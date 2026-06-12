"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import mongoose from "mongoose";

import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  withTenantScope,
} from "@/lib/utils/tenant-utils";
import { safeErrorMessage } from "@/lib/safe-error";

import ApprovalRequest, {
  APPROVER_MATRIX,
} from "@/app/models/approvalRequest";
import {
  notifyApprovalSubmitted,
  notifyApprovalDecided,
} from "@/lib/notifications/approval-notify";
import ErpCounter from "@/app/models/erp-counter";
import Product from "@/app/models/product";
import InventoryAdjustment from "@/app/models/inventoryAdjustment";
import Payment from "@/app/models/payment";
import CreditNote from "@/app/models/creditNote";

// ============================================
// APPROVAL ENGINE — SERVER ACTIONS
// ============================================
// Public surface:
//   submitApproval(data)        — used by other actions to escalate a change
//   approveApproval(id, note)   — apply the payload and mark approved
//   rejectApproval(id, note)    — discard
//   cancelApproval(id)          — submitter aborts before decision
//
// On approval, the engine routes by `type` to a handler that applies
// the change atomically. Rejection / cancellation never modifies the
// target — the approval request is the only thing updated.

function userInfo(user) {
  return {
    id: user.id || user._id?.toString?.() || "system",
    name: user.name || user.email || "System",
    role: user.role,
  };
}

// When an approval that gated a draft document is rejected or cancelled,
// the underlying draft (Payment / CreditNote / InventoryAdjustment) was
// already created and would otherwise linger in "draft" forever — cluttering
// lists and re-submittable. Void it via the model's own method so audit
// fields are populated and any reversal is handled (here none — drafts were
// never posted). price_change targets a Product that was never edited, so
// it's a no-op there. Best-effort: cleanup failure must never block the
// decision the approver/submitter just made.
async function voidApprovalTarget(approval, user, action) {
  const ref = approval.targetRef;
  if (!ref?.kind || !ref?.id) return;
  const reason = `Approval ${approval.requestNumber} ${action}`;
  const by = userInfo(user);
  try {
    if (ref.kind === "Payment") {
      const doc = await Payment.findOne({
        _id: ref.id,
        companyId: approval.companyId,
      });
      if (doc?.status === "draft") await doc.cancel(by, reason);
    } else if (ref.kind === "CreditNote") {
      const doc = await CreditNote.findOne({
        _id: ref.id,
        companyId: approval.companyId,
      });
      if (doc?.status === "draft") await doc.void(by, reason);
    } else if (ref.kind === "InventoryAdjustment") {
      const doc = await InventoryAdjustment.findOne({
        _id: ref.id,
        companyId: approval.companyId,
      });
      if (doc?.status === "draft") await doc.cancel(by, reason);
    }
  } catch (e) {
    console.error("voidApprovalTarget error:", e);
  }
}

async function generateRequestNumber(companyId, session) {
  const seq = await ErpCounter.getNextSequence("approval", companyId, session);
  return `APR-${String(seq).padStart(4, "0")}`;
}

// ============================================
// SUBMIT
// ============================================
// Called from other actions when their change requires escalation. Not
// directly called from a form (the source action gathers all the context).
export async function submitApproval({
  type,
  targetRef,
  payload,
  reason,
  requesterNote = "",
  context = {},
}) {
  try {
    const { companyId, user } = await getTenantContext();
    await dbConnect();

    const approverRoles = APPROVER_MATRIX[type] || [];
    if (approverRoles.length === 0) {
      return { success: false, error: `No approver matrix for type "${type}"` };
    }

    const requestNumber = await generateRequestNumber(companyId);

    const req = await ApprovalRequest.create({
      companyId,
      type,
      status: "submitted",
      requestNumber,
      targetRef,
      payload,
      reason,
      requesterNote,
      context,
      requiredApproverRoles: approverRoles,
      submittedBy: {
        ...userInfo(user),
        submittedAt: new Date(),
      },
    });

    // Email eligible approvers — best-effort, never blocks the submit.
    await notifyApprovalSubmitted(req);

    revalidatePath("/dashboard/approvals");

    return {
      success: true,
      approval: {
        _id: req._id.toString(),
        requestNumber: req.requestNumber,
        status: req.status,
      },
    };
  } catch (error) {
    console.error("submitApproval error:", error);
    return {
      success: false,
      error: safeErrorMessage(error, "Failed to submit approval"),
    };
  }
}

// ============================================
// APPROVE
// ============================================
const ApproveSchema = z.object({
  note: z.string().max(1000).optional().default(""),
});

