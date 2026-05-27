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
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  sendPurchaseOrder,
  confirmPurchaseOrder,
  cancelPurchaseOrder,
  deletePurchaseOrder,
} from "@/app/mongodb/actions/purchase-order-actions";
import { ConvertToBillDialog } from "./ConvertToBillDialog";

export function PODetailActions({ purchaseOrder, userRole }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Dialog states
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showBillDialog, setShowBillDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const canManage = ["SuperAdmin", "Admin", "Manager", "Accountant"].includes(userRole);
  const po = purchaseOrder;

  // ----------------------------------------
  // ACTION HANDLERS
  // ----------------------------------------
  const handleSend = () => {
    startTransition(async () => {
      const result = await sendPurchaseOrder(po._id);
      if (result.success) {
        toast.success("Purchase order sent to supplier");
        router.refresh();
      } else {
        toast.error(result.error || "Failed to send purchase order");
      }
    });
  };

  const handleConfirm = () => {
    startTransition(async () => {
      const result = await confirmPurchaseOrder(po._id);
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
      const result = await cancelPurchaseOrder(po._id, null, formData);
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

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deletePurchaseOrder(po._id);
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

      {/* Cancel - Non-cancelled, non-received */}
      {!["cancelled", "received", "expired"].includes(po.status) && canManage && (
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
