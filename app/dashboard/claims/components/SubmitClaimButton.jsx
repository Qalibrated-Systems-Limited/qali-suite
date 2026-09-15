"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitEmployeeClaimPg as submitEmployeeClaim } from "@/app/db/actions/claim-actions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Send, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Sends a draft claim for approval.
 *
 * THE WAY BACK OUT OF A RECALL. `RecallClaimButton` promises "This will move
 * the claim back to draft so you can make changes" — and until this existed
 * there was no button that returned it to the queue. A recalled claim could be
 * edited and then sat in draft for ever, out of every approver's list, with no
 * sign to its owner that it was going nowhere.
 *
 * The sibling `ResubmitClaimButton` looks the same and is not: it is for a
 * claim an approver REJECTED, which is a different sentence to read and a
 * different thing to have happened.
 */
export function SubmitClaimButton({ claimId, claimNumber }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSubmit = () => {
    startTransition(async () => {
      const result = await submitEmployeeClaim(claimId);
      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" className="flex-1 sm:flex-none">
          <Send className="w-4 h-4 mr-2" />
          Submit for Approval
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Submit {claimNumber}?</AlertDialogTitle>
          <AlertDialogDescription>
            This sends the claim to the approval queue. You can recall it again
            while it is still waiting, but not once it has been approved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleSubmit} disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              "Yes, Submit"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
