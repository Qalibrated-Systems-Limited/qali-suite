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
import { parties } from "./parties";
import { products } from "./products";
import { journalEntries } from "./journal";
import { stockRequests, itemCheckouts, weighbridgeTickets } from "./fulfilment";
import {
  invoiceStatusEnum,
  paymentStatusEnum,
  fulfilmentSourceEnum,
  cogsSourceEnum,
  invoiceSourceTypeEnum,
  lineItemTypeEnum,
  serviceCategoryEnum,
} from "./enums";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

/**
 * Sales invoices.
 *
 * Deliberate omissions from app/models/invoice.js, per
 * docs/POSTGRES-MIGRATION-PLAN.md §8:
 *
 * - `source_type` IS stored, as in Mongo, but a trigger keeps it in step with
 *   the lines (migration 0010). The earlier decision to derive it removed a
 *   field the application reads and added an aggregate to every read, to
 *   prevent a divergence that has not been observed. Storing it and
 *   maintaining it gives the same guarantee more cheaply. `requestId` and
 *   `checkoutIds[]` are not duplicated at the header — the lines carry them.
 *
 * - `paymentHistory[]` is not embedded. Payments are their own table with
 *   allocations; an invoice's payment history is a query.
 *
 * - `amountDue` is not stored: it is total - amount_paid, and a stored
 *   difference is one more value that can drift (§8.4).
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    invoiceNumber: text("invoice_number").notNull(),
    invoiceDate: date("invoice_date").notNull(),
    dueDate: date("due_date"),

    customerId: uuid("customer_id").notNull(),
    /**
     * The project this invoice bills against (0054). `CreateInvoiceForm` has
     * posted a `projectId` since it was written and there was no column to put
     * it in, so every link a user picked was dropped on the way in.
     *
     * text, not uuid — projects are not ported, so this is a Mongo ObjectId.
     */
    projectId: text("project_id"),
    projectNumberAtInvoice: text("project_number_at_invoice"),
    projectNameAtInvoice: text("project_name_at_invoice"),
    title: text("title"),
    notes: text("notes"),

    subtotal: money("subtotal").notNull().default("0"),
    /**
     * The header discount the form has always shown and the port never stored
     * (0055). Mongo keeps both the percentage and the money; so does this.
     */
    discountPercentage: numeric("discount_percentage", { precision: 9, scale: 4 })
      .notNull()
      .default("0"),
    discountTotal: money("discount_total").notNull().default("0"),
    taxAmount: money("tax_amount").notNull().default("0"),
    total: money("total").notNull().default("0"),
    currency: text("currency").notNull().default("KES"),

    amountPaid: money("amount_paid").notNull().default("0"),
    paymentStatus: paymentStatusEnum("payment_status")
      .notNull()
      .default("unpaid"),
    paymentTermsDays: integer("payment_terms_days").notNull().default(30),
    /**
     * A pre-cutover receivable carried in during onboarding (0061).
     * Posts Dr AR / Cr Opening Balance Equity — no revenue, no VAT, no
     * COGS — so the AR subledger is seeded without booking a sale into
     * the new period. `bills` has carried the same flag since the bills
     * port; invoices never got it.
     */
    isOpeningBalance: boolean("is_opening_balance").notNull().default(false),


    status: invoiceStatusEnum("status").notNull().default("draft"),
    /**
     * Header provenance. Stored (as in Mongo) rather than derived, and kept in
     * step with the lines by a trigger — so it cannot contradict them without
     * costing an aggregate on every read. The invoice_provenance view remains
     * available for spotting drift.
     */
    sourceType: invoiceSourceTypeEnum("source_type").notNull().default("direct"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedById: text("completed_by_id"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledById: text("cancelled_by_id"),

    /** The revenue journal entry raised when the invoice was completed. */
    revenueEntryId: uuid("revenue_entry_id").references(
      () => journalEntries.id,
      { onDelete: "restrict" },
    ),
    /**
     * The cost-of-sales entry: DR COGS, CR Inventory and/or Technician Stock.
     * A completed invoice raises two entries, and both are traceable (0027).
     */
    cogsEntryId: uuid("cogs_entry_id").references(() => journalEntries.id, {
      onDelete: "restrict",
    }),

    createdById: text("created_by_id"),
    /**
     * Who raised it, as they were named then. There is no users table in
     * Postgres to join to, and a rename must not relabel a document already
     * issued — the same call item_checkouts and stock_requests make (§9.4).
     */
    createdByName: text("created_by_name"),
    createdByRole: text("created_by_role"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("invoices_company_number_uq").on(t.companyId, t.invoiceNumber),
    uniqueIndex("invoices_id_company_uq").on(t.id, t.companyId),
    index("invoices_company_customer_idx").on(t.companyId, t.customerId),
    index("invoices_company_project_idx")
      .on(t.companyId, t.projectId)
      .where(sql`${t.projectId} IS NOT NULL AND ${t.projectId} <> ''`),
    index("invoices_company_date_status_idx").on(
      t.companyId,
      t.invoiceDate.desc(),
      t.status,
    ),
    // Drives AR aging: only unsettled invoices are ever scanned.
    index("invoices_aging_idx")
      .on(t.companyId, t.dueDate)
      .where(sql`${t.status} = 'completed' AND ${t.paymentStatus} <> 'paid'`),
    check(
      "invoices_amounts_non_negative",
      sql`${t.subtotal} >= 0 AND ${t.total} >= 0 AND ${t.amountPaid} >= 0 AND ${t.taxAmount} >= 0`,
    ),
  ],
);

/**
 * Invoice lines.
 *
 * `fulfilment_source` is the §8.1 correction: mandatory, single-valued, and
 * CHECK-constrained (migration 0007) so that exactly the matching reference is
 * present. In Mongo this is inferred from whether a nullable nested field
 * exists, which makes "sold from main inventory" indistinguishable from "the
 * relatedRequest field failed to save" — and decides which inventory account
 * COGS credits.
 *
 * `unit_price` and `unit_cost` ARE stored rather than joined from products.
 * That is deliberate and the opposite call to the cached account names dropped
 * from journal lines: the price charged and the cost at the moment of sale are
 * historical facts. Re-pricing a product must not rewrite last year's invoices.
 */
export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    invoiceId: uuid("invoice_id").notNull(),

    /**
     * A line sells a stocked product or a service. Mongo has carried this since
     * the beginning — labour, mileage, accommodation, installation fees — and
     * this table did not, with `product_id NOT NULL`, so no invoice containing
     * a service line could be represented at all. Found while extending the
     * backfill; corrected in migration 0025.
     */
    itemType: lineItemTypeEnum("item_type").notNull().default("product"),
    /** Set for service lines; null for products. */
    serviceCategory: serviceCategoryEnum("service_category"),
    /** Null for a service — there is no product to point at. */
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "restrict",
    }),

    lineNumber: integer("line_number").notNull(),
    description: text("description"),
    unit: text("unit").notNull().default("pcs"),

    quantity: numeric("quantity", { precision: 19, scale: 4 }).notNull(),
    /** Frozen at sale time — see note above. */
    unitPrice: money("unit_price").notNull(),
    /** Cost used for COGS, frozen at sale time. */
    unitCost: money("unit_cost").notNull().default("0"),
    discountAmount: money("discount_amount").notNull().default("0"),
    taxAmount: money("tax_amount").notNull().default("0"),
    lineTotal: money("line_total").notNull(),

    // ── Fulfilment (§8.1) ────────────────────────────────────────────────────
    fulfilmentSource: fulfilmentSourceEnum("fulfilment_source")
      .notNull()
      .default("inventory"),
    stockRequestId: uuid("stock_request_id"),
    checkoutId: uuid("checkout_id"),
    weighbridgeTicketId: uuid("weighbridge_ticket_id"),

    /**
     * What the document said at the time of sale — immutable snapshots filled
     * by a trigger (migration 0010), not a cache.
     *
     * The FKs above are what make the reference valid; these are what the line
     * recorded. A technician's name when stock was issued to them is a
     * historical fact: they leave, records get renamed or anonymised, and a
     * join would silently relabel a delivery that definitely happened. Keeping
     * them also avoids three joins per line just to print a name.
     */
    stockRequestNumberAtSale: text("stock_request_number_at_sale"),
    technicianNameAtSale: text("technician_name_at_sale"),
    checkoutNumberAtSale: text("checkout_number_at_sale"),
    weighbridgeTicketNumberAtSale: text("weighbridge_ticket_number_at_sale"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("invoice_lines_invoice_line_uq").on(t.invoiceId, t.lineNumber),
    index("invoice_lines_company_product_idx").on(t.companyId, t.productId),
    index("invoice_lines_invoice_idx").on(t.invoiceId),
    check("invoice_lines_quantity_positive", sql`${t.quantity} > 0`),
    // A product line names a product; a service line does not. The same rule
    // credit_note_lines has carried since 0015.
    check(
      "invoice_lines_product_matches_item_type",
      sql`(${t.itemType} = 'product') = (${t.productId} IS NOT NULL)`,
    ),
    check(
      "invoice_lines_amounts_non_negative",
      sql`${t.unitPrice} >= 0 AND ${t.unitCost} >= 0 AND ${t.discountAmount} >= 0`,
    ),
  ],
);

