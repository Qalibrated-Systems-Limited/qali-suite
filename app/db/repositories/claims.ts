import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { anyOf, isUuid, likeContains, toDate } from "./sqlHelpers";
import type { Tx } from "../client";
import {
  employeeClaims,
  employeeClaimItems,
  employeeClaimAttachments,
  employeeClaimJournalEntries,
} from "../schema/claims";
import { createJournalEntry, type JournalLineInput } from "./journal";
import { getSystemAccount } from "./accounts";
import { createParty } from "./parties";
import { getUserParty, linkUserToParty } from "./users";

/**
 * Employee claims (0052) — advances, their settlement, and reimbursements.
 *
 * This is where §9G's biggest ledger gap closes. `claim-action.js` posts six
 * journal entries through the Mongo model while every ledger screen reads
 * Postgres, so advances, expense recognition and reimbursements all landed in
 * a ledger nothing reads.
 *
 *   payAdvance            DR Employee Advance   CR Bank
 *   closeSettlement       DR Expense accounts   CR Employee Advance
 *                                               (+ Payables where overspent)
 *   recordAdvanceReturn   DR Bank               CR Employee Advance
 *   paySettlementBalance  DR Employee Payables  CR Bank
 *   payReimbursement #1   DR Expense accounts   CR Employee Payables
 *   payReimbursement #2   DR Employee Payables  CR Bank
 *
 * Accounts are passed in for the BANK side and looked up here for the two
 * system accounts — the same division bills and goods receipts draw. The
 * action layer owns "which bank account did the user pick"; the repository
 * owns "Employee Advance is where an advance sits".
 *
 * Totals are never written. `employee_claim_state` derives `total_amount`,
 * `total_spent` and `balance` from the items, so there is no stored figure to
 * go stale — which is what happened in Mongo, where three `validate*` methods
 * recomputed them from `submit()` and `approve()` and nowhere else.
 */

export type MoneyString = string;

/** Everything a screen reads about a claim, including its derived totals. */
const CLAIM_SELECT = sql`
  c.id, c.company_id, c.claim_number, c.claim_date, c.claim_type, c.status,
  c.party_id, c.employee_id, c.employee_user_id,
  c.project_id, c.project_number, c.project_name,
  c.cost_code_id, c.cost_code_code, c.cost_code_name,
  c.advance_type, c.requested_amount, c.purpose, c.travel_from, c.travel_to,
  c.destination, c.estimated_expenses, c.approved_amount, c.disbursement_date,
  c.advance_claim_id, c.advance_payment_id, c.advance_amount,
  c.amount_returned, c.return_recorded_at, c.return_recorded_by_name,
  c.amount_paid_to_employee, c.extra_paid_at, c.extra_paid_by_name,
  c.currency, c.description, c.notes,
  c.submitted_at, c.submitted_by_name, c.approved_at, c.approved_by_name,
  c.rejected_at, c.rejected_by_name, c.rejection_reason,
  c.settlement_payment_id, c.paid_at,
  c.created_by_id, c.created_by_name, c.created_at, c.updated_at,
  s.item_count, s.items_total, s.total_amount, s.total_spent, s.balance,
  s.balance_outstanding, s.disbursed_amount, s.awaiting,
  p.name AS employee_name, p.email AS employee_email,
  e.employee_number, d.name AS department
`;

const CLAIM_FROM = sql`
  FROM employee_claims c
  JOIN employee_claim_state s ON s.claim_id = c.id
  JOIN parties p              ON p.id = c.party_id
  LEFT JOIN employees e       ON e.id = c.employee_id
  LEFT JOIN departments d     ON d.id = e.department_id
`;

export type Claim = ReturnType<typeof mapClaim>;

