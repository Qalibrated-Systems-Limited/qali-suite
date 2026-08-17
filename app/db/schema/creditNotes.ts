import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  date,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { products } from "./products";
import { journalEntries } from "./journal";
import {
  creditNoteStatusEnum,
  creditNoteReasonEnum,
  creditNoteItemTypeEnum,
} from "./enums";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

/**
 * Credit notes — a credit raised against a sales invoice.
 *
 * Per docs/POSTGRES-MIGRATION-PLAN.md §9.6 step 3.
 *
 * DERIVED (§9.3): `amount_remaining`. Mongo computes it in `calculateAmounts()`
 * and stores it, so it is only right for as long as nothing writes around that
 * method. `subtotal` and `tax_amount` are stored but trigger-maintained from
 * the lines (migration 0016), like bills.
 *
 * KEPT as snapshots (§9.4): the customer block, which creditNote.js:63 labels
 * "cached from invoice", plus the invoice's number, date and total as they
 * stood when the credit was raised. A credit note is a document issued against
 * another document; what it recorded about that document is a historical fact.
 *
 * The `isFullyApplied` virtual (creditNote.js:328) reads
 * `amountRemaining <= 0.01`, one more float tolerance of the §8.5 kind — it
 * reports a credit exhausted while up to a cent of it is still outstanding.
 * `amount_remaining` is exact here, so the test is `= 0`.
 */
export const creditNotes = pgTable(
  "credit_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    creditNoteNumber: text("credit_note_number").notNull(),
    creditNoteDate: date("credit_note_date").notNull(),

    // ── The invoice being credited: FK plus what the note recorded ───────────
    invoiceId: uuid("invoice_id").notNull(),
    invoiceNumberAtIssue: text("invoice_number_at_issue").notNull(),
    invoiceDateAtIssue: date("invoice_date_at_issue"),
    /** The invoice's total when the credit was raised. */
    invoiceTotalAtIssue: money("invoice_total_at_issue"),

    // ── Customer: FK plus what the note recorded ─────────────────────────────
    /**
     * Mongo stores `customer.id` as a bare String with no ref, so nothing
     * checks that the customer exists — the same referential gap `parties`
     * closed for journal_entries in migration 0005. Here it is a real
     * tenant-scoped foreign key.
     */
    customerId: uuid("customer_id").notNull(),
    customerNameAtIssue: text("customer_name_at_issue").notNull(),
    customerEmailAtIssue: text("customer_email_at_issue"),
    customerPhoneAtIssue: text("customer_phone_at_issue"),
    customerAddressAtIssue: text("customer_address_at_issue"),
    customerTaxPinAtIssue: text("customer_tax_pin_at_issue"),

    reason: creditNoteReasonEnum("reason").notNull(),
    reasonDescription: text("reason_description").notNull(),

    // ── Amounts ──────────────────────────────────────────────────────────────
    /** Maintained from the lines by a trigger; never written by the caller. */
    subtotal: money("subtotal").notNull().default("0"),
    taxAmount: money("tax_amount").notNull().default("0"),
    total: money("total").generatedAlwaysAs(sql`subtotal + tax_amount`),

    amountApplied: money("amount_applied").notNull().default("0"),
    /** §9.3 — the value `calculateAmounts()` stores and can leave stale. */
    amountRemaining: money("amount_remaining").generatedAlwaysAs(
      sql`subtotal + tax_amount - amount_applied`,
    ),

    currency: text("currency").notNull().default("KES"),

    status: creditNoteStatusEnum("status").notNull().default("draft"),

    // ── Accounting links ─────────────────────────────────────────────────────
    /** Dr Revenue, Dr VAT Output, Cr Accounts Receivable. */
    journalEntryId: uuid("journal_entry_id").references(
      () => journalEntries.id,
      { onDelete: "restrict" },
    ),
    /** Dr Inventory, Cr COGS — raised only for lines that restore stock. */
    inventoryJournalEntryId: uuid("inventory_journal_entry_id").references(
      () => journalEntries.id,
      { onDelete: "restrict" },
    ),

    issuedAt: timestamp("issued_at", { withTimezone: true }),
    issuedById: uuid("issued_by_id"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedById: uuid("voided_by_id"),
    voidReason: text("void_reason"),

    notes: text("notes"),

    createdById: uuid("created_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("credit_notes_company_number_uq").on(
      t.companyId,
      t.creditNoteNumber,
    ),
    uniqueIndex("credit_notes_id_company_uq").on(t.id, t.companyId),
    index("credit_notes_company_invoice_idx").on(t.companyId, t.invoiceId),
    index("credit_notes_company_customer_idx").on(
      t.companyId,
      t.customerId,
      t.status,
    ),
    index("credit_notes_company_date_status_idx").on(
      t.companyId,
      t.creditNoteDate.desc(),
      t.status,
    ),
    // A credit cannot be applied for more than it is worth. Exact, because
    // amount_remaining is generated rather than recomputed by hand.
    check("credit_notes_not_over_applied", sql`${t.amountRemaining} >= 0`),
    check(
      "credit_notes_amounts_non_negative",
      sql`${t.subtotal} >= 0 AND ${t.taxAmount} >= 0 AND ${t.amountApplied} >= 0`,
    ),
  ],
);

