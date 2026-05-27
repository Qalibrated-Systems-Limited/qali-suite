"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Loader2, AlertCircle, Ban } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useActionState } from "react";
import { approveLoan, rejectLoan, cancelLoan } from "@/app/mongodb/actions/loan-actions";
import DisburseForm from "./DisburseForm";

const rejectInitial = { success: false, error: null, fieldErrors: null };

function RejectDialog({ open, onClose, loanId, onSuccess }) {
  const [state, formAction, isPending] = useActionState(rejectLoan, rejectInitial);

  if (!open) return null;
  if (state.success) onSuccess?.();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-xl">
        <h3 className="text-base font-semibold text-foreground">Reject Loan Request</h3>
        <p className="mt-1 text-sm text-muted-foreground">Provide a reason for rejection.</p>

        <form action={formAction} className="mt-4 space-y-3">
          <input type="hidden" name="loanId" value={loanId} />
          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              <AlertCircle className="h-3 w-3" /> {state.error}
            </div>
          )}
          <div>
            <textarea
              name="rejectionReason"
              rows={3}
              required
              placeholder="e.g. Insufficient salary to support repayment, pending previous loan..."
              className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary ${state.fieldErrors?.rejectionReason ? "border-destructive" : "border-border"}`}
            />
            {state.fieldErrors?.rejectionReason && (
              <p className="mt-1 text-xs text-destructive">{state.fieldErrors.rejectionReason}</p>
            )}
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

function DisburseDialog({ open, onClose, loan, onSuccess }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <h3 className="text-base font-semibold text-foreground">Disburse Loan</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Disburse KES {(loan.principalAmount || 0).toLocaleString("en-KE")} to {loan.employeeName}
        </p>
        <div className="mt-4">
          <DisburseForm loanId={loan._id} onSuccess={onSuccess} onCancel={onClose} />
        </div>
      </div>
    </div>
  );
}

export function LoanDetailActions({ loan, userRole }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [disburseOpen, setDisburseOpen] = useState(false);

  const canApprove = loan.status === "pending_approval" && ["SuperAdmin", "Admin", "HR"].includes(userRole);
  const canReject = loan.status === "pending_approval" && ["SuperAdmin", "Admin", "HR"].includes(userRole);
  const canDisburse = loan.status === "approved" && ["SuperAdmin", "Admin"].includes(userRole);
  const hasDeductions = loan.installments?.some((i) => i.status === "deducted");
  const canCancel =
    ["pending_approval", "approved", "active"].includes(loan.status) &&
    !hasDeductions &&
    ["SuperAdmin", "Admin", "HR"].includes(userRole);

  function handleApprove() {
    startTransition(async () => {
      const result = await approveLoan(loan._id);
      if (result?.success === false) {
        toast.error(result.error);
      } else {
        toast.success("Loan approved");
        router.refresh();
      }
    });
  }

  function handleCancel() {
    if (!confirm("Are you sure you want to cancel this loan?")) return;
    startTransition(async () => {
      const result = await cancelLoan(loan._id);
      if (result?.success === false) {
        toast.error(result.error);
      } else {
        toast.success("Loan cancelled");
        router.refresh();
      }
    });
  }

  if (!canApprove && !canReject && !canDisburse && !canCancel) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canApprove && (
          <Button onClick={handleApprove} disabled={isPending} size="sm">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            <span className="hidden sm:inline">Approve</span>
          </Button>
        )}
        {canDisburse && (
          <Button
            onClick={() => setDisburseOpen(true)}
            disabled={isPending}
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <CheckCircle2 className="h-4 w-4" />
            <span className="hidden sm:inline">Disburse</span>
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
        {canCancel && (
          <Button variant="outline" size="sm" onClick={handleCancel} disabled={isPending}>
            <Ban className="h-4 w-4" />
            <span className="hidden sm:inline">Cancel</span>
          </Button>
        )}
      </div>

      <RejectDialog
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        loanId={loan._id}
        onSuccess={() => { setRejectOpen(false); router.refresh(); }}
      />

      <DisburseDialog
        open={disburseOpen}
        onClose={() => setDisburseOpen(false)}
        loan={loan}
        onSuccess={() => { setDisburseOpen(false); router.refresh(); }}
      />
    </>
  );
}
