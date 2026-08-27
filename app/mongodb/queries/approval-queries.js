import "server-only";
import { cache } from "react";

import dbConnect from "@/app/config/dbConnect";
import { countLeaveAwaitingApproval } from "@/app/db/actions/hr-leave-actions";
import { countLoansAwaitingApproval } from "@/app/db/actions/hr-loan-actions";
import { getBillsStats } from "@/app/db/actions/bill-actions";
import { getRequestStats } from "@/app/db/actions/request-actions";
import {
  getTenantContext,
  withTenantScope,
} from "@/lib/utils/tenant-utils";
import ApprovalRequest, {
  APPROVER_MATRIX,
} from "@/app/models/approvalRequest";
import { countClaimsAwaitingApprovalPg } from "@/app/db/actions/claim-actions";
import { countNonconformancesAwaitingAuthorisationPg } from "@/app/db/actions/ncr-actions";
// Approver matrices imported from the central rules module. Single
// source of truth for these gates — every consumer (this query, the
// /dashboard/approvals page, the dashboard tile) reads the same Sets.
import {
  STOCK_REQUEST_APPROVER_ROLES,
  BILL_APPROVER_ROLES,
  LEAVE_APPROVER_ROLES,
  LOAN_APPROVER_ROLES,
  CLAIM_APPROVER_ROLES,
  NCR_AUTHORIZER_ROLES,
} from "@/lib/business-rules";

// ============================================
// APPROVAL QUERIES — cached, request-scoped
// ============================================

/**
 * Count approvals the caller can act on. Aggregates across every
 * collection /dashboard/approvals surfaces, gated by the same role
 * matrices used on that page, so the dashboard tile and the approvals
 * page never disagree.
 */
export const cMyPendingApprovals = cache(async () => {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const role = user?.role;
    if (!role) return 0;

    /**
     * THE MONGO COUNT STAYS — IT JUST CANNOT TAKE THE OTHERS DOWN.
     *
     * The generic ApprovalRequest engine is not ported yet, so it is still
     * counted from Mongo. What changed is where the connection is opened.
     *
     * `dbConnect()` used to be the first line of this function, so with the
     * Atlas cluster unreachable it threw before ANY of the six Postgres counts
     * ran and the tile reported 0 — "nothing to approve" is the worst possible
     * answer from an approvals tile, and this module has already been burnt by
     * exactly that once, with leave and loans.
     *
     * Now the engine count owns its connection and its own catch. Mongo down
     * costs you the engine number; stock requests, bills, leave, loans, claims
     * and NCRs still report, because those live in Postgres.
     */
    const engineTypes = Object.entries(APPROVER_MATRIX)
      .filter(([, roles]) =>
        role === "SuperAdmin" ? true : roles.includes(role),
      )
      .map(([k]) => k);

    const tasks = [];

    if (engineTypes.length > 0) {
      tasks.push(
        (async () => {
          try {
            await dbConnect();
            return await ApprovalRequest.countDocuments(
              withTenantScope(
                { status: "submitted", type: { $in: engineTypes } },
                companyId,
                isSuperAdmin,
              ),
            );
          } catch (error) {
            console.error(
              "Approval engine count unavailable (Mongo):",
              error?.message,
            );
            return 0;
          }
        })(),
      );
    }

    if (STOCK_REQUEST_APPROVER_ROLES.has(role)) {
      // Postgres since the requests port. The Mongo collection this counted is
      // no longer written to, so it reported zero for every tenant.
      tasks.push(getRequestStats().then((s) => s?.pending ?? 0));
    }
    if (BILL_APPROVER_ROLES.has(role)) {
      // Postgres since the bills port, same as requests above. `submitted` is
      // the awaiting-approval status on both sides.
      tasks.push(getBillsStats().then((s) => s?.pendingCount ?? 0));
    }
    if (LEAVE_APPROVER_ROLES.has(role)) {
      // Leave lives in Postgres. Counting the Mongo collection would report
      // zero for every tenant, and an approvals dashboard that says there is
      // nothing to approve is worse than no dashboard.
      tasks.push(countLeaveAwaitingApproval());
    }
    if (LOAN_APPROVER_ROLES.has(role)) {
      // Also Postgres, for the same reason as leave above.
      tasks.push(countLoansAwaitingApproval());
    }
    if (CLAIM_APPROVER_ROLES.has(role)) {
      // Postgres since the claims port — the Mongo collection this used to
      // count is no longer written to, so it would always report zero. Same
      // as leave, loans and NCRs above.
      tasks.push(
        countClaimsAwaitingApprovalPg(["advance_request", "reimbursement"]),
      );
    }
    if (NCR_AUTHORIZER_ROLES.has(role)) {
      // Postgres since the procurement port — the Mongo collection this used
      // to count is no longer written to, so it would always report zero.
      tasks.push(countNonconformancesAwaitingAuthorisationPg());
    }
    // Expenses are NOT counted here any more, and never should have been.
    // This counted `status: "pending"` — a legacy status the one-step flow
    // stopped producing long ago, so the number was always zero. And it was
    // redundant even if it had worked: an expense that needs sign-off is an
    // ApprovalRequest of type `expense_payment`, which the engine count above
    // already includes (approvalRequest.js:187). 0059 removes the status.

    if (tasks.length === 0) return 0;

    const counts = await Promise.all(tasks);
    return counts.reduce((sum, n) => sum + (n || 0), 0);
  } catch (error) {
    console.error("cMyPendingApprovals error:", error);
    return 0;
  }
});