/**
 * Credit note lines.
 *
 * One departure from the Mongo shape, and it is a translation rather than a
 * redesign: `originalItemIndex` — a position in the invoice's embedded items
 * array — becomes `original_invoice_line_id`, a foreign key. There is no array
 * to index into here, and an ordinal that silently repoints when a line is
 * removed was never a reference in the first place.
 *
 * `original_quantity` and `original_unit_price` stay as the model has them:
 * what the invoice line said, recorded on the credit for comparison.
 */
export const creditNoteLines = pgTable(
  "credit_note_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    creditNoteId: uuid("credit_note_id").notNull(),

    lineNumber: integer("line_number").notNull(),
    /** The invoice line this credits, where one applies. */
    originalInvoiceLineId: uuid("original_invoice_line_id"),

    itemType: creditNoteItemTypeEnum("item_type").notNull(),
    /** Set for product lines; null for services. */
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "restrict",
    }),

    description: text("description").notNull(),
    unit: text("unit").notNull().default("pcs"),

    /** The quantity being credited — not the quantity originally sold. */
    quantity: numeric("quantity", { precision: 19, scale: 4 }).notNull(),
    originalQuantity: numeric("original_quantity", {
      precision: 19,
      scale: 4,
    }),
    originalUnitPrice: money("original_unit_price"),

    unitPrice: money("unit_price").notNull(),
    amount: money("amount").generatedAlwaysAs(
      sql`(quantity * unit_price)::numeric(19,4)`,
    ),

    taxRate: numeric("tax_rate", { precision: 5, scale: 2 })
      .notNull()
      .default("16"),
    taxAmount: money("tax_amount").generatedAlwaysAs(
      sql`(quantity * unit_price * tax_rate / 100)::numeric(19,4)`,
    ),

    /** Whether crediting this line puts the stock back on the shelf. */
    restoreInventory: boolean("restore_inventory").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("credit_note_lines_note_line_uq").on(
      t.creditNoteId,
      t.lineNumber,
    ),
    index("credit_note_lines_note_idx").on(t.creditNoteId),
    index("credit_note_lines_company_product_idx").on(t.companyId, t.productId),
    check("credit_note_lines_quantity_positive", sql`${t.quantity} > 0`),
    check("credit_note_lines_unit_price_non_negative", sql`${t.unitPrice} >= 0`),
    check(
      "credit_note_lines_tax_rate_range",
      sql`${t.taxRate} >= 0 AND ${t.taxRate} <= 100`,
    ),
    // A product line restoring inventory must say which product.
    check(
      "credit_note_lines_product_required",
      sql`(${t.itemType} = 'product') = (${t.productId} IS NOT NULL)`,
    ),
  ],
);
