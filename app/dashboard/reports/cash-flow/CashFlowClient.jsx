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
  AlertTriangle,
  Briefcase,
  TrendingUp,
  Landmark,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import {
  ReportTable,
  ReportTableHeader,
  ReportTableHeaderCell,
  ReportTableBody,
  ReportTableRow,
  ReportTableCell,
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

export function CashFlowClient({
  initialData,
  initialPeriod,
  startDate,
  endDate,
  error,
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [period, setPeriod] = useState(initialPeriod);

  const handlePeriodChange = (value) => {
    setPeriod(value);
    startTransition(() => {
      router.push(`/dashboard/reports/cash-flow?period=${value}`);
    });
  };

  const handleRefresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  const handleExport = () => {
    if (!initialData) return;

    const headers = ["Category", "Description", "Amount"];
    const rows = [];

    rows.push(["OPERATING ACTIVITIES", "", ""]);
    initialData.operating.transactions.forEach((t) => {
      rows.push(["", t.description, t.amount]);
    });
    rows.push(["Net Cash from Operating", "", initialData.summary.operatingCashFlow]);
    rows.push(["", "", ""]);

    rows.push(["INVESTING ACTIVITIES", "", ""]);
    initialData.investing.transactions.forEach((t) => {
      rows.push(["", t.description, t.amount]);
    });
    rows.push(["Net Cash from Investing", "", initialData.summary.investingCashFlow]);
    rows.push(["", "", ""]);

    rows.push(["FINANCING ACTIVITIES", "", ""]);
    initialData.financing.transactions.forEach((t) => {
      rows.push(["", t.description, t.amount]);
    });
    rows.push(["Net Cash from Financing", "", initialData.summary.financingCashFlow]);
    rows.push(["", "", ""]);

    rows.push(["NET CHANGE IN CASH", "", initialData.summary.netCashFlow]);

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cash-flow-${format(new Date(startDate), "yyyy-MM-dd")}.csv`;
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
  const netCashFlow = data?.summary?.netCashFlow || 0;
  const isPositive = netCashFlow >= 0;

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">
                Cash Flow Statement
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {format(new Date(startDate), "MMM d, yyyy")} -{" "}
                {format(new Date(endDate), "MMM d, yyyy")}
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
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="p-4 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-2 mb-2">
              <Briefcase className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                Operating
              </span>
            </div>
            <p
              className={cn(
                "text-xl font-bold tabular-nums",
                (data?.summary?.operatingCashFlow || 0) >= 0
                  ? "text-blue-700 dark:text-blue-300"
                  : "text-red-600 dark:text-red-400"
              )}
            >
              KES {formatCurrency(data?.summary?.operatingCashFlow || 0)}
            </p>
          </Card>

          <Card className="p-4 bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              <span className="text-sm font-medium text-purple-800 dark:text-purple-200">
                Investing
              </span>
            </div>
            <p
              className={cn(
                "text-xl font-bold tabular-nums",
                (data?.summary?.investingCashFlow || 0) >= 0
                  ? "text-purple-700 dark:text-purple-300"
                  : "text-red-600 dark:text-red-400"
              )}
            >
              KES {formatCurrency(data?.summary?.investingCashFlow || 0)}
            </p>
          </Card>

          <Card className="p-4 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
            <div className="flex items-center gap-2 mb-2">
              <Landmark className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
                Financing
              </span>
            </div>
            <p
              className={cn(
                "text-xl font-bold tabular-nums",
                (data?.summary?.financingCashFlow || 0) >= 0
                  ? "text-amber-700 dark:text-amber-300"
                  : "text-red-600 dark:text-red-400"
              )}
            >
              KES {formatCurrency(data?.summary?.financingCashFlow || 0)}
            </p>
          </Card>

          <Card
            className={cn(
              "p-4",
              isPositive
                ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
            )}
          >
            <div className="flex items-center gap-2 mb-2">
              {isPositive ? (
                <ArrowUpRight className="h-5 w-5 text-green-600 dark:text-green-400" />
              ) : (
                <ArrowDownRight className="h-5 w-5 text-red-600 dark:text-red-400" />
              )}
              <span
                className={cn(
                  "text-sm font-medium",
                  isPositive
                    ? "text-green-800 dark:text-green-200"
                    : "text-red-800 dark:text-red-200"
                )}
              >
                Net Change
              </span>
            </div>
            <p
              className={cn(
                "text-xl font-bold tabular-nums",
                isPositive
                  ? "text-green-700 dark:text-green-300"
                  : "text-red-700 dark:text-red-300"
              )}
            >
              KES {formatCurrency(netCashFlow)}
            </p>
          </Card>
        </div>
      </div>

      {/* Cash Flow Sections */}
      <div className="px-4 sm:px-6 lg:px-8 space-y-6">
        {/* Operating Activities */}
        <Card className="overflow-hidden">
          <div className="bg-blue-50 dark:bg-blue-900/20 px-4 py-3 border-b border-border flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <h2 className="font-bold text-blue-800 dark:text-blue-200">
              Cash Flows from Operating Activities
            </h2>
          </div>
          <ReportTable>
            <ReportTableBody>
              {data?.operating?.transactions?.length > 0 ? (
                <>
                  {data.operating.transactions.map((transaction, index) => (
                    <ReportTableRow key={`op-${index}`}>
                      <ReportTableCell className="text-muted-foreground w-28">
                        {format(new Date(transaction.date), "MMM d")}
                      </ReportTableCell>
                      <ReportTableCell className="max-w-md">
                        {transaction.description}
                        {transaction.entryNumber && (
                          <span className="text-xs text-muted-foreground ml-2">
                            ({transaction.entryNumber})
                          </span>
                        )}
                      </ReportTableCell>
                      <ReportTableCell
                        align="right"
                        className={cn(
                          "tabular-nums w-32",
                          transaction.amount >= 0
                            ? "text-green-600 dark:text-green-400"
                            : "text-red-600 dark:text-red-400"
                        )}
                      >
                        {formatCurrency(transaction.amount)}
                      </ReportTableCell>
                    </ReportTableRow>
                  ))}
                  <ReportTableRow isSubtotal>
                    <ReportTableCell colSpan={2} className="font-semibold">
                      Net Cash from Operating Activities
                    </ReportTableCell>
                    <ReportTableCell
                      align="right"
                      className={cn(
                        "tabular-nums font-semibold",
                        (data?.summary?.operatingCashFlow || 0) >= 0
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      )}
                    >
                      {formatCurrency(data?.summary?.operatingCashFlow || 0)}
                    </ReportTableCell>
                  </ReportTableRow>
                </>
              ) : (
                <ReportTableRow>
                  <ReportTableCell colSpan={3} className="text-center text-muted-foreground py-8">
                    No operating activities for this period.
                  </ReportTableCell>
                </ReportTableRow>
              )}
            </ReportTableBody>
          </ReportTable>
        </Card>

        {/* Investing Activities */}
        <Card className="overflow-hidden">
          <div className="bg-purple-50 dark:bg-purple-900/20 px-4 py-3 border-b border-border flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            <h2 className="font-bold text-purple-800 dark:text-purple-200">
              Cash Flows from Investing Activities
            </h2>
          </div>
          <ReportTable>
            <ReportTableBody>
              {data?.investing?.transactions?.length > 0 ? (
                <>
                  {data.investing.transactions.map((transaction, index) => (
                    <ReportTableRow key={`inv-${index}`}>
                      <ReportTableCell className="text-muted-foreground w-28">
                        {format(new Date(transaction.date), "MMM d")}
                      </ReportTableCell>
                      <ReportTableCell className="max-w-md">
                        {transaction.description}
                      </ReportTableCell>
                      <ReportTableCell
                        align="right"
                        className={cn(
                          "tabular-nums w-32",
                          transaction.amount >= 0
                            ? "text-green-600 dark:text-green-400"
                            : "text-red-600 dark:text-red-400"
                        )}
                      >
                        {formatCurrency(transaction.amount)}
                      </ReportTableCell>
                    </ReportTableRow>
                  ))}
                  <ReportTableRow isSubtotal>
                    <ReportTableCell colSpan={2} className="font-semibold">
                      Net Cash from Investing Activities
                    </ReportTableCell>
                    <ReportTableCell
                      align="right"
                      className={cn(
                        "tabular-nums font-semibold",
                        (data?.summary?.investingCashFlow || 0) >= 0
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      )}
                    >
                      {formatCurrency(data?.summary?.investingCashFlow || 0)}
                    </ReportTableCell>
                  </ReportTableRow>
                </>
              ) : (
                <ReportTableRow>
                  <ReportTableCell colSpan={3} className="text-center text-muted-foreground py-8">
                    No investing activities for this period.
                  </ReportTableCell>
                </ReportTableRow>
              )}
            </ReportTableBody>
          </ReportTable>
        </Card>

        {/* Financing Activities */}
        <Card className="overflow-hidden">
          <div className="bg-amber-50 dark:bg-amber-900/20 px-4 py-3 border-b border-border flex items-center gap-2">
            <Landmark className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <h2 className="font-bold text-amber-800 dark:text-amber-200">
              Cash Flows from Financing Activities
            </h2>
          </div>
          <ReportTable>
            <ReportTableBody>
              {data?.financing?.transactions?.length > 0 ? (
                <>
                  {data.financing.transactions.map((transaction, index) => (
                    <ReportTableRow key={`fin-${index}`}>
                      <ReportTableCell className="text-muted-foreground w-28">
                        {format(new Date(transaction.date), "MMM d")}
                      </ReportTableCell>
                      <ReportTableCell className="max-w-md">
                        {transaction.description}
                      </ReportTableCell>
                      <ReportTableCell
                        align="right"
                        className={cn(
                          "tabular-nums w-32",
                          transaction.amount >= 0
                            ? "text-green-600 dark:text-green-400"
                            : "text-red-600 dark:text-red-400"
                        )}
                      >
                        {formatCurrency(transaction.amount)}
                      </ReportTableCell>
                    </ReportTableRow>
                  ))}
                  <ReportTableRow isSubtotal>
                    <ReportTableCell colSpan={2} className="font-semibold">
                      Net Cash from Financing Activities
                    </ReportTableCell>
                    <ReportTableCell
                      align="right"
                      className={cn(
                        "tabular-nums font-semibold",
                        (data?.summary?.financingCashFlow || 0) >= 0
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      )}
                    >
                      {formatCurrency(data?.summary?.financingCashFlow || 0)}
                    </ReportTableCell>
                  </ReportTableRow>
                </>
              ) : (
                <ReportTableRow>
                  <ReportTableCell colSpan={3} className="text-center text-muted-foreground py-8">
                    No financing activities for this period.
                  </ReportTableCell>
                </ReportTableRow>
              )}
            </ReportTableBody>
          </ReportTable>
        </Card>

        {/* Net Change in Cash */}
        <Card
          className={cn(
            "p-4",
            isPositive
              ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
              : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isPositive ? (
                <ArrowUpRight className="h-8 w-8 text-green-600 dark:text-green-400" />
              ) : (
                <ArrowDownRight className="h-8 w-8 text-red-600 dark:text-red-400" />
              )}
              <div>
                <p
                  className={cn(
                    "text-lg font-bold",
                    isPositive
                      ? "text-green-800 dark:text-green-200"
                      : "text-red-800 dark:text-red-200"
                  )}
                >
                  Net {isPositive ? "Increase" : "Decrease"} in Cash
                </p>
                <p
                  className={cn(
                    "text-sm",
                    isPositive
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400"
                  )}
                >
                  For the period {format(new Date(startDate), "MMM d")} -{" "}
                  {format(new Date(endDate), "MMM d, yyyy")}
                </p>
              </div>
            </div>
            <p
              className={cn(
                "text-3xl font-bold tabular-nums",
                isPositive
                  ? "text-green-700 dark:text-green-300"
                  : "text-red-700 dark:text-red-300"
              )}
            >
              KES {formatCurrency(Math.abs(netCashFlow))}
            </p>
          </div>
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
