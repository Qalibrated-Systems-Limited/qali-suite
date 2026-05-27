"use client";

import { useState, useEffect } from "react";
import { useActionState } from "react";
import {
  Mail,
  Download,
  XCircle,
  Loader2,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  ReceiptText,
  Edit,
} from "lucide-react";
import Link from "next/link";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cancelInvoice, completeInvoice } from "@/app/mongodb/invoice-actions";
import { InvoicePaymentDialog } from "./InvoicePaymentDialog";
import { IssueCreditNoteDialog } from "./IssueCreditNoteDialog";
import { toast } from "sonner";

export function InvoiceDetailActions({
  invoice,
  userRole,
  userId,
  paymentAccounts = [],
}) {
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [postDialogOpen, setPostDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [creditNoteDialogOpen, setCreditNoteDialogOpen] = useState(false);

  // Bind invoice ID to actions
  const completeInvoiceWithId = completeInvoice.bind(null, invoice._id);
  const cancelInvoiceWithId = cancelInvoice.bind(null, invoice._id);

  // useActionState for form submissions
  const [postState, postAction, isPostPending] = useActionState(
    completeInvoiceWithId,
    null
  );
  const [cancelState, cancelAction, isCancelPending] = useActionState(
    cancelInvoiceWithId,
    null
  );

  // Show toast notifications for errors
  useEffect(() => {
    if (postState?.message) {
      toast.error("Failed to post invoice", {
        description: postState.message,
        duration: 5000,
      });
    }
  }, [postState]);

  useEffect(() => {
    if (cancelState?.message) {
      toast.error("Failed to cancel invoice", {
        description: cancelState.message,
        duration: 5000,
      });
    }
  }, [cancelState]);

  const canEdit =
    (invoice.status === "draft" || invoice.status === "sent") &&
    invoice.paymentStatus !== "paid";
  const canPost = invoice.status === "draft" || invoice.status === "sent";
  const canPay =
    invoice.paymentStatus !== "paid" && invoice.status === "completed";
  const canCancel =
    (invoice.status === "draft" || invoice.status === "sent") &&
    (userRole === "Admin" ||
      (userRole === "Accountant" && invoice.createdBy?.id === userId));
  // Calculate total already credited
  const totalCredited = (invoice.creditNotes || []).reduce(
    (sum, cn) => sum + (cn.amount || 0),
    0
  );
  const remainingCreditable = invoice.total - totalCredited;

  const canIssueCreditNote =
    invoice.status === "completed" &&
    ["SuperAdmin", "Admin", "Accountant"].includes(userRole) &&
    remainingCreditable > 0.01;

  return (
    <div className="space-y-2">
      {/* Edit Invoice (for drafts) */}
      {canEdit && (
        <Button
          variant="outline"
          className="w-full border-yellow-500/20 text-yellow-600 hover:bg-yellow-500/10"
          asChild
        >
          <Link href={`/dashboard/invoices/${invoice._id}/update`}>
            <Edit className="mr-2 h-4 w-4" />
            Edit Invoice
          </Link>
        </Button>
      )}

      {/* Post Invoice (for drafts) */}
      {canPost && (
        <Button
          className="w-full bg-blue-600 hover:bg-blue-700"
          onClick={() => setPostDialogOpen(true)}
          disabled={isPostPending}
        >
          <CheckCircle className="mr-2 h-4 w-4" />
          Post Invoice
        </Button>
      )}

      {/* Receive Payment */}
      {canPay && (
        <Button
          className="w-full bg-emerald-600 hover:bg-emerald-700"
          onClick={() => setPaymentDialogOpen(true)}
        >
          <DollarSign className="mr-2 h-4 w-4" />
          Receive Payment
        </Button>
      )}

      {/* Send to Customer */}
      <Button variant="outline" className="w-full border-border">
        <Mail className="mr-2 h-4 w-4" />
        Send to Customer
      </Button>

      {/* Download PDF */}
      <Button variant="outline" className="w-full border-border">
        <Download className="mr-2 h-4 w-4" />
        Download PDF
      </Button>

      {/* Issue Credit Note */}
      {canIssueCreditNote && (
        <Button
          variant="outline"
          className="w-full border-orange-500/20 text-orange-600 hover:bg-orange-500/10"
          onClick={() => setCreditNoteDialogOpen(true)}
        >
          <ReceiptText className="mr-2 h-4 w-4" />
          Issue Credit Note
        </Button>
      )}

      {/* Cancel Invoice */}
      {canCancel && (
        <Button
          variant="outline"
          className="w-full border-red-500/20 text-red-600 hover:bg-red-500/10"
          onClick={() => setCancelDialogOpen(true)}
          disabled={isCancelPending}
        >
          <XCircle className="mr-2 h-4 w-4" />
          Cancel Invoice
        </Button>
      )}

      {/* Post Invoice Confirmation Dialog */}
      <AlertDialog open={postDialogOpen} onOpenChange={setPostDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post Invoice</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to post invoice {invoice.invoiceNumber}?
              This will create journal entries and deduct stock from inventory.
              Posted invoices cannot be edited.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {postState?.message && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{postState.message}</AlertDescription>
            </Alert>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPostPending}>
              Keep as Draft
            </AlertDialogCancel>
            <form action={postAction}>
              <Button
                type="submit"
                disabled={isPostPending}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {isPostPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle className="mr-2 h-4 w-4" />
                )}
                Post Invoice
              </Button>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Invoice</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel invoice {invoice.invoiceNumber}?
              This will restore any deducted stock. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {cancelState?.message && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{cancelState.message}</AlertDescription>
            </Alert>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCancelPending}>
              Keep Invoice
            </AlertDialogCancel>
            <form action={cancelAction}>
              <Button
                type="submit"
                disabled={isCancelPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isCancelPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="mr-2 h-4 w-4" />
                )}
                Cancel Invoice
              </Button>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Payment Dialog */}
      <InvoicePaymentDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        invoice={invoice}
        paymentAccounts={paymentAccounts}
      />

      {/* Credit Note Dialog */}
      <IssueCreditNoteDialog
        open={creditNoteDialogOpen}
        onOpenChange={setCreditNoteDialogOpen}
        invoice={invoice}
      />
    </div>
  );
}
