"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal,
  Eye,
  CheckCircle2,
  XCircle,
  Landmark,
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
  confirmPaymentPg,
  cancelPaymentPg,
  clearPaymentPg,
} from "@/app/db/actions/payment-actions";

/**
 * Row and header actions for a payment.
 *
 * THERE IS NO "DELETE DRAFT" ANY MORE. It was there for a status this layer
 * cannot produce: creating a payment records, allocates, confirms and posts in
 * one transaction, so nothing is left in `draft` when the action returns.
 * Cancelling is the operation that undoes a payment, and it reverses the
 * journal entry rather than making the row disappear.
 *
 * "Confirm" is kept for a draft that some other path leaves behind. What
 * replaces it in practice is MARK CLEARED, for a cheque or transfer that was
 * routed into a clearing account and has since shown up on the statement — the
 * transition `pending_clearance → confirmed`, which had no button before.
 */
export function PaymentActions({ payment, userRole }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const canManage = ["SuperAdmin", "Admin", "Manager", "Accountant"].includes(userRole);
  const canCancel =
    payment.status !== "cancelled" && ["SuperAdmin", "Admin", "Manager"].includes(userRole);
  const canConfirm = payment.status === "draft" && canManage;
  const canClear = payment.status === "pending_clearance" && canManage;

  const run = (fn, onOk) =>
    startTransition(async () => {
      const result = await fn();
      if (result.success) {
        onOk();
        router.refresh();
      } else {
        toast.error(result.error || "That did not work");
      }
    });

  const handleConfirm = () =>
    run(
      () => confirmPaymentPg(payment.id),
      () => toast.success(`Payment ${payment.paymentNumber} confirmed`),
    );

  const handleClear = () =>
    run(
      () => clearPaymentPg(payment.id),
      () => toast.success(`Payment ${payment.paymentNumber} cleared`),
    );

  const handleCancel = () => {
    if (!cancelReason.trim()) {
      toast.error("Please provide a cancellation reason");
      return;
    }
    const formData = new FormData();
    formData.append("reason", cancelReason);

    run(
      () => cancelPaymentPg(payment.id, null, formData),
      () => {
        toast.success(`Payment ${payment.paymentNumber} cancelled`);
        setShowCancelDialog(false);
        setCancelReason("");
      },
    );
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
            onClick={() => router.push(`/dashboard/payments/${payment.id}`)}
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

          {canClear && (
            <DropdownMenuItem onClick={handleClear}>
              <Landmark className="mr-2 h-4 w-4" />
              Mark Cleared
            </DropdownMenuItem>
          )}

          {canCancel && (
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
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Cancel Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Payment</DialogTitle>
            <DialogDescription>
              Cancel payment {payment.paymentNumber}. This reverses the journal
              entry and gives the allocated documents their balance back.
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