function mapClaim(r: Record<string, unknown>) {
  const s = (k: string) => (r[k] as string) ?? null;
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    claimNumber: String(r.claim_number),
    claimDate: String(r.claim_date),
    claimType: String(r.claim_type) as
      | "advance_request"
      | "advance_return"
      | "reimbursement",
    status: String(r.status),
    partyId: String(r.party_id),
    employeeId: s("employee_id"),
    employeeUserId: s("employee_user_id"),
    employeeName: s("employee_name"),
    employeeEmail: s("employee_email"),
    employeeNumber: s("employee_number"),
    department: s("department"),
    projectId: s("project_id"),
    projectNumber: s("project_number"),
    projectName: s("project_name"),
    costCodeId: s("cost_code_id"),
    costCodeCode: s("cost_code_code"),
    costCodeName: s("cost_code_name"),
    advanceType: s("advance_type"),
    requestedAmount: s("requested_amount"),
    purpose: s("purpose"),
    travelFrom: s("travel_from"),
    travelTo: s("travel_to"),
    destination: s("destination"),
    estimatedExpenses: s("estimated_expenses"),
    approvedAmount: s("approved_amount"),
    disbursementDate: s("disbursement_date"),
    advanceClaimId: s("advance_claim_id"),
    advancePaymentId: s("advance_payment_id"),
    advanceAmount: s("advance_amount"),
    amountReturned: s("amount_returned"),
    returnRecordedAt: toDate(r.return_recorded_at),
    returnRecordedByName: s("return_recorded_by_name"),
    amountPaidToEmployee: s("amount_paid_to_employee"),
    extraPaidAt: toDate(r.extra_paid_at),
    extraPaidByName: s("extra_paid_by_name"),
    currency: String(r.currency),
    description: String(r.description),
    notes: s("notes"),
    submittedAt: toDate(r.submitted_at),
    submittedByName: s("submitted_by_name"),
    approvedAt: toDate(r.approved_at),
    approvedByName: s("approved_by_name"),
    rejectedAt: toDate(r.rejected_at),
    rejectedByName: s("rejected_by_name"),
    rejectionReason: s("rejection_reason"),
    settlementPaymentId: s("settlement_payment_id"),
    paidAt: toDate(r.paid_at),
    createdById: s("created_by_id"),
    createdByName: s("created_by_name"),
    createdAt: toDate(r.created_at),
    updatedAt: toDate(r.updated_at),
    // Derived — see employee_claim_state.
    itemCount: Number(r.item_count ?? 0),
    itemsTotal: s("items_total") ?? "0",
    totalAmount: s("total_amount") ?? "0",
    totalSpent: s("total_spent"),
    balance: s("balance"),
    balanceOutstanding: s("balance_outstanding"),
    disbursedAmount: s("disbursed_amount"),
    awaiting: s("awaiting"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Identity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The party a claim is raised against, creating one if this login has none.
 *
 * Mongo's `getOrCreateEmployeeParty` looked the party up by `Party.userId`.
 * Here the link lives on the GRANT (`user_company_access.party_id`), because a
 * party is company-scoped and a person can be an employee of one company and a
 * supplier to another — see `linkUserToParty`. The employment record is
 * consulted first: if HR already knows this login, its party is the answer and
 * a second one must not be invented beside it.
 */
export async function ensureEmployeeParty(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    name?: string | null;
    email?: string | null;
  },
): Promise<{ partyId: string; employeeId: string | null }> {
  const employeeRows = (await tx.execute(sql`
    SELECT id, party_id FROM employees WHERE user_id = ${String(input.userId)}
  `)) as unknown as Array<{ id: string; party_id: string }>;

  if (employeeRows.length) {
    const { id, party_id } = employeeRows[0];
    // Keep the grant pointing at it, so the next call is one query.
    const linked = await getUserParty(tx, input.userId, input.companyId);
    if (linked !== party_id) {
      await linkUserToParty(tx, {
        userId: input.userId,
        companyId: input.companyId,
        partyId: party_id,
      });
    }
    return { partyId: party_id, employeeId: id };
  }

  const existing = await getUserParty(tx, input.userId, input.companyId);
  if (existing) return { partyId: existing, employeeId: null };

  const party = await createParty(tx, {
    companyId: input.companyId,
    name: input.name || input.email || "Employee",
    primaryType: "employee",
    email: input.email ?? null,
    createdById: input.userId,
  });

  await linkUserToParty(tx, {
    userId: input.userId,
    companyId: input.companyId,
    partyId: party.id,
  });

  return { partyId: party.id, employeeId: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export async function getClaim(tx: Tx, claimId: string) {
  // An id a uuid column cannot hold is NOT FOUND, not a 22P02 with
  // the statement in the message. See isUuid in sqlHelpers.
  if (!isUuid(claimId)) return null;
  const rows = (await tx.execute(sql`
    SELECT ${CLAIM_SELECT} ${CLAIM_FROM} WHERE c.id = ${claimId}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.length ? mapClaim(rows[0]) : null;
}

export async function getClaimDetail(tx: Tx, claimId: string) {
  // An id a uuid column cannot hold is NOT FOUND, not a 22P02 with
  // the statement in the message. See isUuid in sqlHelpers.
  if (!isUuid(claimId)) return null;
  const claim = await getClaim(tx, claimId);
  if (!claim) return null;

  // Sequential, not Promise.all. These share one connection inside one
  // transaction, so concurrency buys nothing and pipelines statements the
  // driver would rather serialise — which is why every other repository here
  // does it this way too.
  const items = await listClaimItems(tx, claimId);

  const attachments = await tx
    .select()
    .from(employeeClaimAttachments)
    .where(eq(employeeClaimAttachments.claimId, claimId))
    .orderBy(asc(employeeClaimAttachments.uploadedAt));

  const entries = (await tx.execute(sql`
    SELECT l.purpose, j.id, j.entry_number, j.entry_date, j.status,
           j.description
      FROM employee_claim_journal_entries l
      JOIN journal_entries j ON j.id = l.journal_entry_id
     WHERE l.claim_id = ${claimId}::uuid
     ORDER BY l.created_at
  `)) as unknown as Array<Record<string, unknown>>;

  // The settlement raised against this advance, if there is one. Read from the
  // settlement's own advance_claim_id — one direction, one truth (§8.2).
  const settlement = (await tx.execute(sql`
    SELECT ${CLAIM_SELECT} ${CLAIM_FROM}
     WHERE c.advance_claim_id = ${claimId}::uuid
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    ...claim,
    items,
    attachments,
    journalEntries: entries.map((e) => ({
      purpose: String(e.purpose),
      id: String(e.id),
      entryNumber: String(e.entry_number),
      entryDate: String(e.entry_date),
      status: String(e.status),
      description: String(e.description),
    })),
    settlement: settlement.length ? mapClaim(settlement[0]) : null,
    advance:
      claim.advanceClaimId != null
        ? await getClaim(tx, claim.advanceClaimId)
        : null,
  };
}

export async function listClaimItems(tx: Tx, claimId: string) {
  const rows = (await tx.execute(sql`
    SELECT i.*, a.account_code, a.account_name
      FROM employee_claim_items i
      JOIN accounts a ON a.id = i.expense_account_id
     WHERE i.claim_id = ${claimId}::uuid
     ORDER BY i.line_number
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    lineNumber: Number(r.line_number),
    itemDate: String(r.item_date),
    category: String(r.category),
    expenseAccountId: String(r.expense_account_id),
    accountCode: String(r.account_code),
    accountName: String(r.account_name),
    description: String(r.description),
    amount: String(r.amount),
    receiptFilename: (r.receipt_filename as string) ?? null,
    receiptUrl: (r.receipt_url as string) ?? null,
    notes: (r.notes as string) ?? null,
  }));
}

export interface ListClaimsOptions {
  status?: string | string[];
  claimType?: string;
  partyId?: string;
  userId?: string;
  projectId?: string;
  search?: string;
  from?: string;
  to?: string;
  /**
   * The dashboard cards each want a different "most recent": submitted for an
   * approvals queue, approved for a to-pay list, updated for an activity feed.
   * An allow-list, because this reaches an ORDER BY.
   */
  orderBy?: "claimDate" | "submittedAt" | "approvedAt" | "updatedAt" | "createdAt";
  limit?: number;
  offset?: number;
}

const ORDER_COLUMNS = {
  claimDate: sql`c.claim_date DESC, c.created_at DESC`,
  submittedAt: sql`c.submitted_at DESC NULLS LAST`,
  approvedAt: sql`c.approved_at DESC NULLS LAST`,
  updatedAt: sql`c.updated_at DESC`,
  createdAt: sql`c.created_at DESC`,
} as const;

/**
 * The list page, the my-claims page and the approvals queue are one query.
 *
 * No `company_id` filter — RLS. The limit is clamped here rather than trusted
 * from the caller, the same habit `listInvoices` keeps.
 */
export async function listClaims(tx: Tx, opts: ListClaimsOptions = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const statuses =
    typeof opts.status === "string" ? [opts.status] : (opts.status ?? []);

  const where = sql`WHERE TRUE
    ${statuses.length ? sql`AND c.status = ${anyOf(statuses, "employee_claim_status[]")}` : sql``}
    ${opts.claimType ? sql`AND c.claim_type = ${opts.claimType}::employee_claim_type` : sql``}
    ${opts.partyId ? sql`AND c.party_id = ${opts.partyId}::uuid` : sql``}
    ${opts.userId ? sql`AND c.employee_user_id = ${String(opts.userId)}` : sql``}
    ${opts.projectId ? sql`AND c.project_id = ${String(opts.projectId)}` : sql``}
    ${opts.from ? sql`AND c.claim_date >= ${opts.from}::date` : sql``}
    ${opts.to ? sql`AND c.claim_date <= ${opts.to}::date` : sql``}
    ${
      opts.search
        ? sql`AND (c.claim_number ILIKE ${likeContains(opts.search)}
                OR c.description ILIKE ${likeContains(opts.search)}
                OR p.name ILIKE ${likeContains(opts.search)})`
        : sql``
    }`;

  const rows = (await tx.execute(sql`
    SELECT ${CLAIM_SELECT} ${CLAIM_FROM} ${where}
     ORDER BY ${ORDER_COLUMNS[opts.orderBy ?? "claimDate"]}
     LIMIT ${limit} OFFSET ${offset}
  `)) as unknown as Array<Record<string, unknown>>;

  const totals = (await tx.execute(sql`
    SELECT COUNT(*)::int AS total ${CLAIM_FROM} ${where}
  `)) as unknown as Array<{ total: number }>;

  return { claims: rows.map(mapClaim), total: totals[0]?.total ?? 0 };
}

/** The stats strip: one pass, not six count queries. */
export async function getClaimStats(tx: Tx) {
  const rows = (await tx.execute(sql`
    SELECT
      COUNT(*)::int                                                AS total,
      COUNT(*) FILTER (WHERE c.status = 'draft')::int              AS draft,
      COUNT(*) FILTER (WHERE c.status = 'submitted')::int          AS submitted,
      COUNT(*) FILTER (WHERE c.status = 'approved')::int           AS approved,
      COUNT(*) FILTER (WHERE c.status = 'rejected')::int           AS rejected,
      COUNT(*) FILTER (WHERE c.status = 'paid')::int               AS paid,
      COUNT(*) FILTER (WHERE c.status = 'pending_return')::int     AS pending_return,
      COUNT(*) FILTER (WHERE c.status = 'pending_payment')::int    AS pending_payment,
      COUNT(*) FILTER (WHERE c.status = 'closed')::int             AS closed,
      COALESCE(SUM(s.total_amount) FILTER (WHERE c.status = 'submitted'), 0)::numeric(19,4)
                                                                   AS submitted_value,
      COALESCE(SUM(s.total_amount) FILTER (WHERE c.status = 'approved'), 0)::numeric(19,4)
                                                                   AS approved_value,
      -- Money the company is still carrying on employees: advances paid out
      -- and not yet settled.
      COALESCE(SUM(s.total_amount) FILTER (
        WHERE c.claim_type = 'advance_request' AND c.status = 'paid'
      ), 0)::numeric(19,4)                                         AS outstanding_advances
      FROM employee_claims c
      JOIN employee_claim_state s ON s.claim_id = c.id
  `)) as unknown as Array<Record<string, unknown>>;

  const r = rows[0] ?? {};
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    total: n("total"),
    draft: n("draft"),
    submitted: n("submitted"),
    approved: n("approved"),
    rejected: n("rejected"),
    paid: n("paid"),
    pendingReturn: n("pending_return"),
    pendingPayment: n("pending_payment"),
    closed: n("closed"),
    submittedValue: String(r.submitted_value ?? "0"),
    approvedValue: String(r.approved_value ?? "0"),
    outstandingAdvances: String(r.outstanding_advances ?? "0"),
  };
}

/**
 * A count, for a badge or a dashboard strip.
 *
 * No `company_id` filter and none is needed — RLS. Every dashboard that used
 * to count the Mongo collection calls this instead, or it reports zero
 * forever: the collection is no longer written to. That is the failure the
 * approvals dashboard already had for leave and loans, and the reason
 * `countNonconformancesAwaitingAuthorisationPg` exists beside it.
 */
export async function countClaims(
  tx: Tx,
  opts: {
    status?: string | string[];
    claimType?: string | string[];
    userId?: string;
    projectId?: string;
  } = {},
) {
  const statuses =
    typeof opts.status === "string" ? [opts.status] : (opts.status ?? []);
  const types =
    typeof opts.claimType === "string"
      ? [opts.claimType]
      : (opts.claimType ?? []);

  const rows = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM employee_claims WHERE TRUE
      ${statuses.length ? sql`AND status = ${anyOf(statuses, "employee_claim_status[]")}` : sql``}
      ${types.length ? sql`AND claim_type = ${anyOf(types, "employee_claim_type[]")}` : sql``}
      ${opts.userId ? sql`AND employee_user_id = ${String(opts.userId)}` : sql``}
      ${opts.projectId ? sql`AND project_id = ${String(opts.projectId)}` : sql``}
  `)) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/**
 * How many claims match, and what they add up to.
 *
 * One query per dashboard tile instead of a `countDocuments` and an
 * `aggregate` side by side, and the total comes from `employee_claim_state` —
 * so it is a sum of the receipts rather than of a stored `totalAmount` that
 * three `validate*` methods were supposed to keep current.
 */
export async function sumClaims(
  tx: Tx,
  opts: {
    status?: string | string[];
    claimType?: string | string[];
    userId?: string;
    projectId?: string;
    /** Only advances that nothing has settled yet. */
    unsettledOnly?: boolean;
    approvedSince?: string;
    rejectedSince?: string;
    paidSince?: string;
  } = {},
) {
  const statuses =
    typeof opts.status === "string" ? [opts.status] : (opts.status ?? []);
  const types =
    typeof opts.claimType === "string"
      ? [opts.claimType]
      : (opts.claimType ?? []);

  const rows = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n,
           COALESCE(SUM(s.total_amount), 0)::float8 AS total
      FROM employee_claims c
      JOIN employee_claim_state s ON s.claim_id = c.id
     WHERE TRUE
      ${statuses.length ? sql`AND c.status = ${anyOf(statuses, "employee_claim_status[]")}` : sql``}
      ${types.length ? sql`AND c.claim_type = ${anyOf(types, "employee_claim_type[]")}` : sql``}
      ${opts.userId ? sql`AND c.employee_user_id = ${String(opts.userId)}` : sql``}
      ${opts.projectId ? sql`AND c.project_id = ${String(opts.projectId)}` : sql``}
      ${opts.approvedSince ? sql`AND c.approved_at >= ${opts.approvedSince}::timestamptz` : sql``}
      ${opts.rejectedSince ? sql`AND c.rejected_at >= ${opts.rejectedSince}::timestamptz` : sql``}
      ${opts.paidSince ? sql`AND c.paid_at >= ${opts.paidSince}::timestamptz` : sql``}
      ${
        opts.unsettledOnly
          ? sql`AND NOT EXISTS (
                  SELECT 1 FROM employee_claims st
                   WHERE st.advance_claim_id = c.id AND st.status <> 'rejected'
                )`
          : sql``
      }
  `)) as unknown as Array<{ n: number; total: number }>;

  return { count: rows[0]?.n ?? 0, total: rows[0]?.total ?? 0 };
}

/** How many claims are waiting on somebody — the approvals badge. */
export async function countClaimsAwaitingApproval(
  tx: Tx,
  claimType?: string | string[],
) {
  return countClaims(tx, { status: "submitted", claimType });
}

/**
 * What a project has cost through claims: spent, and promised.
 *
 * Projects are still on Mongo and its rollup used to aggregate the Mongo
 * claims collection, which nothing writes to any more — so without this every
 * project's claim spend would read zero.
 *
 * Settlements are excluded, as they were in Mongo: an `advance_return` is the
 * reconciliation of an advance whose cost was already counted when it was
 * paid, so counting it again would double the project's spend.
 *
 * The Mongo version's actuals filter is `status: { $in: ["paid", "settled"] }`
 * and "settled" is not a status a claim can hold — it is not in the enum. So
 * that arm never matched. Here the second status is `closed`, which is what a
 * fully-settled claim actually reaches.
 */
export async function getProjectClaimTotals(tx: Tx, projectId: string) {
  const rows = (await tx.execute(sql`
    SELECT
      COUNT(*)::int                                                AS claim_count,
      COALESCE(SUM(s.total_amount) FILTER (
        WHERE c.status IN ('submitted', 'approved')
      ), 0)::float8                                                AS committed,
      COALESCE(SUM(s.total_amount) FILTER (
        WHERE c.status IN ('paid', 'closed')
      ), 0)::float8                                                AS actual
      FROM employee_claims c
      JOIN employee_claim_state s ON s.claim_id = c.id
     WHERE c.project_id = ${String(projectId)}
       AND c.claim_type <> 'advance_return'
  `)) as unknown as Array<Record<string, unknown>>;

  const r = rows[0] ?? {};
  return {
    claimCount: Number(r.claim_count ?? 0),
    committed: Number(r.committed ?? 0),
    actual: Number(r.actual ?? 0),
  };
}

/**
 * A project's claim spend broken down by expense account.
 *
 * The Mongo version `$unwind`s the items array; here the items are rows, so it
 * is a GROUP BY. Returns `{ _id, total }` per account because that is what the
 * budget page's reducer reads.
 */
export async function getProjectClaimsByAccount(tx: Tx, projectId: string) {
  const rows = (await tx.execute(sql`
    SELECT i.expense_account_id::text                       AS account_id,
           COALESCE(SUM(i.amount) FILTER (
             WHERE c.status IN ('paid', 'closed')
           ), 0)::float8                                    AS actual,
           COALESCE(SUM(i.amount) FILTER (
             WHERE c.status IN ('submitted', 'approved')
           ), 0)::float8                                    AS committed
      FROM employee_claim_items i
      JOIN employee_claims c ON c.id = i.claim_id
     WHERE c.project_id = ${String(projectId)}
       AND c.claim_type <> 'advance_return'
     GROUP BY i.expense_account_id
  `)) as unknown as Array<{
    account_id: string;
    actual: number;
    committed: number;
  }>;

  return {
    actuals: rows
      .filter((r) => r.actual !== 0)
      .map((r) => ({ _id: r.account_id, total: r.actual })),
    committed: rows
      .filter((r) => r.committed !== 0)
      .map((r) => ({ _id: r.account_id, total: r.committed })),
  };
}

/**
 * Global search: claim number, description or employee name.
 *
 * Returns the screen shape, because the command palette reads `c._id` and
 * `c.employee?.name` — it renders these rows straight from the action.
 */
export async function searchClaims(tx: Tx, query: string, limit = 5) {
  const { claims } = await listClaimsForScreen(tx, { search: query, limit });
  return claims;
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

async function nextClaimNumber(tx: Tx, companyId: string) {
  const [{ claim_number }] = (await tx.execute(
    sql`SELECT next_entry_number(
      ${companyId}::uuid,
      document_prefix(${companyId}::uuid, 'claim')
    ) AS claim_number`,
  )) as unknown as Array<{ claim_number: string }>;
  return claim_number;
}

/**
 * Records which entry a claim raised, and what for.
 *
 * The unique index on (claim_id, purpose) is what makes a second `payAdvance`
 * fail rather than append. Mongo pushed onto an unconstrained
 * `journalEntryIds` array behind a `claim.status !== "approved"` read — the
 * shape §8.3 documents for COGS double-posting.
 */
async function linkEntry(
  tx: Tx,
  input: {
    companyId: string;
    claimId: string;
    journalEntryId: string;
    purpose: "advance" | "settlement" | "return" | "expense" | "payment";
  },
) {
  await tx.insert(employeeClaimJournalEntries).values({
    companyId: input.companyId,
    claimId: input.claimId,
    journalEntryId: input.journalEntryId,
    purpose: input.purpose,
  });
}

export interface ClaimItemInput {
  itemDate: string;
  category: string;
  /** Required — see decision 1 in 0052. */
  expenseAccountId: string;
  description: string;
  amount: MoneyString;
  receiptFilename?: string | null;
  receiptUrl?: string | null;
  notes?: string | null;
}

export interface ClaimAttachmentInput {
  filename: string;
  url: string;
  publicId?: string | null;
  resourceType?: string | null;
  size?: number | null;
  mimeType?: string | null;
  uploadedById?: string | null;
  uploadedByName?: string | null;
}

async function replaceItems(
  tx: Tx,
  companyId: string,
  claimId: string,
  items: ClaimItemInput[],
) {
  await tx
    .delete(employeeClaimItems)
    .where(eq(employeeClaimItems.claimId, claimId));

  if (!items.length) return;

  await tx.insert(employeeClaimItems).values(
    items.map((item, i) => ({
      companyId,
      claimId,
      lineNumber: String(i + 1),
      itemDate: item.itemDate,
      category: item.category,
      expenseAccountId: item.expenseAccountId,
      description: item.description,
      amount: item.amount,
      receiptFilename: item.receiptFilename ?? null,
      receiptUrl: item.receiptUrl ?? null,
      receiptUploadedAt: item.receiptUrl ? new Date() : null,
      notes: item.notes ?? null,
    })),
  );
}

async function addAttachments(
  tx: Tx,
  companyId: string,
  claimId: string,
  attachments: ClaimAttachmentInput[],
) {
  if (!attachments.length) return;
  await tx.insert(employeeClaimAttachments).values(
    attachments.map((a) => ({
      companyId,
      claimId,
      filename: a.filename,
      url: a.url,
      publicId: a.publicId ?? null,
      resourceType: a.resourceType ?? null,
      size: a.size != null ? String(a.size) : null,
      mimeType: a.mimeType ?? null,
      uploadedById: a.uploadedById ?? null,
      uploadedByName: a.uploadedByName ?? null,
    })),
  );
}

export interface CreateAdvanceRequestInput {
  companyId: string;
  partyId: string;
  employeeId?: string | null;
  employeeUserId?: string | null;
  claimDate: string;
  advanceType: string;
  requestedAmount: MoneyString;
  purpose: string;
  description: string;
  travelFrom?: string | null;
  travelTo?: string | null;
  destination?: string | null;
  estimatedExpenses?: string | null;
  projectId?: string | null;
  projectNumber?: string | null;
  projectName?: string | null;
  costCodeId?: string | null;
  costCodeCode?: string | null;
  costCodeName?: string | null;
  notes?: string | null;
  currency?: string;
  attachments?: ClaimAttachmentInput[];
  submit?: boolean;
  createdById?: string | null;
  createdByName?: string | null;
}

export async function createAdvanceRequest(
  tx: Tx,
  input: CreateAdvanceRequestInput,
) {
  const claimNumber = await nextClaimNumber(tx, input.companyId);
  const now = new Date();

  const [claim] = await tx
    .insert(employeeClaims)
    .values({
      companyId: input.companyId,
      claimNumber,
      claimDate: input.claimDate,
      claimType: "advance_request",
      status: input.submit ? "submitted" : "draft",
      partyId: input.partyId,
      employeeId: input.employeeId ?? null,
      employeeUserId: input.employeeUserId ?? null,
      projectId: input.projectId ?? null,
      projectNumber: input.projectNumber ?? null,
      projectName: input.projectName ?? null,
      costCodeId: input.costCodeId ?? null,
      costCodeCode: input.costCodeCode ?? null,
      costCodeName: input.costCodeName ?? null,
      advanceType: input.advanceType,
      requestedAmount: input.requestedAmount,
      purpose: input.purpose,
      travelFrom: input.travelFrom ?? null,
      travelTo: input.travelTo ?? null,
      destination: input.destination ?? null,
      estimatedExpenses: input.estimatedExpenses ?? null,
      currency: input.currency ?? "KES",
      description: input.description,
      notes: input.notes ?? null,
      submittedAt: input.submit ? now : null,
      submittedById: input.submit ? (input.createdById ?? null) : null,
      submittedByName: input.submit ? (input.createdByName ?? null) : null,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName ?? null,
    })
    .returning();

  await addAttachments(
    tx,
    input.companyId,
    claim.id,
    input.attachments ?? [],
  );

  return claim;
}

export interface CreateReimbursementInput {
  companyId: string;
  partyId: string;
  employeeId?: string | null;
  employeeUserId?: string | null;
  claimDate: string;
  description: string;
  items: ClaimItemInput[];
  projectId?: string | null;
  projectNumber?: string | null;
  projectName?: string | null;
  costCodeId?: string | null;
  costCodeCode?: string | null;
  costCodeName?: string | null;
  notes?: string | null;
  currency?: string;
  attachments?: ClaimAttachmentInput[];
  submit?: boolean;
  createdById?: string | null;
  createdByName?: string | null;
}

export async function createReimbursement(
  tx: Tx,
  input: CreateReimbursementInput,
) {
  const claimNumber = await nextClaimNumber(tx, input.companyId);
  const now = new Date();

  const [claim] = await tx
    .insert(employeeClaims)
    .values({
      companyId: input.companyId,
      claimNumber,
      claimDate: input.claimDate,
      claimType: "reimbursement",
      status: input.submit ? "submitted" : "draft",
      partyId: input.partyId,
      employeeId: input.employeeId ?? null,
      employeeUserId: input.employeeUserId ?? null,
      projectId: input.projectId ?? null,
      projectNumber: input.projectNumber ?? null,
      projectName: input.projectName ?? null,
      costCodeId: input.costCodeId ?? null,
      costCodeCode: input.costCodeCode ?? null,
      costCodeName: input.costCodeName ?? null,
      currency: input.currency ?? "KES",
      description: input.description,
      notes: input.notes ?? null,
      submittedAt: input.submit ? now : null,
      submittedById: input.submit ? (input.createdById ?? null) : null,
      submittedByName: input.submit ? (input.createdByName ?? null) : null,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName ?? null,
    })
    .returning();

  await replaceItems(tx, input.companyId, claim.id, input.items);
  await addAttachments(tx, input.companyId, claim.id, input.attachments ?? []);

  return claim;
}

export interface UpdateClaimInput {
  claimDate?: string;
  description?: string;
  notes?: string | null;
  advanceType?: string;
  requestedAmount?: MoneyString;
  purpose?: string;
  travelFrom?: string | null;
  travelTo?: string | null;
  destination?: string | null;
  estimatedExpenses?: string | null;
  projectId?: string | null;
  projectNumber?: string | null;
  projectName?: string | null;
  costCodeId?: string | null;
  costCodeCode?: string | null;
  costCodeName?: string | null;
  items?: ClaimItemInput[];
  attachments?: ClaimAttachmentInput[];
  lastModifiedById?: string | null;
  lastModifiedByName?: string | null;
}

/**
 * Edits a claim.
 *
 * The draft-or-rejected rule is not checked here: `employee_claim_items_frozen`
 * enforces it on the items, and the status machine on everything else. The
 * guard `updateClaim` carries in Mongo protects one call site out of several.
 */
export async function updateClaim(
  tx: Tx,
  claimId: string,
  input: UpdateClaimInput,
) {
  const existing = await getClaim(tx, claimId);
  if (!existing) throw new Error("Claim not found");

  if (existing.status !== "draft" && existing.status !== "rejected") {
    throw new Error(
      `Claim ${existing.claimNumber} is ${existing.status} and can no longer be edited.`,
    );
  }

  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
    lastModifiedById: input.lastModifiedById ?? null,
    lastModifiedByName: input.lastModifiedByName ?? null,
  };
  const set = <K extends keyof UpdateClaimInput>(k: K, col: string) => {
    if (input[k] !== undefined) patch[col] = input[k];
  };
  set("claimDate", "claimDate");
  set("description", "description");
  set("notes", "notes");
  set("advanceType", "advanceType");
  set("requestedAmount", "requestedAmount");
  set("purpose", "purpose");
  set("travelFrom", "travelFrom");
  set("travelTo", "travelTo");
  set("destination", "destination");
  set("estimatedExpenses", "estimatedExpenses");
  set("projectId", "projectId");
  set("projectNumber", "projectNumber");
  set("projectName", "projectName");
  set("costCodeId", "costCodeId");
  set("costCodeCode", "costCodeCode");
  set("costCodeName", "costCodeName");

  const [updated] = await tx
    .update(employeeClaims)
    .set(patch)
    .where(eq(employeeClaims.id, claimId))
    .returning();

  if (input.items) {
    await replaceItems(tx, existing.companyId, claimId, input.items);
  }
  if (input.attachments?.length) {
    await addAttachments(tx, existing.companyId, claimId, input.attachments);
  }

  return updated;
}

export async function submitClaim(
  tx: Tx,
  claimId: string,
  by: { id?: string | null; name?: string | null },
) {
  const [row] = await tx
    .update(employeeClaims)
    .set({
      status: "submitted",
      submittedAt: new Date(),
      submittedById: by.id ?? null,
      submittedByName: by.name ?? null,
      updatedAt: new Date(),
    })
    .where(eq(employeeClaims.id, claimId))
    .returning();
  return row;
}

export async function approveClaim(
  tx: Tx,
  claimId: string,
  by: { id?: string | null; name?: string | null; approvedAmount?: MoneyString },
) {
  const [row] = await tx
    .update(employeeClaims)
    .set({
      status: "approved",
      approvedAt: new Date(),
      approvedById: by.id ?? null,
      approvedByName: by.name ?? null,
      approvedAmount: by.approvedAmount ?? null,
      updatedAt: new Date(),
    })
    .where(eq(employeeClaims.id, claimId))
    .returning();
  return row;
}

export async function rejectClaim(
  tx: Tx,
  claimId: string,
  by: { id?: string | null; name?: string | null; reason: string },
) {
  const [row] = await tx
    .update(employeeClaims)
    .set({
      status: "rejected",
      rejectedAt: new Date(),
      rejectedById: by.id ?? null,
      rejectedByName: by.name ?? null,
      rejectionReason: by.reason,
      updatedAt: new Date(),
    })
    .where(eq(employeeClaims.id, claimId))
    .returning();
  return row;
}

/** submitted → draft. Only the owner may; the action checks that. */
export async function recallClaim(tx: Tx, claimId: string) {
  const [row] = await tx
    .update(employeeClaims)
    .set({
      status: "draft",
      submittedAt: null,
      submittedById: null,
      submittedByName: null,
      updatedAt: new Date(),
    })
    .where(eq(employeeClaims.id, claimId))
    .returning();
  return row;
}

/** rejected → submitted. */
export async function resubmitClaim(
  tx: Tx,
  claimId: string,
  by: { id?: string | null; name?: string | null },
) {
  const [row] = await tx
    .update(employeeClaims)
    .set({
      status: "submitted",
      submittedAt: new Date(),
      submittedById: by.id ?? null,
      submittedByName: by.name ?? null,
      rejectedAt: null,
      rejectedById: null,
      rejectedByName: null,
      rejectionReason: null,
      updatedAt: new Date(),
    })
    .where(eq(employeeClaims.id, claimId))
    .returning();
  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// The six postings
//
// Every one of these went into the Mongo ledger. From here they go into the
// ledger the trial balance reads.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The expense side of a claim, grouped by account.
 *
 * Mongo grouped with `item.expenseAccountId?.toString() || item.category` and
 * then looked the group up in a map keyed only by account id — so an item with
 * no account produced a key that was a category name and `account._id` threw.
 * `expense_account_id` is NOT NULL now, so the fallback has nothing to fall
 * back to and the group key is always an account.
 */
async function expenseLinesFor(
  tx: Tx,
  claimId: string,
  employeeName: string,
): Promise<JournalLineInput[]> {
  const rows = (await tx.execute(sql`
    SELECT expense_account_id,
           SUM(amount)::numeric(19,4) AS amount,
           string_agg(DISTINCT category, ', ' ORDER BY category) AS categories
      FROM employee_claim_items
     WHERE claim_id = ${claimId}::uuid
     GROUP BY expense_account_id
     ORDER BY expense_account_id
  `)) as unknown as Array<{
    expense_account_id: string;
    amount: string;
    categories: string;
  }>;

  return rows.map((r) => ({
    accountId: r.expense_account_id,
    debit: r.amount,
    description: `${r.categories} expenses - ${employeeName}`,
  }));
}

async function systemAccountOrThrow(tx: Tx, key: string, label: string) {
  const account = await getSystemAccount(tx, key);
  if (!account) {
    throw new Error(
      `${label} account not configured. Ask your admin to create a system account with code '${key}'.`,
    );
  }
  return account;
}

export interface PayClaimOptions {
  paymentAccountId: string;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  paymentNotes?: string | null;
  paidById?: string | null;
  paidByName?: string | null;
}

/**
 * Disburse an approved advance.
 *
 *   DR Employee Advance   the employee now owes the company
 *   CR Cash / Bank        the money leaves
 */
export async function payAdvance(
  tx: Tx,
  claimId: string,
  opts: PayClaimOptions,
) {
  const claim = await getClaim(tx, claimId);
  if (!claim) throw new Error("Claim not found");
  if (claim.claimType !== "advance_request") {
    throw new Error("Only an advance request can be disbursed.");
  }
  if (claim.status !== "approved") {
    throw new Error(
      `Claim ${claim.claimNumber} is ${claim.status}; only an approved advance can be paid.`,
    );
  }

  const advanceAccount = await systemAccountOrThrow(
    tx,
    "employee_advance",
    "Employee Advance",
  );
  const amount = claim.totalAmount;

  const entry = await createJournalEntry(tx, {
    companyId: claim.companyId,
    entryDate: new Date().toISOString().slice(0, 10),
    entryType: "advance",
    description: `Advance payment to ${claim.employeeName} - ${claim.claimNumber}`,
    reference: opts.paymentReference ?? claim.claimNumber,
    notes: opts.paymentNotes ?? null,
    partyType: "employee",
    partyId: claim.partyId,
    sourceType: "employee_claim",
    sourceId: claim.id,
    lines: [
      {
        accountId: advanceAccount.id,
        debit: amount,
        description: `Advance to ${claim.employeeName}`,
      },
      {
        accountId: opts.paymentAccountId,
        credit: amount,
        description: `Payment via ${opts.paymentMethod ?? "bank"}${
          opts.paymentReference ? ` - Ref: ${opts.paymentReference}` : ""
        }`,
      },
    ],
    createdById: opts.paidById ?? null,
    postImmediately: true,
  });

  await linkEntry(tx, {
    companyId: claim.companyId,
    claimId: claim.id,
    journalEntryId: entry.id,
    purpose: "advance",
  });

  const [updated] = await tx
    .update(employeeClaims)
    .set({
      status: "paid",
      paidAt: new Date(),
      disbursementDate: new Date().toISOString().slice(0, 10),
      updatedAt: new Date(),
    })
    .where(eq(employeeClaims.id, claimId))
    .returning();

  return { claim: updated, entry };
}

export interface OpenSettlementInput {
  items: ClaimItemInput[];
  claimDate?: string;
  notes?: string | null;
  attachments?: ClaimAttachmentInput[];
  createdById?: string | null;
  createdByName?: string | null;
}

/**
 * Open the settlement of a paid advance — `settleAdvance`.
 *
 * Creates the `advance_return` claim, already submitted, carrying the receipts.
 * `advance_amount` is frozen from what the advance was worth; everything else
 * about the settlement is derived from its items.
 *
 * The double-settlement check Mongo performs in application code — a read, a
 * branch, then a write, which two concurrent callers both pass — is a unique
 * index here. This still reads first, but only so the caller gets a sentence
 * instead of a constraint name; the index is what actually decides.
 */
export async function openSettlement(
  tx: Tx,
  advanceClaimId: string,
  input: OpenSettlementInput,
) {
  const advance = await getClaim(tx, advanceClaimId);
  if (!advance) throw new Error("Advance not found");
  if (advance.claimType !== "advance_request") {
    throw new Error(`Claim ${advance.claimNumber} is not an advance request.`);
  }
  if (advance.status !== "paid") {
    throw new Error(
      `Advance ${advance.claimNumber} has not been paid out (status ${advance.status}), so there is nothing to settle.`,
    );
  }

  const existing = (await tx.execute(sql`
    SELECT claim_number FROM employee_claims
     WHERE advance_claim_id = ${advanceClaimId}::uuid AND status <> 'rejected'
  `)) as unknown as Array<{ claim_number: string }>;
  if (existing.length) {
    throw new Error(
      `A settlement (${existing[0].claim_number}) already exists for this advance.`,
    );
  }

  const claimNumber = await nextClaimNumber(tx, advance.companyId);
  const now = new Date();

  const [settlement] = await tx
    .insert(employeeClaims)
    .values({
      companyId: advance.companyId,
      claimNumber,
      claimDate: input.claimDate ?? now.toISOString().slice(0, 10),
      claimType: "advance_return",
      status: "submitted",
      partyId: advance.partyId,
      employeeId: advance.employeeId,
      employeeUserId: advance.employeeUserId,
      // Inherited from the advance, the way Mongo inherits it.
      projectId: advance.projectId,
      projectNumber: advance.projectNumber,
      projectName: advance.projectName,
      costCodeId: advance.costCodeId,
      costCodeCode: advance.costCodeCode,
      costCodeName: advance.costCodeName,
      advanceClaimId: advance.id,
      advanceAmount: advance.totalAmount,
      currency: advance.currency,
      description: `Settlement for advance ${advance.claimNumber}`,
      notes: input.notes ?? null,
      submittedAt: now,
      submittedById: input.createdById ?? null,
      submittedByName: input.createdByName ?? null,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName ?? null,
    })
    .returning();

  await replaceItems(tx, advance.companyId, settlement.id, input.items);
  await addAttachments(
    tx,
    advance.companyId,
    settlement.id,
    input.attachments ?? [],
  );

  return settlement;
}

/**
 * Recognise what the advance was actually spent on — `closeSettlement`.
 *
 *   DR Expense accounts       what the receipts say
 *   CR Employee Advance       cleared, by the amount spent
 *   CR Employee Payables      only where the employee spent more than they held
 *
 * Where the employee underspent, the unspent part stays in Employee Advance —
 * they are still holding it — and the claim lands in `pending_return`. Where
 * they overspent, the whole advance clears and the excess becomes a payable,
 * and the claim lands in `pending_payment`. Exactly matched, and it closes.
 */
export async function closeSettlement(
  tx: Tx,
  settlementId: string,
  by: { id?: string | null; name?: string | null },
) {
  const settlement = await getClaim(tx, settlementId);
  if (!settlement) throw new Error("Settlement not found");
  if (settlement.claimType !== "advance_return") {
    throw new Error(`Claim ${settlement.claimNumber} is not a settlement.`);
  }
  if (settlement.status !== "approved") {
    throw new Error(
      `Settlement must be approved first. Current status: ${settlement.status}`,
    );
  }

  const advanceAccount = await systemAccountOrThrow(
    tx,
    "employee_advance",
    "Employee Advance",
  );
  const payablesAccount = await systemAccountOrThrow(
    tx,
    "employee_payables",
    "Employee Payables",
  );

  const advanceAmount = Number(settlement.advanceAmount ?? 0);
  const totalSpent = Number(settlement.totalSpent ?? 0);
  const balance = advanceAmount - totalSpent;

  const lines: JournalLineInput[] = await expenseLinesFor(
    tx,
    settlement.id,
    settlement.employeeName ?? "employee",
  );

  if (balance >= 0) {
    // Underspent, or exactly matched: only what was spent clears. The rest is
    // still in the employee's pocket, and stays in Employee Advance until they
    // hand it back.
    lines.push({
      accountId: advanceAccount.id,
      credit: totalSpent.toFixed(4),
      description: "Clear advance for expenses incurred",
    });
  } else {
    // Overspent: the whole advance clears and the excess becomes a payable.
    lines.push({
      accountId: advanceAccount.id,
      credit: advanceAmount.toFixed(4),
      description: "Clear full advance",
    });
    lines.push({
      accountId: payablesAccount.id,
      credit: Math.abs(balance).toFixed(4),
      description: `Additional reimbursement owed to ${settlement.employeeName}`,
    });
  }

  const entry = await createJournalEntry(tx, {
    companyId: settlement.companyId,
    entryDate: new Date().toISOString().slice(0, 10),
    entryType: "advance_settlement",
    description: `Advance settlement - ${settlement.claimNumber}`,
    reference: settlement.claimNumber,
    partyType: "employee",
    partyId: settlement.partyId,
    sourceType: "employee_claim",
    sourceId: settlement.id,
    lines,
    createdById: by.id ?? null,
    postImmediately: true,
  });

  await linkEntry(tx, {
    companyId: settlement.companyId,
    claimId: settlement.id,
    journalEntryId: entry.id,
    purpose: "settlement",
  });

  const nextStatus =
    balance === 0 ? "closed" : balance > 0 ? "pending_return" : "pending_payment";

  const [updated] = await tx
    .update(employeeClaims)
    .set({ status: nextStatus, updatedAt: new Date() })
    .where(eq(employeeClaims.id, settlementId))
    .returning();

  // Exactly matched settles the advance in the same breath.
  if (nextStatus === "closed") {
    await closeParentAdvance(tx, settlement.advanceClaimId);
  }

  return { claim: updated, entry, balance, status: nextStatus };
}

/**
 * The advance itself closes when its settlement does.
 *
 * Mongo leaves the advance on `paid` forever — the settlement closes and its
 * parent stays in the outstanding-advances figure, which is what that figure
 * is supposed to be counting. This is a deliberate change, and it is the
 * reason `paid → closed` exists in the status machine.
 */
async function closeParentAdvance(tx: Tx, advanceClaimId: string | null) {
  if (!advanceClaimId) return;
  await tx
    .update(employeeClaims)
    .set({ status: "closed", updatedAt: new Date() })
    .where(
      and(
        eq(employeeClaims.id, advanceClaimId),
        eq(employeeClaims.status, "paid"),
      ),
    );
}

export interface SettlementCashOptions {
  paymentAccountId: string;
  amount: MoneyString;
  paymentMethod?: string | null;
  reference?: string | null;
  recordedById?: string | null;
  recordedByName?: string | null;
}

/**
 * The employee hands back what they did not spend — `recordAdvanceReturn`.
 *
 *   DR Cash / Bank         the money comes back
 *   CR Employee Advance    what they were holding is cleared
 */
export async function recordAdvanceReturn(
  tx: Tx,
  settlementId: string,
  opts: SettlementCashOptions,
) {
  const settlement = await getClaim(tx, settlementId);
  if (!settlement) throw new Error("Settlement not found");
  if (settlement.status !== "pending_return") {
    throw new Error(
      `Settlement is not pending return. Current status: ${settlement.status}`,
    );
  }

  const advanceAccount = await systemAccountOrThrow(
    tx,
    "employee_advance",
    "Employee Advance",
  );

  const entry = await createJournalEntry(tx, {
    companyId: settlement.companyId,
    entryDate: new Date().toISOString().slice(0, 10),
    entryType: "advance_return",
    description: `Advance return - ${settlement.claimNumber}`,
    reference: opts.reference ?? settlement.claimNumber,
    partyType: "employee",
    partyId: settlement.partyId,
    sourceType: "employee_claim",
    sourceId: settlement.id,
    lines: [
      {
        accountId: opts.paymentAccountId,
        debit: opts.amount,
        description: `Cash returned by ${settlement.employeeName}`,
      },
      {
        accountId: advanceAccount.id,
        credit: opts.amount,
        description: "Clear remaining advance balance",
      },
    ],
    createdById: opts.recordedById ?? null,
    postImmediately: true,
  });

  await linkEntry(tx, {
    companyId: settlement.companyId,
    claimId: settlement.id,
    journalEntryId: entry.id,
    purpose: "return",
  });

  // The trigger checks this against the derived balance before it lands.
  const [updated] = await tx
    .update(employeeClaims)
    .set({
      amountReturned: opts.amount,
      returnRecordedAt: new Date(),
      returnRecordedById: opts.recordedById ?? null,
      returnRecordedByName: opts.recordedByName ?? null,
      updatedAt: new Date(),
    })
    .where(eq(employeeClaims.id, settlementId))
    .returning();

  const [closed] = await tx
    .update(employeeClaims)
    .set({ status: "closed", updatedAt: new Date() })
    .where(eq(employeeClaims.id, settlementId))
    .returning();

  await closeParentAdvance(tx, settlement.advanceClaimId);

  return { claim: closed ?? updated, entry };
}

/**
 * The company pays the employee what they were out of pocket —
 * `paySettlementBalance`.
 *
 *   DR Employee Payables   the liability raised by closeSettlement clears
 *   CR Cash / Bank         the money leaves
 */
export async function paySettlementBalance(
  tx: Tx,
  settlementId: string,
  opts: SettlementCashOptions,
) {
  const settlement = await getClaim(tx, settlementId);
  if (!settlement) throw new Error("Settlement not found");
  if (settlement.status !== "pending_payment") {
    throw new Error(
      `Settlement is not pending payment. Current status: ${settlement.status}`,
    );
  }

  const payablesAccount = await systemAccountOrThrow(
    tx,
    "employee_payables",
    "Employee Payables",
  );

  const entry = await createJournalEntry(tx, {
    companyId: settlement.companyId,
    entryDate: new Date().toISOString().slice(0, 10),
    entryType: "payment_made",
    description: `Settlement payment - ${settlement.claimNumber}`,
    reference: opts.reference ?? settlement.claimNumber,
    partyType: "employee",
    partyId: settlement.partyId,
    sourceType: "employee_claim",
    sourceId: settlement.id,
    lines: [
      {
        accountId: payablesAccount.id,
        debit: opts.amount,
        description: `Clear payable to ${settlement.employeeName}`,
      },
      {
        accountId: opts.paymentAccountId,
        credit: opts.amount,
        description: `Payment via ${opts.paymentMethod ?? "bank"}`,
      },
    ],
    createdById: opts.recordedById ?? null,
    postImmediately: true,
  });

  await linkEntry(tx, {
    companyId: settlement.companyId,
    claimId: settlement.id,
    journalEntryId: entry.id,
    purpose: "payment",
  });

  await tx
    .update(employeeClaims)
    .set({
      amountPaidToEmployee: opts.amount,
      extraPaidAt: new Date(),
      extraPaidById: opts.recordedById ?? null,
      extraPaidByName: opts.recordedByName ?? null,
      updatedAt: new Date(),
    })
    .where(eq(employeeClaims.id, settlementId));

  const [closed] = await tx
    .update(employeeClaims)
    .set({ status: "closed", updatedAt: new Date() })
    .where(eq(employeeClaims.id, settlementId))
    .returning();

  await closeParentAdvance(tx, settlement.advanceClaimId);

  return { claim: closed, entry };
}

/**
 * Pay an approved reimbursement — two entries, because two things happen.
 *
 *   #1  DR Expense accounts     the expense is recognised
 *       CR Employee Payables    the company owes the employee
 *
 *   #2  DR Employee Payables    the liability clears
 *       CR Cash / Bank          the money leaves
 *
 * They are separate on purpose: the expense belongs to the date it was
 * incurred and the payment to the date it was made, and collapsing them into
 * one entry loses the payable that sat between.
 */
export async function payReimbursement(
  tx: Tx,
  claimId: string,
  opts: PayClaimOptions,
) {
  const claim = await getClaim(tx, claimId);
  if (!claim) throw new Error("Claim not found");
  if (claim.claimType !== "reimbursement") {
    throw new Error("Only a reimbursement can be paid this way.");
  }
  if (claim.status !== "approved") {
    throw new Error(
      `Claim ${claim.claimNumber} is ${claim.status}; only an approved reimbursement can be paid.`,
    );
  }

  const payablesAccount = await systemAccountOrThrow(
    tx,
    "employee_payables",
    "Employee Payables",
  );

  const employeeName = claim.employeeName ?? "employee";
  const total = claim.totalAmount;
  const today = new Date().toISOString().slice(0, 10);

  const expenseLines = await expenseLinesFor(tx, claim.id, employeeName);

  const expenseEntry = await createJournalEntry(tx, {
    companyId: claim.companyId,
    entryDate: today,
    entryType: "expense",
    description: `Expense recognition - ${claim.claimNumber}`,
    reference: claim.claimNumber,
    partyType: "employee",
    partyId: claim.partyId,
    sourceType: "employee_claim",
    sourceId: claim.id,
    lines: [
      ...expenseLines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit,
        description: l.description,
      })),
      {
        accountId: payablesAccount.id,
        credit: total,
        description: `Reimbursement owed to ${employeeName}`,
      },
    ],
    createdById: opts.paidById ?? null,
    postImmediately: true,
  });

  await linkEntry(tx, {
    companyId: claim.companyId,
    claimId: claim.id,
    journalEntryId: expenseEntry.id,
    purpose: "expense",
  });

  const paymentEntry = await createJournalEntry(tx, {
    companyId: claim.companyId,
    entryDate: today,
    entryType: "payment_made",
    description: `Reimbursement payment to ${employeeName} - ${claim.claimNumber}`,
    reference: opts.paymentReference ?? claim.claimNumber,
    notes: opts.paymentNotes ?? null,
    partyType: "employee",
    partyId: claim.partyId,
    sourceType: "employee_claim",
    sourceId: claim.id,
    lines: [
      {
        accountId: payablesAccount.id,
        debit: total,
        description: `Clear liability to ${employeeName}`,
      },
      {
        accountId: opts.paymentAccountId,
        credit: total,
        description: `Payment via ${opts.paymentMethod ?? "bank"}${
          opts.paymentReference ? ` - Ref: ${opts.paymentReference}` : ""
        }`,
      },
    ],
    createdById: opts.paidById ?? null,
    postImmediately: true,
  });

  await linkEntry(tx, {
    companyId: claim.companyId,
    claimId: claim.id,
    journalEntryId: paymentEntry.id,
    purpose: "payment",
  });

  const [updated] = await tx
    .update(employeeClaims)
    .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
    .where(eq(employeeClaims.id, claimId))
    .returning();

  return { claim: updated, expenseEntry, paymentEntry };
}

// ─────────────────────────────────────────────────────────────────────────────
// The shape the claims screens read
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A claim, named as the thirteen claim components already read it.
 *
 * They address `claim._id`, `claim.employee.name`,
 * `claim.advanceDetails.travelDates.from` and `claim.returnDetails.balance` —
 * the Mongo document's shape. The same choice `getBillDetail` made in 0015,
 * and for the same reason: the alternative is rewriting every screen in the
 * module in the same commit that moves its data, which is how a port acquires
 * bugs that have nothing to do with the port.
 *
 * The nesting is presentational only. Nothing writes through this shape, and
 * the derived figures inside it — `totalAmount`, `returnDetails.totalSpent`,
 * `returnDetails.balance` — come from `employee_claim_state`, not from stored
 * columns, so they are correct here in a way they were not in Mongo.
 */
export function toClaimViewModel(
  claim: Claim,
  extras: {
    items?: Awaited<ReturnType<typeof listClaimItems>>;
    attachments?: Array<Record<string, unknown>>;
    settlementClaimId?: string | null;
  } = {},
) {
  const audit = (name: string | null, id?: string | null) =>
    name ? { name, id: id ?? null } : null;

  return {
    _id: claim.id,
    id: claim.id,
    companyId: claim.companyId,
    claimNumber: claim.claimNumber,
    claimDate: claim.claimDate,
    claimType: claim.claimType,
    status: claim.status,
    description: claim.description,
    notes: claim.notes,
    currency: claim.currency,
    totalAmount: Number(claim.totalAmount),

    employee: {
      partyId: claim.partyId,
      userId: claim.employeeUserId,
      name: claim.employeeName,
      email: claim.employeeEmail,
      employeeNumber: claim.employeeNumber,
      department: claim.department,
    },

    projectId: claim.projectId,
    project: claim.projectId
      ? { projectNumber: claim.projectNumber, name: claim.projectName }
      : null,
    costCodeId: claim.costCodeId,
    costCode: claim.costCodeId
      ? { code: claim.costCodeCode, name: claim.costCodeName }
      : null,

    advanceDetails: {
      advanceType: claim.advanceType,
      requestedAmount:
        claim.requestedAmount != null ? Number(claim.requestedAmount) : null,
      purpose: claim.purpose,
      destination: claim.destination,
      estimatedExpenses: claim.estimatedExpenses,
      travelDates: { from: claim.travelFrom, to: claim.travelTo },
      approvedAmount:
        claim.approvedAmount != null ? Number(claim.approvedAmount) : null,
      disbursedAmount:
        claim.disbursedAmount != null ? Number(claim.disbursedAmount) : null,
      disbursementDate: claim.disbursementDate,
    },

    returnDetails: {
      advanceClaimId: claim.advanceClaimId,
      advanceAmount:
        claim.advanceAmount != null ? Number(claim.advanceAmount) : null,
      totalSpent: claim.totalSpent != null ? Number(claim.totalSpent) : null,
      balance: claim.balance != null ? Number(claim.balance) : null,
      balanceOutstanding:
        claim.balanceOutstanding != null
          ? Number(claim.balanceOutstanding)
          : null,
      amountReturned: Number(claim.amountReturned ?? 0),
      amountPaidToEmployee: Number(claim.amountPaidToEmployee ?? 0),
      returnRecordedAt: claim.returnRecordedAt,
      extraPaidAt: claim.extraPaidAt,
    },

    /**
     * Derived by looking for the settlement that points HERE, rather than
     * stored on both rows. §8.2 — the reverse pointer is the one that can go
     * out of step, so there isn't one.
     */
    settlementClaimId: extras.settlementClaimId ?? null,

    items: (extras.items ?? []).map((i) => ({
      _id: i.id,
      date: i.itemDate,
      category: i.category,
      expenseAccountId: i.expenseAccountId,
      accountCode: i.accountCode,
      accountName: i.accountName,
      description: i.description,
      amount: Number(i.amount),
      notes: i.notes,
      receipt: i.receiptUrl
        ? { filename: i.receiptFilename, url: i.receiptUrl }
        : null,
    })),

    receipts: (extras.attachments ?? []).map((a) => ({
      _id: String(a.id),
      filename: a.filename,
      url: a.url,
      size: a.size != null ? Number(a.size) : null,
      mimeType: a.mimeType,
      uploadedAt: a.uploadedAt,
      uploadedBy: audit(
        (a.uploadedByName as string) ?? null,
        (a.uploadedById as string) ?? null,
      ),
    })),

    submittedAt: claim.submittedAt,
    submittedBy: audit(claim.submittedByName),
    approvedAt: claim.approvedAt,
    approvedBy: audit(claim.approvedByName),
    rejectedAt: claim.rejectedAt,
    rejectedBy: audit(claim.rejectedByName),
    rejectionReason: claim.rejectionReason,
    paidAt: claim.paidAt,
    createdAt: claim.createdAt,
    createdBy: audit(claim.createdByName, claim.createdById),

    // Derived, and not in the Mongo shape: what this claim is waiting on.
    awaiting: claim.awaiting,
    itemCount: claim.itemCount,
  };
}

/** The list page, already in the shape its rows read. */
export async function listClaimsForScreen(
  tx: Tx,
  opts: ListClaimsOptions = {},
) {
  const { claims: rows, total } = await listClaims(tx, opts);
  return { claims: rows.map((c) => toClaimViewModel(c)), total };
}

/** The detail page: the claim, its items, its receipts, and its counterpart. */
export async function getClaimForScreen(tx: Tx, claimId: string) {
  // An id a uuid column cannot hold is NOT FOUND, not a 22P02 with
  // the statement in the message. See isUuid in sqlHelpers.
  if (!isUuid(claimId)) return null;
  const detail = await getClaimDetail(tx, claimId);
  if (!detail) return null;

  return {
    ...toClaimViewModel(detail, {
      items: detail.items,
      attachments: detail.attachments as unknown as Array<
        Record<string, unknown>
      >,
      settlementClaimId: detail.settlement?.id ?? null,
    }),
    journalEntries: detail.journalEntries,
    settlement: detail.settlement ? toClaimViewModel(detail.settlement) : null,
    advance: detail.advance ? toClaimViewModel(detail.advance) : null,
  };
}
