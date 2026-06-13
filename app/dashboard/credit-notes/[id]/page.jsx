import { auth } from "@/auth";
import { canSeeSalesNav } from "@/lib/permissions";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCreditNoteById } from "@/app/mongodb/queries/credit-note-queries";
import { getCompanyById } from "@/app/mongodb/queries/company-queries";
import { serializeBsonType } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  ReceiptText,
  User,
  Calendar,
  FileText,
  Package,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
} from "lucide-react";
import { CreditNoteActions } from "../components/CreditNoteActions";
import { CreditNotePDFButton } from "../components/CreditNotePDFButton";

export default async function CreditNoteDetailPage({ params }) {
  const resolvedParams = await params;
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;

  // Same gate that surfaces the Sales nav link (was Admin/Accountant only).
  if (!canSeeSalesNav(user.role)) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Access Denied</h2>
          <p className="text-muted-foreground">
            You don&apos;t have permission to view credit notes.
          </p>
        </div>
      </div>
    );
  }

  let creditNote = await getCreditNoteById(resolvedParams.id);

  if (!creditNote) {
    notFound();
  }

  creditNote = serializeBsonType(creditNote);

  // Fetch company for PDF
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
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "issued":
        return "bg-green-500/10 text-green-600 border-green-500/20";
      case "applied":
        return "bg-blue-500/10 text-blue-600 border-blue-500/20";
      case "void":
        return "bg-red-500/10 text-red-600 border-red-500/20";
      default:
        return "bg-yellow-500/10 text-yellow-600 border-yellow-500/20";
    }
  };

  const getReasonLabel = (reason) => {
    const labels = {
      return: "Goods Returned",
      damaged: "Damaged Goods",
      overcharge: "Price Correction",
      cancellation: "Order Cancellation",
      discount: "Post-Sale Discount",
      defective: "Defective Goods",
      other: "Other",
    };
    return labels[reason] || reason;
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case "issued":
        return <CheckCircle className="w-4 h-4" />;
      case "void":
        return <XCircle className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

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
          <Link href="/dashboard/credit-notes">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Credit Notes
          </Link>
        </Button>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold">
                {creditNote.creditNoteNumber}
              </h1>
              <Badge variant="outline" className={getStatusColor(creditNote.status)}>
                {getStatusIcon(creditNote.status)}
                <span className="ml-1">{creditNote.status}</span>
              </Badge>
            </div>
            <p className="text-muted-foreground">
              Credit note for invoice{" "}
              <Link
                href={`/dashboard/invoices/${creditNote.invoice?.id}`}
                className="text-blue-600 hover:underline"
              >
                {creditNote.invoice?.invoiceNumber}
              </Link>
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <CreditNotePDFButton creditNote={creditNote} company={company} />
          </div>
        </div>
      </div>

      {/* Status Alerts */}
      {creditNote.status === "void" && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-start gap-3">
          <XCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-600">Credit Note Voided</p>
            <p className="text-sm text-red-600/80 mt-1">
              {creditNote.voidReason || "This credit note has been voided."}
            </p>
          </div>
        </div>
      )}

      {creditNote.status === "draft" && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-yellow-600">Draft Credit Note</p>
            <p className="text-sm text-yellow-600/80 mt-1">
              This credit note hasn't been issued yet. Issue it to apply the
              credit to the customer's account.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Credit Note Details */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <ReceiptText className="w-5 h-5 text-red-500" />
                Credit Note Details
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Credit Note Date
                    </span>
                  </div>
                  <p className="font-medium">
                    {formatDate(creditNote.creditNoteDate)}
                  </p>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Original Invoice
                    </span>
                  </div>
                  <Link
                    href={`/dashboard/invoices/${creditNote.invoice?.id}`}
                    className="font-medium text-blue-600 hover:underline"
                  >
                    {creditNote.invoice?.invoiceNumber}
                  </Link>
                </div>

                <div className="col-span-2">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Reason</span>
                  </div>
                  <Badge variant="outline" className="mb-2">
                    {getReasonLabel(creditNote.reason)}
                  </Badge>
                  <p className="text-sm text-muted-foreground">
                    {creditNote.reasonDescription}
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
                Credited Items
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        #
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        Item
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                        Qty
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                        Price
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                        Credit
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {creditNote.items?.map((item, index) => (
                      <tr key={index} className="hover:bg-muted/30">
                        <td className="px-6 py-4 text-sm text-muted-foreground">
                          {index + 1}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-start gap-2">
                            <Package className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                            <div>
                              <p className="font-medium">
                                {item.productName || item.description}
                              </p>
                              {item.productSKU && (
                                <p className="text-xs text-yellow-600 font-mono">
                                  SKU: {item.productSKU}
                                </p>
                              )}
                              {item.restoreInventory && (
                                <Badge
                                  variant="outline"
                                  className="mt-1 text-xs bg-green-500/10 text-green-600 border-green-500/20"
                                >
                                  Inventory Restored
                                </Badge>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-right">
                          {item.quantity} {item.unit}
                        </td>
                        <td className="px-6 py-4 text-sm text-right">
                          {formatCurrency(item.unitPrice)}
                        </td>
                        <td className="px-6 py-4 text-sm text-right font-semibold text-red-600">
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
          {creditNote.notes && (
            <Card>
              <CardHeader className="border-b">
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <p className="text-sm whitespace-pre-wrap">{creditNote.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Customer Info */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5 text-yellow-500" />
                Customer
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-3">
              <div>
                <p className="font-semibold text-lg">
                  {creditNote.customer?.name}
                </p>
              </div>
              <Separator />
              {creditNote.customer?.email && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Email</p>
                  <p className="text-sm">{creditNote.customer.email}</p>
                </div>
              )}
              {creditNote.customer?.phone && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Phone</p>
                  <p className="text-sm">{creditNote.customer.phone}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Credit Summary */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <ReceiptText className="w-5 h-5 text-red-500" />
                Credit Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal:</span>
                <span className="font-medium">
                  {formatCurrency(creditNote.subtotal)}
                </span>
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">VAT (16%):</span>
                <span className="font-medium">
                  {formatCurrency(creditNote.taxAmount)}
                </span>
              </div>

              <Separator />

              <div className="flex justify-between">
                <span className="font-semibold">Credit Total:</span>
                <span className="text-lg font-bold text-red-600">
                  {formatCurrency(creditNote.total)}
                </span>
              </div>

              {creditNote.status === "issued" && (
                <>
                  <Separator />
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Applied:</span>
                    <span className="font-medium text-green-600">
                      {formatCurrency(creditNote.amountApplied)}
                    </span>
                  </div>
                  <div className="flex justify-between p-3 bg-red-500/10 rounded-lg border border-red-500/20">
                    <span className="font-semibold text-red-600">
                      Remaining:
                    </span>
                    <span className="font-bold text-red-600">
                      {formatCurrency(creditNote.amountRemaining)}
                    </span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          {creditNote.status !== "void" && (
            <Card>
              <CardHeader className="border-b">
                <CardTitle>Actions</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <CreditNoteActions
                  creditNote={creditNote}
                  userRole={user.role}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
