"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2 } from "lucide-react";
import { approveEmployeeClaim } from "@/app/mongodb/actions/claim-action";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useActionState } from "react";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      disabled={pending}
      className="bg-green-600 hover:bg-green-700 text-white"
    >
      {pending ? (
        <>
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          Approving...
        </>
      ) : (
        <>
          <CheckCircle2 className="w-4 h-4 mr-2" />
          Approve Claim
        </>
      )}
    </Button>
  );
}

export function ApproveClaimDialog({ claimId, claimNumber, children }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const approveWithId = approveEmployeeClaim.bind(null, claimId);
  const [state, formAction] = useActionState(approveWithId, {
    message: null,
  });

  useEffect(() => {
    if (state?.message === "success") {
      toast.success("Claim approved successfully");
      setOpen(false);
      router.refresh();
    } else if (state?.message && state.message !== "success") {
      toast.error(state.message);
    }
  }, [state, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            Approve
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Approve Claim</DialogTitle>
          <DialogDescription>
            Are you sure you want to approve claim{" "}
            <span className="font-semibold text-foreground">{claimNumber}</span>
            ?
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800 p-4">
            <p className="text-sm text-green-800 dark:text-green-300">
              Once approved, this claim will be sent to the accountant for
              payment processing.
            </p>
          </div>

          <div className="flex gap-3 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <SubmitButton />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
