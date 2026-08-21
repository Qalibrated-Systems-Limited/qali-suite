"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, RotateCcw, Loader2, AlertCircle, Send, Ban } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  approveLeaveRequest,
  recallLeaveRequest,
  submitLeaveRequest,
  rejectLeaveRequest,
  cancelLeaveRequest,
} from "@/app/db/actions/hr-leave-actions";
import { useActionState } from "react";
import { HR_ADMIN_ROLES } from "@/lib/utils/role-gates";
import { roleAllowed } from "@/lib/permissions";

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

function CancelDialog({ open, onClose, leaveId, onSuccess }) {
  const [state, formAction, isPending] = useActionState(cancelLeaveRequest, rejectInitial);

  if (!open) return null;
  if (state.success) onSuccess?.();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-xl">
        <h3 className="text-base font-semibold text-foreground">Cancel this leave</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          The days go straight back into the balance. Leave that has already
          been taken cannot be cancelled.
        </p>

        <form action={formAction} className="mt-4 space-y-3">
          <input type="hidden" name="leaveId" value={leaveId} />
          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              <AlertCircle className="h-3 w-3" /> {state.error}
            </div>
          )}
          <textarea
            name="reason"
            rows={3}
            placeholder="e.g. Project deadline moved, employee withdrew the request"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isPending}>
              Keep it
            </Button>
            <Button type="submit" variant="destructive" size="sm" disabled={isPending}>
              {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              Cancel leave
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function LeaveDetailActions({ leave, userRole, canApprove: isApprover }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const canApprove = leave.status === "submitted" && isApprover;
  const canReject = leave.status === "submitted" && isApprover;
  const canRecall = leave.status === "submitted";
  // A draft can be submitted for approval. The action enforces ownership —
  // without this the draft was a dead end.
  const canSubmit = leave.status === "draft";
  // Cancelling approved leave: the source defines the role list and the status
  // and implements neither, so it could only be undone in the database.
  const canCancel =
    ["draft", "submitted", "approved"].includes(leave.status) &&
    roleAllowed(userRole, HR_ADMIN_ROLES);

  function handleSubmit() {
    startTransition(async () => {
      const result = await submitLeaveRequest(leave.id);
      if (result?.success === false) {
        toast.error(result.error);
      } else {
        toast.success("Leave request submitted for approval");
        router.refresh();
      }
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const result = await approveLeaveRequest(leave.id);
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
      const result = await recallLeaveRequest(leave.id);
      if (result?.success === false) {
        toast.error(result.error);
      } else {
        toast.success(result?.message || "Pulled back to draft");
        router.refresh();
      }
    });
  }

  if (!canApprove && !canReject && !canRecall && !canSubmit && !canCancel) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canSubmit && (
          <Button onClick={handleSubmit} disabled={isPending} size="sm">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span className="hidden sm:inline">Submit for approval</span>
          </Button>
        )}
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
          <Button
            variant="outline"
            size="sm"
            onClick={handleRecall}
            disabled={isPending}
            title="Pull it back to draft so it can be edited and sent again"
          >
            <RotateCcw className="h-4 w-4" />
            <span className="hidden sm:inline">Recall to draft</span>
          </Button>
        )}
        {canCancel && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCancelOpen(true)}
            disabled={isPending}
            className="border-destructive/30 text-destructive hover:bg-destructive/5"
          >
            <Ban className="h-4 w-4" />
            <span className="hidden sm:inline">Cancel leave</span>
          </Button>
        )}
      </div>

      <RejectDialog
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        leaveId={leave.id}
        onSuccess={() => { setRejectOpen(false); router.refresh(); }}
      />

      <CancelDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        leaveId={leave.id}
        onSuccess={() => { setCancelOpen(false); router.refresh(); }}
      />
    </>
  );
}
