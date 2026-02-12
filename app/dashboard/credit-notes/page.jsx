import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  getCreditNotes,
  getCreditNoteStats,
} from "@/app/mongodb/queries/credit-note-queries";
import { serializeBsonType } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ReceiptText,
  FileText,
  Clock,
  CheckCircle,
  XCircle,
  ArrowRight,
  TrendingDown,
} from "lucide-react";

export const metadata = {
  title: "Credit Notes | ERP System",
  description: "Manage credit notes",
};

export default async function CreditNotesPage({ searchParams }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;

  if (!["Admin", "Accountant"].includes(user.role)) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Access Denied</h2>
          <p className="text-muted-foreground">
            Only Admins and Accountants can view credit notes.
          </p>
        </div>
      </div>
    );
  }

  const params = await searchParams;
  const filters = {
    status: params.status || "all",
    search: params.search || "",
  };

  // Fetch data
  const [statsResult, creditNotesResult] = await Promise.all([
    getCreditNoteStats(),
    getCreditNotes(filters, 50),
  ]);

  const stats = serializeBsonType(statsResult);
  const { creditNotes } = serializeBsonType(creditNotesResult);

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
      month: "short",
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
      return: "Return",
      damaged: "Damaged",
      overcharge: "Overcharge",
      cancellation: "Cancellation",
      discount: "Discount",
      defective: "Defective",
      other: "Other",
    };
    return labels[reason] || reason;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Credit Notes</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage customer credit notes and refunds
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Draft
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.draft?.count || 0}</div>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(stats.draft?.total)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500" />
              Issued
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.issued?.count || 0}</div>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(stats.issued?.total)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-500" />
              Applied
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.applied?.count || 0}</div>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(stats.applied?.total)}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-red-500/5 border-red-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-red-600 flex items-center gap-2">
              <TrendingDown className="w-4 h-4" />
              Total Credits
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {formatCurrency(stats.totalValue)}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats.totalCount} credit notes
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Credit Notes List */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <ReceiptText className="w-5 h-5 text-red-500" />
            Credit Notes
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {creditNotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ReceiptText className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-1">No credit notes</h3>
              <p className="text-muted-foreground text-sm max-w-md">
                Credit notes can be issued from completed invoices to credit
                customers for returns, damages, or price corrections.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                      Credit Note
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                      Invoice
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                      Customer
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                      Reason
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                      Date
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                      Amount
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {creditNotes.map((cn) => (
                    <tr key={cn._id} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="font-medium">{cn.creditNoteNumber}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/invoices/${cn.invoice?.id}`}
                          className="text-blue-600 hover:underline"
                        >
                          {cn.invoice?.invoiceNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{cn.customer?.name}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="font-normal">
                          {getReasonLabel(cn.reason)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(cn.creditNoteDate)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-red-600">
                        {formatCurrency(cn.total)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge
                          variant="outline"
                          className={getStatusColor(cn.status)}
                        >
                          {cn.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/dashboard/credit-notes/${cn._id}`}>
                            View
                            <ArrowRight className="ml-1 h-4 w-4" />
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
