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
import { accounts } from "./accounts";
import { parties } from "./parties";
import { assets } from "./assets";
import { journalEntries } from "./journal";
import { users } from "./users";
import { projects, projectCostCodes } from "./projects";
import {
  expenseStatusEnum,
  expenseCategoryEnum,
  expensePaymentMethodEnum,
  partyTypeEnum,
} from "./enums";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

/**
 * Expenses — the seventh module posting into the Mongo ledger.
 *
 * See migration 0059 for why it was missed three times and for the six
 * decisions this table encodes. In short: the postings are in the MODEL
 * (`app/models/expenses.js:608` and `:695`), not the action layer, so every
 * sweep of `app/mongodb/actions/` and then of `lib/` walked straight past it.
 *
 *   post()          DR Expense [/ DR VAT Input]  CR Cash|Bank|Mpesa   (paid)
 *                                                CR Accrued Expenses  (unpaid)
 *   recordPayment() DR Accrued Expenses          CR Cash|Bank|Mpesa
 *
 * DERIVED, not stored (§9.3): `total` and `payment_status`. Mongo computes
 * `total` in `validateAmounts()` and `payment_status` in a `post("init")` read
 * hook — a method and a hook, so any write that skips them leaves the value
 * behind. `subtotal` is not here at all: it is a verbatim copy of `amount`.
 *
 * MONEY IS A STRING. numeric(19,4) maps to string in Drizzle so values never
 * round-trip through float64. Do not Number() these.
 */
