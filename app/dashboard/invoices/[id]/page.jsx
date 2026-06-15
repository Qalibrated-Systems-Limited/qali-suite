import { auth } from "@/auth";
import { canSeeSalesNav } from "@/lib/permissions";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getInvoiceById } from "@/app/mongodb/queries/invoice-queries";
import { getCompanyById } from "@/app/mongodb/queries/company-queries";
import { serializeBsonType, formatAddress } from "@/lib/utils";
import Account from "@/app/models/account";
import dbConnect from "@/app/config/dbConnect";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Mail,
  Printer,
  DollarSign,
  XCircle,
  CheckCircle,
  Clock,
  FileText,
  User,
  Calendar,
  CreditCard,
  Package,
  Wrench,
  AlertCircle,
} from "lucide-react";
import { InvoiceDetailActions } from "../components/InvoiceDetailActions";
import { InvoicePDFDownloadButton } from "../components/InvoicePDFButton";
import { DeliveryNotePDFButton } from "../components/DeliveryNotePDFButton";

export default async function InvoiceDetailsPage({ params }) {
  const resolvedParams = await params;
  const session = await auth();

  const { user } = session;

  // Check permissions
  // Same gate that surfaces the Sales nav link (was Admin/Accountant only).
  if (!canSeeSalesNav(user.role)) {
    return (
      <div className="flex min-h-100 items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Access Denied
          </h2>
          <p className="text-muted-foreground">
            You don&apos;t have permission to view invoices.
          </p>
        </div>
      </div>
    );
  }

  let invoice = await getInvoiceById(resolvedParams.id);

  if (!invoice) {
    notFound();
  }

  // Serialize BSON types (ObjectId, Date) for client components
  invoice = serializeBsonType(invoice);

  // Fetch company data for PDF generation
  let company = null;
  if (user.companyId) {
    company = await getCompanyById(user.companyId);
    if (company) {
      company = serializeBsonType(company);
    }
  }

  // Fetch payment accounts for the payment dialog (tenant-scoped)
  await dbConnect();
  const paymentAccounts = await Account.find({
    companyId: user.companyId,
    accountType: "asset",
    subType: { $in: ["cash", "bank", "mpesa"] },
    isActive: true,
  })
    .select("_id accountName accountCode subType")
    .sort({ accountName: 1 })
    .lean();

  // Serialize for client component
  const serializedPaymentAccounts = paymentAccounts.map((acc) => ({
    _id: acc._id.toString(),
    name: acc.accountName,
    code: acc.accountCode,
    subType: acc.subType,
  }));

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const getPaymentStatusColor = (status) => {
    switch (status) {
      case "paid":
        return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20";
      case "unpaid":
        return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
      case "partial":
        return "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20";
      case "overdue":
        return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20";
      default:
        return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20";
    }
  };

  const getInvoiceStatusColor = (status) => {
    switch (status) {
      case "paid":
        return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20";
      case "sent":
        return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
      case "draft":
        return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20";
      case "cancelled":
        return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
      default:
        return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20";
    }
  };

  const balanceDue = invoice.total - invoice.amountPaid;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit text-muted-foreground hover:text-foreground"
          asChild
        >
          <Link href="/dashboard/invoices">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Invoices
          </Link>
        </Button>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-foreground">
                {invoice.invoiceNumber}
              </h1>
              <Badge
                variant="outline"
                className={getInvoiceStatusColor(invoice.status)}
              >
                {invoice.status}
              </Badge>
              <Badge
                variant="outline"
                className={getPaymentStatusColor(invoice.paymentStatus)}
              >
                {invoice.paymentStatus}
              </Badge>
            </div>
            <p className="text-muted-foreground">
              Invoice details and line items
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2">
            <InvoicePDFDownloadButton invoice={invoice} company={company} />
            {invoice.status === "completed" && (
              <DeliveryNotePDFButton invoice={invoice} company={company} />
            )}
            <Button
              variant="outline"
              size="sm"
              className="border-border hover:bg-accent"
            >
              <Mail className="mr-2 h-4 w-4" />
              Send Email
            </Button>
            {/* <Button
              variant="outline"
              size="sm"
              className="border-border hover:bg-accent"
            >
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button> */}
          </div>
        </div>
      </div>

      {/* Alert for Overdue or Balance */}
      {balanceDue > 0 && invoice.paymentStatus !== "paid" && (
        <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-orange-600 dark:text-orange-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-orange-600 dark:text-orange-400">
              Payment Pending
            </p>
            <p className="text-sm text-orange-600/80 dark:text-orange-400/80 mt-1">
              Balance due: {formatCurrency(balanceDue)}
              {invoice.dueDate && ` • Due by ${formatDate(invoice.dueDate)}`}
            </p>
          </div>
        </div>
      )}

      {invoice.status === "cancelled" && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-start gap-3">
          <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-red-600 dark:text-red-400">
              Invoice Cancelled
            </p>
            <p className="text-sm text-red-600/80 dark:text-red-400/80 mt-1">
              This invoice has been cancelled. Stock has been restored.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Invoice Details Card */}
          <Card className="bg-card border-border">
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center gap-2 text-foreground">
                <FileText className="w-5 h-5 text-yellow-500" />
                Invoice Details
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Invoice Date
                    </span>
                  </div>
                  <p className="text-foreground font-medium">
                    {formatDate(invoice.invoiceDate)}
                  </p>
                </div>

                {invoice.dueDate && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Due Date
                      </span>
                    </div>
                    <p className="text-foreground font-medium">
                      {formatDate(invoice.dueDate)}
                    </p>
                  </div>
                )}

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <CreditCard className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Payment Method
                    </span>
                  </div>
                  <p className="text-foreground font-medium">
                    {invoice.paymentMethod || "Not specified"}
                  </p>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Created By
                    </span>
                  </div>
                  <p className="text-foreground font-medium">
                    {invoice.createdBy.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {invoice.createdBy.role}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card className="bg-card border-border">
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center gap-2 text-foreground">
                <Package className="w-5 h-5 text-blue-500" />
                Items & Services
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/50 border-b border-border">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        #
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        Item
                      </th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-muted-foreground uppercase">
                        Unit
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                        Qty
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                        Price
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {invoice.items.map((item, index) => (
                      <tr key={index} className="hover:bg-muted/30">
                        <td className="px-6 py-4 text-sm text-muted-foreground">
                          {index + 1}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-start gap-2">
                            {item.type === "stock" ? (
                              <Package className="w-4 h-4 text-blue-500 mt-0.5 hrink-0" />
                            ) : (
                              <Wrench className="w-4 h-4 text-purple-500 mt-0.5 shrink-0" />
                            )}
                            <div>
                              <p className="font-medium text-foreground">
                                {item.name}
                              </p>
                              {item.description && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {item.description}
                                </p>
                              )}
                              {item.SKU && (
                                <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-0.5 font-mono">
                                  SKU: {item.SKU}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-center text-foreground">
                          {item.unit}
                        </td>
                        <td className="px-6 py-4 text-sm text-right text-foreground">
                          {item.quantity}
                        </td>
                        <td className="px-6 py-4 text-sm text-right text-foreground">
                          {formatCurrency(item.unitPrice)}
                        </td>
                        <td className="px-6 py-4 text-sm text-right font-semibold text-foreground">
                          {formatCurrency(item.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          {invoice.notes && (
            <Card className="bg-card border-border">
              <CardHeader className="border-b border-border">
                <CardTitle className="text-foreground">Notes</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {invoice.notes}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Customer Info */}
          <Card className="bg-card border-border">
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center gap-2 text-foreground">
                <User className="w-5 h-5 text-yellow-500" />
                Customer
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-3">
              <div>
                <p className="font-semibold text-foreground text-lg">
                  {invoice.customer.name}
                </p>
              </div>
              <Separator />
              {invoice.customer.email && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Email</p>
                  <p className="text-sm text-foreground">
                    {invoice.customer.email}
                  </p>
                </div>
              )}
              {invoice.customer.phone && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Phone</p>
                  <p className="text-sm text-foreground">
                    {invoice.customer.phone}
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground mb-1">Address</p>
                <p className="text-sm text-foreground">
                  {formatAddress(invoice.customer.address)}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Payment Summary */}
          <Card className="bg-card border-border">
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center gap-2 text-foreground">
                <DollarSign className="w-5 h-5 text-green-500" />
                Payment Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal:</span>
                <span className="font-medium text-foreground">
                  {formatCurrency(invoice.subtotal)}
                </span>
              </div>

              {(invoice.totalDiscount > 0 || invoice.discountAmount > 0) && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Discount:
                  </span>
                  <span className="font-medium text-red-600 dark:text-red-400">
                    -{formatCurrency(invoice.totalDiscount || invoice.discountAmount || 0)}
                  </span>
                </div>
              )}

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  VAT:
                </span>
                <span className="font-medium text-foreground">
                  {formatCurrency(invoice.taxAmount || 0)}
                </span>
              </div>

              <Separator />

              <div className="flex justify-between">
                <span className="font-semibold text-foreground">Total:</span>
                <span className="text-lg font-bold text-foreground">
                  {formatCurrency(invoice.total)}
                </span>
              </div>

              {invoice.amountPaid > 0 && (
                <>
                  <Separator />
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Amount Paid:</span>
                    <span className="font-semibold text-green-600 dark:text-green-400">
                      {formatCurrency(invoice.amountPaid)}
                    </span>
                  </div>
                </>
              )}

              {balanceDue > 0 && (
                <div className="flex justify-between p-3 bg-orange-500/10 rounded-lg border border-orange-500/20">
                  <span className="font-semibold text-orange-600 dark:text-orange-400">
                    Balance Due:
                  </span>
                  <span className="text-lg font-bold text-orange-600 dark:text-orange-400">
                    {formatCurrency(balanceDue)}
                  </span>
                </div>
              )}

              {invoice.paymentStatus === "paid" && (
                <div className="flex items-center justify-center gap-2 p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                  <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
                  <span className="font-semibold text-green-600 dark:text-green-400">
                    Fully Paid
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          {invoice.status !== "cancelled" && (
            <Card className="bg-card border-border">
              <CardHeader className="border-b border-border">
                <CardTitle className="text-foreground">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <InvoiceDetailActions
                  invoice={invoice}
                  userRole={user.role}
                  userId={user.id}
                  paymentAccounts={serializedPaymentAccounts}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