export async function approveApproval(approvalId, _prevState, formData) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    if (!mongoose.Types.ObjectId.isValid(approvalId)) {
      return { success: false, error: "Invalid approval id" };
    }

    const raw = Object.fromEntries(formData?.entries?.() ?? []);
    const parsed = ApproveSchema.safeParse(raw);
    const note = parsed.success ? parsed.data.note : "";

    await dbConnect();

    // Authority pre-check using a cheap projection (don't apply yet).
    const peek = await ApprovalRequest.findOne(
      withTenantScope({ _id: approvalId }, companyId, isSuperAdmin),
    )
      .select("type status")
      .lean();
    if (!peek) return { success: false, error: "Approval not found" };
    if (peek.status !== "submitted") {
      return {
        success: false,
        error:
          peek.status === "applying"
            ? "Another approver is processing this request — please refresh."
            : `Already ${peek.status}; cannot re-decide.`,
      };
    }
    if (!ApprovalRequest.canApprove(user.role, peek.type)) {
      return {
        success: false,
        error: "You don't have authority to approve this type of request.",
      };
    }

    // Atomic claim: flip "submitted" → "applying". Only the first
    // concurrent approver wins. Returns null if someone else got there
    // first, prevents the double-application race the audit flagged.
    const claimed = await ApprovalRequest.findOneAndUpdate(
      withTenantScope(
        { _id: approvalId, status: "submitted" },
        companyId,
        isSuperAdmin,
      ),
      { $set: { status: "applying" } },
      { new: true },
    );
    if (!claimed) {
      return {
        success: false,
        error: "Another approver claimed this request first.",
      };
    }

    // Apply the payload. If it fails, release the lease so a retry can
    // proceed; we never leave the approval orphaned in "applying".
    let applyResult;
    try {
      applyResult = await applyApprovalPayload(claimed, user);
    } catch (e) {
      await ApprovalRequest.updateOne(
        { _id: approvalId },
        { $set: { status: "submitted" } },
      );
      throw e;
    }
    if (!applyResult.success) {
      await ApprovalRequest.updateOne(
        { _id: approvalId },
        { $set: { status: "submitted" } },
      );
      return { success: false, error: applyResult.error };
    }

    // Finalize: lease → "approved" with the applied snapshot.
    const decidedBy = userInfo(user);
    await ApprovalRequest.updateOne(
      { _id: approvalId },
      {
        $set: {
          status: "approved",
          appliedAt: applyResult.appliedAt || new Date(),
          appliedRef: applyResult.appliedRef,
          decision: {
            action: "approved",
            by: decidedBy,
            at: new Date(),
            note,
          },
        },
      },
    );

    // Tell the submitter — best-effort, never blocks the approval.
    claimed.decision = { action: "approved", by: decidedBy, at: new Date(), note };
    await notifyApprovalDecided(claimed, "approved", decidedBy);

    revalidatePath("/dashboard/approvals");
    revalidatePath(`/dashboard/approvals/${approvalId}`);
    if (claimed.targetRef?.kind === "Product") {
      revalidatePath("/dashboard/stocks");
      revalidatePath(`/dashboard/stocks/${claimed.targetRef.id}`);
    }
    if (claimed.targetRef?.kind === "InventoryAdjustment") {
      revalidatePath("/dashboard/adjustments");
    }
    if (claimed.targetRef?.kind === "Payment") {
      revalidatePath("/dashboard/payments");
      revalidatePath(`/dashboard/payments/${claimed.targetRef.id}`);
      revalidatePath("/dashboard/bills");
    }
    if (claimed.targetRef?.kind === "CreditNote") {
      revalidatePath("/dashboard/credit-notes");
      revalidatePath(`/dashboard/credit-notes/${claimed.targetRef.id}`);
      revalidatePath("/dashboard/invoices");
    }

    return { success: true };
  } catch (error) {
    console.error("approveApproval error:", error);
    return {
      success: false,
      error: safeErrorMessage(error, "Failed to approve"),
    };
  }
}

