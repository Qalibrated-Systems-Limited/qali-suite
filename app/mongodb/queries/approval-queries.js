import "server-only";
import { cache } from "react";

import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  withTenantScope,
} from "@/lib/utils/tenant-utils";
import ApprovalRequest, {
  APPROVER_MATRIX,
} from "@/app/models/approvalRequest";

// ============================================
// APPROVAL QUERIES — cached, request-scoped
// ============================================

/**
 * Count approvals the caller can act on (submitted + their role is in the
 * approver matrix for that type). Used to drive the AlertsStrip badge and
 * the bottom-nav indicator.
 */
export const cMyPendingApprovals = cache(async () => {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const role = user?.role;

    // Which types can this role decide on?
    const types = Object.entries(APPROVER_MATRIX)
      .filter(([, roles]) =>
        role === "SuperAdmin" ? true : roles.includes(role),
      )
      .map(([k]) => k);

    if (types.length === 0) return 0;

    return ApprovalRequest.countDocuments(
      withTenantScope(
        { status: "submitted", type: { $in: types } },
        companyId,
        isSuperAdmin,
      ),
    );
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
