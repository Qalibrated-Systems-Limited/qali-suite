"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Send,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  submitGoodsReceiptPg,
  acceptGoodsReceiptPg,
  rejectGoodsReceiptPg,
  voidGoodsReceiptPg,
} from "@/app/db/actions/grn-actions";
import { roleAllowed } from "@/lib/permissions";
import {
  GRN_ACCEPT_SALES_ROLES,
  GRN_ACCEPT_FINANCE_ROLES,
} from "@/lib/utils/role-gates";

export default function GRNActions({ grn, currentUser }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirmingReject, setConfirmingReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  /**
   * Which sign-off buttons to OFFER. Not authorization — the action gates on
   * the same two lists server-side, and the rules that depend on which person
   * already signed (the receiver cannot sign; one person cannot sign both
   * halves) are CHECK constraints, because only the row knows that.
   *
   * The lists are imported rather than written out: a second copy of an access
   * rule drifts, and when it does the UI offers a button the server refuses.
   * roleAllowed rather than .includes so SuperAdmin is granted in one place.
   */
  const isSales = roleAllowed(currentUser?.role, [...GRN_ACCEPT_SALES_ROLES]);
  const isFinance = roleAllowed(currentUser?.role, [...GRN_ACCEPT_FINANCE_ROLES]);

  const flash = (fn, msg) => {
    setError("");
    setSuccess("");
    startTransition(async () => {
      const res = await fn();
      if (res?.success) {
        if (msg) setSuccess(msg);
        router.refresh();
      } else {
        setError(res?.error || "Action failed");
      }
    });
  };

  if (grn.status === "draft") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => flash(() => submitGoodsReceiptPg(grn._id), "GRN submitted for acceptance")}
          disabled={isPending}
          className="gap-1.5"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Submit for acceptance
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            flash(() => voidGoodsReceiptPg(grn._id, "Created in error"), "GRN voided")
          }
          disabled={isPending}
          className="gap-1.5"
        >
          <Trash2 className="h-4 w-4" />
          Void
        </Button>
        {(error || success) && (
          <FeedbackLine error={error} success={success} />
        )}
      </div>
    );
  }

  if (
    grn.status === "pending_acceptance" ||
    grn.status === "partially_accepted"
  ) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {!grn.salesAccepted && isSales && (
            <Button
              onClick={() =>
                flash(
                  () => acceptGoodsReceiptPg(grn._id, "sales"),
                  "Sales acceptance recorded",
                )
              }
              disabled={isPending}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
            >
              <CheckCircle2 className="h-4 w-4" />
              Accept (Sales)
            </Button>
          )}
          {!grn.financeAccepted && isFinance && (
            <Button
              onClick={() =>
                flash(
                  () => acceptGoodsReceiptPg(grn._id, "finance"),
                  "Finance acceptance recorded",
                )
              }
              disabled={isPending}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
            >
              <CheckCircle2 className="h-4 w-4" />
              Accept (Finance)
            </Button>
          )}
          {!confirmingReject && (
            <Button
              variant="outline"
              onClick={() => setConfirmingReject(true)}
              disabled={isPending}
              className="gap-1.5 text-red-600 hover:text-red-700"
            >
              <XCircle className="h-4 w-4" />
              Reject all
            </Button>
          )}
        </div>

        {confirmingReject && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/10 p-3 space-y-2">
            <p className="text-sm font-medium text-red-700 dark:text-red-300">
              Rejecting will return all received goods out of HOLD (and out of
              inventory). This is irreversible.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection (required)"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={2}
            />
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() =>
                  flash(
                    () => rejectGoodsReceiptPg(grn._id, rejectReason),
                    "GRN rejected",
                  )
                }
                disabled={isPending || !rejectReason.trim()}
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Confirm reject"
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setConfirmingReject(false);
                  setRejectReason("");
                }}
                disabled={isPending}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {(error || success) && (
          <FeedbackLine error={error} success={success} />
        )}
      </div>
    );
  }

  // accepted / rejected / voided — terminal states, no actions.
  return null;
}

function FeedbackLine({ error, success }) {
  if (error) {
    return (
      <div className="inline-flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
        <AlertCircle className="h-3.5 w-3.5" />
        {error}
      </div>
    );
  }
  if (success) {
    return (
      <div className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {success}
      </div>
    );
  }
  return null;
}
