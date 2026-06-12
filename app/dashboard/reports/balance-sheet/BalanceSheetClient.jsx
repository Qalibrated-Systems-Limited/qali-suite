"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Download,
  Printer,
  RefreshCw,
  Calendar,
  CheckCircle,
  AlertTriangle,
  Building2,
  Wallet,
  PiggyBank,
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
  formatCurrencyCompact,
} from "../components";
import { ReportSkeleton } from "../components/ReportSkeleton";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export function BalanceSheetClient({
  initialData,
  initialAsOfDate,
  error,
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [asOfDate, setAsOfDate] = useState(initialAsOfDate);

  const handleRefresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  const handleDateChange = (newDate) => {
    setAsOfDate(newDate);
    startTransition(() => {
      router.push(`/dashboard/reports/balance-sheet?asOf=${newDate}`);
    });
  };

  const handleExport = () => {
    if (!initialData) return;

    const headers = ["Account", "Amount"];
    const rows = [];

    rows.push(["ASSETS", ""]);
    rows.push(["Current Assets", ""]);
    initialData.assets.current.forEach((acc) => {
      rows.push([`  ${acc.accountName}`, acc.balance]);
    });
    rows.push(["Fixed Assets", ""]);
    initialData.assets.fixed.forEach((acc) => {
      rows.push([`  ${acc.accountName}`, acc.balance]);
    });
    rows.push(["Total Assets", initialData.summary.totalAssets]);
    rows.push(["", ""]);

    rows.push(["LIABILITIES", ""]);
    rows.push(["Current Liabilities", ""]);
    initialData.liabilities.current.forEach((acc) => {
      rows.push([`  ${acc.accountName}`, acc.balance]);
    });
    rows.push(["Long-term Liabilities", ""]);
    initialData.liabilities.longTerm.forEach((acc) => {
      rows.push([`  ${acc.accountName}`, acc.balance]);
    });
    rows.push(["Total Liabilities", initialData.summary.totalLiabilities]);
    rows.push(["", ""]);

    rows.push(["EQUITY", ""]);
    initialData.equity.accounts.forEach((acc) => {
      rows.push([`  ${acc.accountName}`, acc.balance]);
    });
    rows.push(["Total Equity", initialData.summary.totalEquity]);
    rows.push(["", ""]);

    rows.push(["TOTAL LIABILITIES & EQUITY", initialData.summary.totalLiabilitiesAndEquity]);

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `balance-sheet-${asOfDate}.csv`;
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

  const data = initialData;

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">
                Balance Sheet
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                As of {format(new Date(asOfDate), "MMMM d, yyyy")}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isPending}
              >
                <RefreshCw className={cn("h-4 w-4 mr-2", isPending && "animate-spin")} />
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
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="p-4 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-2 mb-2">
              <Building2 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                Total Assets
              </span>
            </div>
            <p className="text-xl sm:text-2xl font-bold text-blue-700 dark:text-blue-300 tabular-nums">
              <span className="sm:hidden">KES {formatCurrencyCompact(data?.summary?.totalAssets || 0)}</span>
              <span className="hidden sm:inline">KES {formatCurrency(data?.summary?.totalAssets || 0)}</span>
            </p>
          </Card>

          <Card className="p-4 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800">
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="h-5 w-5 text-red-600 dark:text-red-400" />
              <span className="text-sm font-medium text-red-800 dark:text-red-200">
                Total Liabilities
              </span>
            </div>
            <p className="text-xl sm:text-2xl font-bold text-red-700 dark:text-red-300 tabular-nums">
              <span className="sm:hidden">KES {formatCurrencyCompact(data?.summary?.totalLiabilities || 0)}</span>
              <span className="hidden sm:inline">KES {formatCurrency(data?.summary?.totalLiabilities || 0)}</span>
            </p>
          </Card>

          <Card className="p-4 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
            <div className="flex items-center gap-2 mb-2">
              <PiggyBank className="h-5 w-5 text-green-600 dark:text-green-400" />
              <span className="text-sm font-medium text-green-800 dark:text-green-200">
                Total Equity
              </span>
            </div>
            <p className="text-xl sm:text-2xl font-bold text-green-700 dark:text-green-300 tabular-nums">
              <span className="sm:hidden">KES {formatCurrencyCompact(data?.summary?.totalEquity || 0)}</span>
              <span className="hidden sm:inline">KES {formatCurrency(data?.summary?.totalEquity || 0)}</span>
            </p>
          </Card>

          <Card
            className={cn(
              "p-4 flex items-center gap-3",
              data?.summary?.isBalanced
                ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                : "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800"
            )}
          >
            {data?.summary?.isBalanced ? (
              <>
                <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    Balanced
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-400">
                    A = L + E
                  </p>
                </div>
              </>
            ) : (
              <>
                <AlertTriangle className="h-8 w-8 text-yellow-600 dark:text-yellow-400" />
                <div>
                  <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                    Not Balanced
                  </p>
                  <p className="text-xs text-yellow-600 dark:text-yellow-400">
                    Diff: {formatCurrency(data?.summary?.difference || 0)}
                  </p>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>

      {/* Balance Sheet */}
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Assets Column */}
          <Card className="overflow-hidden">
            <div className="bg-blue-50 dark:bg-blue-900/20 px-4 py-3 border-b border-border">
              <h2 className="font-bold text-blue-800 dark:text-blue-200 flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                ASSETS
              </h2>
            </div>
            <ReportTable>
              <ReportTableBody>
                {/* Current Assets */}
                {data?.assets?.current?.length > 0 && (
                  <>
                    <ReportTableRow isHeader>
                      <ReportTableCell className="font-semibold">
                        Current Assets
                      </ReportTableCell>
                      <ReportTableCell />
                    </ReportTableRow>
                    {data.assets.current.map((account) => (
                      <ReportTableRow key={account.accountCode}>
                        <ReportTableCell indent={1}>
                          {account.accountName}
                        </ReportTableCell>
                        <ReportTableCell align="right" className="tabular-nums">
                          {formatCurrency(account.balance)}
                        </ReportTableCell>
                      </ReportTableRow>
                    ))}
                    <ReportTableRow isSubtotal>
                      <ReportTableCell className="font-medium">
                        Total Current Assets
                      </ReportTableCell>
                      <ReportTableCell align="right" className="tabular-nums font-medium">
                        {formatCurrency(
                          data.assets.current.reduce((sum, a) => sum + a.balance, 0)
                        )}
                      </ReportTableCell>
                    </ReportTableRow>
                  </>
                )}

                {/* Fixed Assets */}
                {data?.assets?.fixed?.length > 0 && (
                  <>
                    <ReportTableRow isHeader>
                      <ReportTableCell className="font-semibold">
                        Fixed Assets
                      </ReportTableCell>
                      <ReportTableCell />
                    </ReportTableRow>
                    {data.assets.fixed.map((account) => (
                      <ReportTableRow key={account.accountCode}>
                        <ReportTableCell indent={1}>
                          {account.accountName}
                        </ReportTableCell>
                        <ReportTableCell align="right" className="tabular-nums">
                          {formatCurrency(account.balance)}
                        </ReportTableCell>
                      </ReportTableRow>
                    ))}
                    <ReportTableRow isSubtotal>
                      <ReportTableCell className="font-medium">
                        Total Fixed Assets
                      </ReportTableCell>
                      <ReportTableCell align="right" className="tabular-nums font-medium">
                        {formatCurrency(
                          data.assets.fixed.reduce((sum, a) => sum + a.balance, 0)
                        )}
                      </ReportTableCell>
                    </ReportTableRow>
                  </>
                )}

                {/* Other Assets */}
                {data?.assets?.other?.length > 0 && (
                  <>
                    <ReportTableRow isHeader>
                      <ReportTableCell className="font-semibold">
                        Other Assets
                      </ReportTableCell>
                      <ReportTableCell />
                    </ReportTableRow>
                    {data.assets.other.map((account) => (
                      <ReportTableRow key={account.accountCode}>
                        <ReportTableCell indent={1}>
                          {account.accountName}
                        </ReportTableCell>
                        <ReportTableCell align="right" className="tabular-nums">
                          {formatCurrency(account.balance)}
                        </ReportTableCell>
                      </ReportTableRow>
                    ))}
                  </>
                )}

                {/* Total Assets */}
                <ReportTableRow isTotal>
                  <ReportTableCell className="font-bold">
                    TOTAL ASSETS
                  </ReportTableCell>
                  <ReportTableCell
                    align="right"
                    className="tabular-nums font-bold text-blue-700 dark:text-blue-400"
                  >
                    {formatCurrency(data?.summary?.totalAssets || 0)}
                  </ReportTableCell>
                </ReportTableRow>
              </ReportTableBody>
            </ReportTable>
          </Card>

          {/* Liabilities & Equity Column */}
          <Card className="overflow-hidden">
            {/* Liabilities Section */}
            <div className="bg-red-50 dark:bg-red-900/20 px-4 py-3 border-b border-border">
              <h2 className="font-bold text-red-800 dark:text-red-200 flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                LIABILITIES
              </h2>
            </div>
            <ReportTable>
              <ReportTableBody>
                {/* Current Liabilities */}
                {data?.liabilities?.current?.length > 0 && (
                  <>
                    <ReportTableRow isHeader>
                      <ReportTableCell className="font-semibold">
                        Current Liabilities
                      </ReportTableCell>
                      <ReportTableCell />
                    </ReportTableRow>
                    {data.liabilities.current.map((account) => (
                      <ReportTableRow key={account.accountCode}>
                        <ReportTableCell indent={1}>
                          {account.accountName}
                        </ReportTableCell>
                        <ReportTableCell align="right" className="tabular-nums">
                          {formatCurrency(account.balance)}
                        </ReportTableCell>
                      </ReportTableRow>
                    ))}
                  </>
                )}

                {/* Long-term Liabilities */}
                {data?.liabilities?.longTerm?.length > 0 && (
                  <>
                    <ReportTableRow isHeader>
                      <ReportTableCell className="font-semibold">
                        Long-term Liabilities
                      </ReportTableCell>
                      <ReportTableCell />
                    </ReportTableRow>
                    {data.liabilities.longTerm.map((account) => (
                      <ReportTableRow key={account.accountCode}>
                        <ReportTableCell indent={1}>
                          {account.accountName}
                        </ReportTableCell>
                        <ReportTableCell align="right" className="tabular-nums">
                          {formatCurrency(account.balance)}
                        </ReportTableCell>
                      </ReportTableRow>
                    ))}
                  </>
                )}

                <ReportTableRow isSubtotal>
                  <ReportTableCell className="font-medium">
                    Total Liabilities
                  </ReportTableCell>
                  <ReportTableCell
                    align="right"
                    className="tabular-nums font-medium text-red-700 dark:text-red-400"
                  >
                    {formatCurrency(data?.summary?.totalLiabilities || 0)}
                  </ReportTableCell>
                </ReportTableRow>
              </ReportTableBody>
            </ReportTable>

            {/* Equity Section */}
            <div className="bg-green-50 dark:bg-green-900/20 px-4 py-3 border-b border-t border-border">
              <h2 className="font-bold text-green-800 dark:text-green-200 flex items-center gap-2">
                <PiggyBank className="h-5 w-5" />
                EQUITY
              </h2>
            </div>
            <ReportTable>
              <ReportTableBody>
                {data?.equity?.accounts?.map((account) => (
                  <ReportTableRow key={account.accountCode}>
                    <ReportTableCell indent={1}>
                      {account.accountName}
                    </ReportTableCell>
                    <ReportTableCell align="right" className="tabular-nums">
                      {formatCurrency(account.balance)}
                    </ReportTableCell>
                  </ReportTableRow>
                ))}
                <ReportTableRow isSubtotal>
                  <ReportTableCell className="font-medium">
                    Total Equity
                  </ReportTableCell>
                  <ReportTableCell
                    align="right"
                    className="tabular-nums font-medium text-green-700 dark:text-green-400"
                  >
                    {formatCurrency(data?.summary?.totalEquity || 0)}
                  </ReportTableCell>
                </ReportTableRow>

                {/* Total Liabilities & Equity */}
                <ReportTableRow isTotal>
                  <ReportTableCell className="font-bold">
                    TOTAL LIABILITIES & EQUITY
                  </ReportTableCell>
                  <ReportTableCell
                    align="right"
                    className="tabular-nums font-bold"
                  >
                    {formatCurrency(data?.summary?.totalLiabilitiesAndEquity || 0)}
                  </ReportTableCell>
                </ReportTableRow>
              </ReportTableBody>
            </ReportTable>
          </Card>
        </div>
      </div>

      {/* Print-only footer */}
      <div className="hidden print:block px-8 py-4 text-center text-xs text-muted-foreground border-t">
        <p>
          Generated on {format(new Date(), "MMMM d, yyyy 'at' h:mm a")} |
          Balance Sheet as of {format(new Date(asOfDate), "MMMM d, yyyy")}
        </p>
      </div>
    </div>
  );
}
