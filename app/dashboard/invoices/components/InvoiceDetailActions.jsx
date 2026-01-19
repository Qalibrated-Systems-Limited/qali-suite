"use client";

import { useState } from "react";
import { useActionState } from "react";
import {
  Mail,
  Download,
  XCircle,
  Loader2,
  DollarSign,
  AlertTriangle,
  CheckCircle,
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cancelInvoice, completeInvoice } from "@/app/mongodb/invoice-actions";
import { InvoicePaymentDialog } from "./InvoicePaymentDialog";

export function InvoiceDetailActions({
  invoice,
  userRole,
  paymentAccounts = [],
}) {
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [postDialogOpen, setPostDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

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

  const canPost = invoice.status === "draft" || invoice.status === "sent";
  const canPay =
    invoice.paymentStatus !== "paid" && invoice.status === "completed";
  const canCancel =
    invoice.status !== "cancelled" &&
    invoice.paymentStatus !== "paid" &&
    userRole?.toLowerCase() === "admin";

  return (
    <div className="space-y-2">
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
    </div>
  );
}
