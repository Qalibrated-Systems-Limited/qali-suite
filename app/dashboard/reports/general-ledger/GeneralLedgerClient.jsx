"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Download,
  Printer,
  RefreshCw,
  Calendar,
  BookOpen,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import {
  ReportTable,
  ReportTableHeader,
  ReportTableHeaderCell,
  ReportTableBody,
  ReportTableRow,
  ReportTableCell,
  ReportSummaryCard,
  formatCurrency,
} from "../components";
import { ReportSkeleton } from "../components/ReportSkeleton";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export function GeneralLedgerClient({
  initialData,
  accounts,
  selectedAccountId,
  initialStartDate,
  initialEndDate,
  error,
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [accountId, setAccountId] = useState(selectedAccountId || "");
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);

  const updateUrl = (newAccountId, newStartDate, newEndDate) => {
    const params = new URLSearchParams();
    if (newAccountId) params.set("account", newAccountId);
    params.set("startDate", newStartDate);
    params.set("endDate", newEndDate);
    return `/dashboard/reports/general-ledger?${params.toString()}`;
  };

  const handleAccountChange = (value) => {
    setAccountId(value);
    startTransition(() => {
      router.push(updateUrl(value, startDate, endDate));
    });
  };

  const handleStartDateChange = (value) => {
    setStartDate(value);
    if (accountId) {
      startTransition(() => {
        router.push(updateUrl(accountId, value, endDate));
      });
    }
  };

  const handleEndDateChange = (value) => {
    setEndDate(value);
    if (accountId) {
      startTransition(() => {
        router.push(updateUrl(accountId, startDate, value));
      });
    }
  };

  const handleRefresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  const handleExport = () => {
    if (!initialData) return;

    const headers = ["Date", "Entry #", "Description", "Reference", "Debit", "Credit", "Balance"];
    const rows = initialData.transactions.map((t) => [
      format(new Date(t.date), "yyyy-MM-dd"),
      t.entryNumber,
      t.description,
      t.reference || "",
      t.debit || "",
      t.credit || "",
      t.balance,
    ]);

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `general-ledger-${initialData.account.accountCode}-${startDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  if (isPending && accountId) {
    return <ReportSkeleton />;
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
        <h2 className="text-lg font-semibold mb-2">Error Loading Report</h2>
        <p className="text-muted-foreground mb-4">{error}</p>
        <Button onClick={handleRefresh}>Try Again</Button>
      </div>
    );
  }

  // Group accounts by type for the dropdown
  const groupedAccounts = accounts.reduce((acc, account) => {
    const type = account.accountType;
    if (!acc[type]) acc[type] = [];
    acc[type].push(account);
    return acc;
  }, {});

  const accountTypeLabels = {
    asset: "Assets",
    liability: "Liabilities",
    equity: "Equity",
    revenue: "Revenue",
    expense: "Expenses",
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">
                General Ledger
              </h1>
              {initialData?.account && (
                <p className="text-sm text-muted-foreground mt-1">
                  {initialData.account.accountCode} - {initialData.account.accountName}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isPending || !accountId}
              >
                <RefreshCw className={cn("h-4 w-4 mr-2", isPending && "animate-spin")} />
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={!initialData}
              >
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrint}
                disabled={!initialData}
              >
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
            </div>
          </div>

          {/* Filters Row */}
          <div className="flex flex-wrap items-center gap-4 mt-4">
            {/* Account Selector */}
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              <Select value={accountId} onValueChange={handleAccountChange}>
                <SelectTrigger className="w-[280px] h-9">
                  <SelectValue placeholder="Select an account..." />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {Object.entries(groupedAccounts).map(([type, accts]) => (
                    <div key={type}>
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50">
                        {accountTypeLabels[type] || type}
                      </div>
                      {accts.map((acc) => (
                        <SelectItem key={acc._id} value={acc._id.toString()}>
                          <span className="font-mono text-xs text-muted-foreground mr-2">
                            {acc.accountCode}
                          </span>
                          {acc.accountName}
                        </SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date Range */}
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => handleStartDateChange(e.target.value)}
                className="h-9 px-3 rounded-md border border-input bg-background text-sm"
              />
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <input
                type="date"
                value={endDate}
                onChange={(e) => handleEndDateChange(e.target.value)}
                className="h-9 px-3 rounded-md border border-input bg-background text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      {/* No Account Selected State */}
      {!accountId && (
        <div className="px-4 sm:px-6 lg:px-8">
          <Card className="p-12 text-center">
            <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Select an Account</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              Choose an account from the dropdown above to view its transaction history
              and running balance.
            </p>
          </Card>
        </div>
      )}

      {/* Report Content */}
      {accountId && initialData && (
        <>
          {/* Summary Cards */}
          <div className="px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <ReportSummaryCard
                label="Account Code"
                value={initialData.account.accountCode}
                subValue={initialData.account.accountType}
              />
              <ReportSummaryCard
                label="Opening Balance"
                value={`KES ${formatCurrency(initialData.summary.openingBalance)}`}
              />
              <ReportSummaryCard
                label="Closing Balance"
                value={`KES ${formatCurrency(initialData.summary.closingBalance)}`}
              />
              <ReportSummaryCard
                label="Transactions"
                value={initialData.summary.transactionCount.toString()}
                subValue={`${format(new Date(startDate), "MMM d")} - ${format(
                  new Date(endDate),
                  "MMM d, yyyy"
                )}`}
              />
            </div>
          </div>

          {/* Transactions Table */}
          <div className="px-4 sm:px-6 lg:px-8">
            <Card className="overflow-hidden">
              <ReportTable>
                <ReportTableHeader>
                  <ReportTableHeaderCell className="w-28">Date</ReportTableHeaderCell>
                  <ReportTableHeaderCell className="w-28">Entry #</ReportTableHeaderCell>
                  <ReportTableHeaderCell>Description</ReportTableHeaderCell>
                  <ReportTableHeaderCell className="w-24">Reference</ReportTableHeaderCell>
                  <ReportTableHeaderCell align="right" className="w-28">
                    Debit
                  </ReportTableHeaderCell>
                  <ReportTableHeaderCell align="right" className="w-28">
                    Credit
                  </ReportTableHeaderCell>
                  <ReportTableHeaderCell align="right" className="w-32">
                    Balance
                  </ReportTableHeaderCell>
                </ReportTableHeader>
                <ReportTableBody>
                  {initialData.transactions.length === 0 ? (
                    <ReportTableRow>
                      <ReportTableCell
                        colSpan={7}
                        className="text-center text-muted-foreground py-8"
                      >
                        No transactions found for this period.
                      </ReportTableCell>
                    </ReportTableRow>
                  ) : (
                    <>
                      {initialData.transactions.map((transaction, index) => (
                        <ReportTableRow key={`${transaction.entryNumber}-${index}`}>
                          <ReportTableCell className="text-muted-foreground">
                            {format(new Date(transaction.date), "MMM d, yyyy")}
                          </ReportTableCell>
                          <ReportTableCell className="font-mono text-sm">
                            {transaction.entryNumber}
                          </ReportTableCell>
                          <ReportTableCell className="max-w-xs truncate">
                            {transaction.description}
                          </ReportTableCell>
                          <ReportTableCell className="text-muted-foreground">
                            {transaction.reference || "-"}
                          </ReportTableCell>
                          <ReportTableCell
                            align="right"
                            className={cn(
                              "tabular-nums",
                              transaction.debit > 0 && "text-blue-600 dark:text-blue-400"
                            )}
                          >
                            {transaction.debit > 0 ? formatCurrency(transaction.debit) : "-"}
                          </ReportTableCell>
                          <ReportTableCell
                            align="right"
                            className={cn(
                              "tabular-nums",
                              transaction.credit > 0 && "text-green-600 dark:text-green-400"
                            )}
                          >
                            {transaction.credit > 0 ? formatCurrency(transaction.credit) : "-"}
                          </ReportTableCell>
                          <ReportTableCell align="right" className="tabular-nums font-medium">
                            {formatCurrency(transaction.balance)}
                          </ReportTableCell>
                        </ReportTableRow>
                      ))}

                      {/* Closing Balance Row */}
                      <ReportTableRow isTotal>
                        <ReportTableCell colSpan={6} className="font-bold">
                          Closing Balance
                        </ReportTableCell>
                        <ReportTableCell align="right" className="tabular-nums font-bold">
                          {formatCurrency(initialData.summary.closingBalance)}
                        </ReportTableCell>
                      </ReportTableRow>
                    </>
                  )}
                </ReportTableBody>
              </ReportTable>
            </Card>
          </div>
        </>
      )}

      {/* Print-only footer */}
      <div className="hidden print:block px-8 py-4 text-center text-xs text-muted-foreground border-t">
        <p>
          Generated on {format(new Date(), "MMMM d, yyyy 'at' h:mm a")} |
          {initialData?.account &&
            ` Account: ${initialData.account.accountCode} - ${initialData.account.accountName} |`}
          {" Period: "}
          {format(new Date(startDate), "MMM d, yyyy")} - {format(new Date(endDate), "MMM d, yyyy")}
        </p>
      </div>
    </div>
  );
}