/**
 * One row per invoice line whose COGS has been posted — by whichever system got
 * there first.
 *
 * This is the §8.3 correction. Today, double-posting is prevented by the
 * weighbridge connector reading the invoice's status and standing down if it is
 * already completed. That read and the subsequent journal insert are not in one
 * transaction, and the invoice posts from a different process, so an invoice
 * completed inside that window produces COGS twice.
 *
 * Making invoice_line_id the PRIMARY KEY removes the race entirely: the second
 * writer takes a unique violation instead of duplicating the posting. It also
 * records WHICH quantity was costed and by whom, so a weighed-1750 against
 * billed-1800 discrepancy becomes queryable rather than a warning string.
 */
export const cogsPostings = pgTable(
  "cogs_postings",
  {
    invoiceLineId: uuid("invoice_line_id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    postedBy: cogsSourceEnum("posted_by").notNull(),
    journalEntryId: uuid("journal_entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "restrict" }),
    /** The quantity actually costed — weighed or billed, whichever applied. */
    quantity: numeric("quantity", { precision: 19, scale: 4 }).notNull(),
    unitCost: money("unit_cost").notNull(),
    totalCost: money("total_cost").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("cogs_postings_company_idx").on(t.companyId),
    index("cogs_postings_entry_idx").on(t.journalEntryId),
    check("cogs_postings_quantity_positive", sql`${t.quantity} > 0`),
  ],
);
