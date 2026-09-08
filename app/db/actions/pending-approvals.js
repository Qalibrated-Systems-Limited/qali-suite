"use server";

// ============================================
// PENDING APPROVALS — UNIFIED INBOX FEED
// ============================================
//
// Per-domain queries that surface documents awaiting a decision. Each is
// tenant-scoped, capped, and returns a small render-friendly projection.
//
// Designed for `/dashboard/approvals`, where every section is its own Suspense
// boundary and the page renders only the sections whose role gate matches the
// caller — so a query is not invoked at all for a section that will not show.
//
// MOVED HERE FROM app/mongodb/queries/ (0101). Most of it was already
// Postgres: leave, loans, claims and NCRs each moved as their own module did,
// with a note above them recording that the Mongo collection they used to read
// "is no longer written to, so the approvals dashboard would show an empty
// queue however many requests were waiting".
//
// `getPendingBills` was the last one that had not, and it had exactly that
// defect — it read the MONGO `Bill` collection while bills have been Postgres
// since their port, so the bills section of this page has been EMPTY for every
// tenant. It reads `listBillsForPage` now.
// ============================================
import { listLeaveAwaitingApproval } from "@/app/db/actions/hr-leave-actions";
import { listLoansAwaitingApproval } from "@/app/db/actions/hr-loan-actions";
import { listNonconformancesAwaitingAuthorisationPg } from "@/app/db/actions/ncr-actions";
import { listBillsForPage } from "@/app/db/actions/bill-actions";
import { listClaimsPg } from "@/app/db/actions/claim-actions";

const DEFAULT_LIMIT = 50;


// ============================================
// BILLS — status: submitted
// ============================================
export async function getPendingBills(limit = DEFAULT_LIMIT) {
  const { bills } = await listBillsForPage({
    status: "submitted",
    limit,
    page: 1,
  });

  return bills.map((b) => ({
    _id: String(b.id ?? b._id),
    ref: b.billNumber,
    title: b.supplierName ?? b.supplier?.name ?? "—",
    amount: Number(b.total ?? b.netPayable ?? 0),
    submittedAt: b.submittedAt ?? b.billDate ?? b.createdAt,
    submittedBy: b.submittedByName ?? b.createdByName ?? "—",
    href: `/dashboard/bills/${b.id ?? b._id}`,
    meta: b.dueDate
      ? `Due ${new Date(b.dueDate).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}`
      : null,
  }));
}

// ============================================
// LEAVE REQUESTS — status: submitted
// ============================================
/**
 * Leave awaiting a decision.
 *
 * Reads Postgres — the Mongo collection this used to query is no longer
 * written to, so the approvals dashboard would show an empty leave queue
 * however many requests were waiting.
 */
export async function getPendingLeaveRequests(limit = DEFAULT_LIMIT) {
  return listLeaveAwaitingApproval(limit);
}

// ============================================
// LOANS — status: pending_approval
// ============================================
/**
 * Staff loans awaiting approval. Postgres, for the same reason as leave.
 *
 * The dashboard shows an amount beside a loan, so it is carried through
 * rather than left to be parsed out of the description.
 */
export async function getPendingLoans(limit = DEFAULT_LIMIT) {
  return listLoansAwaitingApproval(limit);
}

// ============================================
// CLAIMS (reimbursements + advances) — status: submitted
// `claimType` distinguishes the two so we can render appropriate labels.
// ============================================
async function getPendingClaimsByType(claimType, limit) {
  // Postgres since the claims port. Reading the Mongo collection here would
  // report an empty queue however many claims were waiting — which is exactly
  // what this dashboard already did for leave and loans.
  //
  // The amount is also right now. The Mongo version reads
  // `r.totals?.totalAmount || r.totals?.requestedAmount || ...` and there is
  // no `totals` field on the claim schema at all, so a REIMBURSEMENT fell all
  // the way through to `advanceDetails?.requestedAmount`, which a
  // reimbursement never has, and showed 0.
  const { claims } = await listClaimsPg({
    status: "submitted",
    claimType,
    orderBy: "submittedAt",
    limit,
  });

  return claims.map((c) => ({
    _id: c._id,
    ref: c.claimNumber,
    title: c.employee?.name || c.submittedBy?.name || "—",
    amount: c.totalAmount,
    submittedAt: c.submittedAt || c.createdAt,
    submittedBy: c.submittedBy?.name || "—",
    href: `/dashboard/claims/${c._id}`,
    meta: claimType === "advance_request" ? c.advanceDetails?.advanceType : null,
  }));
}

/*
 * `await dbConnect()` used to open a MONGO connection here before delegating
 * to a Postgres claims read that never touched it — a leftover from when this
 * function did read Mongo. With no Mongo configured it would have thrown on
 * the way to a query that would have worked.
 */
export async function getPendingReimbursements(limit = DEFAULT_LIMIT) {
  return getPendingClaimsByType("reimbursement", limit);
}

export async function getPendingAdvances(limit = DEFAULT_LIMIT) {
  return getPendingClaimsByType("advance_request", limit);
}

// ============================================
// NCR — status: disposition_proposed (awaiting MD authorisation)
// ============================================
/**
 * Nonconformances awaiting the MD's decision.
 *
 * Delegated to Postgres, the way getPendingLoans is. The register moved with
 * the procurement port, so counting the Mongo collection here would report an
 * empty queue however many were waiting — which is exactly what happened to
 * leave and loans when HR moved.
 */
export async function getPendingNCRs(limit = DEFAULT_LIMIT) {
  return listNonconformancesAwaitingAuthorisationPg(limit);
}