/**
 * Approvals queue for the caller's role. Returns serialized rows.
 */
export const cApprovalQueue = cache(async (status = "submitted") => {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const role = user?.role;

    const types = Object.entries(APPROVER_MATRIX)
      .filter(([, roles]) =>
        role === "SuperAdmin" ? true : roles.includes(role),
      )
      .map(([k]) => k);

    if (types.length === 0) return [];

    const filter = withTenantScope(
      { status, type: { $in: types } },
      companyId,
      isSuperAdmin,
    );

    const rows = await ApprovalRequest.find(filter)
      .sort({ "submittedBy.submittedAt": -1 })
      .limit(100)
      .lean();

    return rows.map((r) => ({
      _id: r._id.toString(),
      requestNumber: r.requestNumber,
      type: r.type,
      status: r.status,
      reason: r.reason || "",
      requesterNote: r.requesterNote || "",
      context: r.context || {},
      payload: r.payload || {},
      targetRef: r.targetRef
        ? {
            kind: r.targetRef.kind,
            id: r.targetRef.id?.toString?.() ?? null,
            label: r.targetRef.label || "",
          }
        : null,
      submittedBy: {
        id: r.submittedBy?.id || "",
        name: r.submittedBy?.name || "",
        role: r.submittedBy?.role || "",
        submittedAt:
          r.submittedBy?.submittedAt?.toISOString?.() ??
          r.submittedBy?.submittedAt ??
          null,
      },
      decision: r.decision
        ? {
            action: r.decision.action,
            by: r.decision.by,
            at: r.decision.at?.toISOString?.() ?? r.decision.at ?? null,
            note: r.decision.note || "",
          }
        : null,
    }));
  } catch (error) {
    console.error("cApprovalQueue error:", error);
    return [];
  }
});

/**
 * "What I submitted" — for the requester to track their pending items.
 */
export const cMySubmittedApprovals = cache(async (limit = 20) => {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    if (!user?.id) return [];

    const filter = withTenantScope(
      { "submittedBy.id": user.id },
      companyId,
      isSuperAdmin,
    );

    const rows = await ApprovalRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return rows.map((r) => ({
      _id: r._id.toString(),
      requestNumber: r.requestNumber,
      type: r.type,
      status: r.status,
      reason: r.reason || "",
      submittedAt:
        r.submittedBy?.submittedAt?.toISOString?.() ??
        r.submittedBy?.submittedAt ??
        null,
      decisionAt: r.decision?.at?.toISOString?.() ?? r.decision?.at ?? null,
    }));
  } catch (error) {
    console.error("cMySubmittedApprovals error:", error);
    return [];
  }
});
