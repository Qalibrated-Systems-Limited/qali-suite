"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Download,
  Printer,
  RefreshCw,
  Calendar,
  CheckCircle,
  AlertTriangle,
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

// Group accounts by type
const ACCOUNT_TYPE_ORDER = ["asset", "liability", "equity", "revenue", "expense"];
const ACCOUNT_TYPE_LABELS = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  revenue: "Revenue",
  expense: "Expenses",
};

export function TrialBalanceClient({
  initialData,
  initialAsOfDate,
  initialShowZero,
  error,
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [asOfDate, setAsOfDate] = useState(initialAsOfDate);
  const [showZeroBalances, setShowZeroBalances] = useState(initialShowZero);

  const handleRefresh = () => {
    startTransition(() => {
      const params = new URLSearchParams();
      params.set("asOf", asOfDate);
      if (showZeroBalances) params.set("showZero", "true");
      router.push(`/dashboard/reports/trial-balance?${params.toString()}`);
      router.refresh();
    });
  };

  const handleDateChange = (newDate) => {
    setAsOfDate(newDate);
    startTransition(() => {
      const params = new URLSearchParams();
      params.set("asOf", newDate);
      if (showZeroBalances) params.set("showZero", "true");
      router.push(`/dashboard/reports/trial-balance?${params.toString()}`);
    });
  };

  const handleShowZeroChange = (checked) => {
    setShowZeroBalances(checked);
    startTransition(() => {
      const params = new URLSearchParams();
      params.set("asOf", asOfDate);
      if (checked) params.set("showZero", "true");
      router.push(`/dashboard/reports/trial-balance?${params.toString()}`);
    });
  };

  const handleExport = () => {
    if (!initialData) return;

    // Generate CSV
    const headers = ["Account Code", "Account Name", "Account Type", "Debit", "Credit"];
    const rows = initialData.accounts.map((acc) => [
      acc.accountCode,
      acc.accountName,
      acc.accountType,
      acc.debit || "",
      acc.credit || "",
    ]);

    // Add totals row
    rows.push([
      "",
      "TOTALS",
      "",
      initialData.summary.totalDebits,
      initialData.summary.totalCredits,
    ]);

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trial-balance-${asOfDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  if (isPending) {
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

  // Group accounts by type
  const groupedAccounts = ACCOUNT_TYPE_ORDER.reduce((acc, type) => {
    const accounts = initialData?.accounts?.filter((a) => a.accountType === type) || [];
    if (accounts.length > 0) {
      acc[type] = accounts;
    }
    return acc;
  }, {});

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          {/* Title Row */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">
                Trial Balance
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                As of {format(new Date(asOfDate), "MMMM d, yyyy")}
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isPending}
              >
                <RefreshCw
                  className={cn("h-4 w-4 mr-2", isPending && "animate-spin")}
                />
                Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
            </div>
          </div>

          {/* Filters Row */}
          <div className="flex flex-wrap items-center gap-4 mt-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">As of:</span>
              <input
                type="date"
                value={asOfDate}
                onChange={(e) => handleDateChange(e.target.value)}
                className="h-9 px-3 rounded-md border border-input bg-background text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="showZero"
                checked={showZeroBalances}
                onCheckedChange={handleShowZeroChange}
              />
              <label htmlFor="showZero" className="text-sm text-muted-foreground">
                Show zero balances
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <ReportSummaryCard
            label="Total Debits"
            value={`KES ${formatCurrency(initialData?.summary?.totalDebits || 0)}`}
          />
          <ReportSummaryCard
            label="Total Credits"
            value={`KES ${formatCurrency(initialData?.summary?.totalCredits || 0)}`}
          />
          <ReportSummaryCard
            label="Difference"
            value={`KES ${formatCurrency(initialData?.summary?.difference || 0)}`}
          />
          <Card
            className={cn(
              "p-4 flex items-center gap-3",
              initialData?.summary?.isBalanced
                ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
            )}
          >
            {initialData?.summary?.isBalanced ? (
              <>
                <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    Balanced
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-400">
                    Debits = Credits
                  </p>
                </div>
              </>
            ) : (
              <>
                <AlertTriangle className="h-8 w-8 text-red-600 dark:text-red-400" />
                <div>
                  <p className="text-sm font-medium text-red-800 dark:text-red-200">
                    Not Balanced
                  </p>
                  <p className="text-xs text-red-600 dark:text-red-400">
                    Difference: {formatCurrency(initialData?.summary?.difference || 0)}
                  </p>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>

      {/* Trial Balance Table */}
      <div className="px-4 sm:px-6 lg:px-8">
        <Card className="overflow-hidden">
          <ReportTable>
            <ReportTableHeader>
              <ReportTableHeaderCell className="w-24">Code</ReportTableHeaderCell>
              <ReportTableHeaderCell>Account Name</ReportTableHeaderCell>
              <ReportTableHeaderCell align="right" className="w-32">
                Debit
              </ReportTableHeaderCell>
              <ReportTableHeaderCell align="right" className="w-32">
                Credit
              </ReportTableHeaderCell>
            </ReportTableHeader>
            <ReportTableBody>
              {Object.entries(groupedAccounts).map(([type, accounts]) => (
                <Fragment key={type}>
                  {/* Account Type Header */}
                  <ReportTableRow isHeader>
                    <ReportTableCell colSpan={4} className="font-semibold">
                      {ACCOUNT_TYPE_LABELS[type]}
                    </ReportTableCell>
                  </ReportTableRow>
                  {/* Account Rows */}
                  {accounts.map((account) => (
                    <ReportTableRow key={account.accountCode}>
                      <ReportTableCell className="font-mono text-muted-foreground">
                        {account.accountCode}
                      </ReportTableCell>
                      <ReportTableCell indent={1}>
                        {account.accountName}
                      </ReportTableCell>
                      <ReportTableCell align="right" className="tabular-nums">
                        {account.debit > 0 ? formatCurrency(account.debit) : "-"}
                      </ReportTableCell>
                      <ReportTableCell align="right" className="tabular-nums">
                        {account.credit > 0 ? formatCurrency(account.credit) : "-"}
                      </ReportTableCell>
                    </ReportTableRow>
                  ))}
                </Fragment>
              ))}

              {/* Totals Row */}
              <ReportTableRow isTotal>
                <ReportTableCell colSpan={2} className="font-bold">
                  TOTALS
                </ReportTableCell>
                <ReportTableCell align="right" className="tabular-nums font-bold">
                  {formatCurrency(initialData?.summary?.totalDebits || 0)}
                </ReportTableCell>
                <ReportTableCell align="right" className="tabular-nums font-bold">
                  {formatCurrency(initialData?.summary?.totalCredits || 0)}
                </ReportTableCell>
              </ReportTableRow>
            </ReportTableBody>
          </ReportTable>
        </Card>
      </div>

      {/* Print-only footer */}
      <div className="hidden print:block px-8 py-4 text-center text-xs text-muted-foreground border-t">
        <p>
          Generated on {format(new Date(), "MMMM d, yyyy 'at' h:mm a")} |
          Trial Balance as of {format(new Date(asOfDate), "MMMM d, yyyy")}
        </p>
      </div>
    </div>
  );
}
