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
import { assets } from "./assets";
import { products } from "./products";
import { journalEntries } from "./journal";
import { projects, projectCostCodes } from "./projects";
import {
  billStatusEnum,
  billLineAccountTypeEnum,
  paymentStatusEnum,
} from "./enums";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

/**
 * Bills — accounts payable. The AP mirror of `invoices`.
 *
 * Per docs/POSTGRES-MIGRATION-PLAN.md §9.6 step 3. Three of the six float
 * tolerances catalogued in §9.2 live in this model, and two of them permit a
 * real error rather than hiding residue:
 *
 *   bill.js:1302  `amount > this.amounts.balance + 0.01`
 *                 — overpay a bill by up to a cent.
 *   bill.js:1324  `Math.abs(this.amounts.balance) < 0.01` then clamp to 0
 *                 — report settled when it is not.
 *   bill.js:992   `Math.abs(debits - credits) > 0.01`
 *                 — post an unbalanced journal entry.
 *
 * None of the three survives here. `balance` is a generated column, so it is
 * always exactly `net_payable - amount_paid` and there is nothing to clamp; the
 * overpay guard becomes CHECK (balance >= 0), which is exact; and the balance
 * of the journal entry was already the database's job from migration 0001.
 *
 * DERIVED, not stored (§9.3, §8.4): `net_payable` and `balance`. Mongo
 * recomputes both in a pre-save hook, so a write that bypasses the hook leaves
 * them stale. `subtotal`, `vat_amount` and `wht_amount` are stored but
 * trigger-maintained from the lines (migration 0016) — the same call made for
 * `invoices.source_type` in 0010: keeping a value stored and keeping it honest
 * are not in conflict, and it saves an aggregate on every read.
 *
 * NOT carried over: the embedded `payments[]` array. As with invoices, a bill's
 * payment history is a query over `payment_allocations` — and making that the
 * only way a bill gets paid is what lets `amount_paid` be maintained from the
 * allocations rather than by hand.
 */
