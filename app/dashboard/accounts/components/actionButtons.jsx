"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Power, PowerOff, RefreshCw } from "lucide-react";
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
  activateAccount,
  deactivateAccount,
  calculateAccountBalance,
} from "@/app/mongodb/actions/account-actions";
import { toast } from "sonner";

// ============================================
// RECALCULATE BALANCE BUTTON
// ============================================
export function RecalculateBalanceButton({ account }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleRecalculate = () => {
    startTransition(async () => {
      const result = await calculateAccountBalance(account._id);

      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.errors?._form?.[0] || "Failed to calculate balance");
      }
    });
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleRecalculate}
      disabled={isPending}
    >
      <RefreshCw
        className={`w-4 h-4 mr-2 ${isPending ? "animate-spin" : ""}`}
      />
      {isPending ? "Calculating..." : "Recalculate"}
    </Button>
  );
}

// ============================================
// ACCOUNT ACTION BUTTONS (TOGGLE STATUS)
// ============================================
export function AccountActionButtons({ account }) {
  const router = useRouter();
  const [showDialog, setShowDialog] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Don't show for system accounts
  if (account.systemAccount) {
    return null;
  }

  const handleToggleStatus = () => {
    startTransition(async () => {
      const result = account.isActive
        ? await deactivateAccount(account._id)
        : await activateAccount(account._id);

      if (result.success) {
        toast.success(result.message);
        setShowDialog(false);
        router.refresh();
      } else {
        toast.error(result.errors?._form?.[0] || "Failed to update status");
      }
    });
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowDialog(true)}
        className={account.isActive ? "text-orange-600" : "text-green-600"}
      >
        {account.isActive ? (
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

      <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {account.isActive ? "Deactivate" : "Activate"} Account
            </AlertDialogTitle>
            <AlertDialogDescription>
              {account.isActive ? (
                <>
                  Are you sure you want to deactivate{" "}
                  <strong>
                    {account.accountCode} - {account.accountName}
                  </strong>
                  ?
                  <br />
                  <br />
                  Inactive accounts won't appear in dropdowns or reports.
                </>
              ) : (
                <>
                  Are you sure you want to activate{" "}
                  <strong>
                    {account.accountCode} - {account.accountName}
                  </strong>
                  ?
                  <br />
                  <br />
                  The account will be available for use in transactions.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleToggleStatus}
              disabled={isPending}
              className={
                account.isActive
                  ? "bg-orange-600 hover:bg-orange-700"
                  : "bg-green-600 hover:bg-green-700"
              }
            >
              {isPending
                ? "Processing..."
                : account.isActive
                ? "Deactivate"
                : "Activate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
