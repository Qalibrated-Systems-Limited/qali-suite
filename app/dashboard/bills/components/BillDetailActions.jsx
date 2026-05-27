"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Send,
  CheckCircle2,
  XCircle,
  Trash2,
  Loader2,
  DollarSign,
  Edit,
  Ban,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import Link from "next/link";
import {
  submitBill,
  approveBill,
  rejectBill,
  cancelBill,
  deleteBill,
} from "@/app/mongodb/actions/bill-actions";
import { BillPaymentDialog } from "./BillPaymentDialog";

export function BillDetailActions({ bill, userRole, paymentAccounts = [] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [dialogError, setDialogError] = useState(null);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [reason, setReason] = useState("");

  const canEdit = bill.canEdit;
  const canSubmit = bill.canSubmit;
  const canApprove = bill.canApprove && ["SuperAdmin", "Admin", "Manager"].includes(userRole);
  const canReject = bill.status === "submitted" && ["SuperAdmin", "Admin", "Manager"].includes(userRole);
  const canPay = bill.canPay;
  const canCancel = bill.canCancel && ["SuperAdmin", "Admin", "Manager"].includes(userRole);
  const canDelete = bill.status === "draft";

  const handleSimpleAction = async (action) => {
    setDialogError(null);

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
          if (result.success) {
            setConfirmDialog(null);
            router.push("/dashboard/bills");
            return;
          }
          break;
        default:
          return;
      }

      if (result.success) {
        setConfirmDialog(null);
        toast.success(result.message);
        router.refresh();
      } else {
        // Show error in the dialog instead of toast
        setDialogError(result.error);
      }
    });
  };

  const closeConfirmDialog = () => {
    setConfirmDialog(null);
    setDialogError(null);
  };

  const handleReject = async () => {
    if (!reason.trim()) {
      toast.error("Please provide a rejection reason");
      return;
    }

    const formData = new FormData();
    formData.append("reason", reason);

    startTransition(async () => {
      const result = await rejectBill(bill._id, null, formData);

      if (result.success) {
        toast.success(result.message);
        setRejectDialogOpen(false);
        setReason("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const handleCancel = async () => {
    if (!reason.trim()) {
      toast.error("Please provide a cancellation reason");
      return;
    }

    const formData = new FormData();
    formData.append("reason", reason);

    startTransition(async () => {
      const result = await cancelBill(bill._id, null, formData);

      if (result.success) {
        toast.success(result.message);
        setCancelDialogOpen(false);
        setReason("");
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
    <div className="space-y-2">
      {/* Edit Button */}
      {canEdit && (
        <Button variant="outline" className="w-full" asChild>
          <Link href={`/dashboard/bills/${bill._id}/edit`}>
            <Edit className="mr-2 h-4 w-4" />
            Edit Bill
          </Link>
        </Button>
      )}

      {/* Submit for Approval */}
      {canSubmit && (
        <Button
          className="w-full"
          onClick={() => setConfirmDialog("submit")}
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          Submit for Approval
        </Button>
      )}

      {/* Approve */}
      {canApprove && (
        <Button
          className="w-full bg-emerald-600 hover:bg-emerald-700"
          onClick={() => setConfirmDialog("approve")}
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-2 h-4 w-4" />
          )}
          Approve Bill
        </Button>
      )}

      {/* Reject */}
      {canReject && (
        <Button
          variant="outline"
          className="w-full border-red-500/20 text-red-600 hover:bg-red-500/10"
          onClick={() => setRejectDialogOpen(true)}
          disabled={isPending}
        >
          <XCircle className="mr-2 h-4 w-4" />
          Reject
        </Button>
      )}

      {/* Record Payment */}
      {canPay && (
        <Button
          className="w-full bg-primary hover:bg-primary/90"
          onClick={() => setPaymentDialogOpen(true)}
          disabled={isPending}
        >
          <DollarSign className="mr-2 h-4 w-4" />
          Record Payment
        </Button>
      )}

      {/* Cancel */}
      {canCancel && bill.status !== "draft" && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setCancelDialogOpen(true)}
          disabled={isPending}
        >
          <Ban className="mr-2 h-4 w-4" />
          Cancel Bill
        </Button>
      )}

      {/* Delete */}
      {canDelete && (
        <Button
          variant="outline"
          className="w-full border-red-500/20 text-red-600 hover:bg-red-500/10"
          onClick={() => setConfirmDialog("delete")}
          disabled={isPending}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Draft
        </Button>
      )}

      {/* Confirmation Dialog */}
      <AlertDialog
        open={!!confirmDialog}
        onOpenChange={(open) => !open && closeConfirmDialog()}
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

          {/* Error Display */}
          {dialogError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{dialogError}</AlertDescription>
            </Alert>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <Button
              onClick={() => handleSimpleAction(confirmDialog)}
              disabled={isPending}
              className={
                confirmDialog === "delete"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : confirmDialog === "approve"
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : ""
              }
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {confirmDialog && confirmActions[confirmDialog]?.action}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Bill</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this bill. The creator will be notified.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reason">Rejection Reason</Label>
              <Textarea
                id="reason"
                placeholder="Enter the reason for rejection..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectDialogOpen(false);
                setReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={isPending || !reason.trim()}
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="mr-2 h-4 w-4" />
              )}
              Reject Bill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Bill</DialogTitle>
            <DialogDescription>
              This will cancel the bill and reverse any journal entries. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="cancelReason">Cancellation Reason</Label>
              <Textarea
                id="cancelReason"
                placeholder="Enter the reason for cancellation..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCancelDialogOpen(false);
                setReason("");
              }}
            >
              Keep Bill
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={isPending || !reason.trim()}
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Ban className="mr-2 h-4 w-4" />
              )}
              Cancel Bill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Dialog */}
      <BillPaymentDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        bill={bill}
        paymentAccounts={paymentAccounts}
      />
    </div>
  );
}
