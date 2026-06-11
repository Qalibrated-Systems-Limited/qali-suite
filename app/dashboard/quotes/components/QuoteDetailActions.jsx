"use client";

import { useState, useActionState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Send,
  ThumbsUp,
  ThumbsDown,
  ArrowRightCircle,
  Edit,
  Copy,
  XCircle,
  Loader2,
  AlertTriangle,
  ClipboardList,
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  sendQuote,
  acceptQuote,
  rejectQuote,
  cancelQuote,
} from "@/app/mongodb/actions/quote-actions";
import { ConvertToInvoiceDialog } from "./ConvertToInvoiceDialog";
import { QuotePDFDownloadButton } from "./QuotePDFButton";
import { createSalesOrderFromQuote } from "@/app/mongodb/actions/sales-order-actions";

export function QuoteDetailActions({
  quote,
  userRole,
  showConvertDialog = false,
  company,
}) {
  const router = useRouter();
  const [isSoPending, startSoTransition] = useTransition();

  const onCreateSalesOrder = () =>
    startSoTransition(async () => {
      const res = await createSalesOrderFromQuote(quote._id);
      if (res?.success) {
        toast.success(`Sales order ${res.data.orderNumber} created`);
        router.push(`/dashboard/sales-orders/${res.data.id}`);
      } else {
        toast.error(res?.error || "Failed to create sales order");
      }
    });

  // Dialog states
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [acceptDialogOpen, setAcceptDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [convertDialogOpen, setConvertDialogOpen] = useState(showConvertDialog);

  // Reject reason
  const [rejectReason, setRejectReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  // Bind quote ID to actions
  const sendQuoteWithId = sendQuote.bind(null, quote._id);
  const acceptQuoteWithId = acceptQuote.bind(null, quote._id);
  const rejectQuoteWithId = rejectQuote.bind(null, quote._id, rejectReason);
  const cancelQuoteWithId = cancelQuote.bind(null, quote._id, cancelReason);

  // useActionState for form submissions
  const [sendState, sendAction, isSendPending] = useActionState(
    sendQuoteWithId,
    null,
  );
  const [acceptState, acceptAction, isAcceptPending] = useActionState(
    acceptQuoteWithId,
    null,
  );
  const [rejectState, rejectAction, isRejectPending] = useActionState(
    rejectQuoteWithId,
    null,
  );
  const [cancelState, cancelAction, isCancelPending] = useActionState(
    cancelQuoteWithId,
    null,
  );

  // Permission checks
  const canEdit = quote.status === "draft";
  const canSend = quote.status === "draft";
  const canAcceptReject = quote.status === "sent";
  const canConvert = ["sent", "accepted"].includes(quote.status);
  const canCancel = !["cancelled", "converted", "rejected"].includes(
    quote.status,
  );

  return (
    <div className="flex flex-wrap gap-2">
      {/* Edit - Draft only */}
      {canEdit && (
        <Button variant="outline" asChild>
          <Link href={`/dashboard/quotes/${quote._id}/update`}>
            <Edit className="mr-2 h-4 w-4" />
            Edit
          </Link>
        </Button>
      )}

      {/* Send Quote */}
      {canSend && (
        <Button
          className="bg-blue-600 hover:bg-blue-700"
          onClick={() => setSendDialogOpen(true)}
          disabled={isSendPending}
        >
          <Send className="mr-2 h-4 w-4" />
          Send Quote
        </Button>
      )}

      {/* Accept Quote */}
      {canAcceptReject && (
        <Button
          className="bg-green-600 hover:bg-green-700"
          onClick={() => setAcceptDialogOpen(true)}
          disabled={isAcceptPending}
        >
          <ThumbsUp className="mr-2 h-4 w-4" />
          Accept
        </Button>
      )}

      {/* Reject Quote */}
      {canAcceptReject && (
        <Button
          variant="outline"
          className="border-red-500/20 text-red-600 hover:bg-red-500/10"
          onClick={() => setRejectDialogOpen(true)}
          disabled={isRejectPending}
        >
          <ThumbsDown className="mr-2 h-4 w-4" />
          Reject
        </Button>
      )}

      {/* Create Sales Order — confirmed-commitment path: reserves stock on
          confirm, then invoices. Same eligibility as direct conversion. */}
      {canConvert && (
        <Button
          variant="outline"
          onClick={onCreateSalesOrder}
          disabled={isSoPending}
        >
          {isSoPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ClipboardList className="mr-2 h-4 w-4" />
          )}
          Create Sales Order
        </Button>
      )}

      {/* Convert to Invoice */}
      {canConvert && (
        <Button
          className="bg-purple-600 hover:bg-purple-700"
          onClick={() => setConvertDialogOpen(true)}
        >
          <ArrowRightCircle className="mr-2 h-4 w-4" />
          Convert to Invoice
        </Button>
      )}

      {/* Download PDF */}
      <QuotePDFDownloadButton quote={quote} company={company} />

      {/* Duplicate */}
      <Button variant="outline" asChild>
        <Link href={`/dashboard/quotes/create?from=${quote._id}`}>
          <Copy className="mr-2 h-4 w-4" />
          <span className="hidden sm:inline">Duplicate</span>
        </Link>
      </Button>

      {/* Cancel */}
      {canCancel && (
        <Button
          variant="outline"
          className="border-red-500/20 text-red-600 hover:bg-red-500/10"
          onClick={() => setCancelDialogOpen(true)}
          disabled={isCancelPending}
        >
          <XCircle className="mr-2 h-4 w-4" />
          <span className="hidden sm:inline">Cancel</span>
        </Button>
      )}

      {/* Send Quote Dialog */}
      <AlertDialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send Quote to Customer</AlertDialogTitle>
            <AlertDialogDescription>
              Mark quote {quote.quoteNumber} as sent to the customer. This will
              change the status to "sent" and record the sent date.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {sendState?.message && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{sendState.message}</AlertDescription>
            </Alert>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSendPending}>
              Cancel
            </AlertDialogCancel>
            <form action={sendAction}>
              <Button
                type="submit"
                disabled={isSendPending}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {isSendPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Send Quote
              </Button>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Accept Quote Dialog */}
      <AlertDialog open={acceptDialogOpen} onOpenChange={setAcceptDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Accept Quote</AlertDialogTitle>
            <AlertDialogDescription>
              Mark quote {quote.quoteNumber} as accepted by the customer. You
              can then convert it to an invoice.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {acceptState?.message && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{acceptState.message}</AlertDescription>
            </Alert>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isAcceptPending}>
              Cancel
            </AlertDialogCancel>
            <form action={acceptAction}>
              <Button
                type="submit"
                disabled={isAcceptPending}
                className="bg-green-600 hover:bg-green-700"
              >
                {isAcceptPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ThumbsUp className="mr-2 h-4 w-4" />
                )}
                Accept Quote
              </Button>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject Quote Dialog */}
      <AlertDialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Quote</AlertDialogTitle>
            <AlertDialogDescription>
              Mark quote {quote.quoteNumber} as rejected by the customer.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="py-4">
            <Label htmlFor="rejectReason">Rejection Reason (Optional)</Label>
            <Textarea
              id="rejectReason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Why was the quote rejected?"
              className="mt-2"
              rows={3}
            />
          </div>

          {rejectState?.message && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{rejectState.message}</AlertDescription>
            </Alert>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRejectPending}>
              Cancel
            </AlertDialogCancel>
            <form action={rejectAction}>
              <Button
                type="submit"
                disabled={isRejectPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isRejectPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ThumbsDown className="mr-2 h-4 w-4" />
                )}
                Reject Quote
              </Button>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Quote Dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Quote</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel quote {quote.quoteNumber}? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="py-4">
            <Label htmlFor="cancelReason">Cancellation Reason (Optional)</Label>
            <Textarea
              id="cancelReason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Why is this quote being cancelled?"
              className="mt-2"
              rows={3}
            />
          </div>

          {cancelState?.message && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{cancelState.message}</AlertDescription>
            </Alert>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCancelPending}>
              Keep Quote
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
                Cancel Quote
              </Button>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Convert to Invoice Dialog */}
      <ConvertToInvoiceDialog
        quote={quote}
        open={convertDialogOpen}
        onOpenChange={setConvertDialogOpen}
      />
    </div>
  );
}
