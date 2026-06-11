import "server-only";
import mongoose from "mongoose";

import User from "@/app/models/user";
import { sendInternalNotificationEmail } from "@/lib/email";

// ============================================
// APPROVAL NOTIFICATIONS
// ============================================
// Email the people who can act, the moment there is something to act on:
//  - submit  → every Active user in the tenant whose role is in the
//              request's requiredApproverRoles (minus the submitter)
//  - decide  → the submitter
//
// Strictly best-effort: every function swallows its own errors. A failed
// email must never fail (or slow-roll) the approval action itself — callers
// can fire-and-await without try/catch.

const APP_URL = process.env.APP_URL || "http://localhost:3000";
const MAX_RECIPIENTS = 25; // safety ceiling — no tenant has more approvers

const TYPE_LABELS = {
  price_change: "Price change",
  stock_writeoff: "Stock write-off",
  stock_adjustment: "Stock adjustment",
  bill_payment: "Bill payment",
  credit_note: "Credit note",
  discount: "Discount",
};

function approvalRows(approval) {
  return [
    ["Request", approval.requestNumber],
    ["Type", TYPE_LABELS[approval.type] || approval.type],
    ["Regarding", approval.targetRef?.label],
    ["Reason", approval.reason],
    ["Submitted by", approval.submittedBy?.name],
  ];
}

/**
 * Notify eligible approvers that a new request needs their decision.
 */
export async function notifyApprovalSubmitted(approval) {
  try {
    const roles = approval?.requiredApproverRoles || [];
    if (roles.length === 0) return;

    // Eligible approvers in this tenant, excluding whoever raised it.
    // Projection + lean + capped — this runs inline in the submit action.
    const approvers = await User.find({
      companyId: approval.companyId,
      role: { $in: roles },
      status: "Active",
    })
      .select("email name")
      .limit(MAX_RECIPIENTS)
      .lean();

    const to = approvers
      .filter((u) => u.email && u._id.toString() !== approval.submittedBy?.id)
      .map((u) => u.email);
    if (to.length === 0) return;

    await sendInternalNotificationEmail({
      to,
      subject: `Approval needed: ${approval.requestNumber} — ${TYPE_LABELS[approval.type] || approval.type}`,
      label: "Approval requested",
      heading: `${approval.requestNumber} is waiting for your decision`,
      rows: approvalRows(approval),
      note: approval.requesterNote || undefined,
      ctaUrl: `${APP_URL}/dashboard/approvals`,
      ctaLabel: "Review request",
    });
  } catch (e) {
    console.error("notifyApprovalSubmitted error:", e);
  }
}

/**
 * Notify the submitter that their request was approved or rejected.
 */
export async function notifyApprovalDecided(approval, action, decidedBy) {
  try {
    const submitterId = approval?.submittedBy?.id;
    if (!submitterId || !mongoose.Types.ObjectId.isValid(submitterId)) return;
    // Don't email people about their own clicks (e.g. admin self-approval).
    if (decidedBy?.id === submitterId) return;

    const submitter = await User.findOne({
      _id: submitterId,
      companyId: approval.companyId,
    })
      .select("email name")
      .lean();
    if (!submitter?.email) return;

    const verb = action === "approved" ? "approved" : "rejected";
    await sendInternalNotificationEmail({
      to: submitter.email,
      subject: `${approval.requestNumber} ${verb} — ${TYPE_LABELS[approval.type] || approval.type}`,
      label: `Request ${verb}`,
      heading: `Your request ${approval.requestNumber} was ${verb}`,
      rows: [
        ...approvalRows(approval).filter(([k]) => k !== "Submitted by"),
        ["Decided by", decidedBy?.name],
        ["Note", approval.decision?.note],
      ],
      ctaUrl: `${APP_URL}/dashboard/approvals`,
      ctaLabel: "View request",
    });
  } catch (e) {
    console.error("notifyApprovalDecided error:", e);
  }
}
