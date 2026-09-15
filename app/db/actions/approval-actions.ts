"use server";

import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import * as approvals from "../repositories/approvals";
import {
  APPROVER_MATRIX,
  canApproveType,
  approvableTypesFor,
} from "@/lib/business-rules";
import {
  notifyApprovalSubmitted,
  notifyApprovalDecided,
} from "@/lib/notifications/approval-notify";

/**
 * The approval engine on Postgres — 0101.
 *
 * The last cross-cutting Mongo module, and the only one that genuinely worked
 * rather than being stranded: a Postgres action raised a MONGO request, the
 * page read Mongo, and approving it applied back into Postgres.
 *
 * WHAT THAT COST is that Postgres money paths could not run without Mongo.
 * `requestApprovalIfOverThreshold` is awaited inside `expense-actions.ts` and
 * `payment-actions.ts`, so with no Mongo connection an expense over the
 * threshold did not skip its approval — it THREW, and
 * `expense_payment_value` defaults to 50,000 for every company.
 *
 * THE APPLIERS DID NOT MOVE. Every one already reaches into Postgres and has
 * since its own module ported; they live in `applyApprovalPayload` below,
 * pointing at exactly the functions the Mongo engine pointed at.
 */

export type ActionResult =
  | { success: true; message?: string }
  | { success: false; error: string };

/**
 * `submitApproval`'s result is NOT a discriminated union, deliberately.
 *
 * Four Postgres modules already call it and read the result the way the Mongo
 * one returned it — `if (!result?.success) return result.error` and then
 * `result.approval.requestNumber` in the success message. A union makes both
 * of those a compile error at four call sites for no gain: this is a boundary
 * shaped to its existing callers, and the alternative is editing them to prove
 * something they already handle correctly.
 */
export interface SubmittedApproval {
  _id: string;
  id: string;
  requestNumber: string;
  type: string;
  status: string;
  targetRef: { kind: string; id: string; label: string };
}

export interface SubmitApprovalResult {
  success: boolean;
  error?: string;
  approval?: SubmittedApproval;
}

function actor(user: { id?: string | null; name?: string | null; role?: string | null }) {
  return {
    id: user?.id ?? "system",
    name: user?.name ?? "System",
    role: user?.role ?? null,
  };
}

function revalidateApprovals(approvalId?: string | null) {
  revalidatePath("/dashboard/approvals");
  revalidatePath("/dashboard");
  if (approvalId) revalidatePath(`/dashboard/approvals/${approvalId}`);
}

/** The screens a decision changes, by what the request was holding. */
function revalidateTarget(kind?: string | null, id?: string | null) {
  if (kind === "Product") {
    revalidatePath("/dashboard/stocks");
    if (id) revalidatePath(`/dashboard/stocks/${id}`);
  } else if (kind === "InventoryAdjustment" || kind === "StockAdjustment") {
    revalidatePath("/dashboard/adjustments");
  } else if (kind === "Payment") {
    revalidatePath("/dashboard/payments");
    if (id) revalidatePath(`/dashboard/payments/${id}`);
    revalidatePath("/dashboard/bills");
  } else if (kind === "CreditNote") {
    revalidatePath("/dashboard/credit-notes");
    if (id) revalidatePath(`/dashboard/credit-notes/${id}`);
    revalidatePath("/dashboard/invoices");
  } else if (kind === "Expense") {
    revalidatePath("/dashboard/expenses");
    if (id) revalidatePath(`/dashboard/expenses/${id}`);
  }
}

// ── Submit ──────────────────────────────────────────────────────────────────

/**
 * Raise a request. Called BY other actions when their change needs escalation,
 * never from a form — the source action gathers the context.
 *
 * The signature is the Mongo one, unchanged, because four Postgres modules
 * already call it: `expense-actions`, `payment-actions`, `product-actions` and
 * `adjustment-actions`. They change one import path and nothing else.
 */
