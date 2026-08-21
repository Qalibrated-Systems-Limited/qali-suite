// ============================================
// PENDING APPROVALS — UNIFIED INBOX FEED
// ============================================
//
// Per-domain queries that surface documents awaiting a decision. Each
// is tenant-scoped, indexed on the same composite Mongo expects
// (`(companyId, status, ...)`), capped at a sensible limit, and returns
// a small, render-friendly projection — no full documents.
//
// Designed for use from the unified `/dashboard/approvals` page where
// every section is a Suspense boundary. The page renders only the
// sections whose role gate matches the caller; queries are not invoked
// at all for sections that won't render.
// ============================================
import mongoose from "mongoose";
import dbConnect from "@/app/config/dbConnect";
import { listLeaveAwaitingApproval } from "@/app/db/actions/hr-leave-actions";
import { listLoansAwaitingApproval } from "@/app/db/actions/hr-loan-actions";
import { listNonconformancesAwaitingAuthorisationPg } from "@/app/db/actions/ncr-actions";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import Bill from "@/app/models/bill";
import EmployeeClaim from "@/app/models/employeesClaims";
import Expense from "@/app/models/expenses";

const { ObjectId } = mongoose.Types;
const DEFAULT_LIMIT = 50;

function tenantFilter(companyId, isSuperAdmin) {
  return isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };
}

// ============================================
// BILLS — status: submitted
// ============================================
export async function getPendingBills(limit = DEFAULT_LIMIT) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  return Bill.find({
    ...tenantFilter(companyId, isSuperAdmin),
    status: "submitted",
  })
    .select(
      "billNumber supplier amounts dueDate submittedAt submittedBy createdAt",
    )
    .sort({ submittedAt: -1, createdAt: -1 })
    .limit(limit)
    .lean()
    .then((rows) =>
      rows.map((r) => ({
        _id: r._id.toString(),
        ref: r.billNumber,
        title: r.supplier?.name || "—",
        amount: r.amounts?.total || 0,
        submittedAt: r.submittedAt || r.createdAt,
        submittedBy: r.submittedBy?.name || "—",
        href: `/dashboard/bills/${r._id}`,
        meta: r.dueDate
          ? `Due ${new Date(r.dueDate).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}`
          : null,
      })),
    );
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
  const { companyId, isSuperAdmin } = await getTenantContext();
  return EmployeeClaim.find({
    ...tenantFilter(companyId, isSuperAdmin),
    status: "submitted",
    claimType,
  })
    .select(
      "claimNumber claimType employee totals submittedAt submittedBy advanceDetails createdAt",
    )
    .sort({ submittedAt: -1, createdAt: -1 })
    .limit(limit)
    .lean()
    .then((rows) =>
      rows.map((r) => ({
        _id: r._id.toString(),
        ref: r.claimNumber,
        title: r.employee?.name || r.submittedBy?.name || "—",
        amount:
          r.totals?.totalAmount ||
          r.totals?.requestedAmount ||
          r.advanceDetails?.requestedAmount ||
          0,
        submittedAt: r.submittedAt || r.createdAt,
        submittedBy: r.submittedBy?.name || "—",
        href: `/dashboard/claims/${r._id}`,
        meta:
          claimType === "advance_request"
            ? r.advanceDetails?.advanceType
            : null,
      })),
    );
}

export async function getPendingReimbursements(limit = DEFAULT_LIMIT) {
  await dbConnect();
  return getPendingClaimsByType("reimbursement", limit);
}

export async function getPendingAdvances(limit = DEFAULT_LIMIT) {
  await dbConnect();
  return getPendingClaimsByType("advance_request", limit);
}

// ============================================
// OPERATING EXPENSES — status: pending
// (utilities, rent, payroll, transport, etc — distinct from
//  EmployeeClaim's advance/reimbursement flow)
// ============================================
export async function getPendingOperatingExpenses(limit = DEFAULT_LIMIT) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  return Expense.find({
    ...tenantFilter(companyId, isSuperAdmin),
    status: "pending",
  })
    .select(
      "expenseNumber category total vendor description submittedAt submittedBy expenseDate isReimbursable createdAt",
    )
    .sort({ submittedAt: -1, createdAt: -1 })
    .limit(limit)
    .lean()
    .then((rows) =>
      rows.map((r) => ({
        _id: r._id.toString(),
        ref: r.expenseNumber,
        title: r.vendor?.name || r.description || "—",
        subtitle: r.category,
        amount: r.total || 0,
        submittedAt: r.submittedAt || r.createdAt,
        submittedBy: r.submittedBy?.name || "—",
        href: `/dashboard/expenses/${r._id}`,
        meta: r.expenseDate
          ? new Date(r.expenseDate).toLocaleDateString("en-KE", {
              day: "numeric",
              month: "short",
            })
          : null,
      })),
    );
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
