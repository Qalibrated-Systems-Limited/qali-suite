"use client";

import { useActionState, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  approveApproval,
  rejectApproval,
} from "@/app/mongodb/actions/approval-actions";

// ============================================
// APPROVAL DECISION FORM
// ============================================
// One inline form rendered per pending approval row. Uses two distinct
// useActionState pairs so approve / reject each have their own pending
// state and don't disable each other.

const initialState = { success: false, error: null };

export default function ApprovalDecisionForm({ approvalId }) {
  const router = useRouter();
  const [note, setNote] = useState("");

  const approveAction = approveApproval.bind(null, approvalId);
  const rejectAction = rejectApproval.bind(null, approvalId);

  const [approveState, approveFormAction, approvePending] = useActionState(
    approveAction,
    initialState,
  );
  const [rejectState, rejectFormAction, rejectPending] = useActionState(
    rejectAction,
    initialState,
  );

  const isPending = approvePending || rejectPending;

  useEffect(() => {
    if (approveState.success) {
      toast.success("Approved");
      router.refresh();
    } else if (approveState.error) {
      toast.error(approveState.error);
    }
  }, [approveState, router]);

  useEffect(() => {
    if (rejectState.success) {
      toast.success("Rejected");
      router.refresh();
    } else if (rejectState.error) {
      toast.error(rejectState.error);
    }
  }, [rejectState, router]);

  return (
    <div className="space-y-2 rounded-md border border-border bg-card p-3">
      <label
        htmlFor={`note-${approvalId}`}
        className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
      >
        Decision note (optional)
      </label>
      <textarea
        id={`note-${approvalId}`}
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add context for the audit log..."
        disabled={isPending}
        className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <form action={rejectFormAction} className="flex-1 sm:flex-none">
          <input type="hidden" name="note" value={note} />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={isPending}
            className="w-full border-destructive/40 text-destructive hover:bg-destructive/5 sm:w-auto"
          >
            {rejectPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <XCircle className="mr-2 h-4 w-4" />
            )}
            Reject
          </Button>
        </form>
        <form action={approveFormAction} className="flex-1 sm:flex-none">
          <input type="hidden" name="note" value={note} />
          <Button
            type="submit"
            size="sm"
            disabled={isPending}
            className="w-full sm:w-auto"
          >
            {approvePending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            Approve
          </Button>
        </form>
      </div>
    </div>
  );
}