// ============================================
// REJECT
// ============================================
export async function rejectApproval(approvalId, _prevState, formData) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    if (!mongoose.Types.ObjectId.isValid(approvalId)) {
      return { success: false, error: "Invalid approval id" };
    }

    const raw = Object.fromEntries(formData?.entries?.() ?? []);
    const note = String(raw.note || "").slice(0, 1000);

    await dbConnect();
    const approval = await ApprovalRequest.findOne(
      withTenantScope({ _id: approvalId }, companyId, isSuperAdmin),
    );
    if (!approval) return { success: false, error: "Approval not found" };
    if (approval.status !== "submitted") {
      return {
        success: false,
        error: `Already ${approval.status}; cannot re-decide.`,
      };
    }
    if (!ApprovalRequest.canApprove(user.role, approval.type)) {
      return { success: false, error: "Not authorized to reject this type." };
    }

    approval.status = "rejected";
    approval.decision = {
      action: "rejected",
      by: userInfo(user),
      at: new Date(),
      note,
    };
    await approval.save();

    // Void the orphaned draft (payment / credit note / adjustment) the
    // rejected request was gating, so it doesn't linger or get re-submitted.
    await voidApprovalTarget(approval, user, "rejected");

    // Tell the submitter — best-effort, never blocks the rejection.
    await notifyApprovalDecided(approval, "rejected", userInfo(user));

    revalidatePath("/dashboard/approvals");
    revalidatePath(`/dashboard/approvals/${approvalId}`);
    return { success: true };
  } catch (error) {
    console.error("rejectApproval error:", error);
    return {
      success: false,
      error: safeErrorMessage(error, "Failed to reject"),
    };
  }
}

// ============================================
// CANCEL (submitter aborts)
// ============================================
export async function cancelApproval(approvalId) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    if (!mongoose.Types.ObjectId.isValid(approvalId)) {
      return { success: false, error: "Invalid approval id" };
    }
    await dbConnect();
    const approval = await ApprovalRequest.findOne(
      withTenantScope({ _id: approvalId }, companyId, isSuperAdmin),
    );
    if (!approval) return { success: false, error: "Approval not found" };
    if (approval.status !== "submitted") {
      return {
        success: false,
        error: `Already ${approval.status}; cannot cancel.`,
      };
    }
    if (
      approval.submittedBy.id !== user.id &&
      !["Admin", "SuperAdmin"].includes(user.role)
    ) {
      return {
        success: false,
        error: "Only the submitter (or Admin) can cancel.",
      };
    }
    approval.status = "cancelled";
    approval.decision = {
      action: "cancelled",
      by: userInfo(user),
      at: new Date(),
      note: "",
    };
    await approval.save();

    // Void the orphaned draft the cancelled request was gating.
    await voidApprovalTarget(approval, user, "cancelled");

    revalidatePath("/dashboard/approvals");
    return { success: true };
  } catch (error) {
    console.error("cancelApproval error:", error);
    return {
      success: false,
      error: safeErrorMessage(error, "Failed to cancel"),
    };
  }
}

// ============================================
// PAYLOAD APPLICATION (type → handler)
// ============================================
// Each handler returns { success, error?, appliedAt?, appliedRef? }
async function applyApprovalPayload(approval, user) {
  switch (approval.type) {
    case "price_change":
      return applyPriceChange(approval, user);
    case "stock_adjustment":
    case "stock_writeoff":
      return applyStockAdjustment(approval, user);
    case "bill_payment":
      return applyBillPayment(approval, user);
    case "credit_note":
      return applyCreditNote(approval, user);
    default:
      return {
        success: false,
        error: `No applier registered for "${approval.type}"`,
      };
  }
}

async function applyStockAdjustment(approval, user) {
  const adjustmentId = approval.targetRef?.id;
  if (!adjustmentId) {
    return { success: false, error: "Missing adjustment reference" };
  }

  // Wrap the whole apply in a transaction so the model's approve() (which
  // creates a journal entry, posts stock movements, and flips status) runs
  // atomically. Without this, a partial failure left stock and books out
  // of sync — this is the high-risk approval queue path.
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // Tenant scoping is enforced via companyId on the approval — load the
    // adjustment from the same tenant, in-session for consistency.
    const adjustment = await InventoryAdjustment.findOne({
      _id: adjustmentId,
      companyId: approval.companyId,
    }).session(session);
    if (!adjustment) {
      await session.abortTransaction();
      return { success: false, error: "Adjustment not found" };
    }
    if (adjustment.status !== "draft") {
      await session.abortTransaction();
      return {
        success: false,
        error: `Adjustment already ${adjustment.status}`,
      };
    }

    // The model's approve() method is the single point of truth — pass the
    // session so its writes (JE, movements, product mutation) join our txn.
    await adjustment.approve(
      {
        name: user.name || user.email || "Approver",
        id: user.id,
      },
      session,
    );

    await session.commitTransaction();
    return {
      success: true,
      appliedAt: new Date(),
      appliedRef: { kind: "InventoryAdjustment", id: adjustment._id },
    };
  } catch (e) {
    await session.abortTransaction();
    throw e;
  } finally {
    session.endSession();
  }
}

