import {
  pgTable,
  uuid,
  text,
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
import { journalEntries } from "./journal";
import {
  taxTypeEnum,
  taxSourceDocumentTypeEnum,
  partyTypeEnum,
} from "./enums";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

/**
 * Statutory tax records — VAT, withholding, payroll taxes — and their filing
 * and remittance state.
 *
 * Per docs/POSTGRES-MIGRATION-PLAN.md §9.6 step 4. The sweep found no float
 * tolerances, no pre-save derived values and no snapshot fields to reclassify
 * in this model, and §9.5 keeps the tax transaction structure as-is. So this is
 * the most faithful port of the four slices — the nested blocks are flattened
 * and the references are made real, and nothing else changes.
 *
 * Three things this does correct, all of them the same corrections already made
 * elsewhere in the migration rather than new decisions:
 *
 * 1. `party.id` is a bare `String` with no `ref` in Mongo, so a tax record can
 *    name a party that does not exist — the referential gap `parties` closed
 *    for journal_entries (0005) and credit notes (0016). Here it is a
 *    tenant-scoped foreign key.
 *
 * 2. The party and account details ARE snapshots, and are treated as such even
 *    though §9.1 counted none in this model. A filed tax record states what was
 *    filed: the supplier's name and PIN as they appeared on the return. A
 *    rename must not rewrite a submission already made to KRA. This is the
 *    §9.4 rule applied where the sweep did not look, not a departure from it.
 *
 * 3. `transaction_number` stays deterministic (`VAT-OUT-<invoice number>`,
 *    `WHT-<bill number>`) rather than becoming a counter. Combined with the
 *    per-company unique index, that is what makes posting the same document's
 *    tax twice a unique violation instead of a duplicate return line — the
 *    same reasoning as `cogs_postings`' primary key in §8.3.
 */
export const taxTransactions = pgTable(
  "tax_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    /**
     * Deterministic, derived from the source document — not a counter. See the
     * note above: the unique index on (company_id, transaction_number) is what
     * makes a double-posting fail loudly.
     */
    transactionNumber: text("transaction_number").notNull(),
    transactionDate: date("transaction_date").notNull(),

    taxType: taxTypeEnum("tax_type").notNull(),
    /** e.g. "VAT-16", "WHT-5". */
    taxCode: text("tax_code").notNull(),
    taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull(),

    // ── Amounts ──────────────────────────────────────────────────────────────
    /** What the tax was calculated on. */
    baseAmount: money("base_amount").notNull(),
    taxAmount: money("tax_amount").notNull(),
    /**
     * NOT derived, and NOT the same quantity for every tax type — worth
     * reading before anyone "fixes" it into a generated column.
     *
     *   vat_input / vat_output   gross document value      base + tax
     *   wht                      net cash paid to the payee base + vat - tax
     *
     * The Mongo schema comment (taxTransactions.js:108-110) says `base - tax`
     * for WHT. That comment is wrong, and the code it sits above does not
     * follow it — the WHT branch stores the bill's `netPayable`.
     *
     * `netPayable` is the correct figure. VAT is a tax the supplier collects
     * and remits, so the buyer pays it in full; WHT is deducted from what the
     * buyer hands over. On 15,050 + 16% VAT with 5% withheld, the supplier is
     * paid 16,705.50 and 752.50 goes to KRA — and 16,705.50 is what a WHT
     * certificate reports as the net paid. `base - tax` would be 14,297.50,
     * which is neither the payment, the base, nor the gross.
     *
     * So it stays stored and unconstrained: no single formula covers both tax
     * types, and the two cannot be told apart from base and tax alone, because
     * the VAT that separates them is not a column here. See §9.8.
     */
    totalAmount: money("total_amount").notNull(),
    currency: text("currency").notNull().default("KES"),

    // ── Party: FK plus what the return said ──────────────────────────────────
    partyId: uuid("party_id").notNull(),
    partyType: partyTypeEnum("party_type").notNull(),
    partyNameAtTransaction: text("party_name_at_transaction").notNull(),
    partyTaxPinAtTransaction: text("party_tax_pin_at_transaction"),
    partyEmailAtTransaction: text("party_email_at_transaction"),
    partyPhoneAtTransaction: text("party_phone_at_transaction"),

    // ── Source document ──────────────────────────────────────────────────────
    /**
     * Polymorphic by design, as in Mongo's `refPath`. Validated by a trigger
     * (migration 0018) rather than a foreign key, since the target table
     * depends on the type — the same treatment `payment_allocations` gets.
     */
    sourceDocumentType: taxSourceDocumentTypeEnum("source_document_type").notNull(),
    sourceDocumentId: uuid("source_document_id").notNull(),
    sourceDocumentNumber: text("source_document_number"),
    sourceDocumentDate: date("source_document_date"),

    // ── KRA tracking, flattened from the nested block ────────────────────────
    /**
     * YYYY-MM. Filled from `transaction_date` by a trigger when not supplied,
     * but settable: a transaction can legitimately be filed in a later period
     * than the one it falls in, and Mongo's always-derive-from-the-date rule
     * cannot express that.
     */
    filingPeriod: text("filing_period").notNull(),
    filed: boolean("filed").notNull().default(false),
    filedAt: timestamp("filed_at", { withTimezone: true }),
    filedById: uuid("filed_by_id"),
    filingReference: text("filing_reference"),

    remitted: boolean("remitted").notNull().default(false),
    remittedAt: timestamp("remitted_at", { withTimezone: true }),
    remittedById: uuid("remitted_by_id"),
    remittanceReference: text("remittance_reference"),

    certificateIssued: boolean("certificate_issued").notNull().default(false),
    certificateNumber: text("certificate_number"),
    certificateIssuedAt: timestamp("certificate_issued_at", {
      withTimezone: true,
    }),

    // ── Reconciliation ───────────────────────────────────────────────────────
    reconciled: boolean("reconciled").notNull().default(false),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    reconciledById: uuid("reconciled_by_id"),
    reconciliationNotes: text("reconciliation_notes"),

    // ── Accounting link ──────────────────────────────────────────────────────
    journalEntryId: uuid("journal_entry_id").references(
      () => journalEntries.id,
      { onDelete: "restrict" },
    ),
    accountId: uuid("account_id").notNull(),
    accountCodeAtTransaction: text("account_code_at_transaction").notNull(),
    accountNameAtTransaction: text("account_name_at_transaction").notNull(),

    description: text("description"),
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
    uniqueIndex("tax_transactions_company_number_uq").on(
      t.companyId,
      t.transactionNumber,
    ),
    uniqueIndex("tax_transactions_id_company_uq").on(t.id, t.companyId),
    index("tax_transactions_company_date_type_idx").on(
      t.companyId,
      t.transactionDate.desc(),
      t.taxType,
    ),
    index("tax_transactions_company_party_type_idx").on(
      t.companyId,
      t.partyId,
      t.taxType,
    ),
    index("tax_transactions_company_period_type_idx").on(
      t.companyId,
      t.filingPeriod,
      t.taxType,
    ),
    index("tax_transactions_source_idx").on(
      t.companyId,
      t.sourceDocumentType,
      t.sourceDocumentId,
    ),
    // Drives the "what still needs filing / remitting" queries, which are the
    // ones with a deadline attached. Partial, so only outstanding rows are
    // scanned — the filed archive grows without end and is never the answer.
    index("tax_transactions_unfiled_idx")
      .on(t.companyId, t.taxType, t.filingPeriod)
      .where(sql`${t.filed} = false`),
    index("tax_transactions_unremitted_idx")
      .on(t.companyId, t.taxType, t.filingPeriod)
      .where(sql`${t.remitted} = false`),

    check(
      "tax_transactions_amounts_non_negative",
      sql`${t.baseAmount} >= 0 AND ${t.taxAmount} >= 0 AND ${t.totalAmount} >= 0`,
    ),
    check(
      "tax_transactions_rate_range",
      sql`${t.taxRate} >= 0 AND ${t.taxRate} <= 100`,
    ),
    check(
      "tax_transactions_filing_period_format",
      sql`${t.filingPeriod} ~ '^\\d{4}-\\d{2}$'`,
    ),
  ],
);
