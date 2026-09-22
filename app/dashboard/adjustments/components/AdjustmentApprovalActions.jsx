"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  applyApprovedStockAdjustmentPg,
  voidDraftStockAdjustmentPg,
} from "@/app/db/actions/adjustment-actions";

/**
 * Approve or cancel a DRAFT adjustment.
 *
 * NOTHING IN THE APP CALLED EITHER ACTION. `applyApprovedStockAdjustmentPg`
 * and `voidDraftStockAdjustmentPg` were written, tested at the repository and
 * had no caller in any screen, so a draft adjustment could be raised and then
 * never approved: the stock stayed wrong and the register filled with drafts.
 *
 * APPROVING IS THE POSTING. It is not a status flip — it moves the stock and
 * writes the journal, which is why the button says what it will do and why the
 * page reloads after it: the quantities on the screen are stale the moment it
 * succeeds.
 *
 * CANCELLING TAKES A REASON, because the database stores one and an
 * adjustment that was refused with no grounds tells the next counter nothing.
 * The box opens before the call rather than after a constraint violation.
 */
export default function AdjustmentApprovalActions({ adjustmentId, canApprove }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  if (!canApprove) return null;

  const run = (fn, done) =>
    startTransition(async () => {
      const res = await fn();
      if (res?.success) {
        toast.success(res.message ?? "Done");
        done?.();
        router.refresh();
      } else {
        toast.error(res?.error ?? "That did not work");
      }
    });

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <div className="flex gap-2">
        <Button
          size="sm"
          className="h-10 flex-1 bg-emerald-600 hover:bg-emerald-700 sm:h-9 sm:flex-none"
          disabled={isPending}
          onClick={() => run(() => applyApprovedStockAdjustmentPg(adjustmentId))}
        >
          {isPending ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Check className="mr-1.5 h-4 w-4" />
          )}
          Approve and post
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-10 flex-1 border-red-500/40 text-red-600 sm:h-9 sm:flex-none"
          disabled={isPending}
          onClick={() => {
            setReason("");
            setCancelling((v) => !v);
          }}
        >
          <X className="mr-1.5 h-4 w-4" />
          Cancel
        </Button>
      </div>

      {cancelling && (
        <div className="w-full space-y-2 sm:w-80">
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this adjustment being cancelled?"
            className="text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCancelling(false)}
            >
              Keep it
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={isPending || reason.trim().length < 3}
              onClick={() =>
                run(
                  () => voidDraftStockAdjustmentPg(adjustmentId, reason.trim()),
                  () => setCancelling(false),
                )
              }
            >
              Cancel adjustment
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
