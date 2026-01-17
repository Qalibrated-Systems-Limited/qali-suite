"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Mail,
  Download,
  XCircle,
  Loader2,
  DollarSign,
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { cancelInvoice } from "@/app/mongodb/invoice-actions";
import { InvoicePaymentDialog } from "./InvoicePaymentDialog";

export function InvoiceDetailActions({
  invoice,
  userRole,
  paymentAccounts = [],
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState(null);

  const canPay = invoice.paymentStatus !== "paid" && invoice.status !== "cancelled";
  const canCancel =
    invoice.status !== "cancelled" &&
    invoice.status !== "paid" &&
    userRole === "Admin";

  const handleCancel = async () => {
    setDialogError(null);

    startTransition(async () => {
      const result = await cancelInvoice(invoice._id);

      if (result.success) {
        toast.success(result.message || "Invoice cancelled successfully");
        setCancelDialogOpen(false);
        router.refresh();
      } else {
        setDialogError(result.message || "Failed to cancel invoice");
      }
    });
  };

  return (
    <div className="space-y-2">
      {/* Receive Payment */}
      {canPay && (
        <Button
          className="w-full bg-emerald-600 hover:bg-emerald-700"
          onClick={() => setPaymentDialogOpen(true)}
          disabled={isPending}
        >
          <DollarSign className="mr-2 h-4 w-4" />
          Receive Payment
        </Button>
      )}

      {/* Send to Customer */}
      <Button variant="outline" className="w-full border-border" disabled={isPending}>
        <Mail className="mr-2 h-4 w-4" />
        Send to Customer
      </Button>

      {/* Download PDF */}
      <Button variant="outline" className="w-full border-border" disabled={isPending}>
        <Download className="mr-2 h-4 w-4" />
        Download PDF
      </Button>

      {/* Cancel Invoice */}
      {canCancel && (
        <Button
          variant="outline"
          className="w-full border-red-500/20 text-red-600 hover:bg-red-500/10"
          onClick={() => setCancelDialogOpen(true)}
          disabled={isPending}
        >
          <XCircle className="mr-2 h-4 w-4" />
          Cancel Invoice
        </Button>
      )}

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

          {dialogError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{dialogError}</AlertDescription>
            </Alert>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Keep Invoice</AlertDialogCancel>
            <Button
              onClick={handleCancel}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="mr-2 h-4 w-4" />
              )}
              Cancel Invoice
            </Button>
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