// ============================================
// BILL PAYMENT — applies a pending payment.confirm()
// ============================================
// The payment was created in draft state; confirmation posts to GL via
// payment.confirm(). On approval we run that confirm with the approver
// as the user — preserves the audit trail (the payment shows it was
// confirmed by the approver, not the requester).
async function applyBillPayment(approval, user) {
  const paymentId = approval.targetRef?.id;
  if (!paymentId) {
    return { success: false, error: "Missing payment reference" };
  }

  const payment = await Payment.findOne({
    _id: paymentId,
    companyId: approval.companyId,
  });
  if (!payment) return { success: false, error: "Payment not found" };

  if (payment.status !== "draft") {
    return {
      success: false,
      error: `Payment is already ${payment.status}; cannot re-confirm.`,
    };
  }

  await payment.confirm(user);

  return {
    success: true,
    appliedAt: new Date(),
    appliedRef: { kind: "Payment", id: payment._id },
  };
}

// ============================================
// CREDIT NOTE — applies the draft credit note's issue()
// ============================================
// Issuance posts to GL (reduces AR, recognises the credit) via the
// model's issue() method. Same pattern as bill_payment — the approver
// is recorded as the issuer.
async function applyCreditNote(approval, user) {
  const creditNoteId = approval.targetRef?.id;
  if (!creditNoteId) {
    return { success: false, error: "Missing credit note reference" };
  }

  const creditNote = await CreditNote.findOne({
    _id: creditNoteId,
    companyId: approval.companyId,
  });
  if (!creditNote) return { success: false, error: "Credit note not found" };

  if (creditNote.status !== "draft") {
    return {
      success: false,
      error: `Credit note is already ${creditNote.status}; cannot re-issue.`,
    };
  }

  await creditNote.issue({
    name: user.name || user.email || "Approver",
    id: user.id,
  });

  return {
    success: true,
    appliedAt: new Date(),
    appliedRef: { kind: "CreditNote", id: creditNote._id },
  };
}

async function applyPriceChange(approval, user) {
  const { companyId } = await getTenantContext();
  const productId = approval.targetRef?.id;
  if (!productId)
    return { success: false, error: "Missing product reference" };

  const product = await Product.findOne({ _id: productId, companyId });
  if (!product) return { success: false, error: "Product not found" };

  const cost = Number(product.costing?.costPrice) || 0;
  const previousPrice = Number(product.pricing?.sellingPrice) || 0;
  const previousMarkup = Number(product.pricing?.markupPercentage) || 0;

  // The request tripped the floor/margin checks against the cost at
  // submission time, and (in markup mode) the new selling price is derived
  // from cost. If cost moved since — a GRN, a landed-cost correction — the
  // approver is greenlighting a number that no longer holds. Refuse rather
  // than silently write a now-wrong price; the requester can resubmit.
  const submittedCost = Number(approval.context?.cost);
  if (
    Number.isFinite(submittedCost) &&
    submittedCost > 0 &&
    Math.abs(cost - submittedCost) > 0.005
  ) {
    return {
      success: false,
      error: `Cost changed since submission (was ${submittedCost}, now ${cost}). Please resubmit the price change.`,
    };
  }

  const p = approval.payload || {};
  const mode = p.priceMode || product.pricing?.priceMode || "manual";

  let nextSelling;
  let nextMarkup;
  if (mode === "markup") {
    nextMarkup = Number(p.markupPercent) || 0;
    nextSelling = cost > 0 ? Math.round(cost * (1 + nextMarkup / 100) * 100) / 100 : 0;
  } else {
    nextSelling = Number(p.sellingPrice) || 0;
    nextMarkup = cost > 0 ? ((nextSelling - cost) / cost) * 100 : 0;
  }

  product.pricing.priceMode = mode;
  if (p.minimumPrice !== undefined && p.minimumPrice !== null) {
    product.pricing.minimumPrice = Number(p.minimumPrice) || 0;
  }
  if (mode === "markup") {
    product.pricing.markupPercentage = nextMarkup;
  } else {
    product.pricing.sellingPrice = nextSelling;
  }
  product.pricing.lastPriceUpdate = new Date();
  product.pricing.priceHistory = product.pricing.priceHistory || [];
  product.pricing.priceHistory.push({
    previousPrice,
    newPrice: nextSelling,
    previousMarkup,
    newMarkup: nextMarkup,
    costAtChange: cost,
    mode,
    reason: `Approved (${approval.requestNumber}): ${approval.reason || p.reason || ""}`.trim(),
    changedBy: {
      name: user.name || user.email || "System",
      id: user.id,
      role: user.role,
    },
    changedAt: new Date(),
  });

  await product.save();

  return {
    success: true,
    appliedAt: new Date(),
    appliedRef: { kind: "Product", id: product._id },
  };
}