export async function submitApproval(input: {
  type: string;
  targetRef: { kind: string; id: string; label?: string };
  payload?: Record<string, unknown>;
  reason?: string;
  requesterNote?: string;
  context?: Record<string, unknown>;
}): Promise<SubmitApprovalResult> {
  try {
    const roles = (APPROVER_MATRIX as Record<string, string[]>)[input.type];
    if (!roles?.length) {
      return { success: false, error: `No approver matrix for type "${input.type}"` };
    }

    const approval = await withAuthorizedTenant([], (tx, { user, companyId }) =>
      approvals.submitApproval(tx, {
        companyId,
        type: input.type,
        targetKind: input.targetRef.kind,
        targetId: String(input.targetRef.id),
        targetLabel: input.targetRef.label ?? null,
        payload: input.payload ?? {},
        context: input.context ?? {},
        reason: input.reason ?? "",
        requesterNote: input.requesterNote ?? "",
        requiredApproverRoles: roles,
        submittedById: actor(user).id,
        submittedByName: actor(user).name,
        submittedByRole: actor(user).role,
      }),
    );

    // Best-effort: an approval must not fail because a bell or a mail did.
    await notifyApprovalSubmitted(approval);

    revalidateApprovals();
    return { success: true, approval: approval as SubmittedApproval };
  } catch (error) {
    return { success: false, error: userMessage(error, "Failed to submit approval") };
  }
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** What is waiting that this caller may decide. */
export async function getApprovalQueuePg(status = "submitted") {
  try {
    return await withAuthorizedTenant([], (tx, { user }) =>
      approvals.listQueue(
        tx,
        approvableTypesFor(user.role),
        status as approvals.ApprovalStatus,
      ),
    );
  } catch {
    return [];
  }
}

/**
 * The count behind the dashboard tile.
 *
 * Returns 0 on failure rather than throwing — but note that this is now the
 * ONLY reason it would: the Mongo version needed an inner try/catch of its own
 * so that an unreachable Atlas cluster could not take the six Postgres counts
 * down with it. "Nothing to approve" is the worst possible answer from an
 * approvals tile, and that isolation is no longer needed because there is no
 * second store to be unreachable.
 */
export async function countMyPendingApprovalsPg() {
  try {
    return await withAuthorizedTenant([], (tx, { user }) =>
      approvals.countQueue(tx, approvableTypesFor(user.role)),
    );
  } catch {
    return 0;
  }
}

export async function getMySubmittedApprovalsPg(limit = 20) {
  try {
    return await withAuthorizedTenant([], (tx, { user }) =>
      approvals.listSubmittedBy(tx, actor(user).id, limit),
    );
  } catch {
    return [];
  }
}

export async function getApprovalPg(approvalId: string) {
  if (!approvalId) return null;
  return withAuthorizedTenant([], (tx) => approvals.getApproval(tx, approvalId));
}

// ── Applying ────────────────────────────────────────────────────────────────

type Applied = { success: boolean; error?: string; appliedKind?: string; appliedId?: string };

/**
 * The failure text out of whichever ActionResult shape the module uses.
 *
 * They differ — some carry `error`, some `message`, and `product-actions`
 * types `error` as `string | Record<string, string[]>` because it also returns
 * field errors. Reading `.error` off the union does not compile, and casting
 * past it would put "[object Object]" in front of an approver.
 */
function errorText(result: unknown, fallback: string): string {
  const r = (result ?? {}) as { error?: unknown; message?: unknown };
  if (typeof r.error === "string" && r.error) return r.error;
  if (typeof r.message === "string" && r.message) return r.message;
  if (r.error && typeof r.error === "object") {
    const first = Object.values(r.error as Record<string, string[]>)
      .flat()
      .find((v) => typeof v === "string");
    if (first) return first;
  }
  return fallback;
}

/**
 * type → the module that owns the change.
 *
 * Every one of these already lived in Postgres before this port: each was
 * moved as its own module went over, and the notes above them in
 * `app/mongodb/actions/approval-actions.js` record what each was posting into
 * the Mongo ledger before that. This function is the only part of the wire
 * that changes — it no longer has a Mongo document in the middle of it.
 */
async function applyApprovalPayload(approval: {
  type: string;
  targetRef: { kind: string; id: string };
  payload: Record<string, unknown>;
}): Promise<Applied> {
  const targetId = String(approval.targetRef.id);
  const payload = approval.payload ?? {};

  switch (approval.type) {
    case "price_change": {
      const { applyApprovedPriceChangePg } = await import("./product-actions");
      const result = await applyApprovedPriceChangePg(
        targetId,
        payload as never,
        {
          submittedCost: (payload.submittedCost as number) ?? null,
          approvalRef: (payload.approvalRef as string) ?? null,
        },
      );
      return result?.success
        ? { success: true, appliedKind: "Product", appliedId: targetId }
        : { success: false, error: errorText(result, "Could not apply the price change.") };
    }

    case "stock_adjustment":
    case "stock_writeoff": {
      const adjustmentId = targetId || String(payload.adjustmentId ?? "");
      if (!adjustmentId) return { success: false, error: "Missing adjustment reference" };
      const { applyApprovedStockAdjustmentPg } = await import("./adjustment-actions");
      const result = await applyApprovedStockAdjustmentPg(adjustmentId);
      return result?.success
        ? { success: true, appliedKind: "InventoryAdjustment", appliedId: adjustmentId }
        : { success: false, error: result?.message ?? "Could not apply the adjustment." };
    }

    case "bill_payment": {
      /*
       * There is no draft payment to load. The Postgres path checks the
       * threshold BEFORE it writes anything, so an over-threshold payment is
       * held as a PAYLOAD and nothing exists until this runs. The id was
       * minted when the approval was raised and travels in that payload, so
       * the approval's link to the payment it creates resolves.
       */
      const paymentId = String(payload.paymentId ?? targetId);
      if (!paymentId) return { success: false, error: "Missing payment reference" };
      const { releaseApprovedPaymentPg } = await import("./payment-actions");
      const result = await releaseApprovedPaymentPg({ ...payload, paymentId } as never);
      return result?.success
        ? { success: true, appliedKind: "Payment", appliedId: paymentId }
        : { success: false, error: errorText(result, "Could not record the payment.") };
    }

    case "expense_payment": {
      const expenseId = targetId || String(payload.expenseId ?? "");
      if (!expenseId) return { success: false, error: "Missing expense reference" };
      const { applyApprovedExpensePaymentPg } = await import("./expense-actions");
      const result = await applyApprovedExpensePaymentPg(expenseId, {
        paymentMethod: String(payload.paymentMethod ?? ""),
        paidFrom: String(payload.paidFrom ?? ""),
        paidAt: (payload.paidAt as string) ?? null,
      });
      return result?.success
        ? { success: true, appliedKind: "Expense", appliedId: expenseId }
        : { success: false, error: errorText(result, "Could not record the payment.") };
    }

    case "credit_note": {
      const { issueCreditNotePg } = await import("./credit-note-actions");
      const result = await issueCreditNotePg(targetId);
      return result?.success
        ? { success: true, appliedKind: "CreditNote", appliedId: targetId }
        : { success: false, error: errorText(result, "Could not issue the credit note.") };
    }

    default:
      return { success: false, error: `No applier registered for "${approval.type}"` };
  }
}

/**
 * Undo the draft a rejected or cancelled request was gating.
 *
 * Best-effort by design: a cleanup failure must never block the decision the
 * approver just made. `price_change` and `Payment` are deliberate no-ops —
 * neither writes anything until the approval is GRANTED, so a refused one
 * leaves nothing behind.
 */
async function voidApprovalTarget(
  targetRef: { kind: string; id: string },
  requestNumber: string,
  action: string,
) {
  const reason = `Approval ${requestNumber} ${action}`;
  try {
    if (targetRef.kind === "CreditNote") {
      const { voidDraftCreditNotePg } = await import("./credit-note-actions");
      await voidDraftCreditNotePg(String(targetRef.id), reason);
    } else if (
      targetRef.kind === "InventoryAdjustment" ||
      targetRef.kind === "StockAdjustment"
    ) {
      const { voidDraftStockAdjustmentPg } = await import("./adjustment-actions");
      await voidDraftStockAdjustmentPg(String(targetRef.id), reason);
    }
  } catch (e) {
    console.error("[voidApprovalTarget]", e);
  }
}

// ── Decisions ───────────────────────────────────────────────────────────────

/**
 * Approve: claim, apply, finalise.
 *
 * THE CLAIM IS ITS OWN TRANSACTION, and that is the whole of the concurrency
 * design. `UPDATE … WHERE status = 'submitted'` returns zero rows for the
 * second of two simultaneous approvers — but only once the first COMMITS.
 * Holding the claim open across the apply would make the second approver wait
 * for a ledger posting to finish rather than be told immediately, and would
 * hold a row lock for the duration.
 *
 * If the apply fails the lease is handed back so a retry can proceed; if the
 * process dies in between, `/api/cron/reap-approvals` sweeps it.
 */
export async function approveApproval(
  approvalId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const note = String(formData?.get?.("note") ?? "").slice(0, 1000);

  let claimed: Awaited<ReturnType<typeof approvals.claim>> = null;
  try {
    claimed = await withAuthorizedTenant([], async (tx, { user }) => {
      const peek = await approvals.getApproval(tx, approvalId);
      if (!peek) throw new Error("Approval not found.");
      if (peek.status !== "submitted") {
        throw new Error(
          peek.status === "applying"
            ? "Another approver is processing this request — please refresh."
            : `Already ${peek.status}; it cannot be re-decided.`,
        );
      }
      if (!canApproveType(user.role, peek.type)) {
        throw new Error("You don't have authority to approve this type of request.");
      }
      return approvals.claim(tx, approvalId);
    });
  } catch (error) {
    return { success: false, error: userMessage(error, "Failed to approve") };
  }

  if (!claimed) {
    return { success: false, error: "Another approver claimed this request first." };
  }

  let applied: Applied;
  try {
    applied = await applyApprovalPayload(claimed);
  } catch (error) {
    await withAuthorizedTenant([], (tx) => approvals.releaseClaim(tx, approvalId));
    return { success: false, error: userMessage(error, "Failed to apply the approval") };
  }

  if (!applied.success) {
    await withAuthorizedTenant([], (tx) => approvals.releaseClaim(tx, approvalId));
    return { success: false, error: applied.error ?? "Could not apply the change." };
  }

  try {
    const finalised = await withAuthorizedTenant([], (tx, { user }) =>
      approvals.finaliseApproved(
        tx,
        approvalId,
        actor(user),
        { kind: applied.appliedKind, id: applied.appliedId },
        note,
      ),
    );
    await notifyApprovalDecided(finalised, "approved", finalised.decision?.by);
  } catch (error) {
    /*
     * THE CHANGE IS ALREADY APPLIED. Failing here would tell the approver the
     * approval failed while the price is changed and the payment is posted,
     * which is the worse of the two wrong answers. The reaper will return the
     * lease to the queue, and re-approving is refused by the applier's own
     * idempotence guard.
     */
    console.error("[approveApproval] applied but could not finalise:", error);
    return {
      success: false,
      error:
        "The change was applied, but the approval record could not be finalised. Refresh before re-approving.",
    };
  }

  revalidateApprovals(approvalId);
  revalidateTarget(claimed.targetRef.kind, claimed.targetRef.id);
  return { success: true };
}

export async function rejectApproval(
  approvalId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const note = String(formData?.get?.("note") ?? "").slice(0, 1000);
  try {
    const decided = await withAuthorizedTenant([], async (tx, { user }) => {
      const peek = await approvals.getApproval(tx, approvalId);
      if (!peek) throw new Error("Approval not found.");
      if (!canApproveType(user.role, peek.type)) {
        throw new Error("You don't have authority to decide this type of request.");
      }
      return approvals.decide(tx, approvalId, "rejected", actor(user), note);
    });

    await voidApprovalTarget(decided.targetRef, decided.requestNumber, "rejected");
    await notifyApprovalDecided(decided, "rejected", decided.decision?.by);

    revalidateApprovals(approvalId);
    revalidateTarget(decided.targetRef.kind, decided.targetRef.id);
    return { success: true };
  } catch (error) {
    return { success: false, error: userMessage(error, "Failed to reject") };
  }
}

/** The submitter withdrawing their own request before anyone decides it. */
export async function cancelApproval(approvalId: string): Promise<ActionResult> {
  try {
    const decided = await withAuthorizedTenant([], async (tx, { user }) => {
      const peek = await approvals.getApproval(tx, approvalId);
      if (!peek) throw new Error("Approval not found.");

      const me = actor(user);
      const isSubmitter = String(peek.submittedBy.id) === String(me.id);
      if (!isSubmitter && !canApproveType(user.role, peek.type)) {
        throw new Error("Only the person who raised this request can cancel it.");
      }
      return approvals.decide(tx, approvalId, "cancelled", me, "");
    });

    await voidApprovalTarget(decided.targetRef, decided.requestNumber, "cancelled");

    revalidateApprovals(approvalId);
    revalidateTarget(decided.targetRef.kind, decided.targetRef.id);
    return { success: true };
  } catch (error) {
    return { success: false, error: userMessage(error, "Failed to cancel") };
  }
}

/**
 * Reset leases stranded by a crash between the claim and the finalise.
 *
 * Called by `/api/cron/reap-approvals`. Cross-tenant, so it runs on the
 * privileged connection rather than a tenant scope — a sweep has no session
 * and no company.
 */
export async function reapStaleApprovalLeases(staleMinutes = 10) {
  const { privilegedDb } = await import("../provisioning");
  const { sql } = await import("drizzle-orm");
  const rows = (await privilegedDb().execute(sql`
    UPDATE approval_requests
       SET status = 'submitted', updated_at = now()
     WHERE status = 'applying'
       AND updated_at < now() - ${`${staleMinutes} minutes`}::interval
    RETURNING id
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.length;
}
