"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal,
  Eye,
  CheckCircle2,
  XCircle,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  confirmPayment,
  cancelPayment,
  deletePayment,
} from "@/app/mongodb/actions/payment-actions";

export function PaymentActions({ payment, userRole }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const canManage = ["SuperAdmin", "Admin", "Manager", "Accountant"].includes(userRole);
  const canDelete = ["SuperAdmin", "Admin", "Manager"].includes(userRole);
  const isDraft = payment.status === "draft";
  const canConfirm =
    ["draft", "pending_clearance"].includes(payment.status) && canManage;
  const canCancel =
    payment.status !== "cancelled" && ["SuperAdmin", "Admin", "Manager"].includes(userRole);

  const handleConfirm = () => {
    startTransition(async () => {
      const result = await confirmPayment(payment._id);
      if (result.success) {
        toast.success(`Payment ${payment.paymentNumber} confirmed`);
        router.refresh();
      } else {
        toast.error(result.error || "Failed to confirm payment");
      }
    });
  };

  const handleCancel = () => {
    if (!cancelReason.trim()) {
      toast.error("Please provide a cancellation reason");
      return;
    }

    const formData = new FormData();
    formData.append("reason", cancelReason);

    startTransition(async () => {
      const result = await cancelPayment(payment._id, null, formData);
      if (result.success) {
        toast.success(`Payment ${payment.paymentNumber} cancelled`);
        setShowCancelDialog(false);
        setCancelReason("");
        router.refresh();
      } else {
        toast.error(result.error || "Failed to cancel payment");
      }
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deletePayment(payment._id);
      if (result.success) {
        toast.success("Draft payment deleted");
        router.refresh();
      } else {
        toast.error(result.error || "Failed to delete payment");
      }
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={isPending}>
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreHorizontal className="h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => router.push(`/dashboard/payments/${payment._id}`)}
          >
            <Eye className="mr-2 h-4 w-4" />
            View Details
          </DropdownMenuItem>

          {canConfirm && (
            <DropdownMenuItem onClick={handleConfirm}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Confirm Payment
            </DropdownMenuItem>
          )}

          {canCancel && payment.status !== "cancelled" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setShowCancelDialog(true)}
              >
                <XCircle className="mr-2 h-4 w-4" />
                Cancel Payment
              </DropdownMenuItem>
            </>
          )}

          {isDraft && canDelete && (
            <DropdownMenuItem className="text-destructive" onClick={handleDelete}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Draft
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Cancel Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Payment</DialogTitle>
            <DialogDescription>
              Cancel payment {payment.paymentNumber}. This will reverse the
              journal entry and update allocated documents.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancelReason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="cancelReason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Reason for cancellation..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCancelDialog(false)}
              disabled={isPending}
            >
              Close
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={isPending || !cancelReason.trim()}
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="mr-2 h-4 w-4" />
              )}
              Cancel Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
