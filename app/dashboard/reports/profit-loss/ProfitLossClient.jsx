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
  TrendingUp,
  TrendingDown,
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

const DATE_PRESETS = [
  { value: "this-month", label: "This Month" },
  { value: "last-month", label: "Last Month" },
  { value: "this-quarter", label: "This Quarter" },
  { value: "last-quarter", label: "Last Quarter" },
  { value: "this-year", label: "This Year" },
  { value: "last-year", label: "Last Year" },
];

const COMPARISON_OPTIONS = [
  { value: "none", label: "No Comparison" },
  { value: "previous_period", label: "Previous Period" },
  { value: "previous_year", label: "Previous Year" },
];

export function ProfitLossClient({
  initialData,
  initialPeriod,
  initialComparison,
  startDate,
  endDate,
  error,
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [period, setPeriod] = useState(initialPeriod);
  const [comparison, setComparison] = useState(initialComparison || "none");

  const handlePeriodChange = (value) => {
    setPeriod(value);
    startTransition(() => {
      const params = new URLSearchParams();
      params.set("period", value);
      if (comparison !== "none") params.set("compare", comparison);
      router.push(`/dashboard/reports/profit-loss?${params.toString()}`);
    });
  };

  const handleComparisonChange = (value) => {
    setComparison(value);
    startTransition(() => {
      const params = new URLSearchParams();
      params.set("period", period);
      if (value !== "none") params.set("compare", value);
      router.push(`/dashboard/reports/profit-loss?${params.toString()}`);
    });
  };

  const handleRefresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  const handleExport = () => {
    const report = initialData?.current;
    if (!report) return;

    // Generate CSV
    const headers = ["Account", "Amount"];
    const rows = [];

    rows.push(["REVENUE", ""]);
    report.revenue.accounts.forEach((acc) => {
      rows.push([`  ${acc.accountName}`, acc.balance]);
    });
    rows.push(["Total Revenue", report.revenue.total]);
    rows.push(["", ""]);

    rows.push(["EXPENSES", ""]);
    report.expenses.accounts.forEach((acc) => {
      rows.push([`  ${acc.accountName}`, acc.balance]);
    });
    rows.push(["Total Expenses", report.expenses.total]);
    rows.push(["", ""]);

    rows.push(["NET INCOME", report.summary.netIncome]);

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `profit-loss-${format(new Date(startDate), "yyyy-MM-dd")}.csv`;
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

  const report = initialData?.current;
  const comparisonReport = initialData?.comparison;
  const variance = initialData?.variance;
  const netIncome = report?.summary?.netIncome || 0;
  const isProfit = netIncome >= 0;

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          {/* Title Row */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">
                Profit & Loss Statement
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {format(new Date(startDate), "MMM d, yyyy")} -{" "}
                {format(new Date(endDate), "MMM d, yyyy")}
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
              <Select value={period} onValueChange={handlePeriodChange}>
                <SelectTrigger className="w-[160px] h-9">
                  <SelectValue placeholder="Select period" />
                </SelectTrigger>
                <SelectContent>
                  {DATE_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Compare:</span>
              <Select value={comparison} onValueChange={handleComparisonChange}>
                <SelectTrigger className="w-[160px] h-9">
                  <SelectValue placeholder="No comparison" />
                </SelectTrigger>
                <SelectContent>
                  {COMPARISON_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <ReportSummaryCard
            label="Total Revenue"
            value={`KES ${formatCurrency(report?.revenue?.total || 0)}`}
          />
          <ReportSummaryCard
            label="Total Expenses"
            value={`KES ${formatCurrency(report?.expenses?.total || 0)}`}
          />
          <Card
            className={cn(
              "p-4",
              isProfit
                ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
            )}
          >
            <div className="flex items-center gap-2">
              {isProfit ? (
                <TrendingUp className="h-5 w-5 text-green-600 dark:text-green-400" />
              ) : (
                <TrendingDown className="h-5 w-5 text-red-600 dark:text-red-400" />
              )}
              <span
                className={cn(
                  "text-sm font-medium",
                  isProfit
                    ? "text-green-800 dark:text-green-200"
                    : "text-red-800 dark:text-red-200"
                )}
              >
                {isProfit ? "Net Profit" : "Net Loss"}
              </span>
            </div>
            <p
              className={cn(
                "text-2xl font-bold mt-1 tabular-nums",
                isProfit
                  ? "text-green-700 dark:text-green-300"
                  : "text-red-700 dark:text-red-300"
              )}
            >
              KES {formatCurrency(Math.abs(netIncome))}
            </p>
          </Card>
          <ReportSummaryCard
            label="Net Margin"
            value={`${report?.summary?.netMargin || 0}%`}
            subValue="of total revenue"
          />
        </div>
      </div>

      {/* P&L Statement */}
      <div className="px-4 sm:px-6 lg:px-8">
        <Card className="overflow-hidden">
          <ReportTable>
            <ReportTableHeader>
              <ReportTableHeaderCell>Account</ReportTableHeaderCell>
              <ReportTableHeaderCell align="right" className="w-32">
                Amount
              </ReportTableHeaderCell>
              {comparisonReport && (
                <>
                  <ReportTableHeaderCell align="right" className="w-32">
                    Prior
                  </ReportTableHeaderCell>
                  <ReportTableHeaderCell align="right" className="w-24">
                    Change
                  </ReportTableHeaderCell>
                </>
              )}
            </ReportTableHeader>
            <ReportTableBody>
              {/* Revenue Section */}
              <ReportTableRow isHeader>
                <ReportTableCell className="font-bold text-green-700 dark:text-green-400">
                  REVENUE
                </ReportTableCell>
                <ReportTableCell />
                {comparisonReport && (
                  <>
                    <ReportTableCell />
                    <ReportTableCell />
                  </>
                )}
              </ReportTableRow>
              {report?.revenue?.accounts?.map((account) => (
                <ReportTableRow key={account.accountCode}>
                  <ReportTableCell indent={1}>{account.accountName}</ReportTableCell>
                  <ReportTableCell align="right" className="tabular-nums">
                    {formatCurrency(account.balance)}
                  </ReportTableCell>
                  {comparisonReport && (
                    <>
                      <ReportTableCell align="right" className="tabular-nums text-muted-foreground">
                        {formatCurrency(
                          comparisonReport?.revenue?.accounts?.find(
                            (a) => a.accountCode === account.accountCode
                          )?.balance || 0
                        )}
                      </ReportTableCell>
                      <ReportTableCell align="right" className="tabular-nums">
                        -
                      </ReportTableCell>
                    </>
                  )}
                </ReportTableRow>
              ))}
              <ReportTableRow isSubtotal>
                <ReportTableCell className="font-semibold">
                  Total Revenue
                </ReportTableCell>
                <ReportTableCell
                  align="right"
                  className="tabular-nums font-semibold text-green-700 dark:text-green-400"
                >
                  {formatCurrency(report?.revenue?.total || 0)}
                </ReportTableCell>
                {comparisonReport && (
                  <>
                    <ReportTableCell align="right" className="tabular-nums text-muted-foreground">
                      {formatCurrency(comparisonReport?.revenue?.total || 0)}
                    </ReportTableCell>
                    <ReportTableCell align="right" className="tabular-nums">
                      {variance?.revenue > 0 ? "+" : ""}
                      {formatCurrency(variance?.revenue || 0)}
                    </ReportTableCell>
                  </>
                )}
              </ReportTableRow>

              {/* Spacer */}
              <ReportTableRow>
                <ReportTableCell colSpan={comparisonReport ? 4 : 2} className="h-4" />
              </ReportTableRow>

              {/* Expenses Section */}
              <ReportTableRow isHeader>
                <ReportTableCell className="font-bold text-red-700 dark:text-red-400">
                  EXPENSES
                </ReportTableCell>
                <ReportTableCell />
                {comparisonReport && (
                  <>
                    <ReportTableCell />
                    <ReportTableCell />
                  </>
                )}
              </ReportTableRow>
              {report?.expenses?.accounts?.map((account) => (
                <ReportTableRow key={account.accountCode}>
                  <ReportTableCell indent={1}>{account.accountName}</ReportTableCell>
                  <ReportTableCell align="right" className="tabular-nums">
                    {formatCurrency(account.balance)}
                  </ReportTableCell>
                  {comparisonReport && (
                    <>
                      <ReportTableCell align="right" className="tabular-nums text-muted-foreground">
                        {formatCurrency(
                          comparisonReport?.expenses?.accounts?.find(
                            (a) => a.accountCode === account.accountCode
                          )?.balance || 0
                        )}
                      </ReportTableCell>
                      <ReportTableCell align="right" className="tabular-nums">
                        -
                      </ReportTableCell>
                    </>
                  )}
                </ReportTableRow>
              ))}
              <ReportTableRow isSubtotal>
                <ReportTableCell className="font-semibold">
                  Total Expenses
                </ReportTableCell>
                <ReportTableCell
                  align="right"
                  className="tabular-nums font-semibold text-red-700 dark:text-red-400"
                >
                  ({formatCurrency(report?.expenses?.total || 0)})
                </ReportTableCell>
                {comparisonReport && (
                  <>
                    <ReportTableCell align="right" className="tabular-nums text-muted-foreground">
                      ({formatCurrency(comparisonReport?.expenses?.total || 0)})
                    </ReportTableCell>
                    <ReportTableCell align="right" className="tabular-nums">
                      {variance?.expenses > 0 ? "+" : ""}
                      {formatCurrency(variance?.expenses || 0)}
                    </ReportTableCell>
                  </>
                )}
              </ReportTableRow>

              {/* Net Income */}
              <ReportTableRow isTotal>
                <ReportTableCell className="font-bold">
                  {isProfit ? "NET PROFIT" : "NET LOSS"}
                </ReportTableCell>
                <ReportTableCell
                  align="right"
                  className={cn(
                    "tabular-nums font-bold",
                    isProfit
                      ? "text-green-700 dark:text-green-400"
                      : "text-red-700 dark:text-red-400"
                  )}
                >
                  {isProfit ? "" : "("}
                  {formatCurrency(Math.abs(netIncome))}
                  {isProfit ? "" : ")"}
                </ReportTableCell>
                {comparisonReport && (
                  <>
                    <ReportTableCell align="right" className="tabular-nums text-muted-foreground font-bold">
                      {formatCurrency(comparisonReport?.summary?.netIncome || 0)}
                    </ReportTableCell>
                    <ReportTableCell
                      align="right"
                      className={cn(
                        "tabular-nums font-bold",
                        (variance?.netIncome || 0) >= 0
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      )}
                    >
                      {(variance?.netIncome || 0) > 0 ? "+" : ""}
                      {formatCurrency(variance?.netIncome || 0)}
                    </ReportTableCell>
                  </>
                )}
              </ReportTableRow>
            </ReportTableBody>
          </ReportTable>
        </Card>
      </div>

      {/* Print-only footer */}
      <div className="hidden print:block px-8 py-4 text-center text-xs text-muted-foreground border-t">
        <p>
          Generated on {format(new Date(), "MMMM d, yyyy 'at' h:mm a")} |
          Period: {format(new Date(startDate), "MMM d, yyyy")} - {format(new Date(endDate), "MMM d, yyyy")}
        </p>
      </div>
    </div>
  );
}
