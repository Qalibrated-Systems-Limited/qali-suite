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
// never posted). price_change is a no-op here too, but for a different
// reason: it never applied anything to undo — the price is only written when
// the approval is GRANTED (0069), so a rejected one leaves nothing behind. Best-effort: cleanup failure must never block the
// decision the approver/submitter just made.
async function voidApprovalTarget(approval, user, action) {
  const ref = approval.targetRef;
  if (!ref?.kind || !ref?.id) return;
  const reason = `Approval ${approval.requestNumber} ${action}`;
  try {
    if (ref.kind === "Payment") {
      // NOTHING TO VOID. The Postgres path writes no payment until the
      // approval is granted, so a rejected bill payment leaves no row behind —
      // where the Mongo path left a draft that had to be cancelled. This also
      // stops `Payment.findOne` being handed a UUID it cannot cast, which the
      // catch below would have swallowed as a logged CastError.
      return;
    } else if (ref.kind === "CreditNote") {
      // POSTGRES since §9L. This voided the MONGO CreditNote, so rejecting an
      // approval left the real draft — the Postgres one the screens show —
      // sitting there as though nothing had happened.
      const { voidDraftCreditNotePg } = await import(
        "@/app/db/actions/credit-note-actions"
      );
      await voidDraftCreditNotePg(String(ref.id), reason);
    } else if (ref.kind === "InventoryAdjustment") {
      // POSTGRES since 0066. This looked the adjustment up in Mongo by an id
      // that is a uuid now, so `findOne` threw a CastError, the catch below
      // logged it, and the rejected adjustment stayed a live draft — exactly
      // what the CreditNote branch above was written to stop.
      const { voidDraftStockAdjustmentPg } = await import(
        "@/app/db/actions/adjustment-actions"
      );
      await voidDraftStockAdjustmentPg(String(ref.id), reason);
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
    case "expense_payment":
      return applyExpensePayment(approval, user);
    case "credit_note":
      return applyCreditNote(approval, user);
    default:
      return {
        success: false,
        error: `No applier registered for "${approval.type}"`,
      };
  }
}

// ============================================
// STOCK ADJUSTMENT — applies the adjustment the approval was holding
// ============================================
// ON POSTGRES SINCE 0066. This used to load the Mongo InventoryAdjustment and
// call `adjustment.approve()`, which created the journal entry, the stock
// movements and the product mutation in MONGO — so an adjustment raised for
// sign-off because it was high-risk or high-value was approved by a manager
// and then booked into a ledger no screen reads, against product counters the
// inventory screens do not show.
//
// It was the last module of substance still posting there.
//
// The tenant scope, the draft guard and the atomicity all live below the
// action now: RLS makes the first structural, `WHERE status = 'draft'` on the
// claiming UPDATE makes the second unraceable, and the transaction is the
// action's. What this function keeps is the engine's half — the reference, and
// the applied record it returns.
async function applyStockAdjustment(approval, user) {
  const adjustmentId = approval.targetRef?.id || approval.payload?.adjustmentId;
  if (!adjustmentId) {
    return { success: false, error: "Missing adjustment reference" };
  }

  const { applyApprovedStockAdjustmentPg } = await import(
    "@/app/db/actions/adjustment-actions"
  );
  const result = await applyApprovedStockAdjustmentPg(adjustmentId);

  if (!result?.success) {
    return {
      success: false,
      error: result?.message || "Could not apply the adjustment.",
    };
  }

  return {
    success: true,
    appliedAt: new Date(),
    appliedRef: { kind: "InventoryAdjustment", id: adjustmentId },
  };
}

// ============================================
// BILL PAYMENT — records the payment the approval was holding
// ============================================
// ON POSTGRES SINCE THE PAYMENTS PORT. This used to load a DRAFT Mongo payment
// and call `payment.confirm()`, which posted the journal entry into the Mongo
// ledger — an approved supplier payment, signed off and recorded, posted where
// no ledger screen reads.
//
// There is no draft payment to load any more. The Postgres path checks the
// threshold BEFORE it writes anything, so an over-threshold payment is held as
// a PAYLOAD on the approval rather than as a half-finished row: nothing exists
// until this runs. The payment id was minted when the approval was raised and
// travels in that payload, so `targetRef.id` points at the payment this
// creates, and the approval's link to it resolves.
//
// `releaseApprovedPaymentPg` deliberately does not re-check the threshold —
// the threshold is what raised this approval.
async function applyBillPayment(approval, user) {
  const payload = approval.payload || {};
  const paymentId = payload.paymentId || approval.targetRef?.id;
  if (!paymentId) {
    return { success: false, error: "Missing payment reference" };
  }

  const { releaseApprovedPaymentPg } = await import(
    "@/app/db/actions/payment-actions"
  );
  const result = await releaseApprovedPaymentPg({ ...payload, paymentId });

  if (!result?.success) {
    return { success: false, error: result?.error || "Could not record the payment." };
  }

  return {
    success: true,
    appliedAt: new Date(),
    appliedRef: { kind: "Payment", id: paymentId },
  };
}

// ============================================
// EXPENSE PAYMENT — releases the held expense payment
// ============================================
// The custodian's payment was deferred (over threshold); on approval we run
// the same recordPayment the direct path would, using the captured payload.
async function applyExpensePayment(approval, user) {
  const expenseId = approval.targetRef?.id || approval.payload?.expenseId;
  if (!expenseId) return { success: false, error: "Missing expense reference" };

  const p = approval.payload || {};

  /**
   * POSTGRES since 0059. This used to load the Mongo Expense and call
   * `expense.recordPayment()`, which wrote the clearing entry (DR Accrued
   * Expenses / CR Cash) into the MONGO ledger — so an over-threshold payment
   * was raised for approval, approved, released, and then posted into a
   * ledger no screen reads.
   *
   * The tenant scope, the payment-account check and the "already paid" guard
   * all live inside the action and the repository now; RLS makes the first of
   * them structural rather than a filter this function has to remember. What
   * is NOT re-checked is the threshold: it is what raised this approval, and
   * checking it again would refuse the payment for needing the approval it
   * has just been given.
   */
  const { applyApprovedExpensePaymentPg } = await import(
    "@/app/db/actions/expense-actions"
  );
  const result = await applyApprovedExpensePaymentPg(String(expenseId), {
    paymentMethod: p.paymentMethod,
    paidFrom: p.paidFrom,
    paidAt: p.paidAt || null,
  });

  if (!result?.success) {
    return { success: false, error: result?.error || "Failed to record payment" };
  }

  /**
   * NOTHING TO INCREMENT ANY MORE, and incrementing it was throwing.
   *
   * This used to move the cost from committed to actual on the Mongo Project,
   * with a comment saying projects were still Mongo. They are not — and
   * `result.projectId` has been a Postgres UUID since that port, which
   * `Project.findByIdAndUpdate` casts to an ObjectId and refuses:
   *
   *     CastError: Cast to ObjectId failed for value "0f9c1a2e-…"
   *
   * The throw escaped this function, escaped `applyApprovalPayload`, and was
   * caught by the outer handler in `approveApproval` — which rolls the lease
   * back to "submitted" only on `!applyResult.success`, never on an exception.
   * So an over-threshold expense payment against a PROJECT was: recorded in
   * Postgres, reported to the approver as failed, and left stuck in the
   * "applying" lease for the reaper to find. The money moved; the queue said
   * it had not.
   *
   * Deleted rather than ported, because there is no Postgres column to
   * increment. `computeActualsFor` derives a project's costs and commitments
   * from the expenses themselves on every read — the derived-not-stored rule
   * this module is built on. Recording the payment IS the update.
   */

  return {
    success: true,
    appliedAt: new Date(),
    appliedRef: { kind: "Expense", id: expenseId },
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

  /**
   * POSTGRES since §9L. This loaded the Mongo CreditNote and called its
   * `issue()`, which posts DR Revenue / DR VAT Output / CR Accounts Receivable
   * into the MONGO ledger — so a credit note raised for approval, approved and
   * released posted where no ledger screen looks.
   *
   * The draft-status guard, the tenant scope and the system-account lookups
   * all live inside the action and the repository now; RLS makes the tenant
   * scope structural rather than a filter this function has to remember.
   */
  const { issueCreditNotePg } = await import(
    "@/app/db/actions/credit-note-actions"
  );
  const result = await issueCreditNotePg(String(creditNoteId));

  if (!result?.success) {
    return { success: false, error: result?.error || "Failed to issue credit note" };
  }

  return {
    success: true,
    appliedAt: new Date(),
    appliedRef: { kind: "CreditNote", id: creditNoteId },
  };
}

// ============================================
// PRICE CHANGE — writes the price the approval was holding
// ============================================
// ON POSTGRES SINCE 0069. This loaded the MONGO Product and edited it — an
// approval raised because a price was below cost, granted by a CFO, and then
// written to a store no screen reads. The shelf price never moved.
//
// It also kept its own `pricing.priceHistory` array, which was the only record
// of a price change anywhere and has been unwritten since products moved.
// `product_price_history` is that record now, written by the same repository
// function the direct path uses — so an approved change and an overridden one
// leave the same kind of trace.
//
// MARKUP MODE IS GONE. The Mongo product carried `priceMode` and
// `markupPercentage` and could derive a selling price from cost; the Postgres
// product carries three plain prices and no mode, and nothing on this branch
// submits a markup payload. The payload holds the prices themselves.
async function applyPriceChange(approval, user) {
  void user;
  const productId = approval.targetRef?.id;
  if (!productId) {
    return { success: false, error: "Missing product reference" };
  }

  const { applyApprovedPriceChangePg } = await import(
    "@/app/db/actions/product-actions"
  );

  const p = approval.payload || {};
  const result = await applyApprovedPriceChangePg(
    String(productId),
    {
      sellingPrice: p.sellingPrice ?? null,
      wholesalePrice: p.wholesalePrice ?? null,
      minimumPrice: p.minimumPrice ?? null,
    },
    {
      // The cost the request was judged against. The action refuses if a
      // receipt has re-costed the product since, rather than writing a price
      // nobody approved at that cost.
      submittedCost: Number(approval.context?.cost),
      approvalRef: approval.requestNumber,
    },
  );

  if (!result?.success) {
    return {
      success: false,
      error: result?.error || "Could not apply the price change.",
    };
  }

  return {
    success: true,
    appliedAt: new Date(),
    appliedRef: { kind: "Product", id: productId },
  };
}
