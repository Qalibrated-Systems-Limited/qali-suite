"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { CheckCircle2, Loader2, Banknote, Ban, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { approveExit, payExit, cancelExit } from "@/app/db/actions/hr-exit-actions";

function Dialog({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

function FormDialog({ title, description, action, exitId, field, placeholder, submitLabel, variant, onClose }) {
  const [state, formAction, isPending] = useActionState(action, { success: false });
  useEffect(() => {
    if (state.success) {
      toast.success(state.message ?? "Done");
      onClose();
    }
  }, [state, onClose]);

  return (
    <Dialog title={title} onClose={onClose}>
      <p className="text-sm text-muted-foreground">{description}</p>
      <form action={formAction} className="mt-4 space-y-3">
        <input type="hidden" name="exitId" value={exitId} />
        {state.error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" /> {state.error}
          </div>
        )}
        <input
          name={field}
          placeholder={placeholder}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isPending}>
            Back
          </Button>
          <Button type="submit" size="sm" variant={variant} disabled={isPending}>
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function ExitActions({ exit, can, netPay, clearanceOpen }) {
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState(null);
  const close = () => setDialog(null);

  const approve = () =>
    startTransition(async () => {
      const res = await approveExit(exit.id);
      if (!res.success) return toast.error(res.error);
      toast.success(res.message);
      if (res.warning) toast.warning(res.warning);
      close();
    });

  const kes = (n) => (n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2 });

  return (
    <div className="flex flex-wrap gap-2">
      {exit.status === "draft" && can.approve && (
        <Button size="sm" onClick={() => setDialog("approve")} disabled={clearanceOpen > 0} title={clearanceOpen > 0 ? "Complete the clearance first" : undefined}>
          <CheckCircle2 className="h-4 w-4" /> Approve final dues
        </Button>
      )}
      {exit.status === "approved" && can.pay && (
        <Button size="sm" onClick={() => setDialog("pay")}>
          <Banknote className="h-4 w-4" /> Record payment
        </Button>
      )}
      {exit.status === "draft" && can.manage && (
        <Button size="sm" variant="outline" onClick={() => setDialog("cancel")}>
          <Ban className="h-4 w-4" /> Cancel exit
        </Button>
      )}

      {dialog === "approve" && (
        <Dialog title="Approve final dues" onClose={close}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>The statement is frozen as it stands: net KES {kes(netPay)}.</li>
            <li>The employment ends on {exit.lastWorkingDate} and the employee&apos;s login is deactivated.</li>
            <li>The accrual is posted to the ledger and any loan recovery is applied.</li>
          </ul>
          <p className="mt-3 text-sm text-foreground">This cannot be undone from here.</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={close} disabled={isPending}>
              Back
            </Button>
            <Button size="sm" onClick={approve} disabled={isPending}>
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Approve and post
            </Button>
          </div>
        </Dialog>
      )}
      {dialog === "pay" && (
        <FormDialog
          title="Record payment"
          description={`Clears KES ${kes(netPay)} of final dues payable against the payroll bank account.`}
          action={payExit}
          exitId={exit.id}
          field="paymentReference"
          placeholder="Payment reference, e.g. EFT number"
          submitLabel="Record payment"
          onClose={close}
        />
      )}
      {dialog === "cancel" && (
        <FormDialog
          title="Cancel this exit"
          description="The employee stays employed and nothing is posted. Say why, for the record."
          action={cancelExit}
          exitId={exit.id}
          field="reason"
          placeholder="Reason for cancelling"
          submitLabel="Cancel exit"
          variant="destructive"
          onClose={close}
        />
      )}
    </div>
  );
}