export const bills = pgTable(
  "bills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    billNumber: text("bill_number").notNull(),
    /** The supplier's own invoice number, for reconciliation. */
    supplierInvoiceNumber: text("supplier_invoice_number"),

    billDate: date("bill_date").notNull(),
    dueDate: date("due_date").notNull(),

    // ── Supplier: FK plus what the document said ─────────────────────────────
    supplierId: uuid("supplier_id").notNull(),
    /**
     * §9.4 — snapshots, explicitly. bill.js:234 says so in as many words:
     * "Cached at bill creation time (won't change if supplier updates)".
     * Immutable after insert (migration 0016).
     */
    supplierNameAtBill: text("supplier_name_at_bill").notNull(),
    supplierTaxPinAtBill: text("supplier_tax_pin_at_bill"),
    supplierEmailAtBill: text("supplier_email_at_bill"),
    supplierPhoneAtBill: text("supplier_phone_at_bill"),
    supplierAddressAtBill: text("supplier_address_at_bill"),

    // ── Withholding tax, as it stood on the supplier at bill time ────────────
    whtApplicable: boolean("wht_applicable").notNull().default(false),
    whtRate: numeric("wht_rate", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),

    // ── Amounts ──────────────────────────────────────────────────────────────
    /** Maintained from the lines by a trigger; never written by the caller. */
    subtotal: money("subtotal").notNull().default("0"),
    vatAmount: money("vat_amount").notNull().default("0"),
    whtAmount: money("wht_amount").notNull().default("0"),
    /**
     * GENERATED ALWAYS — never written. Postgres forbids a generated column
     * referencing another generated column, so each spells out its base
     * columns rather than building on the one above.
     */
    total: money("total").generatedAlwaysAs(sql`subtotal + vat_amount`),
    netPayable: money("net_payable").generatedAlwaysAs(
      sql`subtotal + vat_amount - wht_amount`,
    ),
    /**
     * Maintained from `payment_allocations` by a trigger (migration 0016), so
     * it cannot disagree with the payments that produced it.
     */
    amountPaid: money("amount_paid").notNull().default("0"),
    /** §9.3. The value bill.js:1321 recomputes by hand and then clamps. */
    balance: money("balance").generatedAlwaysAs(
      sql`subtotal + vat_amount - wht_amount - amount_paid`,
    ),

    currency: text("currency").notNull().default("KES"),

    status: billStatusEnum("status").notNull().default("draft"),
    /** Set by a trigger from `amount_paid` — a function, not a field. */
    paymentStatus: paymentStatusEnum("payment_status")
      .notNull()
      .default("unpaid"),

    /**
     * A pre-cutover payable carried over during onboarding. Posts only
     * Dr Opening Balance Equity / Cr AP — no expense, VAT, WHT or stock — and
     * carries no lines, so the totals trigger leaves it alone.
     */
    isOpeningBalance: boolean("is_opening_balance").notNull().default(false),

    title: text("title"),
    reference: text("reference"),
    description: text("description"),
    internalNotes: text("internal_notes"),

    // ── Workflow ─────────────────────────────────────────────────────────────
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    submittedById: text("submitted_by_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedById: text("approved_by_id"),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectedById: text("rejected_by_id"),
    rejectionReason: text("rejection_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledById: text("cancelled_by_id"),
    cancellationReason: text("cancellation_reason"),

    /** The purchase journal entry raised when the bill was approved. */
    journalEntryId: uuid("journal_entry_id").references(
      () => journalEntries.id,
      { onDelete: "restrict" },
    ),
    /**
     * True when approval physically admitted inventory. False when the bill
     * posted to GR/IR clearing instead and the stock is admitted on GRN
     * acceptance. Both flags drive the GRN action's branching and are what
     * `cancel()` reads to decide whether there is stock to give back.
     */
    inventoryMoved: boolean("inventory_moved").notNull().default(true),
    usedGrni: boolean("used_grni").notNull().default(false),

    /**
     * Deferred references. `purchase_orders` and `projects` are not ported
     * (§10 — the other 64 models are priced after the slice), so these carry
     * the value without a foreign key rather than dropping data the backfill
     * would need. The FK lands with the table.
     */
    purchaseOrderId: uuid("purchase_order_id"),
    purchaseOrderNumberAtBill: text("purchase_order_number_at_bill"),
    /** A real reference since 0070 — see `projects.project_id` there. */
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    projectNumberAtBill: text("project_number_at_bill"),
    projectNameAtBill: text("project_name_at_bill"),
    /**
     * This was ALREADY uuid while claims, expenses and stock requests had it
     * as text — so the bill form's cost code picker, which posted a Mongo
     * ObjectId, threw `invalid input syntax for type uuid` on every bill
     * anybody tagged. The column was right; the picker feeding it was not.
     */
    costCodeId: uuid("cost_code_id").references(() => projectCostCodes.id, {
      onDelete: "set null",
    }),
    costCodeAtBill: text("cost_code_at_bill"),
    costCodeNameAtBill: text("cost_code_name_at_bill"),

    createdById: text("created_by_id"),
    /**
     * Who acted, as they were named then (0029).
     *
     * There is no users table in Postgres — users are still in Mongo and out
     * of scope (§10) — so an id alone is unrenderable. Same call as 0026 made
     * for invoices, and the same one supplier_name_at_bill already makes on
     * this table: where a person acted, the name is snapshotted beside the id,
     * because a rename must not relabel what already happened (§9.4).
     */
    createdByName: text("created_by_name"),
    createdByRole: text("created_by_role"),
    submittedByName: text("submitted_by_name"),
    approvedByName: text("approved_by_name"),
    rejectedByName: text("rejected_by_name"),
    cancelledByName: text("cancelled_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("bills_company_number_uq").on(t.companyId, t.billNumber),
    uniqueIndex("bills_id_company_uq").on(t.id, t.companyId),
    index("bills_company_supplier_idx").on(t.companyId, t.supplierId, t.status),
    index("bills_company_date_status_idx").on(
      t.companyId,
      t.billDate.desc(),
      t.status,
    ),
    index("bills_company_supplier_invoice_idx").on(
      t.companyId,
      t.supplierInvoiceNumber,
    ),
    // Drives AP aging: only unsettled bills are ever scanned. Mirrors
    // invoices_aging_idx on the AR side.
    index("bills_aging_idx")
      .on(t.companyId, t.dueDate)
      .where(sql`${t.status} = 'approved' AND ${t.paymentStatus} <> 'paid'`),
    /**
     * §9.2 — bill.js:1302 permits `amount > balance + 0.01`, so a bill can be
     * overpaid by up to a cent. `balance` is generated and exact, so the guard
     * is a constraint rather than a tolerance.
     */
    check("bills_not_overpaid", sql`${t.balance} >= 0`),
    check(
      "bills_amounts_non_negative",
      sql`${t.subtotal} >= 0 AND ${t.vatAmount} >= 0 AND ${t.whtAmount} >= 0 AND ${t.amountPaid} >= 0`,
    ),
    check(
      "bills_wht_rate_range",
      sql`${t.whtRate} >= 0 AND ${t.whtRate} <= 30`,
    ),
    // WHT is withheld from the supplier's payment; it cannot exceed the bill.
    check("bills_wht_within_total", sql`${t.whtAmount} <= ${t.subtotal} + ${t.vatAmount}`),
    check("bills_due_on_or_after_bill_date", sql`${t.dueDate} >= ${t.billDate}`),
  ],
);

/**
 * Bill lines.
 *
 * `account_code_at_bill` / `account_name_at_bill` are snapshots, not caches —
 * §9.4 names bill.js:69-70 specifically, and this is the same call migration
 * 0009 made for journal lines after §8.6 got it backwards. What a bill charged
 * to "5200 · Fuel" it charged to "5200 · Fuel", whatever that account is
 * renamed to later.
 *
 * `account_type` is snapshotted for the same reason and because it is load
 * bearing: it decides whether the line debits Inventory, GR/IR clearing, or the
 * account directly.
 *
 * The product, by contrast, is a plain foreign key with no name copied down —
 * the same call `invoice_lines` makes. A bill line's product identity is a
 * reference; its price is the historical fact, and that is what is frozen.
 */
export const billLines = pgTable(
  "bill_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    billId: uuid("bill_id").notNull(),

    lineNumber: integer("line_number").notNull(),
    description: text("description").notNull(),

    /** Optional — set only for stocked items. */
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "restrict",
    }),

    accountId: uuid("account_id").notNull(),
    accountCodeAtBill: text("account_code_at_bill").notNull(),
    accountNameAtBill: text("account_name_at_bill").notNull(),
    accountType: billLineAccountTypeEnum("account_type").notNull(),

    quantity: numeric("quantity", { precision: 19, scale: 4 }).notNull(),
    unit: text("unit").notNull().default("pcs"),
    unitPrice: money("unit_price").notNull(),
    /** GENERATED — bill.js:571 rounds this by hand on every save. */
    amount: money("amount").generatedAlwaysAs(
      sql`(quantity * unit_price)::numeric(19,4)`,
    ),

    vatRate: numeric("vat_rate", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    vatAmount: money("vat_amount").generatedAlwaysAs(
      sql`(quantity * unit_price * vat_rate / 100)::numeric(19,4)`,
    ),
    lineTotal: money("line_total").generatedAlwaysAs(
      sql`(quantity * unit_price + quantity * unit_price * vat_rate / 100)::numeric(19,4)`,
    ),

    /**
     * Goods already admitted against a weighbridge ticket. When set, approval
     * debits GR/IR to clear it rather than Inventory — the receipt already
     * posted Dr Inventory / Cr GR/IR — and queues no stock movement.
     */
    weighbridgeTicketId: uuid("weighbridge_ticket_id"),

    /** Deferred references — see the note on bills.purchase_order_id. */
    purchaseOrderId: uuid("purchase_order_id"),
    purchaseOrderLineNumber: integer("purchase_order_line_number"),
    /**
     * The asset this line was for — fuel, servicing, repairs. A real foreign
     * key since 0057, which is what 0053 said would happen when assets landed.
     */
    assetId: uuid("asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    assetNumberAtBill: text("asset_number_at_bill"),
    assetNameAtBill: text("asset_name_at_bill"),
    /**
     * Set once this line has been capitalised into a register entry; the
     * unique index on it is what blocks doing so twice (0057).
     */
    capitalizedAssetId: uuid("capitalized_asset_id").references(
      () => assets.id,
      { onDelete: "set null" },
    ),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("bill_lines_bill_line_uq").on(t.billId, t.lineNumber),
    index("bill_lines_bill_idx").on(t.billId),
    index("bill_lines_company_product_idx").on(t.companyId, t.productId),
    index("bill_lines_company_account_idx").on(t.companyId, t.accountId),
    check("bill_lines_quantity_positive", sql`${t.quantity} > 0`),
    check("bill_lines_unit_price_non_negative", sql`${t.unitPrice} >= 0`),
    check(
      "bill_lines_vat_rate_range",
      sql`${t.vatRate} >= 0 AND ${t.vatRate} <= 100`,
    ),
  ],
);
