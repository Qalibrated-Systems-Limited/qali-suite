"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { XCircle, Loader2 } from "lucide-react";
import { rejectEmployeeClaim } from "@/app/mongodb/actions/claim-action";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useActionState } from "react";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} variant="destructive">
      {pending ? (
        <>
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          Rejecting...
        </>
      ) : (
        <>
          <XCircle className="w-4 h-4 mr-2" />
          Reject Claim
        </>
      )}
    </Button>
  );
}

export function RejectClaimDialog({ claimId, claimNumber, children }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const rejectWithId = rejectEmployeeClaim.bind(null, claimId);
  const [state, formAction] = useActionState(rejectWithId, {
    message: null,
  });

  useEffect(() => {
    if (state?.message === "success") {
      toast.success("Claim rejected");
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
            variant="outline"
            className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            <XCircle className="w-4 h-4 mr-2" />
            Reject
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject Claim</DialogTitle>
          <DialogDescription>
            Please provide a detailed reason for rejecting claim{" "}
            <span className="font-semibold text-foreground">{claimNumber}</span>
            .
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reason">
              Rejection Reason <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="reason"
              name="reason"
              placeholder="Explain why this claim is being rejected..."
              required
              minLength={10}
              rows={4}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Minimum 10 characters. The employee will see this reason.
            </p>
          </div>

          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4">
            <p className="text-sm text-red-800 dark:text-red-300">
              This action cannot be undone. The employee will be notified of the
              rejection.
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
