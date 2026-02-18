"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { resubmitEmployeeClaim } from "../../../mongodb/actions/claim-action";
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

export function ResubmitClaimButton({ claimId, claimNumber }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleResubmit = () => {
    startTransition(async () => {
      const result = await resubmitEmployeeClaim(claimId);
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
        <Button
          size="sm"
          className="flex-1 sm:flex-none bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Send className="w-4 h-4 mr-2" />
          Resubmit
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Resubmit {claimNumber}?</AlertDialogTitle>
          <AlertDialogDescription>
            This will resubmit the claim for manager approval.
            Make sure you&apos;ve made the necessary changes before resubmitting.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleResubmit}
            disabled={isPending}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              "Yes, Resubmit"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
