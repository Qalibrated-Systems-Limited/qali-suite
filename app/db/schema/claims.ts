import {
  pgTable,
  uuid,
  text,
  date,
  numeric,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { accounts } from "./accounts";
import { parties } from "./parties";
import { employees } from "./hr";
import { users } from "./users";
import { payments } from "./payments";
import { journalEntries } from "./journal";
import { employeeClaimTypeEnum, employeeClaimStatusEnum } from "./enums";

const money = (name: string) =>
  numeric(name, { precision: 19, scale: 4, mode: "string" });

/**
 * Employee claims (0052) — advances, their settlement, and reimbursements.
 *
 * THE LEDGER GAP THIS CLOSES. `claim-action.js` holds six live
 * `JournalEntry.post()` calls against the Mongo model, and every ledger screen
 * — the journal browser, trial balance, P&L, balance sheet, general ledger —
 * reads Postgres. Nothing errored: the entries were created, validated and
 * posted into a ledger nothing reads. Advances went out, expenses were
 * recognised, employees were reimbursed, and the books never saw any of it.
 *
 * The six, in the order the flow runs them:
 *
 *   payAdvance            DR Employee Advance   CR Bank
 *   closeSettlement       DR Expense accounts   CR Employee Advance (+ Payables
 *                                                  where the employee overspent)
 *   recordAdvanceReturn   DR Bank               CR Employee Advance
 *   paySettlementBalance  DR Employee Payables  CR Bank
 *   payReimbursement #1   DR Expense accounts   CR Employee Payables
 *   payReimbursement #2   DR Employee Payables  CR Bank
 *
 * ── Identity has ONE copy here ──────────────────────────────────────────────
 *
 * The Mongo document carried `employee.{userId, partyId, name, employeeNumber,
 * department, email}` — six fields, of which four were a copy of data owned
 * elsewhere. `getEmployeeHRSnapshot` already reads Postgres for the last two,
 * so they were never a historical snapshot: they were a stale copy of current
 * HR, refreshed only when a claim happened to be written.
 *
 * `party_id` is the financial identity and is required. `employee_id` is the
 * employment record and is NULLABLE on purpose — `getEmployeeSnapshotByParty`
 * says it plainly, and it is the rule this follows: "a claim raised by somebody
 * with no HR record is still a claim." Name, email, employee number and
 * department are joined, never stored. This is §9F's correction applied to the
 * module that had the same fault.
 */
export const employeeClaims = pgTable(
  "employee_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    claimNumber: text("claim_number").notNull(),
    claimDate: date("claim_date").notNull(),
    claimType: employeeClaimTypeEnum("claim_type").notNull(),
    status: employeeClaimStatusEnum("status").notNull().default("draft"),

    /** The financial identity. Always present — auto-created if the user has none. */
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id, { onDelete: "restrict" }),
    /** The employment record, where there is one. See the note above. */
    employeeId: uuid("employee_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    /** Whose claim it is, for "only the owner may recall". */
    employeeUserId: text("employee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    /**
     * Deferred references — projects are not ported (§10), so these carry the
     * value without a foreign key rather than dropping it. Same treatment
     * bills gave purchase_order_id in 0015.
     */
    projectId: uuid("project_id"),
    projectNumber: text("project_number"),
    projectName: text("project_name"),
    costCodeId: uuid("cost_code_id"),
    costCodeCode: text("cost_code_code"),
    costCodeName: text("cost_code_name"),

    // ── advance_request ──────────────────────────────────────────────────────
    advanceType: text("advance_type"),
    requestedAmount: money("requested_amount"),
    purpose: text("purpose"),
    travelFrom: date("travel_from"),
    travelTo: date("travel_to"),
    destination: text("destination"),
    estimatedExpenses: text("estimated_expenses"),
    approvedAmount: money("approved_amount"),
    disbursementDate: date("disbursement_date"),

    // ── advance_return (the settlement of an advance) ─────────────────────────
    /**
     * The advance this settles. UNIQUE, which is the invariant the Mongo
     * schema only commented: "Prevents double settlement". Nothing enforced
     * it — two settlements could be raised against one advance and each would
     * credit Employee Advance in full.
     */
    advanceClaimId: uuid("advance_claim_id"),
    /**
     * Nullable and, for now, unwritten. `payAdvance` assigns
     * `claim.advancePaymentId = journalEntry[0]._id` — a journal entry id, into
     * a field Mongo declares `ref: "Payment"` — and `settleAdvance` copies it
     * onward as though it were one. Neither path creates a payment document.
     * The foreign key makes the column honest; which entry funded the advance
     * is `employee_claim_journal_entries.purpose = 'advance'`.
     */
    advancePaymentId: uuid("advance_payment_id").references(() => payments.id, {
      onDelete: "set null",
    }),
    /** What was actually disbursed, frozen when the settlement opens. */
    advanceAmount: money("advance_amount"),
    amountReturned: money("amount_returned").notNull().default("0"),
    returnRecordedAt: timestamp("return_recorded_at", { withTimezone: true }),
    returnRecordedById: text("return_recorded_by_id"),
    returnRecordedByName: text("return_recorded_by_name"),
    amountPaidToEmployee: money("amount_paid_to_employee")
      .notNull()
      .default("0"),
    extraPaidAt: timestamp("extra_paid_at", { withTimezone: true }),
    extraPaidById: text("extra_paid_by_id"),
    extraPaidByName: text("extra_paid_by_name"),

    // ── common ───────────────────────────────────────────────────────────────
    currency: text("currency").notNull().default("KES"),
    description: text("description").notNull(),
    notes: text("notes"),

    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    submittedById: text("submitted_by_id"),
    submittedByName: text("submitted_by_name"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedById: text("approved_by_id"),
    approvedByName: text("approved_by_name"),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectedById: text("rejected_by_id"),
    rejectedByName: text("rejected_by_name"),
    rejectionReason: text("rejection_reason"),

    /** The payment that funded an advance, or settled a reimbursement. */
    settlementPaymentId: uuid("settlement_payment_id").references(
      () => payments.id,
      { onDelete: "set null" },
    ),
    paidAt: timestamp("paid_at", { withTimezone: true }),

    createdById: text("created_by_id"),
    createdByName: text("created_by_name"),
    lastModifiedById: text("last_modified_by_id"),
    lastModifiedByName: text("last_modified_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("employee_claims_number_unique").on(t.companyId, t.claimNumber),
    /** One settlement per advance. The comment in Mongo, as a constraint. */
    uniqueIndex("employee_claims_advance_settled_once")
      .on(t.companyId, t.advanceClaimId)
      .where(sql`${t.advanceClaimId} IS NOT NULL AND ${t.status} <> 'rejected'`),
    index("employee_claims_list_idx").on(t.companyId, t.claimDate, t.status),
    index("employee_claims_party_idx").on(t.companyId, t.partyId, t.status),
    index("employee_claims_user_idx").on(
      t.companyId,
      t.employeeUserId,
      t.status,
    ),
    index("employee_claims_type_idx").on(t.companyId, t.claimType, t.status),
    index("employee_claims_project_idx")
      .on(t.companyId, t.projectId)
      .where(sql`${t.projectId} IS NOT NULL`),

    /**
     * What each claim type is required to carry. In Mongo these were
     * `validateAdvanceRequest` / `validateAdvanceReturn` methods, called from
     * `submit()` and `approve()` — so a claim written by any other path, and
     * there are several, skipped them entirely.
     */
    check(
      "employee_claims_advance_fields",
      sql`${t.claimType} <> 'advance_request' OR (${t.requestedAmount} IS NOT NULL AND ${t.requestedAmount} > 0 AND ${t.purpose} IS NOT NULL)`,
    ),
    check(
      "employee_claims_return_fields",
      sql`${t.claimType} <> 'advance_return' OR (${t.advanceClaimId} IS NOT NULL AND ${t.advanceAmount} IS NOT NULL AND ${t.advanceAmount} >= 0)`,
    ),
    /** Only a settlement may record a return or an extra payment. */
    check(
      "employee_claims_settlement_only_amounts",
      sql`${t.claimType} = 'advance_return' OR (${t.amountReturned} = 0 AND ${t.amountPaidToEmployee} = 0)`,
    ),
    check(
      "employee_claims_amounts_non_negative",
      sql`${t.amountReturned} >= 0 AND ${t.amountPaidToEmployee} >= 0 AND COALESCE(${t.approvedAmount}, 0) >= 0`,
    ),
    /** A rejection has to say why — the action checked for 10 characters. */
    check(
      "employee_claims_rejection_has_reason",
      sql`${t.status} <> 'rejected' OR (${t.rejectionReason} IS NOT NULL AND length(btrim(${t.rejectionReason})) >= 10)`,
    ),
    check(
      "employee_claims_travel_dates_ordered",
      sql`${t.travelFrom} IS NULL OR ${t.travelTo} IS NULL OR ${t.travelTo} >= ${t.travelFrom}`,
    ),
  ],
);

/**
 * The receipts a claim is made of.
 *
 * Items are frozen by a trigger once the claim is approved — the total is a
 * sum of them and the journal entry is built from them, so a late edit changes
 * what the ledger was told. Editing is still limited to draft and rejected by
 * `updateClaim`; the database draws its own line at approval because
 * `openSettlement` legitimately writes receipts onto an already-submitted
 * settlement.
 *
 * `expense_account_id` is NOT NULL, and that is a fix rather than a
 * transcription. Both posting paths group items with
 *
 *     const key = item.expenseAccountId?.toString() || item.category;
 *
 * and then look the group up in the map `resolveExpenseAccounts` built — which
 * only ever keys by account id, because it skips items that have none. So an
 * item saved without an expense account produces a key that is a category
 * name, `expenseAccountMap[category]` is undefined, and `account._id` throws
 * TypeError partway through posting. The claim is approved, the payment is
 * half-made, and the ledger has nothing. Requiring the account moves the
 * failure to the form, where somebody can fix it.
 */
export const employeeClaimItems = pgTable(
  "employee_claim_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => employeeClaims.id, { onDelete: "cascade" }),
    lineNumber: numeric("line_number", { precision: 6, scale: 0 }).notNull(),

    itemDate: date("item_date").notNull(),
    category: text("category").notNull(),
    expenseAccountId: uuid("expense_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    description: text("description").notNull(),
    amount: money("amount").notNull(),

    receiptFilename: text("receipt_filename"),
    receiptUrl: text("receipt_url"),
    receiptUploadedAt: timestamp("receipt_uploaded_at", { withTimezone: true }),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("employee_claim_items_line_unique").on(t.claimId, t.lineNumber),
    index("employee_claim_items_claim_idx").on(t.companyId, t.claimId),
    index("employee_claim_items_account_idx").on(
      t.companyId,
      t.expenseAccountId,
    ),
    check("employee_claim_items_amount_positive", sql`${t.amount} > 0`),
  ],
);

/** Attachments on the claim as a whole, as opposed to on one receipt line. */
export const employeeClaimAttachments = pgTable(
  "employee_claim_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => employeeClaims.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    url: text("url").notNull(),
    publicId: text("public_id"),
    resourceType: text("resource_type"),
    size: numeric("size", { precision: 12, scale: 0 }),
    mimeType: text("mime_type"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    uploadedById: text("uploaded_by_id"),
    uploadedByName: text("uploaded_by_name"),
  },
  (t) => [index("employee_claim_attachments_claim_idx").on(t.companyId, t.claimId)],
);

/**
 * A claim's journal entries, many-to-one.
 *
 * Mongo kept `journalEntryIds: [ObjectId]`, an unconstrained array. A claim
 * raises up to three entries across its life — the advance, the settlement,
 * the payment — and each is a distinct event, so this is a table with the
 * event named rather than an array whose order the reader has to guess.
 */
export const employeeClaimJournalEntries = pgTable(
  "employee_claim_journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => employeeClaims.id, { onDelete: "cascade" }),
    journalEntryId: uuid("journal_entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "restrict" }),
    /** advance | settlement | return | expense | payment */
    purpose: text("purpose").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("employee_claim_journal_entries_unique").on(
      t.claimId,
      t.journalEntryId,
    ),
    /**
     * One entry per purpose per claim. This is what stops a second
     * `payAdvance` from raising a second DR Employee Advance — the read-then-
     * check in §8.3's COGS bug, as a constraint instead.
     */
    uniqueIndex("employee_claim_journal_entries_purpose_unique").on(
      t.claimId,
      t.purpose,
    ),
    index("employee_claim_journal_entries_entry_idx").on(
      t.companyId,
      t.journalEntryId,
    ),
  ],
);
