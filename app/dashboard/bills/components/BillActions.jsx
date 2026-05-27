"use client";

import { useState, useTransition } from "react";
import {
  MoreHorizontal,
  Eye,
  Edit,
  Send,
  CheckCircle2,
  Trash2,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  submitBill,
  approveBill,
  deleteBill,
} from "@/app/mongodb/actions/bill-actions";

export function BillActions({ bill, userRole }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmDialog, setConfirmDialog] = useState(null);

  const canEdit = ["draft", "rejected"].includes(bill.status);
  const canSubmit = bill.status === "draft";
  const canApprove =
    bill.status === "submitted" && ["SuperAdmin", "Admin", "Manager"].includes(userRole);
  const canDelete = bill.status === "draft";

  const handleAction = async (action) => {
    setConfirmDialog(null);

    startTransition(async () => {
      let result;

      switch (action) {
        case "submit":
          result = await submitBill(bill._id);
          break;
        case "approve":
          result = await approveBill(bill._id);
          break;
        case "delete":
          result = await deleteBill(bill._id);
          break;
        default:
          return;
      }

      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const confirmActions = {
    submit: {
      title: "Submit Bill for Approval",
      description: `Are you sure you want to submit bill ${bill.billNumber} for approval? This will send it to a manager for review.`,
      action: "Submit",
    },
    approve: {
      title: "Approve Bill",
      description: `Are you sure you want to approve bill ${bill.billNumber}? This will create journal entries and post to the ledger.`,
      action: "Approve",
    },
    delete: {
      title: "Delete Bill",
      description: `Are you sure you want to delete bill ${bill.billNumber}? This action cannot be undone.`,
      action: "Delete",
      variant: "destructive",
    },
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreHorizontal className="h-4 w-4" />
            )}
            <span className="sr-only">Open menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {/* View */}
          <DropdownMenuItem
            onClick={() => router.push(`/dashboard/bills/${bill._id}`)}
          >
            <Eye className="mr-2 h-4 w-4" />
            View Details
          </DropdownMenuItem>

          {/* Edit */}
          {canEdit && (
            <DropdownMenuItem
              onClick={() => router.push(`/dashboard/bills/${bill._id}/edit`)}
            >
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          {/* Submit for Approval */}
          {canSubmit && (
            <DropdownMenuItem onClick={() => setConfirmDialog("submit")}>
              <Send className="mr-2 h-4 w-4" />
              Submit for Approval
            </DropdownMenuItem>
          )}

          {/* Approve */}
          {canApprove && (
            <DropdownMenuItem
              onClick={() => setConfirmDialog("approve")}
              className="text-emerald-600 focus:text-emerald-600"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Approve
            </DropdownMenuItem>
          )}

          {/* Delete */}
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setConfirmDialog("delete")}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Confirmation Dialog */}
      <AlertDialog
        open={!!confirmDialog}
        onOpenChange={() => setConfirmDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDialog && confirmActions[confirmDialog]?.title}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog && confirmActions[confirmDialog]?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleAction(confirmDialog)}
              className={
                confirmDialog === "delete"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : confirmDialog === "approve"
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : ""
              }
            >
              {confirmDialog && confirmActions[confirmDialog]?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
