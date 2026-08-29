import "server-only";

import { notifyApprovers, notifySubmitter } from "@/app/db/actions/approval-notify-actions";
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
//
// ── WHY THIS FILE CHANGED (0074) ───────────────────────────────────────────
// It read the Mongo `User` collection to find who to notify, and wrote the
// bell into the Mongo `Notification` collection. Users moved in 0036, so
// `User.find({ companyId, role: { $in: roles } })` had been matching NOTHING
// since — **every approval submitted since then notified nobody and emailed
// nobody**, silently, because this file swallows its own errors by design.
//
// The recipient lookup and the bell write now happen in Postgres, behind
// `approval-notify-actions`. The approval ENGINE stays on Mongo deliberately
// (see the 2026-08-27 handoff); only the people and the bell moved, and the
// tenant comes from the SESSION rather than from `approval.companyId` — these
// three call sites are all inside server actions, and a Mongo ObjectId on the
// approval document is not a company id Postgres can use.
// ============================================

const APP_URL = process.env.APP_URL || "http://localhost:3000";

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

const label = (approval) => TYPE_LABELS[approval.type] || approval.type;

/**
 * Notify eligible approvers that a new request needs their decision.
 */
export async function notifyApprovalSubmitted(approval) {
  try {
    const roles = approval?.requiredApproverRoles || [];
    if (roles.length === 0) return;

    const recipients = await notifyApprovers({
      roles,
      excludeUserId: approval.submittedBy?.id,
      type: "approval_request",
      title: `${approval.requestNumber} needs your approval`,
      body: `${label(approval)}${approval.targetRef?.label ? ` — ${approval.targetRef.label}` : ""}`,
      href: "/dashboard/approvals",
    });

    const to = recipients.map((u) => u.email).filter(Boolean);
    if (to.length === 0) return;

    await sendInternalNotificationEmail({
      to,
      subject: `Approval needed: ${approval.requestNumber} — ${label(approval)}`,
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
    if (!submitterId) return;
    // Don't email people about their own clicks (e.g. admin self-approval).
    if (decidedBy?.id === submitterId) return;

    const verb = action === "approved" ? "approved" : "rejected";

    // The id check that used to guard this was `ObjectId.isValid`, which
    // returns false for every user id now that users are Postgres — so this
    // returned before doing anything, for everyone. The lookup itself is the
    // guard: an id that names nobody comes back null.
    const submitter = await notifySubmitter({
      userId: submitterId,
      type: "approval_decision",
      title: `${approval.requestNumber} was ${verb}`,
      body: `${label(approval)}${decidedBy?.name ? ` — by ${decidedBy.name}` : ""}`,
      href: "/dashboard/approvals",
    });
    if (!submitter?.email) return;

    await sendInternalNotificationEmail({
      to: submitter.email,
      subject: `${approval.requestNumber} ${verb} — ${label(approval)}`,
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
