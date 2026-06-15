import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getBillById } from "@/app/mongodb/queries/bill-queries";
import Account from "@/app/models/account";
import dbConnect from "@/app/config/dbConnect";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Download,
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
  BookOpen,
} from "lucide-react";
import { BillDetailActions } from "../components/BillDetailActions";

export async function generateMetadata({ params }) {
  const resolvedParams = await params;
  const { bill } = await getBillById(resolvedParams.id);

  if (!bill) {
    return { title: "Bill Not Found" };
  }

  return {
    title: `${bill.billNumber} | Bills`,
    description: `Bill details for ${bill.supplier?.name}`,
  };
}

export default async function BillDetailsPage({ params }) {
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
            You don&apos;t have permission to view bills.
          </p>
        </div>
      </div>
    );
  }

  const { bill, error } = await getBillById(resolvedParams.id);

  if (error || !bill) {
    notFound();
  }

  // Fetch payment accounts (cash, bank, mpesa) for payment dialog (tenant-scoped)
  await dbConnect();
  const paymentAccounts = await Account.find({
    companyId: user.companyId,
    accountType: "asset",
    subType: { $in: ["cash", "bank", "mpesa"] },
    isActive: { $ne: false },
    canPost: true,
  })
    .select("_id accountCode accountName subType")
    .sort({ accountCode: 1 })
    .lean();

  const serializedPaymentAccounts = paymentAccounts.map((a) => ({
    _id: a._id.toString(),
    accountCode: a.accountCode,
    accountName: a.accountName,
    subType: a.subType,
  }));

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
      submitted: {
        label: "Pending Approval",
        className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20",
        icon: Clock,
      },
      approved: {
        label: "Approved",
        className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
        icon: CheckCircle,
      },
      rejected: {
        label: "Rejected",
        className: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20",
        icon: XCircle,
      },
      cancelled: {
        label: "Cancelled",
        className: "bg-muted text-muted-foreground",
        icon: XCircle,
      },
    };
    return configs[status] || configs.draft;
  };

  const getPaymentStatusConfig = (paymentStatus, isOverdue) => {
    if (paymentStatus === "paid") {
      return {
        label: "Paid",
        className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
        icon: CheckCircle,
      };
    }
    if (isOverdue) {
      return {
        label: "Overdue",
        className: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20",
        icon: AlertCircle,
      };
    }
    if (paymentStatus === "partial") {
      return {
        label: "Partial",
        className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20",
        icon: Clock,
      };
    }
    return {
      label: "Unpaid",
      className: "bg-muted text-muted-foreground",
      icon: Clock,
    };
  };

  const isOverdue =
    bill.status === "approved" &&
    bill.paymentStatus !== "paid" &&
    bill.dueDate &&
    new Date(bill.dueDate) < new Date();

  const statusConfig = getStatusConfig(bill.status);
  const paymentConfig = getPaymentStatusConfig(bill.paymentStatus, isOverdue);
  const StatusIcon = statusConfig.icon;
  const PaymentIcon = paymentConfig.icon;

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
          <Link href="/dashboard/bills">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Bills
          </Link>
        </Button>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h1 className="text-3xl font-bold text-foreground">
                {bill.billNumber}
              </h1>
              <Badge variant="outline" className={statusConfig.className}>
                <StatusIcon className="mr-1 h-3 w-3" />
                {statusConfig.label}
              </Badge>
              {bill.status === "approved" && (
                <Badge variant="outline" className={paymentConfig.className}>
                  <PaymentIcon className="mr-1 h-3 w-3" />
                  {paymentConfig.label}
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground">
              Bill from {bill.supplier?.name}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2">
            {bill.canEdit && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/dashboard/bills/${bill._id}/edit`}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </Link>
              </Button>
            )}
            {bill.status === "approved" &&
              (bill.lines || []).some((l) => l.product?.id) &&
              [
                "SuperAdmin",
                "Admin",
                "Manager",
                "Store Manager",
                "Storekeeper",
              ].includes(user.role) && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/dashboard/grn/create?fromBill=${bill._id}`}>
                    <Edit className="mr-2 h-4 w-4" />
                    Receive Goods (GRN)
                  </Link>
                </Button>
              )}
            <Button variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" />
              PDF
            </Button>
            <Button variant="outline" size="sm">
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
          </div>
        </div>
      </div>

      {/* Alert Banners */}
      {bill.status === "rejected" && bill.rejectionReason && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-start gap-3">
          <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-red-600 dark:text-red-400">
              Bill Rejected
            </p>
            <p className="text-sm text-red-600/80 dark:text-red-400/80 mt-1">
              {bill.rejectionReason}
            </p>
            {bill.rejectedBy && (
              <p className="text-xs text-red-600/60 dark:text-red-400/60 mt-2">
                By {bill.rejectedBy.name} on {formatDate(bill.rejectedAt)}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Three-way match: payment is blocked until goods are received & accepted */}
      {bill.status === "approved" &&
        bill.accounting?.usedGRNI === true &&
        bill.accounting?.inventoryMoved !== true && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-amber-700 dark:text-amber-400">
                Awaiting goods receipt
              </p>
              <p className="text-sm text-amber-700/80 dark:text-amber-400/80 mt-1">
                This bill posted to GR/IR clearing — inventory will be admitted
                and payment will unlock once a Goods Receipt Note is created
                and accepted by Sales + Finance.
              </p>
              <Link
                href={`/dashboard/grn/create?fromBill=${bill._id}`}
                className="text-xs text-amber-700 dark:text-amber-400 underline mt-2 inline-block"
              >
                Create Goods Receipt Note →
              </Link>
            </div>
          </div>
        )}

      {bill.status === "cancelled" && (
        <div className="bg-muted border rounded-lg p-4 flex items-start gap-3">
          <XCircle className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">Bill Cancelled</p>
            <p className="text-sm text-muted-foreground mt-1">
              {bill.cancellationReason || "This bill has been cancelled."}
            </p>
            {bill.cancelledBy && (
              <p className="text-xs text-muted-foreground mt-2">
                By {bill.cancelledBy.name} on {formatDate(bill.cancelledAt)}
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
              Payment Overdue
            </p>
            <p className="text-sm text-red-600/80 dark:text-red-400/80 mt-1">
              This bill was due on {formatDate(bill.dueDate)}. Balance: {formatCurrency(bill.amounts?.balance)}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Bill Details Card */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                Bill Details
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Bill Date</span>
                  </div>
                  <p className="font-medium">{formatDate(bill.billDate)}</p>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Due Date</span>
                  </div>
                  <p className={`font-medium ${isOverdue ? "text-destructive" : ""}`}>
                    {formatDate(bill.dueDate)}
                  </p>
                </div>

                {bill.supplierInvoiceNumber && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Receipt className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Supplier Invoice #
                      </span>
                    </div>
                    <p className="font-medium">{bill.supplierInvoiceNumber}</p>
                  </div>
                )}

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Created By</span>
                  </div>
                  <p className="font-medium">{bill.createdBy?.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(bill.createdAt)}
                  </p>
                </div>

                {bill.accounting?.journalEntryId && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <BookOpen className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Journal Entry</span>
                    </div>
                    <Link
                      href={`/dashboard/journal/${bill.accounting.journalEntryId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      View Journal Entry
                    </Link>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <Package className="w-5 h-5 text-blue-500" />
                Line Items ({bill.lines?.length || 0})
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
                        Description
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        Account
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                        Qty
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
                    {bill.lines?.map((line, index) => (
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
                                  <span className="font-mono">{line.product.sku} - </span>
                                )}
                                {line.product.name}
                              </p>
                            )}
                            {line.asset?.id && (
                              <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                                <span className="font-mono">
                                  {line.asset.assetNumber}
                                </span>
                                <span>· {line.asset.name}</span>
                              </p>
                            )}
                            {line.account?.type === "asset" &&
                              ["SuperAdmin", "Admin", "Accountant"].includes(user.role) &&
                              !["cancelled", "rejected"].includes(
                                bill.status
                              ) && (
                                <div className="mt-1.5">
                                  {line.capitalizedAssetId ? (
                                    <Link
                                      href={`/dashboard/assets/${line.capitalizedAssetId}`}
                                      className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-500/15 dark:border-emerald-900 dark:text-emerald-400"
                                    >
                                      View Asset →
                                    </Link>
                                  ) : line._id ? (
                                    <Link
                                      href={`/dashboard/assets/create?fromBillLine=${bill._id}:${line._id}`}
                                      className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-500/15 dark:border-blue-900 dark:text-blue-400"
                                    >
                                      Capitalize →
                                    </Link>
                                  ) : null}
                                </div>
                              )}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-sm">
                          <span className="font-mono text-xs">{line.account?.code}</span>
                          <p className="text-xs text-muted-foreground">{line.account?.name}</p>
                        </td>
                        <td className="px-4 py-4 text-sm text-right">
                          {line.quantity} {line.unit}
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

          {/* Notes */}
          {(bill.description || bill.internalNotes) && (
            <Card>
              <CardHeader className="border-b">
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                {bill.description && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      Description
                    </p>
                    <p className="text-sm whitespace-pre-wrap">{bill.description}</p>
                  </div>
                )}
                {bill.internalNotes && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      Internal Notes
                    </p>
                    <p className="text-sm whitespace-pre-wrap">{bill.internalNotes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Payment History */}
          {bill.payments && bill.payments.length > 0 && (
            <Card>
              <CardHeader className="border-b">
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-green-500" />
                  Payment History
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {bill.payments.map((payment, index) => (
                    <div key={index} className="p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{payment.paymentNumber}</p>
                        <p className="text-sm text-muted-foreground">
                          {payment.method} • {payment.reference || "No reference"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(payment.date)}
                        </p>
                      </div>
                      <p className="font-semibold text-green-600 dark:text-green-400">
                        {formatCurrency(payment.amount)}
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
                <p className="font-semibold text-lg">{bill.supplier?.name}</p>
              </div>
              <Separator />
              {bill.supplier?.taxPin && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Tax PIN</p>
                  <p className="text-sm font-mono">{bill.supplier.taxPin}</p>
                </div>
              )}
              {bill.supplier?.email && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Email</p>
                  <p className="text-sm">{bill.supplier.email}</p>
                </div>
              )}
              {bill.supplier?.phone && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Phone</p>
                  <p className="text-sm">{bill.supplier.phone}</p>
                </div>
              )}
              {bill.supplier?.address && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Address</p>
                  <p className="text-sm">{formatAddress(bill.supplier.address)}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Payment Summary */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-500" />
                Payment Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal:</span>
                <span className="font-medium">{formatCurrency(bill.amounts?.subtotal)}</span>
              </div>

              {bill.amounts?.vatTotal > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">VAT:</span>
                  <span className="font-medium">{formatCurrency(bill.amounts.vatTotal)}</span>
                </div>
              )}

              <Separator />

              <div className="flex justify-between">
                <span className="font-semibold">Total:</span>
                <span className="text-lg font-bold">{formatCurrency(bill.amounts?.total)}</span>
              </div>

              {bill.whtApplicable && bill.amounts?.whtAmount > 0 && (
                <>
                  <Separator />
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">WHT ({bill.whtRate}%):</span>
                    <span className="font-medium text-red-600 dark:text-red-400">
                      -{formatCurrency(bill.amounts.whtAmount)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Net Payable:</span>
                    <span className="font-medium">
                      {formatCurrency(bill.amounts?.total - bill.amounts?.whtAmount)}
                    </span>
                  </div>
                </>
              )}

              {bill.amounts?.paid > 0 && (
                <>
                  <Separator />
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Amount Paid:</span>
                    <span className="font-semibold text-green-600 dark:text-green-400">
                      {formatCurrency(bill.amounts.paid)}
                    </span>
                  </div>
                </>
              )}

              {bill.amounts?.balance > 0 && bill.status === "approved" && (
                <div className="flex justify-between p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                  <span className="font-semibold text-amber-700 dark:text-amber-400">
                    Balance Due:
                  </span>
                  <span className="text-lg font-bold text-amber-700 dark:text-amber-400">
                    {formatCurrency(bill.amounts.balance)}
                  </span>
                </div>
              )}

              {bill.paymentStatus === "paid" && (
                <div className="flex items-center justify-center gap-2 p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                  <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    Fully Paid
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <BillDetailActions
                bill={bill}
                userRole={user.role}
                paymentAccounts={serializedPaymentAccounts}
              />
            </CardContent>
          </Card>

          {/* Audit Trail */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="space-y-4 text-sm">
                {bill.approvedAt && (
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5" />
                    <div>
                      <p className="font-medium">Approved</p>
                      <p className="text-muted-foreground">
                        by {bill.approvedBy?.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(bill.approvedAt)}
                      </p>
                    </div>
                  </div>
                )}
                {bill.submittedAt && (
                  <div className="flex items-start gap-3">
                    <Send className="w-4 h-4 text-blue-500 mt-0.5" />
                    <div>
                      <p className="font-medium">Submitted</p>
                      <p className="text-muted-foreground">
                        by {bill.submittedBy?.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(bill.submittedAt)}
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex items-start gap-3">
                  <FileText className="w-4 h-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="font-medium">Created</p>
                    <p className="text-muted-foreground">by {bill.createdBy?.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(bill.createdAt)}
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
