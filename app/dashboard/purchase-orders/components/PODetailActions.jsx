"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Send,
  CheckCircle,
  XCircle,
  Package,
  Receipt,
  Loader2,
  CircleSlash,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import {
  sendPurchaseOrderPg,
  confirmPurchaseOrderPg,
  cancelPurchaseOrderPg,
  closePurchaseOrderPg,
  deletePurchaseOrderPg,
  reopenPurchaseOrderPg,
} from "@/app/db/actions/purchase-order-actions";
import { ConvertToBillDialog } from "./ConvertToBillDialog";
import { roleAllowed } from "@/lib/permissions";
import { PROCUREMENT_ROLES } from "@/lib/utils/role-gates";

export function PODetailActions({ purchaseOrder, userRole }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Dialog states
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showBillDialog, setShowBillDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [closureReason, setClosureReason] = useState("");

  // PROCUREMENT_ROLES, the list the order actions gate on. The inline literal
  // this replaces named Accountant — who does not run procurement — and omitted
  // CFO, Finance Manager and Procurement Officer, who do.
  const canManage = roleAllowed(userRole, [...PROCUREMENT_ROLES]);
  const po = purchaseOrder;

  // `status` here is the DISPLAY status — "expired", "partial" and "received"
  // are derived and are not values the column can hold. `workflowStatus` is
  // what was actually chosen, and it is the one a transition is judged on.
  const isExpired = po.status === "expired";
  /**
   * A sent order the supplier has not confirmed can still be amended, which is
   * what the transition table has always allowed (sent -> draft) and what the
   * UI never offered: Edit is draft-only and Reopen was expired-only, so a
   * sent order was a dead end and the only way to change it was to cancel it
   * and retype it under a new number.
   */
  const canReturnToDraft = po.workflowStatus === "sent" || isExpired;

  // ----------------------------------------
  // ACTION HANDLERS
  // ----------------------------------------
  const handleSend = () => {
    startTransition(async () => {
      const result = await sendPurchaseOrderPg(po._id);
      if (result.success) {
        toast.success("Purchase order sent to supplier");
        router.refresh();
      } else {
        toast.error(result.error || "Failed to send purchase order");
      }
    });
  };

  /**
   * Back to draft — the amendment step 0049 designed the freeze around.
   *
   * The lines are frozen outside draft on purpose, so revising an order the
   * supplier already has is a deliberate act with a name on it rather than an
   * edit nobody sees. Coming back to draft also clears `sent`, which is what
   * keeps "status = sent" meaning "the supplier has THIS version" — it has to
   * be sent again afterwards.
   *
   * THE VALIDITY DATE MOVES ONLY FOR AN EXPIRED ORDER. Reopening an expired
   * one is meaningless without it. Amending a live one must not silently
   * extend what the supplier was told, so its `validUntil` is left alone.
   */
  const handleReopen = () => {
    startTransition(async () => {
      const reopenedUntil = isExpired
        ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10)
        : undefined;
      const result = await reopenPurchaseOrderPg(po._id, reopenedUntil);
      if (result.success) {
        toast.success(
          isExpired
            ? "Purchase order reopened as draft"
            : "Returned to draft — edit it, then send it again",
        );
        router.refresh();
      } else {
        toast.error(result.error || "Failed to return the purchase order to draft");
      }
    });
  };

  const handleConfirm = () => {
    startTransition(async () => {
      const result = await confirmPurchaseOrderPg(po._id);
      if (result.success) {
        toast.success("Purchase order confirmed");
        router.refresh();
      } else {
        toast.error(result.error || "Failed to confirm purchase order");
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
      const result = await cancelPurchaseOrderPg(po._id, null, formData);
      if (result.success) {
        toast.success("Purchase order cancelled");
        setShowCancelDialog(false);
        setCancelReason("");
        router.refresh();
      } else {
        toast.error(result.error || "Failed to cancel purchase order");
      }
    });
  };

  /**
   * Closes the order short.
   *
   * An order with receipts or bills against it can no longer be CANCELLED —
   * cancelling would leave real documents pointing at something that says it
   * never happened. Closing records that no more is expected without denying
   * what already arrived. The Mongo module has no name for this move, so a
   * part-delivered abandoned order sat in "partial" forever and every
   * open-order report carried it.
   */
  const handleClose = () => {
    if (!closureReason.trim()) {
      toast.error("Please say why the order is being closed");
      return;
    }

    const formData = new FormData();
    formData.append("reason", closureReason);

    startTransition(async () => {
      const result = await closePurchaseOrderPg(po._id, null, formData);
      if (result.success) {
        toast.success("Purchase order closed");
        setShowCloseDialog(false);
        setClosureReason("");
        router.refresh();
      } else {
        toast.error(result.error || "Failed to close purchase order");
      }
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deletePurchaseOrderPg(po._id);
      if (result.success) {
        toast.success("Purchase order deleted");
        router.push("/dashboard/purchase-orders");
      } else {
        toast.error(result.error || "Failed to delete purchase order");
      }
    });
  };

  // ----------------------------------------
  // RENDER
  // ----------------------------------------
  return (
    <div className="space-y-3">
      {/* Back to draft: an expired order, or a sent one not yet confirmed. */}
      {canReturnToDraft && canManage && (
        <Button
          onClick={handleReopen}
          disabled={isPending}
          variant="outline"
          className="w-full"
        >
          {isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="mr-2 h-4 w-4" />
          )}
          {isExpired ? "Reopen as Draft" : "Amend — Return to Draft"}
        </Button>
      )}

      {/* Send to Supplier - Draft only */}
      {po.status === "draft" && canManage && (
        <Button
          onClick={handleSend}
          disabled={isPending}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white"
        >
          {isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          Send to Supplier
        </Button>
      )}

      {/* Confirm - Sent only */}
      {po.status === "sent" && canManage && (
        <Button
          onClick={handleConfirm}
          disabled={isPending}
          className="w-full bg-green-600 hover:bg-green-700 text-white"
        >
          {isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle className="mr-2 h-4 w-4" />
          )}
          Mark as Confirmed
        </Button>
      )}

      {/* Receive Items — route into the GRN inspection workflow. SOP
          §10.1 wants every receipt to go through the inspection +
          Sales/Finance acceptance gate; the GRN page pre-fills from
          this PO via ?fromPO=. */}
      {["sent", "confirmed", "partial"].includes(po.status) && canManage && (
        <Button
          variant="outline"
          className="w-full border-emerald-500 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950"
          onClick={() => router.push(`/dashboard/grn/create?fromPO=${po._id}`)}
        >
          <Package className="mr-2 h-4 w-4" />
          Receive Goods (GRN)
        </Button>
      )}

      {/* Create Bill - Confirmed, Partial, or Received */}
      {["confirmed", "partial", "received"].includes(po.status) && canManage && (
        <Button
          variant="outline"
          className="w-full border-purple-500 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950"
          onClick={() => setShowBillDialog(true)}
        >
          <Receipt className="mr-2 h-4 w-4" />
          Create Bill
        </Button>
      )}

      {/* Close short — the way out for an order that can no longer be cancelled */}
      {["sent", "confirmed", "partial"].includes(po.status) && canManage && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setShowCloseDialog(true)}
          disabled={isPending}
        >
          <CircleSlash className="mr-2 h-4 w-4" />
          Close Order Short
        </Button>
      )}

      {/* Cancel - Non-cancelled, non-received */}
      {!["cancelled", "received", "expired", "closed"].includes(po.status) && canManage && (
        <Button
          variant="outline"
          className="w-full text-destructive hover:bg-destructive/10"
          onClick={() => setShowCancelDialog(true)}
          disabled={isPending}
        >
          <XCircle className="mr-2 h-4 w-4" />
          Cancel PO
        </Button>
      )}

      {/* Delete - Draft only */}
      {po.status === "draft" && canManage && (
        <Button
          variant="ghost"
          className="w-full text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={() => setShowDeleteDialog(true)}
          disabled={isPending}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete PO
        </Button>
      )}

      {/* Close Dialog */}
      <Dialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close order short</DialogTitle>
            <DialogDescription>
              Records that nothing further is expected against {po.poNumber}.
              What has already been received and billed is kept.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="closureReason">Reason *</Label>
            <Textarea
              id="closureReason"
              value={closureReason}
              onChange={(e) => setClosureReason(e.target.value)}
              placeholder="e.g. Supplier cannot deliver the balance"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCloseDialog(false)}
              disabled={isPending}
            >
              Back
            </Button>
            <Button
              onClick={handleClose}
              disabled={isPending || !closureReason.trim()}
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CircleSlash className="mr-2 h-4 w-4" />
              )}
              Close Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Purchase Order</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel {po.poNumber}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="cancelReason">Reason for Cancellation *</Label>
              <Textarea
                id="cancelReason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Enter reason for cancellation..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCancelDialog(false);
                setCancelReason("");
              }}
              disabled={isPending}
            >
              Back
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
              Cancel PO
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Purchase Order?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {po.poNumber}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Convert to Bill Dialog */}
      <ConvertToBillDialog
        purchaseOrder={po}
        open={showBillDialog}
        onOpenChange={setShowBillDialog}
      />
    </div>
  );
}
