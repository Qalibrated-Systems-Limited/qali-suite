import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getPurchaseOrderById } from "@/app/mongodb/queries/purchase-order-queries";
import { getCompanyById } from "@/app/mongodb/queries/company-queries";
import { serializeBsonType, formatAddress } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Printer,
  Edit,
  DollarSign,
  XCircle,
  CheckCircle,
  Clock,
  FileText,
  User,
  Calendar,
  Building2,
  Package,
  AlertCircle,
  Send,
  Receipt,
  Truck,
} from "lucide-react";
import { PODetailActions } from "../components/PODetailActions";
import { POPDFDownloadButton } from "../components/POPDFButton";

export async function generateMetadata({ params }) {
  const resolvedParams = await params;
  const po = await getPurchaseOrderById(resolvedParams.id);

  if (!po) {
    return { title: "Purchase Order Not Found" };
  }

  return {
    title: `${po.poNumber} | Purchase Orders`,
    description: `Purchase order details for ${po.supplier?.name}`,
  };
}

export default async function PurchaseOrderDetailPage({ params }) {
  const resolvedParams = await params;
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;

  // Check permissions
  if (!["SuperAdmin", "Admin", "Manager", "Accountant"].includes(user.role)) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Access Denied
          </h2>
          <p className="text-muted-foreground">
            You don&apos;t have permission to view purchase orders.
          </p>
        </div>
      </div>
    );
  }

  let po = await getPurchaseOrderById(resolvedParams.id);

  if (!po) {
    notFound();
  }

  // Serialize BSON types for client components
  po = serializeBsonType(po);

  // Fetch company data for PDF generation
  let company = null;
  if (user.companyId) {
    company = await getCompanyById(user.companyId);
    if (company) {
      company = serializeBsonType(company);
    }
  }

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(amount || 0);
  };

  const formatDate = (dateString) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-KE", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const getStatusConfig = (status) => {
    const configs = {
      draft: {
        label: "Draft",
        className: "bg-secondary text-secondary-foreground",
        icon: FileText,
      },
      sent: {
        label: "Sent",
        className:
          "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20",
        icon: Send,
      },
      confirmed: {
        label: "Confirmed",
        className:
          "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20",
        icon: CheckCircle,
      },
      partial: {
        label: "Partially Received",
        className:
          "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20",
        icon: Package,
      },
      received: {
        label: "Fully Received",
        className:
          "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
        icon: CheckCircle,
      },
      cancelled: {
        label: "Cancelled",
        className:
          "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20",
        icon: XCircle,
      },
      expired: {
        label: "Expired",
        className: "bg-muted text-muted-foreground",
        icon: Clock,
      },
    };
    return configs[status] || configs.draft;
  };

  const isOverdue =
    po.expectedDeliveryDate &&
    new Date(po.expectedDeliveryDate) < new Date() &&
    ["sent", "confirmed", "partial"].includes(po.status);

  const statusConfig = getStatusConfig(po.status);
  const StatusIcon = statusConfig.icon;

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
          <Link href="/dashboard/purchase-orders">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Purchase Orders
          </Link>
        </Button>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h1 className="text-3xl font-bold text-foreground">
                {po.poNumber}
              </h1>
              <Badge variant="outline" className={statusConfig.className}>
                <StatusIcon className="mr-1 h-3 w-3" />
                {statusConfig.label}
              </Badge>
            </div>
            <p className="text-muted-foreground">
              Purchase order for {po.supplier?.name}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2">
            {po.status === "draft" && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/dashboard/purchase-orders/${po._id}/update`}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </Link>
              </Button>
            )}
            <POPDFDownloadButton purchaseOrder={po} company={company} />
            <Button variant="outline" size="sm">
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
          </div>
        </div>
      </div>

      {/* Alert Banners */}
      {po.status === "cancelled" && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-start gap-3">
          <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-red-600 dark:text-red-400">
              Purchase Order Cancelled
            </p>
            {po.cancellationReason && (
              <p className="text-sm text-red-600/80 dark:text-red-400/80 mt-1">
                {po.cancellationReason}
              </p>
            )}
            {po.cancelledBy && (
              <p className="text-xs text-red-600/60 dark:text-red-400/60 mt-2">
                By {po.cancelledBy.name} on {formatDate(po.cancelledAt)}
              </p>
            )}
          </div>
        </div>
      )}

      {isOverdue && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-red-600 dark:text-red-400">
              Delivery Overdue
            </p>
            <p className="text-sm text-red-600/80 dark:text-red-400/80 mt-1">
              Expected delivery was {formatDate(po.expectedDeliveryDate)}.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* PO Details Card */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                Order Details
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      PO Date
                    </span>
                  </div>
                  <p className="font-medium">{formatDate(po.poDate)}</p>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Truck className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Expected Delivery
                    </span>
                  </div>
                  <p
                    className={`font-medium ${
                      isOverdue ? "text-destructive" : ""
                    }`}
                  >
                    {formatDate(po.expectedDeliveryDate)}
                  </p>
                </div>

                {po.validUntil && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Valid Until
                      </span>
                    </div>
                    <p className="font-medium">{formatDate(po.validUntil)}</p>
                  </div>
                )}

                {po.reference && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Receipt className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Reference #
                      </span>
                    </div>
                    <p className="font-medium">{po.reference}</p>
                  </div>
                )}

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Created By
                    </span>
                  </div>
                  <p className="font-medium">{po.createdBy?.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(po.createdAt)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <Package className="w-5 h-5 text-blue-500" />
                Line Items ({po.lines?.length || 0})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        #
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        Product
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                        Qty
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                        Received
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                        Price
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                        VAT
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {po.lines?.map((line, index) => (
                      <tr key={index} className="hover:bg-muted/30">
                        <td className="px-4 py-4 text-sm text-muted-foreground">
                          {line.lineNumber || index + 1}
                        </td>
                        <td className="px-4 py-4">
                          <div>
                            <p className="font-medium">{line.description}</p>
                            {line.product?.name && (
                              <p className="text-xs text-muted-foreground">
                                {line.product.sku && (
                                  <span className="font-mono">
                                    {line.product.sku} -{" "}
                                  </span>
                                )}
                                {line.product.name}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-sm text-right">
                          {line.quantity} {line.unit}
                        </td>
                        <td className="px-4 py-4 text-sm text-right">
                          <span
                            className={
                              line.receivedQuantity >= line.quantity
                                ? "text-green-600 dark:text-green-400"
                                : line.receivedQuantity > 0
                                  ? "text-amber-600 dark:text-amber-400"
                                  : ""
                            }
                          >
                            {line.receivedQuantity || 0}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-sm text-right">
                          {formatCurrency(line.unitPrice)}
                        </td>
                        <td className="px-4 py-4 text-sm text-right">
                          {line.vat?.rate > 0 ? (
                            <>
                              <span>{line.vat.rate}%</span>
                              <p className="text-xs text-muted-foreground">
                                {formatCurrency(line.vat.amount)}
                              </p>
                            </>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-sm text-right font-semibold">
                          {formatCurrency(line.lineTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Delivery Address & Notes */}
          {(po.deliveryAddress || po.notes || po.terms) && (
            <Card>
              <CardHeader className="border-b">
                <CardTitle>Additional Information</CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                {po.deliveryAddress && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      Delivery Address
                    </p>
                    <p className="text-sm whitespace-pre-wrap">
                      {po.deliveryAddress}
                    </p>
                  </div>
                )}
                {po.notes && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      Notes
                    </p>
                    <p className="text-sm whitespace-pre-wrap">{po.notes}</p>
                  </div>
                )}
                {po.terms && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      Terms & Conditions
                    </p>
                    <p className="text-sm whitespace-pre-wrap">{po.terms}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Linked Bills */}
          {po.linkedBills && po.linkedBills.length > 0 && (
            <Card>
              <CardHeader className="border-b">
                <CardTitle className="flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-purple-500" />
                  Linked Bills ({po.linkedBills.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {po.linkedBills.map((bill, index) => (
                    <div
                      key={index}
                      className="p-4 flex items-center justify-between"
                    >
                      <div>
                        <Link
                          href={`/dashboard/bills/${bill.billId}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {bill.billNumber}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(bill.date)}
                        </p>
                      </div>
                      <p className="font-semibold">
                        {formatCurrency(bill.amount)}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Supplier Info */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-primary" />
                Supplier
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-3">
              <div>
                <p className="font-semibold text-lg">{po.supplier?.name}</p>
              </div>
              <Separator />
              {po.supplier?.taxPin && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Tax PIN</p>
                  <p className="text-sm font-mono">{po.supplier.taxPin}</p>
                </div>
              )}
              {po.supplier?.email && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Email</p>
                  <p className="text-sm">{po.supplier.email}</p>
                </div>
              )}
              {po.supplier?.phone && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Phone</p>
                  <p className="text-sm">{po.supplier.phone}</p>
                </div>
              )}
              {po.supplier?.address && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Address</p>
                  <p className="text-sm">{formatAddress(po.supplier.address)}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Order Summary */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-500" />
                Order Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal:</span>
                <span className="font-medium">
                  {formatCurrency(po.amounts?.subtotal)}
                </span>
              </div>

              {po.amounts?.vatTotal > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">VAT:</span>
                  <span className="font-medium">
                    {formatCurrency(po.amounts.vatTotal)}
                  </span>
                </div>
              )}

              <Separator />

              <div className="flex justify-between">
                <span className="font-semibold">Total:</span>
                <span className="text-lg font-bold">
                  {formatCurrency(po.amounts?.total)}
                </span>
              </div>

              {po.whtApplicable && po.whtRate > 0 && (
                <>
                  <Separator />
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      WHT ({po.whtRate}%):
                    </span>
                    <span className="font-medium text-red-600 dark:text-red-400">
                      -
                      {formatCurrency(
                        (po.amounts?.subtotal || 0) * (po.whtRate / 100),
                      )}
                    </span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <PODetailActions purchaseOrder={po} userRole={user.role} />
            </CardContent>
          </Card>

          {/* Activity */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="space-y-4 text-sm">
                {po.receivedAt && (
                  <div className="flex items-start gap-3">
                    <Package className="w-4 h-4 text-emerald-500 mt-0.5" />
                    <div>
                      <p className="font-medium">Fully Received</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(po.receivedAt)}
                      </p>
                    </div>
                  </div>
                )}
                {po.confirmedAt && (
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-4 h-4 text-green-500 mt-0.5" />
                    <div>
                      <p className="font-medium">Confirmed</p>
                      <p className="text-muted-foreground">
                        by {po.confirmedBy?.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(po.confirmedAt)}
                      </p>
                    </div>
                  </div>
                )}
                {po.sentAt && (
                  <div className="flex items-start gap-3">
                    <Send className="w-4 h-4 text-blue-500 mt-0.5" />
                    <div>
                      <p className="font-medium">Sent to Supplier</p>
                      <p className="text-muted-foreground">
                        by {po.sentBy?.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(po.sentAt)}
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex items-start gap-3">
                  <FileText className="w-4 h-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="font-medium">Created</p>
                    <p className="text-muted-foreground">
                      by {po.createdBy?.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(po.createdAt)}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