export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    expenseNumber: text("expense_number").notNull(),
    expenseDate: date("expense_date").notNull(),
    category: expenseCategoryEnum("category").notNull(),

    // ── The expense account, and what it was called ─────────────────────────
    /**
     * §9.4 — snapshots. Renaming an account must not rewrite the description
     * of an expense already sitting in the ledger.
     */
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    accountCodeAtExpense: text("account_code_at_expense").notNull(),
    accountNameAtExpense: text("account_name_at_expense").notNull(),

    // ── Amounts ─────────────────────────────────────────────────────────────
    amount: money("amount").notNull(),
    taxAmount: money("tax_amount").notNull().default("0"),
    taxRate: numeric("tax_rate", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    withholdingTax: money("withholding_tax").notNull().default("0"),
    /** GENERATED ALWAYS — never written. */
    total: money("total").generatedAlwaysAs(
      sql`amount + tax_amount - withholding_tax`,
    ),
    currency: text("currency").notNull().default("KES"),

    // ── Payment ─────────────────────────────────────────────────────────────
    /**
     * All three move together or not at all — see the
     * `expenses_payment_is_whole` check. That is what makes `paymentStatus`
     * derivable, and what makes "has a payment method but no account" — the
     * state postLegacyExpense exists to repair — inexpressible.
     */
    paymentMethod: expensePaymentMethodEnum("payment_method"),
    paidFromAccountId: uuid("paid_from_account_id").references(
      () => accounts.id,
      { onDelete: "restrict" },
    ),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** GENERATED. The value the `post("init")` hook repairs on every read. */
    paymentStatus: text("payment_status").generatedAlwaysAs(
      sql`CASE WHEN paid_at IS NULL THEN 'unpaid' ELSE 'paid' END`,
    ),

    // ── Payee: supplier or employee ─────────────────────────────────────────
    /**
     * Optional FK, required snapshot — the Mongo shape, where `vendor.name` is
     * required and `vendor.id` is not. `payeeType` drives
     * `journal_entries.party_type` so employee balances aggregate under the
     * right heading, which is what the model's own comment says it is for.
     */
    payeePartyId: uuid("payee_party_id").references(() => parties.id, {
      onDelete: "restrict",
    }),
    payeeType: partyTypeEnum("payee_type").notNull().default("supplier"),
    payeeNameAtExpense: text("payee_name_at_expense").notNull(),
    payeePhoneAtExpense: text("payee_phone_at_expense"),
    payeeEmailAtExpense: text("payee_email_at_expense"),
    payeeTaxPinAtExpense: text("payee_tax_pin_at_expense"),

    // ── Description ─────────────────────────────────────────────────────────
    description: text("description").notNull(),
    reference: text("reference"),
    supplierInvoiceNumber: text("supplier_invoice_number"),
    notes: text("notes"),

    // ── Optional links ──────────────────────────────────────────────────────
    /** Real references since 0070; `text` until then, holding a Mongo ObjectId. */
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    projectNumberAtExpense: text("project_number_at_expense"),
    projectNameAtExpense: text("project_name_at_expense"),
    costCodeId: uuid("cost_code_id").references(() => projectCostCodes.id, {
      onDelete: "set null",
    }),
    costCodeAtExpense: text("cost_code_at_expense"),
    /**
     * A real uuid FK. Fixed assets moved in 0056 and bills' link became real
     * in 0057; `app/models/expenses.js` documents its half of this already —
     * `asset.id` is a String there precisely because Mongoose could not cast a
     * uuid, and tagging an expense to an asset threw a CastError until it was.
     */
    assetId: uuid("asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    assetNumberAtExpense: text("asset_number_at_expense"),
    assetNameAtExpense: text("asset_name_at_expense"),

    // ── Employee reimbursement ──────────────────────────────────────────────
    isReimbursable: boolean("is_reimbursable").notNull().default(false),
    employeePartyId: uuid("employee_party_id").references(() => parties.id, {
      onDelete: "restrict",
    }),
    employeeNameAtExpense: text("employee_name_at_expense"),
    reimbursedAt: timestamp("reimbursed_at", { withTimezone: true }),
    reimbursedById: text("reimbursed_by_id").references(() => users.id, {
      onDelete: "set null",
    }),

    // ── Status and the ledger ───────────────────────────────────────────────
    status: expenseStatusEnum("status").notNull().default("draft"),
    journalEntryId: uuid("journal_entry_id").references(
      () => journalEntries.id,
      { onDelete: "restrict" },
    ),
    /** The accrual path only: posted unpaid, paid later. */
    clearingJournalEntryId: uuid("clearing_journal_entry_id").references(
      () => journalEntries.id,
      { onDelete: "restrict" },
    ),

    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedById: text("posted_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedById: text("voided_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    voidReason: text("void_reason"),

    createdById: text("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    lastModifiedById: text("last_modified_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("expenses_number_unique").on(t.companyId, t.expenseNumber),

    index("expenses_list_idx").on(t.companyId, t.expenseDate, t.status),
    index("expenses_category_idx").on(t.companyId, t.category, t.status),
    index("expenses_payee_idx").on(t.companyId, t.payeePartyId),
    index("expenses_reimbursable_idx").on(
      t.companyId,
      t.isReimbursable,
      t.employeePartyId,
    ),
    index("expenses_asset_idx").on(t.companyId, t.assetId, t.expenseDate),
    /** Accrual ageing: posted and still unpaid. Generated, so it cannot drift. */
    index("expenses_unpaid_idx").on(
      t.companyId,
      t.paymentStatus,
      t.expenseDate,
    ),

    // `min: [0.01]` on the Mongo schema is a validator, so it applies only to
    // writes that run validation.
    check("expenses_amount_positive", sql`${t.amount} > 0`),
    check(
      "expenses_tax_non_negative",
      sql`${t.taxAmount} >= 0 AND ${t.withholdingTax} >= 0 AND ${t.taxRate} >= 0 AND ${t.taxRate} <= 100`,
    ),
    // "Total amount cannot be negative", thrown by validateAmounts() — again a
    // method, so enforced only where it is called.
    check(
      "expenses_total_non_negative",
      sql`${t.amount} + ${t.taxAmount} - ${t.withholdingTax} >= 0`,
    ),
    check(
      "expenses_payment_is_whole",
      sql`(${t.paidAt} IS NULL AND ${t.paymentMethod} IS NULL AND ${t.paidFromAccountId} IS NULL)
          OR (${t.paidAt} IS NOT NULL AND ${t.paymentMethod} IS NOT NULL AND ${t.paidFromAccountId} IS NOT NULL)`,
    ),
    /**
     * A posted expense has an entry; a draft does not. post() sets both in one
     * save, so nothing INTENDS to separate them — but a failure between
     * JournalEntry.create() and expense.save() strands an entry in the ledger
     * with no expense pointing at it, which is what postLegacyExpense's
     * "already has a JE" branch is for.
     */
    check(
      "expenses_posted_has_entry",
      sql`(${t.status} = 'draft' AND ${t.journalEntryId} IS NULL)
          OR (${t.status} <> 'draft' AND ${t.journalEntryId} IS NOT NULL)`,
    ),
    check(
      "expenses_clearing_needs_payment",
      sql`${t.clearingJournalEntryId} IS NULL OR ${t.paidAt} IS NOT NULL`,
    ),
    check(
      "expenses_void_has_reason",
      sql`${t.status} <> 'void' OR ${t.voidedAt} IS NOT NULL`,
    ),
  ],
);

/**
 * Receipts — a table, not the embedded array Mongo carries.
 *
 * `updateExpense` assigns `expense.receipts = receipts` wholesale, so editing
 * an expense and uploading nothing DELETED every receipt already on it. As
 * rows they are added and removed individually and an edit touches none of
 * them unless it means to.
 */
export const expenseReceipts = pgTable(
  "expense_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    url: text("url").notNull(),
    publicId: text("public_id"),
    resourceType: text("resource_type"),
    size: integer("size"),
    mimeType: text("mime_type"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    uploadedById: text("uploaded_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [index("expense_receipts_expense_idx").on(t.expenseId)],
);
