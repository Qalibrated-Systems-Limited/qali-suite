import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { getAccountLedgerPg as getAccountLedger } from "@/app/db/actions/account-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Pagination from "@/components/pagination";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const ledger = await getAccountLedger(id);
  return {
    title: ledger
      ? `${ledger.account.accountCode} Ledger | Accounts`
      : "Account Ledger",
  };
}

const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
  }).format(amount || 0);

const formatDate = (date) =>
  date
    ? new Date(date).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";

const getTypeColor = (type) =>
  ({
    asset:
      "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800",
    liability:
      "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800",
    equity:
      "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-800",
    revenue:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800",
    expense:
      "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 border-orange-200 dark:border-orange-800",
  })[type] || "";

export default async function AccountLedgerPage({ params, searchParams }) {
  const { id } = await params;
  const sp = (await searchParams) || {};

  const page = Number(sp.page) || 1;
  const startDate = sp.startDate || "";
  const endDate = sp.endDate || "";

  const ledger = await getAccountLedger(
    id,
    page,
    startDate || null,
    endDate || null,
  );

  if (!ledger) {
    notFound();
  }

  const { account, transactions, pagination, openingBalance } = ledger;

  return (
    <div className="flex flex-col gap-4 sm:gap-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3 w-full sm:w-auto">
          <Button variant="ghost" size="icon" asChild className="shrink-0">
            <Link href={`/dashboard/accounts/${id}`}>
              <ArrowLeft className="w-5 h-5" />
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-bold font-mono break-all">
                {account.accountCode}
              </h1>
              <Badge
                variant="outline"
                className={getTypeColor(account.accountType)}
              >
                {account.accountType}
              </Badge>
            </div>
            <p className="text-lg text-foreground mt-1 break-words">
              {account.accountName} — General Ledger
            </p>
          </div>
        </div>
      </div>

      {/* Date range filter (native GET form — works without client JS) */}
      <Card>
        <CardContent className="p-4">
          <form className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">From</label>
              <Input
                type="date"
                name="startDate"
                defaultValue={startDate}
                className="w-full sm:w-44"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">To</label>
              <Input
                type="date"
                name="endDate"
                defaultValue={endDate}
                className="w-full sm:w-44"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit">Apply</Button>
              {(startDate || endDate) && (
                <Button variant="outline" asChild>
                  <Link href={`/dashboard/accounts/${id}/ledger`}>Clear</Link>
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Ledger */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Transactions
            <span className="text-sm font-normal text-muted-foreground">
              ({pagination.total} total)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No posted transactions for this account
              {startDate || endDate ? " in the selected date range" : ""}.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground text-left">
                    <th className="py-2 pr-4 font-medium">Date</th>
                    <th className="py-2 pr-4 font-medium">Entry</th>
                    <th className="py-2 pr-4 font-medium">Description</th>
                    <th className="py-2 pr-4 font-medium text-right">Debit</th>
                    <th className="py-2 pr-4 font-medium text-right">Credit</th>
                    <th className="py-2 pl-4 font-medium text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {openingBalance !== 0 && (
                    <tr className="border-b border-border/50 text-muted-foreground italic">
                      <td className="py-2 pr-4 whitespace-nowrap" colSpan={3}>
                        Balance brought forward
                      </td>
                      <td className="py-2 pr-4" />
                      <td className="py-2 pr-4" />
                      <td className="py-2 pl-4 text-right whitespace-nowrap font-semibold">
                        {formatCurrency(openingBalance)}
                      </td>
                    </tr>
                  )}
                  {transactions.map((txn) => (
                    <tr
                      key={`${txn.entryId}`}
                      className="border-b border-border/50 hover:bg-muted/50 transition"
                    >
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {formatDate(txn.date)}
                      </td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        <Link
                          href={`/dashboard/journal/${txn.entryId}`}
                          className="font-mono text-yellow-600 dark:text-yellow-400 hover:underline"
                        >
                          {txn.entryNumber}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 min-w-48">
                        <p className="break-words">{txn.description}</p>
                        {txn.reference && (
                          <p className="text-xs text-muted-foreground">
                            Ref: {txn.reference}
                          </p>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right whitespace-nowrap text-green-600 dark:text-green-400">
                        {txn.debit > 0 ? formatCurrency(txn.debit) : "—"}
                      </td>
                      <td className="py-2 pr-4 text-right whitespace-nowrap text-red-600 dark:text-red-400">
                        {txn.credit > 0 ? formatCurrency(txn.credit) : "—"}
                      </td>
                      <td className="py-2 pl-4 text-right whitespace-nowrap font-semibold">
                        {formatCurrency(txn.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination totalPages={pagination.totalPages} />
        </div>
      )}
    </div>
  );
}
