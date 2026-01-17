"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Power, PowerOff, Trash2 } from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import {
  togglePartyStatus,
  deleteParty,
} from "@/app/mongodb/actions/party-actions";
import { toast } from "sonner";

// ============================================
// TOGGLE STATUS BUTTON
// ============================================
export function ToggleStatusButton({ party }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleToggle = () => {
    startTransition(async () => {
      const result = await togglePartyStatus(party._id, !party.isActive);

      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.errors?._form?.[0] || "Failed to update status");
      }
    });
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleToggle}
      disabled={isPending}
      className={party.isActive ? "text-orange-600" : "text-green-600"}
    >
      {party.isActive ? (
        <>
          <PowerOff className="w-4 h-4 mr-2" />
          Deactivate
        </>
      ) : (
        <>
          <Power className="w-4 h-4 mr-2" />
          Activate
        </>
      )}
    </Button>
  );
}

// ============================================
// DELETE PARTY BUTTON
// ============================================
export function DeletePartyButton({ party }) {
  const router = useRouter();
  const [showDialog, setShowDialog] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteParty(party._id);

      if (result.success) {
        toast.success(result.message);
        setShowDialog(false);
        router.push("/dashboard/parties");
        router.refresh();
      } else {
        toast.error(result.errors?._form?.[0] || "Failed to delete party");
      }
    });
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowDialog(true)}
        className="text-destructive"
      >
        <Trash2 className="w-4 h-4 mr-2" />
        Delete
      </Button>

      <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Party</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{party.name}</strong>?
              <br />
              <br />
              {party.cachedBalance !== 0 && (
                <span className="text-orange-600">
                  Warning: This party has an outstanding balance of{" "}
                  {new Intl.NumberFormat("en-KE", {
                    style: "currency",
                    currency: "KES",
                  }).format(Math.abs(party.cachedBalance))}
                  .
                  <br />
                  <br />
                </span>
              )}
              If the party has transactions, it will be deactivated instead of
              deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending ? "Deleting..." : "Delete Party"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
