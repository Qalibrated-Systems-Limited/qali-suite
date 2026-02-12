import { notFound } from "next/navigation";
import Link from "next/link";
import { getStatementOfAccount } from "@/app/mongodb/queries/statement-queries";
import { getCompanyForDocuments } from "@/app/mongodb/queries/company-queries";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Mail } from "lucide-react";
import { StatementPDFButton } from "../components/StatementPDFButton";

export async function generateMetadata({ params }) {
  const { customerId } = await params;
  const statement = await getStatementOfAccount(customerId);

  if (!statement) {
    return { title: "Statement Not Found" };
  }

  return {
    title: `Statement - ${statement.customer.name}`,
    description: `Account statement for ${statement.customer.name}`,
  };
}

export default async function StatementDetailPage({ params, searchParams }) {
  const { customerId } = await params;
  const { startDate, endDate } = await searchParams;
  const { companyId } = await getTenantContext();

  const [statement, company] = await Promise.all([
    getStatementOfAccount(customerId, startDate, endDate),
    getCompanyForDocuments(companyId),
  ]);

  if (!statement) {
    notFound();
  }

  const { customer, transactions, summary, aging, period } = statement;

  const formatCurrency = (amount) => {
    return `KES ${Number(amount || 0).toLocaleString("en-KE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const formatDate = (date) => {
    if (!date) return "-";
    return new Date(date).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const getTypeBadge = (type) => {
    switch (type) {
      case "invoice":
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">INV</Badge>;
      case "payment":
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">PMT</Badge>;
      case "credit_note":
        return <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">CN</Badge>;
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
  };

  // Serialize statement for client component
  const serializedStatement = JSON.parse(JSON.stringify(statement));
  const serializedCompany = JSON.parse(JSON.stringify(company));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/statements">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Statement of Account</h1>
            <p className="text-muted-foreground">
              {customer.displayName || customer.name}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Mail className="mr-2 h-4 w-4" />
            Email Statement
          </Button>
          <StatementPDFButton statement={serializedStatement} company={serializedCompany} />
        </div>
      </div>

      {/* Customer & Period Info */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Account Holder</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium">{customer.displayName || customer.name}</p>
            <p className="text-sm text-muted-foreground">{customer.email}</p>
            <p className="text-sm text-muted-foreground">{customer.phone}</p>
            {customer.taxPin && (
              <p className="text-sm text-muted-foreground">PIN: {customer.taxPin}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Statement Period</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium">
              {period.startDate && period.endDate
                ? `${formatDate(period.startDate)} - ${formatDate(period.endDate)}`
                : "All Time"}
            </p>
            <p className="text-sm text-muted-foreground">
              Credit Terms: Net {customer.creditTerms?.paymentTermsDays || 30} Days
            </p>
            {customer.creditTerms?.creditLimit > 0 && (
              <p className="text-sm text-muted-foreground">
                Credit Limit: {formatCurrency(customer.creditTerms.creditLimit)}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Opening Balance</p>
            <p className="text-xl font-bold">{formatCurrency(summary.openingBalance)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Invoiced</p>
            <p className="text-xl font-bold">{formatCurrency(summary.totalInvoiced)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Paid</p>
            <p className="text-xl font-bold text-green-600">{formatCurrency(summary.totalPaid)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Credits Issued</p>
            <p className="text-xl font-bold">{formatCurrency(summary.totalCredited)}</p>
          </CardContent>
        </Card>
        <Card className="bg-primary/10 border-primary">
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Balance Due</p>
            <p className={`text-xl font-bold ${summary.closingBalance > 0 ? "text-red-600" : "text-green-600"}`}>
              {formatCurrency(summary.closingBalance)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Transactions Table */}
      <Card>
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-3 text-sm font-medium">Date</th>
                  <th className="text-left p-3 text-sm font-medium">Type</th>
                  <th className="text-left p-3 text-sm font-medium">Reference</th>
                  <th className="text-left p-3 text-sm font-medium">Description</th>
                  <th className="text-right p-3 text-sm font-medium">Debit</th>
                  <th className="text-right p-3 text-sm font-medium">Credit</th>
                  <th className="text-right p-3 text-sm font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {/* Opening Balance Row */}
                {summary.openingBalance !== 0 && (
                  <tr className="bg-primary/5">
                    <td className="p-3 font-medium" colSpan={4}>Opening Balance</td>
                    <td className="p-3 text-right">-</td>
                    <td className="p-3 text-right">-</td>
                    <td className="p-3 text-right font-medium">
                      {formatCurrency(summary.openingBalance)}
                    </td>
                  </tr>
                )}

                {/* Transaction Rows */}
                {transactions.map((txn, i) => (
                  <tr key={i} className={i % 2 === 0 ? "" : "bg-muted/50"}>
                    <td className="p-3 text-sm">{formatDate(txn.date)}</td>
                    <td className="p-3">{getTypeBadge(txn.type)}</td>
                    <td className="p-3 text-sm font-medium">{txn.reference}</td>
                    <td className="p-3 text-sm">
                      {txn.description}
                      {txn.dueDate && txn.type === "invoice" && (
                        <span className="block text-xs text-muted-foreground">
                          Due: {formatDate(txn.dueDate)}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right text-sm">
                      {txn.debit > 0 ? formatCurrency(txn.debit) : ""}
                    </td>
                    <td className="p-3 text-right text-sm text-green-600">
                      {txn.credit > 0 ? formatCurrency(txn.credit) : ""}
                    </td>
                    <td className="p-3 text-right text-sm font-medium">
                      {formatCurrency(txn.balance)}
                    </td>
                  </tr>
                ))}

                {/* Closing Balance Row */}
                <tr className="bg-primary text-primary-foreground">
                  <td className="p-3 font-bold" colSpan={4}>Closing Balance</td>
                  <td className="p-3 text-right">-</td>
                  <td className="p-3 text-right">-</td>
                  <td className="p-3 text-right font-bold text-lg">
                    {formatCurrency(summary.closingBalance)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Aging Analysis */}
      {(aging.days30 > 0 || aging.days60 > 0 || aging.days90 > 0 || aging.over90 > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Aging Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-5 gap-4">
              <div className="text-center p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                <p className="text-sm text-muted-foreground">Current</p>
                <p className="text-xl font-bold text-green-600">
                  {formatCurrency(aging.current)}
                </p>
              </div>
              <div className="text-center p-4 bg-yellow-50 dark:bg-yellow-950 rounded-lg">
                <p className="text-sm text-muted-foreground">1-30 Days</p>
                <p className="text-xl font-bold text-yellow-600">
                  {formatCurrency(aging.days30)}
                </p>
              </div>
              <div className="text-center p-4 bg-orange-50 dark:bg-orange-950 rounded-lg">
                <p className="text-sm text-muted-foreground">31-60 Days</p>
                <p className="text-xl font-bold text-orange-600">
                  {formatCurrency(aging.days60)}
                </p>
              </div>
              <div className="text-center p-4 bg-red-50 dark:bg-red-950 rounded-lg">
                <p className="text-sm text-muted-foreground">61-90 Days</p>
                <p className="text-xl font-bold text-red-600">
                  {formatCurrency(aging.days90)}
                </p>
              </div>
              <div className="text-center p-4 bg-red-100 dark:bg-red-900 rounded-lg">
                <p className="text-sm text-muted-foreground">Over 90 Days</p>
                <p className="text-xl font-bold text-red-700">
                  {formatCurrency(aging.over90)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
