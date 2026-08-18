import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  date,
  integer,
  boolean,
  index,
  uniqueIndex,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { accounts } from "./accounts";
import { fiscalPeriods } from "./fiscalPeriods";
import {
  journalStatusEnum,
  journalEntryTypeEnum,
  partyTypeEnum,
  sourceDocumentTypeEnum,
} from "./enums";

/**
 * MONEY: every monetary column below is numeric(19,4) — exact decimal.
 *
 * The Mongo schema stores these as JS float64, which is why
 * JournalEntry.isBalanced carries a `Math.abs(d - c) < 0.01` tolerance: it is a
 * workaround for float drift, and it lets an entry post up to a cent out of
 * balance. With exact decimals the tolerance is unnecessary, so the balance
 * check in migration 0001 uses strict equality.
 */
const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),

    entryNumber: text("entry_number").notNull(),
    entryDate: date("entry_date").notNull(),
    entryType: journalEntryTypeEnum("entry_type").notNull(),

    description: text("description").notNull(),
    reference: text("reference"),
    notes: text("notes"),

    // Party — the cached name/email/phone on the Mongo doc are dropped; they
    // come from a join on parties so a renamed customer is not stale here.
    partyType: partyTypeEnum("party_type"),
    partyId: uuid("party_id"),

    dueDate: date("due_date"),

    // Replaces the 12 nullable ids under relatedDocuments. One polymorphic
    // pair; the source_type enum keeps it honest.
    sourceType: sourceDocumentTypeEnum("source_type"),
    sourceId: uuid("source_id"),

    status: journalStatusEnum("status").notNull().default("draft"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedById: text("posted_by_id"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedById: text("reversed_by_id"),

    reversalEntryId: uuid("reversal_entry_id").references(
      (): AnyPgColumn => journalEntries.id,
      { onDelete: "set null" },
    ),
    originalEntryId: uuid("original_entry_id").references(
      (): AnyPgColumn => journalEntries.id,
      { onDelete: "set null" },
    ),

    // Payment tracking (AR/AP aging).
    isFullyPaid: boolean("is_fully_paid").notNull().default(false),
    amountPaid: money("amount_paid").notNull().default("0"),
    amountOutstanding: money("amount_outstanding").notNull().default("0"),

    fiscalPeriodId: uuid("fiscal_period_id").references(
      () => fiscalPeriods.id,
      { onDelete: "restrict" },
    ),
    fiscalYear: integer("fiscal_year"),
    fiscalMonth: integer("fiscal_month"),

    createdById: text("created_by_id"),
    lastModifiedById: text("last_modified_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("journal_entries_company_number_uq").on(
      t.companyId,
      t.entryNumber,
    ),
    index("journal_entries_company_date_status_idx").on(
      t.companyId,
      t.entryDate.desc(),
      t.status,
    ),
    index("journal_entries_company_party_idx").on(
      t.companyId,
      t.partyType,
      t.partyId,
    ),
    // Drives AR/AP aging: only unpaid entries are ever scanned.
    index("journal_entries_aging_idx")
      .on(t.companyId, t.partyType, t.dueDate)
      .where(sql`${t.isFullyPaid} = false AND ${t.status} = 'posted'`),
    index("journal_entries_company_period_idx").on(
      t.companyId,
      t.fiscalYear,
      t.fiscalMonth,
    ),
    index("journal_entries_source_idx").on(t.companyId, t.sourceType, t.sourceId),
    check(
      "journal_entries_fiscal_month_range",
      sql`${t.fiscalMonth} IS NULL OR ${t.fiscalMonth} BETWEEN 1 AND 12`,
    ),
    check(
      "journal_entries_amounts_non_negative",
      sql`${t.amountPaid} >= 0 AND ${t.amountOutstanding} >= 0`,
    ),
    // A party id without a type (or vice versa) produced silently unjoinable
    // rows in the Mongo data.
    check(
      "journal_entries_party_pair",
      sql`(${t.partyType} IS NULL) = (${t.partyId} IS NULL)`,
    ),
    check(
      "journal_entries_source_pair",
      sql`(${t.sourceType} IS NULL) = (${t.sourceId} IS NULL)`,
    ),
  ],
);

/**
 * Journal lines — the embedded `lines[]` array, promoted to a real table.
 *
 * The cached accountCode/accountName/accountType on each embedded line are
 * dropped in favour of the FK join. They existed to avoid a lookup; a FK plus
 * an index does that job without going stale when an account is renamed.
 *
 * Two invariants are enforced here rather than in application code:
 *   - exactly one of debit/credit is non-zero  (replaces validateLines())
 *   - per entry, SUM(debit) = SUM(credit)      (deferred trigger, migration 0001)
 */
export const journalLines = pgTable(
  "journal_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),

    // Ordering within the entry, so a re-read reproduces the original document.
    lineNumber: integer("line_number").notNull(),

    debit: money("debit").notNull().default("0"),
    credit: money("credit").notNull().default("0"),
    description: text("description"),

    /**
     * The account's code and name AS POSTED — an immutable snapshot, not a
     * cache. Populated by a trigger on insert and refused on update (migration
     * 0009), so renaming an account cannot relabel a trial balance printed
     * years ago.
     *
     * Use account_id for all aggregation and any report grouping by the live
     * chart. Use these only to reproduce a journal document as it was posted.
     */
    accountCodeAtPosting: text("account_code_at_posting").notNull().default(""),
    accountNameAtPosting: text("account_name_at_posting").notNull().default(""),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("journal_lines_entry_line_uq").on(t.entryId, t.lineNumber),
    // The workhorse index: every balance, trial balance and ledger report
    // aggregates lines by account within a tenant.
    index("journal_lines_company_account_idx").on(t.companyId, t.accountId),
    index("journal_lines_entry_idx").on(t.entryId),
    check("journal_lines_debit_non_negative", sql`${t.debit} >= 0`),
    check("journal_lines_credit_non_negative", sql`${t.credit} >= 0`),
    // Exactly one side populated, and not a zero-amount line.
    check(
      "journal_lines_one_sided",
      sql`(${t.debit} > 0) <> (${t.credit} > 0)`,
    ),
  ],
);
