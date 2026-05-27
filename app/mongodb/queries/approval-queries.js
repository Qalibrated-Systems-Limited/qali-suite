import "server-only";
import { cache } from "react";
import mongoose from "mongoose";

import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  withTenantScope,
} from "@/lib/utils/tenant-utils";
import ApprovalRequest, {
  APPROVER_MATRIX,
} from "@/app/models/approvalRequest";
import Bill from "@/app/models/bill";
import LeaveRequest from "@/app/models/leaveRequest";
import Loan from "@/app/models/loan";
import EmployeeClaim from "@/app/models/employeesClaims";
import Nonconformance from "@/app/models/nonconformance";
import Expense from "@/app/models/expenses";
import { StockRequest } from "@/app/models/requests";
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
  OPERATING_EXPENSE_APPROVER_ROLES,
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
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const role = user?.role;
    if (!role) return 0;

    const tenantMatch = isSuperAdmin
      ? {}
      : { companyId: new mongoose.Types.ObjectId(companyId) };

    // Generic approval engine — gated by APPROVER_MATRIX
    const engineTypes = Object.entries(APPROVER_MATRIX)
      .filter(([, roles]) =>
        role === "SuperAdmin" ? true : roles.includes(role),
      )
      .map(([k]) => k);

    const tasks = [];

    if (engineTypes.length > 0) {
      tasks.push(
        ApprovalRequest.countDocuments(
          withTenantScope(
            { status: "submitted", type: { $in: engineTypes } },
            companyId,
            isSuperAdmin,
          ),
        ),
      );
    }

    if (STOCK_REQUEST_APPROVER_ROLES.has(role)) {
      tasks.push(
        StockRequest.countDocuments({ ...tenantMatch, status: "pending" }),
      );
    }
    if (BILL_APPROVER_ROLES.has(role)) {
      tasks.push(
        Bill.countDocuments({ ...tenantMatch, status: "submitted" }),
      );
    }
    if (LEAVE_APPROVER_ROLES.has(role)) {
      tasks.push(
        LeaveRequest.countDocuments({ ...tenantMatch, status: "submitted" }),
      );
    }
    if (LOAN_APPROVER_ROLES.has(role)) {
      tasks.push(
        Loan.countDocuments({
          ...tenantMatch,
          status: "pending_approval",
        }),
      );
    }
    if (CLAIM_APPROVER_ROLES.has(role)) {
      tasks.push(
        EmployeeClaim.countDocuments({
          ...tenantMatch,
          status: "submitted",
          claimType: { $in: ["advance_request", "reimbursement"] },
        }),
      );
    }
    if (NCR_AUTHORIZER_ROLES.has(role)) {
      tasks.push(
        Nonconformance.countDocuments({
          ...tenantMatch,
          status: "disposition_proposed",
        }),
      );
    }
    if (OPERATING_EXPENSE_APPROVER_ROLES.has(role)) {
      tasks.push(
        Expense.countDocuments({ ...tenantMatch, status: "pending" }),
      );
    }

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
