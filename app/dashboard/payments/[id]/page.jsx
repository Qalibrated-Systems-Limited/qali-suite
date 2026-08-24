import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  XCircle,
  CreditCard,
  Banknote,
  Smartphone,
  Building2,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatCurrency } from "@/lib/utils";
import { getPaymentPg } from "@/app/db/actions/payment-actions";
import { PaymentActions } from "../components/PaymentActions";

export const metadata = {
  title: "Payment Details | ERP",
};

function StatusBadge({ status }) {
  const config = {
    draft: { label: "Draft", className: "bg-secondary text-secondary-foreground", icon: Clock },
    pending_clearance: { label: "Pending Clearance", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400", icon: Clock },
    confirmed: { label: "Confirmed", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", icon: CheckCircle2 },
    cancelled: { label: "Cancelled", className: "bg-red-500/15 text-red-700 dark:text-red-400", icon: XCircle },
  };
  const { label, className, icon: Icon } = config[status] || config.draft;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${className}`}>
      <Icon className="h-4 w-4" />
      {label}
    </span>
  );
}

function MethodIcon({ method }) {
  const icons = { cash: Banknote, mpesa: Smartphone, bank_transfer: Building2, cheque: CreditCard, card: CreditCard };
  const Icon = icons[method] || CreditCard;
  return <Icon className="h-5 w-5" />;
}

export default async function PaymentDetailPage({ params }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const resolvedParams = await params;
  const payment = await getPaymentPg(resolvedParams.id);

  // RLS decides this: a payment in another tenant is not "forbidden", it is
  // absent. Nothing in the callback filters by company.
  if (!payment) {
    notFound();
  }

  const isReceived = payment.paymentType === "received";
  const backUrl = isReceived
    ? "/dashboard/payments/received"
    : "/dashboard/payments/made";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={backUrl}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">
                {payment.paymentNumber}
              </h1>
              <StatusBadge status={payment.status} />
            </div>
            <p className="text-muted-foreground">
              {isReceived ? "Payment Received" : "Payment Made"} &mdash;{" "}
              {payment.paymentDate
                ? new Date(payment.paymentDate).toLocaleDateString("en-KE", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : "-"}
            </p>
          </div>
        </div>
        <PaymentActions payment={payment} userRole={session.user.role} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Amount & Party */}
          <Card>
            <CardContent className="pt-6">
              <div className="grid gap-6 sm:grid-cols-2">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {isReceived ? "Received From" : "Paid To"}
                  </p>
                  <p className="text-lg font-semibold mt-1">
                    {payment.partyNameAtPayment}
                  </p>
                  {payment.partyEmailAtPayment && (
                    <p className="text-sm text-muted-foreground">
                      {payment.partyEmailAtPayment}
                    </p>
                  )}
                  {payment.partyPhoneAtPayment && (
                    <p className="text-sm text-muted-foreground">
                      {payment.partyPhoneAtPayment}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Amount</p>
                  <p
                    className={`text-3xl font-bold mt-1 ${
                      isReceived
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {isReceived ? "+" : "-"}
                    {formatCurrency(payment.amount)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {payment.currency || "KES"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Allocations */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Allocations</CardTitle>
            </CardHeader>
            <CardContent>
              {payment.allocations?.length > 0 ? (
                <div className="space-y-4">
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                            {isReceived ? "Invoice" : "Bill"} #
                          </th>
                          <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                            Original
                          </th>
                          <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                            Balance Before
                          </th>
                          <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                            Allocated
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {payment.allocations.map((alloc) => (
                          <tr key={alloc.id}>
                            <td className="px-4 py-2 font-medium">
                              {alloc.documentNumberAtAllocation}
                            </td>
                            <td className="px-4 py-2 text-right text-muted-foreground">
                              {formatCurrency(alloc.originalAmount)}
                            </td>
                            <td className="px-4 py-2 text-right text-muted-foreground">
                              {formatCurrency(alloc.balanceBefore)}
                            </td>
                            <td className="px-4 py-2 text-right font-semibold">
                              {formatCurrency(alloc.amountAllocated)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex justify-end gap-6 text-sm">
                    <div>
                      <span className="text-muted-foreground">Total Allocated: </span>
                      <span className="font-semibold">
                        {formatCurrency(payment.balance?.total_allocated || 0)}
                      </span>
                    </div>
                    {Number(payment.balance?.unapplied_amount || 0) > 0 && (
                      <div>
                        <span className="text-muted-foreground">Unapplied: </span>
                        <span className="font-semibold text-amber-600 dark:text-amber-400">
                          {formatCurrency(payment.balance.unapplied_amount)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No allocations. This payment has not been applied to any{" "}
                  {isReceived ? "invoices" : "bills"}.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Description & Notes */}
          {(payment.description || payment.notes) && (
            <Card>
              <CardContent className="pt-6 space-y-4">
                {payment.description && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Description</p>
                    <p className="mt-1">{payment.description}</p>
                  </div>
                )}
                {payment.notes && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Notes</p>
                    <p className="mt-1 text-sm">{payment.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Payment Method */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Payment Method</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <MethodIcon method={payment.paymentMethod} />
                <span className="font-medium capitalize">
                  {payment.paymentMethod?.replace("_", " ")}
                </span>
              </div>

              <Separator />

              <div>
                <p className="text-sm text-muted-foreground">Account</p>
                <p className="font-medium">
                  {payment.accountCodeAtPayment} - {payment.accountNameAtPayment}
                </p>
              </div>

              {payment.reference && (
                <div>
                  <p className="text-sm text-muted-foreground">Reference</p>
                  <p className="font-medium">{payment.reference}</p>
                </div>
              )}

              {/* M-Pesa details */}
              {payment.mpesaReceipt && (
                <div>
                  <p className="text-sm text-muted-foreground">M-Pesa Code</p>
                  <p className="font-mono font-medium">{payment.mpesaReceipt}</p>
                </div>
              )}
              {payment.mpesaPhone && (
                <div>
                  <p className="text-sm text-muted-foreground">Phone</p>
                  <p>{payment.mpesaPhone}</p>
                </div>
              )}

              {/* Bank details */}
              {payment.bankName && (
                <div>
                  <p className="text-sm text-muted-foreground">Bank</p>
                  <p>{payment.bankName}</p>
                </div>
              )}
              {payment.chequeNumber && (
                <div>
                  <p className="text-sm text-muted-foreground">Cheque #</p>
                  <p>{payment.chequeNumber}</p>
                </div>
              )}
              {payment.bankReference && (
                <div>
                  <p className="text-sm text-muted-foreground">Bank Ref</p>
                  <p>{payment.bankReference}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Accounting */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Accounting</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground">Fiscal Period</p>
                {/* Derived from the payment date, not stored. Mongo kept a
                    `fiscalPeriod` string alongside the date, which is one fact
                    written twice — and the two disagree the moment a payment's
                    date is corrected without the string being recomputed. */}
                <p className="font-medium">
                  {payment.paymentDate ? String(payment.paymentDate).slice(0, 7) : "-"}
                </p>
              </div>

              {payment.journalEntryId && (
                <div>
                  <p className="text-sm text-muted-foreground">Journal Entry</p>
                  <Link
                    href={`/dashboard/journal/${payment.journalEntryId}`}
                    className="text-primary hover:underline font-medium"
                  >
                    View Entry
                  </Link>
                </div>
              )}

              <Separator />

              <div>
                <p className="text-sm text-muted-foreground">Cleared</p>
                <p className="font-medium">
                  {payment.status === "pending_clearance"
                    ? "Awaiting clearance"
                    : payment.status === "confirmed"
                      ? "Yes"
                      : "-"}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Audit */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Audit Trail</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground">Created By</p>
                <p className="font-medium">{payment.createdByName || "-"}</p>
                {payment.createdAt && (
                  <p className="text-xs text-muted-foreground">
                    {new Date(payment.createdAt).toLocaleString("en-KE")}
                  </p>
                )}
              </div>

              {payment.confirmedAt && (
                <div>
                  <p className="text-muted-foreground">Confirmed By</p>
                  <p className="font-medium">{payment.confirmedByName || "-"}</p>
                  {payment.confirmedAt && (
                    <p className="text-xs text-muted-foreground">
                      {new Date(payment.confirmedAt).toLocaleString("en-KE")}
                    </p>
                  )}
                </div>
              )}

              {payment.cancelledAt && (
                <div>
                  <p className="text-muted-foreground">Cancelled By</p>
                  <p className="font-medium">{payment.cancelledByName || "-"}</p>
                  {payment.cancellationReason && (
                    <p className="text-xs text-muted-foreground">
                      Reason: {payment.cancellationReason}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
