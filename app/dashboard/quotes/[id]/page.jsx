import { auth } from "@/auth";
import { canSeeSalesNav } from "@/lib/permissions";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getQuoteById } from "@/app/mongodb/queries/quote-queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  FileText,
  User,
  Calendar,
  Clock,
  Package,
  ArrowLeft,
  Building,
  Mail,
  Phone,
} from "lucide-react";
import { formatCurrency, serializeBsonType, formatAddress } from "@/lib/utils";
import { QuoteDetailActions } from "../components/QuoteDetailActions";
import { QuoteItemsTable } from "../components/QuoteItemsTable";
import { getCompanyById } from "@/app/mongodb/queries/company-queries";

export default async function QuoteDetailPage({ params, searchParams }) {
  const session = await auth();
  const { id } = await params;
  const search = await searchParams;

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;

  // Check permissions
  // Single source of truth — same gate that surfaces the Sales nav link.
  // The previous inline ["Admin","Accountant","Sales","SuperAdmin"] both
  // listed a non-existent "Sales" role AND bounced CEO/CFO/Finance Manager/
  // Sales Manager who can see the link.
  if (!canSeeSalesNav(user.role)) {
    return (
      <div className="flex min-h-100 items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Access Denied
          </h2>
          <p className="text-muted-foreground">
            You don&apos;t have permission to view quotes.
          </p>
        </div>
      </div>
    );
  }

  const quote = await getQuoteById(id);

  if (!quote) {
    notFound();
  }

  let company = null;
  if (user.companyId) {
    company = await getCompanyById(user.companyId);
    if (company) {
      company = serializeBsonType(company);
    }
  }

  const formatDate = (dateString) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "draft":
        return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20";
      case "sent":
        return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
      case "accepted":
        return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20";
      case "rejected":
        return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
      case "converted":
        return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20";
      case "expired":
        return "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20";
      case "cancelled":
        return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
      default:
        return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20";
    }
  };

  const isExpired = quote.validUntil && new Date(quote.validUntil) < new Date();
  const isExpiringSoon =
    quote.validUntil &&
    !isExpired &&
    new Date(quote.validUntil) < new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Check if we should show convert dialog
  const showConvertDialog = search.convert === "true";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div className="space-y-2">
          <Link
            href="/dashboard/quotes"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to Quotes
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
              {quote.quoteNumber}
            </h1>
            <Badge variant="outline" className={getStatusColor(quote.status)}>
              {quote.status}
            </Badge>
            {isExpiringSoon && quote.status !== "expired" && (
              <Badge
                variant="outline"
                className="bg-orange-500/10 text-orange-600 border-orange-500/20"
              >
                Expiring Soon
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Created on {formatDate(quote.createdAt)}
            {quote.createdBy?.name && ` by ${quote.createdBy.name}`}
          </p>
        </div>

        {/* Actions - responsive */}
        <div className="w-full lg:w-auto">
          <QuoteDetailActions
          
            company={company}
            quote={quote}
            userRole={user.role}
            showConvertDialog={showConvertDialog}
          />
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Quote Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer Info */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <User className="w-5 h-5 text-yellow-500" />
                Customer
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="flex items-start gap-2">
                    <Building className="w-4 h-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">
                        {quote.customer?.name || "Unknown Customer"}
                      </p>
                      {quote.customer?.taxPin && (
                        <p className="text-xs text-muted-foreground">
                          PIN: {quote.customer.taxPin}
                        </p>
                      )}
                    </div>
                  </div>
                  {quote.customer?.address && (
                    <p className="text-sm text-muted-foreground pl-6">
                      {formatAddress(quote.customer.address)}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  {quote.customer?.email && (
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="w-4 h-4 text-muted-foreground" />
                      <a
                        href={`mailto:${quote.customer.email}`}
                        className="text-blue-500 hover:underline"
                      >
                        {quote.customer.email}
                      </a>
                    </div>
                  )}
                  {quote.customer?.phone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="w-4 h-4 text-muted-foreground" />
                      <a
                        href={`tel:${quote.customer.phone}`}
                        className="text-foreground hover:underline"
                      >
                        {quote.customer.phone}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quote Items */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Package className="w-5 h-5 text-blue-500" />
                Items
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 sm:p-6">
              <QuoteItemsTable items={quote.items || []} />
            </CardContent>
          </Card>

          {/* Notes & Terms */}
          {(quote.notes || quote.termsAndConditions) && (
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="w-5 h-5 text-gray-500" />
                  Notes & Terms
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {quote.notes && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                      Notes
                    </p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">
                      {quote.notes}
                    </p>
                  </div>
                )}
                {quote.notes && quote.termsAndConditions && <Separator />}
                {quote.termsAndConditions && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                      Terms & Conditions
                    </p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">
                      {quote.termsAndConditions}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Activity / Invoices */}
          {quote.invoices && quote.invoices.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="w-5 h-5 text-purple-500" />
                  Related Invoices
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {quote.invoices.map((inv, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                    >
                      <div>
                        <Link
                          href={`/dashboard/invoices/${inv.invoiceId}`}
                          className="font-medium text-yellow-600 dark:text-yellow-400 hover:underline"
                        >
                          {inv.invoiceNumber}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          Created {formatDate(inv.createdAt)}
                          {inv.createdBy?.name && ` by ${inv.createdBy.name}`}
                        </p>
                      </div>
                      <span className="text-sm font-semibold">
                        {formatCurrency(inv.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column - Summary */}
        <div className="space-y-6">
          {/* Quote Summary */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-lg">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Dates */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="w-4 h-4" />
                    Quote Date
                  </span>
                  <span className="text-foreground">
                    {formatDate(quote.quoteDate)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="w-4 h-4" />
                    Valid Until
                  </span>
                  <span
                    className={
                      isExpired
                        ? "text-red-500"
                        : isExpiringSoon
                          ? "text-orange-500"
                          : "text-foreground"
                    }
                  >
                    {formatDate(quote.validUntil)}
                  </span>
                </div>
              </div>

              <Separator />

              {/* Amounts */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="text-foreground">
                    {formatCurrency(quote.subtotal)}
                  </span>
                </div>
                {quote.totalDiscount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Discount</span>
                    <span className="text-red-500">
                      -{formatCurrency(quote.totalDiscount)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tax</span>
                  <span className="text-foreground">
                    {formatCurrency(quote.taxAmount)}
                  </span>
                </div>
                <Separator />
                <div className="flex justify-between text-lg font-bold">
                  <span>Total</span>
                  <span className="text-green-500">
                    {formatCurrency(quote.total)}
                  </span>
                </div>
              </div>

              {/* Invoiced Amount */}
              {quote.invoices && quote.invoices.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Invoiced</span>
                      <span className="text-purple-500">
                        {formatCurrency(
                          quote.invoices.reduce(
                            (sum, inv) => sum + (inv.amount || 0),
                            0,
                          ),
                        )}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Sales Person */}
          {quote.salesPerson && (
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-lg">Sales Person</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-medium text-foreground">
                  {quote.salesPerson.name}
                </p>
                {quote.salesPerson.commission?.rate > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Commission: {quote.salesPerson.commission.rate}%
                    {quote.salesPerson.commission.amount > 0 && (
                      <span className="ml-1">
                        ({formatCurrency(quote.salesPerson.commission.amount)})
                      </span>
                    )}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Audit Trail */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-lg">Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span className="text-foreground text-right">
                    {formatDate(quote.createdAt)}
                    {quote.createdBy?.name && (
                      <span className="block text-xs text-muted-foreground">
                        by {quote.createdBy.name}
                      </span>
                    )}
                  </span>
                </div>
                {quote.sentAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sent</span>
                    <span className="text-foreground text-right">
                      {formatDate(quote.sentAt)}
                      {quote.sentBy?.name && (
                        <span className="block text-xs text-muted-foreground">
                          by {quote.sentBy.name}
                        </span>
                      )}
                    </span>
                  </div>
                )}
                {quote.acceptedAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Accepted</span>
                    <span className="text-foreground text-right">
                      {formatDate(quote.acceptedAt)}
                      {quote.acceptedBy?.name && (
                        <span className="block text-xs text-muted-foreground">
                          by {quote.acceptedBy.name}
                        </span>
                      )}
                    </span>
                  </div>
                )}
                {quote.rejectedAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Rejected</span>
                    <span className="text-foreground text-right">
                      {formatDate(quote.rejectedAt)}
                      {quote.rejectionReason && (
                        <span className="block text-xs text-muted-foreground">
                          {quote.rejectionReason}
                        </span>
                      )}
                    </span>
                  </div>
                )}
                {quote.cancelledAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cancelled</span>
                    <span className="text-foreground text-right">
                      {formatDate(quote.cancelledAt)}
                      {quote.cancellationReason && (
                        <span className="block text-xs text-muted-foreground">
                          {quote.cancellationReason}
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
