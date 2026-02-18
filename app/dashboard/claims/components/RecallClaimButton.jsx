"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recallEmployeeClaim } from "../../../mongodb/actions/claim-action";
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
import { Undo2, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function RecallClaimButton({ claimId, claimNumber }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleRecall = () => {
    startTransition(async () => {
      const result = await recallEmployeeClaim(claimId);
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
          variant="outline"
          className="flex-1 sm:flex-none"
        >
          <Undo2 className="w-4 h-4 mr-2" />
          Recall
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Recall {claimNumber}?</AlertDialogTitle>
          <AlertDialogDescription>
            This will move the claim back to draft so you can make changes.
            It will be removed from the approval queue.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleRecall} disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Recalling...
              </>
            ) : (
              "Yes, Recall"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
