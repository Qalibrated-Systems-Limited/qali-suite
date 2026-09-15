import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  date,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { accounts } from "./accounts";
import { parties } from "./parties";
import { invoices } from "./invoices";
import { bills } from "./bills";
import { payments } from "./payments";
import { journalEntries } from "./journal";
import {
  bankStatementStatusEnum,
  bankBalanceSourceEnum,
  bankLineStatusEnum,
  bankExcludeReasonEnum,
  bankAllocationTypeEnum,
  bankMatchDocumentEnum,
} from "./enums";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

/**
 * Bank statements — 0100.
 *
 * Banking was carried in every count as "stays on Mongo by decision … it is
 * not currently broken — it reads the store it still writes". The second half
 * was wrong: `bankFeedService` also read Mongo `Account`, `Invoice` and
 * `Bill`, all three of which moved, so the bank picker was empty, the account
 * pickers were empty, and no line could be matched to anything. The module was
 * inert, not working.
 *
 * THE STATS ARE NOT HERE. Mongo kept six counters on this document, refreshed
 * by `updateStatementStats()` after every allocation and exclusion — a cache
 * maintained by hand at nine call sites. `bank_statement_stats` is a view; see
 * `getStatementStats` in the repository.
 */
export const bankStatements = pgTable(
  "bank_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** RESTRICT: deleting the account would drop the reconciliation with it. */
    bankAccountId: uuid("bank_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),

    fileName: text("file_name").notNull(),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),

    status: bankStatementStatusEnum("status").notNull().default("processing"),

    /** The BANK's numbers, which is what a reconciliation compares against. */
    openingBalance: money("opening_balance"),
    closingBalance: money("closing_balance"),
    balanceSource: bankBalanceSourceEnum("balance_source")
      .notNull()
      .default("unavailable"),

    /** The column mapping used, so the next file from this bank need not be
     *  re-mapped by hand. Flattened from Mongo's embedded object. */
    mappingDate: text("mapping_date"),
    mappingDescription: text("mapping_description"),
    mappingReference: text("mapping_reference"),
    mappingDebit: text("mapping_debit"),
    mappingCredit: text("mapping_credit"),
    mappingAmount: text("mapping_amount"),
    mappingBalance: text("mapping_balance"),
    dateFormat: text("date_format").notNull().default("DD/MM/YYYY"),

    errorMessage: text("error_message"),
    /** sha256 of the file — duplicate-upload detection. */
    contentHash: text("content_hash"),

    uploadedById: text("uploaded_by_id"),
    uploadedByName: text("uploaded_by_name").notNull().default("System"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("bank_statements_company_created_idx").on(
      t.companyId,
      t.createdAt.desc(),
    ),
    index("bank_statements_account_status_idx").on(
      t.companyId,
      t.bankAccountId,
      t.status,
    ),
  ],
);

/**
 * One transaction off a statement.
 *
 * NO `stock_committed`-style flags and no embedded arrays: the allocation legs
 * and the match suggestions are their own tables. `debit_amount` and
 * `credit_amount` are both positive and exactly one is set — a CHECK the Mongo
 * schema did not have, which let a line be neither a payment nor a receipt.
 */
export const bankFeedLines = pgTable(
  "bank_feed_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    statementId: uuid("statement_id")
      .notNull()
      .references(() => bankStatements.id, { onDelete: "cascade" }),
    bankAccountId: uuid("bank_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),

    transactionDate: date("transaction_date").notNull(),
    description: text("description").notNull(),
    reference: text("reference"),

    debitAmount: money("debit_amount").notNull().default("0"),
    creditAmount: money("credit_amount").notNull().default("0"),
    runningBalance: money("running_balance"),

    /** What the file said, so an import can be argued with. */
    rawData: jsonb("raw_data"),
    rowNumber: integer("row_number"),
    lineHash: text("line_hash"),

    status: bankLineStatusEnum("status").notNull().default("unallocated"),
    excludeReason: bankExcludeReasonEnum("exclude_reason"),
    excludeNote: text("exclude_note"),

    allocationType: bankAllocationTypeEnum("allocation_type"),

    matchedDocumentType: bankMatchDocumentEnum("matched_document_type"),
    matchedInvoiceId: uuid("matched_invoice_id").references(() => invoices.id, {
      onDelete: "set null",
    }),
    matchedBillId: uuid("matched_bill_id").references(() => bills.id, {
      onDelete: "set null",
    }),
    matchedPartyId: uuid("matched_party_id").references(() => parties.id, {
      onDelete: "set null",
    }),
    matchedPartyName: text("matched_party_name"),
    appliedAmount: money("applied_amount"),
    overpaymentAmount: money("overpayment_amount"),

    /**
     * A matched receipt IS a payment (0100). The Mongo service posted its own
     * journal entry and hand-updated `invoice.amountPaid`; the payments module
     * has done exactly that, correctly, since 0063.
     */
    paymentId: uuid("payment_id").references(() => payments.id, {
      onDelete: "set null",
    }),
    /** For the kinds with no document to pay — expense, income, transfer… */
    journalEntryId: uuid("journal_entry_id").references(
      () => journalEntries.id,
      { onDelete: "set null" },
    ),

    allocatedById: text("allocated_by_id"),
    allocatedByName: text("allocated_by_name"),
    allocatedAt: timestamp("allocated_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("bank_feed_lines_statement_idx").on(t.statementId, t.status),
    index("bank_feed_lines_queue_idx").on(
      t.companyId,
      t.status,
      t.transactionDate.desc(),
    ),
  ],
);

/**
 * One leg of an allocation — 0100.
 *
 * Mongo embedded these on the line. As rows, "how much went to Motor Vehicle
 * Expenses last quarter" is a GROUP BY rather than an unwind, and each leg's
 * account is a real foreign key.
 */
export const bankFeedLineAllocations = pgTable(
  "bank_feed_line_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    lineId: uuid("line_id")
      .notNull()
      .references(() => bankFeedLines.id, { onDelete: "cascade" }),

    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    amount: money("amount").notNull(),
    description: text("description"),

    taxAmount: money("tax_amount"),
    taxAccountId: uuid("tax_account_id").references(() => accounts.id, {
      onDelete: "restrict",
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("bank_feed_line_allocations_line_idx").on(t.lineId),
    index("bank_feed_line_allocations_account_idx").on(t.companyId, t.accountId),
  ],
);

/**
 * What the matcher thinks this line might be — 0100.
 *
 * A cache of a computation, rewritten wholesale on every run and cascading
 * with the line. The only thing that must survive is the allocation a person
 * actually chose, and that is on the line itself.
 */
export const bankFeedLineSuggestions = pgTable(
  "bank_feed_line_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    lineId: uuid("line_id")
      .notNull()
      .references(() => bankFeedLines.id, { onDelete: "cascade" }),

    documentType: bankMatchDocumentEnum("document_type").notNull(),
    invoiceId: uuid("invoice_id").references(() => invoices.id, {
      onDelete: "cascade",
    }),
    billId: uuid("bill_id").references(() => bills.id, { onDelete: "cascade" }),

    documentNumber: text("document_number").notNull(),
    partyName: text("party_name"),
    amount: money("amount").notNull(),
    confidence: integer("confidence").notNull(),
    matchReason: text("match_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("bank_feed_line_suggestions_line_idx").on(
      t.lineId,
      t.confidence.desc(),
    ),
    uniqueIndex("bank_feed_line_suggestions_once").on(
      t.lineId,
      t.documentType,
      t.invoiceId,
      t.billId,
    ),
  ],
);
