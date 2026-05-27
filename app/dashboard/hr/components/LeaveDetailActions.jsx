"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, RotateCcw, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { approveLeaveRequest, recallLeaveRequest } from "@/app/mongodb/actions/hr-leave-actions";
import { useActionState } from "react";
import { rejectLeaveRequest } from "@/app/mongodb/actions/hr-leave-actions";

const rejectInitial = { success: false, error: null, fieldErrors: null };

function RejectDialog({ open, onClose, leaveId, onSuccess }) {
  const [state, formAction, isPending] = useActionState(rejectLeaveRequest, rejectInitial);

  if (!open) return null;
  if (state.success) onSuccess?.();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-xl">
        <h3 className="text-base font-semibold text-foreground">Reject Leave Request</h3>
        <p className="mt-1 text-sm text-muted-foreground">Provide a reason for rejection.</p>

        <form action={formAction} className="mt-4 space-y-3">
          <input type="hidden" name="leaveId" value={leaveId} />
          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              <AlertCircle className="h-3 w-3" /> {state.error}
            </div>
          )}
          <div>
            <textarea
              name="reason"
              rows={3}
              required
              placeholder="e.g. Insufficient leave balance, critical project deadline..."
              className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary ${state.fieldErrors?.reason ? "border-destructive" : "border-border"}`}
            />
            {state.fieldErrors?.reason && <p className="mt-1 text-xs text-destructive">{state.fieldErrors.reason}</p>}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" size="sm" disabled={isPending}>
              {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              Reject
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function LeaveDetailActions({ leave, userRole }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);

  const canApprove = leave.status === "submitted" && ["SuperAdmin", "Admin", "Manager", "HR"].includes(userRole);
  const canReject = leave.status === "submitted" && ["SuperAdmin", "Admin", "Manager", "HR"].includes(userRole);
  const canRecall = leave.status === "submitted";

  function handleApprove() {
    startTransition(async () => {
      const result = await approveLeaveRequest(leave._id);
      if (result?.success === false) {
        toast.error(result.error);
      } else {
        toast.success("Leave request approved");
        router.refresh();
      }
    });
  }

  function handleRecall() {
    startTransition(async () => {
      const result = await recallLeaveRequest(leave._id);
      if (result?.success === false) {
        toast.error(result.error);
      } else {
        toast.success("Leave request recalled");
        router.refresh();
      }
    });
  }

  if (!canApprove && !canReject && !canRecall) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canApprove && (
          <Button onClick={handleApprove} disabled={isPending} size="sm">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            <span className="hidden sm:inline">Approve</span>
          </Button>
        )}
        {canReject && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRejectOpen(true)}
            disabled={isPending}
            className="border-destructive/30 text-destructive hover:bg-destructive/5"
          >
            <XCircle className="h-4 w-4" />
            <span className="hidden sm:inline">Reject</span>
          </Button>
        )}
        {canRecall && (
          <Button variant="outline" size="sm" onClick={handleRecall} disabled={isPending}>
            <RotateCcw className="h-4 w-4" />
            <span className="hidden sm:inline">Recall</span>
          </Button>
        )}
      </div>

      <RejectDialog
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        leaveId={leave._id}
        onSuccess={() => { setRejectOpen(false); router.refresh(); }}
      />
    </>
  );
}
