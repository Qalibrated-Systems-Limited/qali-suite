"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Download,
  Printer,
  Loader2,
  AlertCircle,
  Users,
  FileText,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils/erp-utils";

export function ARAgingClient({ initialData, initialAsOfDate, error }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [asOfDate, setAsOfDate] = useState(initialAsOfDate);
  const data = initialData;

  const handleDateChange = () => {
    startTransition(() => {
      router.push(`/dashboard/reports/ar-aging?asOf=${asOfDate}`);
    });
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportCSV = () => {
    if (!data?.customers?.length) return;

    const headers = [
      "Customer",
      "Current",
      "1-30 Days",
      "31-60 Days",
      "61-90 Days",
      "90+ Days",
      "Total",
      "Invoices",
    ];

    const rows = data.customers.map((c) => [
      c.customerName,
      c.current.toFixed(2),
      c.days1_30.toFixed(2),
      c.days31_60.toFixed(2),
      c.days61_90.toFixed(2),
      c.days90plus.toFixed(2),
      c.total.toFixed(2),
      c.invoiceCount,
    ]);

    rows.push([
      "TOTAL",
      data.summary.current.toFixed(2),
      data.summary.days1_30.toFixed(2),
      data.summary.days31_60.toFixed(2),
      data.summary.days61_90.toFixed(2),
      data.summary.days90plus.toFixed(2),
      data.summary.total.toFixed(2),
      data.summary.invoiceCount,
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((r) => r.join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ar-aging-${asOfDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 max-w-7xl">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 max-w-7xl print:p-0">
      {/* Header */}
      <div className="flex flex-col gap-4 mb-4 sm:mb-6 print:hidden">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-foreground">
              AR Aging Report
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
              Accounts receivable aging by customer
            </p>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={handlePrint}
              className="h-8 w-8 sm:h-9 sm:w-9"
            >
              <Printer className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleExportCSV}
              className="h-8 w-8 sm:h-9 sm:w-9"
            >
              <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </Button>
          </div>
        </div>

        {/* Date Filter */}
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className="h-9 text-sm w-auto"
          />
          <Button
            variant="default"
            onClick={handleDateChange}
            disabled={isPending}
            className="h-9 text-sm"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
          </Button>
        </div>
      </div>

      {/* Print Header */}
      <div className="hidden print:block mb-6">
        <h1 className="text-2xl font-bold text-center">AR Aging Report</h1>
        <p className="text-center text-muted-foreground">
          As of {formatDate(data?.asOfDate)}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-2 sm:gap-4 grid-cols-2 lg:grid-cols-4 mb-4 sm:mb-6 print:grid-cols-4">
        <Card className="p-3 sm:p-0">
          <CardHeader className="p-0 sm:p-4 sm:pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-[10px] sm:text-sm font-medium text-muted-foreground">
              Total Receivables
            </CardTitle>
            <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground hidden sm:block" />
          </CardHeader>
          <CardContent className="p-0 sm:p-4 sm:pt-0 mt-1 sm:mt-0">
            <div className="text-base sm:text-xl lg:text-2xl font-bold text-foreground">
              {formatCurrency(data?.summary?.total || 0)}
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              {data?.summary?.invoiceCount || 0} invoices
            </p>
          </CardContent>
        </Card>

        <Card className="p-3 sm:p-0">
          <CardHeader className="p-0 sm:p-4 sm:pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-[10px] sm:text-sm font-medium text-muted-foreground">
              Current
            </CardTitle>
            <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-green-600 hidden sm:block" />
          </CardHeader>
          <CardContent className="p-0 sm:p-4 sm:pt-0 mt-1 sm:mt-0">
            <div className="text-base sm:text-xl lg:text-2xl font-bold text-green-600">
              {formatCurrency(data?.summary?.current || 0)}
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              {data?.summary?.total > 0
                ? ((data.summary.current / data.summary.total) * 100).toFixed(1)
                : 0}
              % of total
            </p>
          </CardContent>
        </Card>

        <Card className="p-3 sm:p-0">
          <CardHeader className="p-0 sm:p-4 sm:pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-[10px] sm:text-sm font-medium text-muted-foreground">
              Overdue
            </CardTitle>
            <AlertTriangle className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-red-600 hidden sm:block" />
          </CardHeader>
          <CardContent className="p-0 sm:p-4 sm:pt-0 mt-1 sm:mt-0">
            <div className="text-base sm:text-xl lg:text-2xl font-bold text-red-600">
              {formatCurrency(data?.summary?.overdueTotal || 0)}
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              {(data?.summary?.overduePercent || 0).toFixed(1)}% overdue
            </p>
          </CardContent>
        </Card>

        <Card className="p-3 sm:p-0">
          <CardHeader className="p-0 sm:p-4 sm:pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-[10px] sm:text-sm font-medium text-muted-foreground">
              Customers
            </CardTitle>
            <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground hidden sm:block" />
          </CardHeader>
          <CardContent className="p-0 sm:p-4 sm:pt-0 mt-1 sm:mt-0">
            <div className="text-base sm:text-xl lg:text-2xl font-bold text-foreground">
              {data?.summary?.customerCount || 0}
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              With balance
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Aging Table */}
      <Card>
        <CardContent className="p-0">
          {!data?.customers?.length ? (
            <div className="p-8 sm:p-12 text-center">
              <FileText className="h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground mx-auto mb-3 sm:mb-4" />
              <h3 className="text-base sm:text-lg font-semibold text-foreground mb-1.5 sm:mb-2">
                No Outstanding Receivables
              </h3>
              <p className="text-xs sm:text-sm text-muted-foreground">
                All customer invoices have been paid.
              </p>
            </div>
          ) : (
            <>
              {/* Mobile Card View */}
              <div className="md:hidden divide-y divide-border">
                {data.customers.map((customer, idx) => (
                  <div
                    key={`${customer.customerId}-${idx}`}
                    className="p-3 hover:bg-muted/30 active:bg-muted/50"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm text-foreground truncate pr-2">
                        {customer.customerName}
                      </span>
                      <span className="font-semibold text-sm tabular-nums">
                        {formatCurrency(customer.total)}
                      </span>
                    </div>
                    <div className="grid grid-cols-5 gap-1 text-[10px]">
                      <div className="text-center">
                        <span className="text-muted-foreground block">Curr</span>
                        <span className="font-medium tabular-nums text-green-600">
                          {customer.current > 0 ? formatCurrency(customer.current) : "-"}
                        </span>
                      </div>
                      <div className="text-center">
                        <span className="text-muted-foreground block">1-30</span>
                        <span className="font-medium tabular-nums text-yellow-600">
                          {customer.days1_30 > 0 ? formatCurrency(customer.days1_30) : "-"}
                        </span>
                      </div>
                      <div className="text-center">
                        <span className="text-muted-foreground block">31-60</span>
                        <span className="font-medium tabular-nums text-orange-600">
                          {customer.days31_60 > 0 ? formatCurrency(customer.days31_60) : "-"}
                        </span>
                      </div>
                      <div className="text-center">
                        <span className="text-muted-foreground block">61-90</span>
                        <span className="font-medium tabular-nums text-red-500">
                          {customer.days61_90 > 0 ? formatCurrency(customer.days61_90) : "-"}
                        </span>
                      </div>
                      <div className="text-center">
                        <span className="text-muted-foreground block">90+</span>
                        <span className="font-medium tabular-nums text-red-600">
                          {customer.days90plus > 0 ? formatCurrency(customer.days90plus) : "-"}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                {/* Mobile Total */}
                <div className="p-3 bg-muted/50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm">TOTAL</span>
                    <span className="font-semibold text-sm tabular-nums">
                      {formatCurrency(data.summary.total)}
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-1 text-[10px]">
                    <div className="text-center">
                      <span className="font-semibold tabular-nums text-green-600">
                        {formatCurrency(data.summary.current)}
                      </span>
                    </div>
                    <div className="text-center">
                      <span className="font-semibold tabular-nums text-yellow-600">
                        {formatCurrency(data.summary.days1_30)}
                      </span>
                    </div>
                    <div className="text-center">
                      <span className="font-semibold tabular-nums text-orange-600">
                        {formatCurrency(data.summary.days31_60)}
                      </span>
                    </div>
                    <div className="text-center">
                      <span className="font-semibold tabular-nums text-red-500">
                        {formatCurrency(data.summary.days61_90)}
                      </span>
                    </div>
                    <div className="text-center">
                      <span className="font-semibold tabular-nums text-red-600">
                        {formatCurrency(data.summary.days90plus)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left p-4 text-xs font-medium text-muted-foreground">
                        Customer
                      </th>
                      <th className="text-right p-4 text-xs font-medium text-muted-foreground">
                        Current
                      </th>
                      <th className="text-right p-4 text-xs font-medium text-muted-foreground">
                        1-30 Days
                      </th>
                      <th className="text-right p-4 text-xs font-medium text-muted-foreground">
                        31-60 Days
                      </th>
                      <th className="text-right p-4 text-xs font-medium text-muted-foreground">
                        61-90 Days
                      </th>
                      <th className="text-right p-4 text-xs font-medium text-red-600">
                        90+ Days
                      </th>
                      <th className="text-right p-4 text-xs font-medium text-muted-foreground">
                        Total
                      </th>
                      <th className="text-center p-4 text-xs font-medium text-muted-foreground print:hidden">
                        Invoices
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.customers.map((customer, idx) => (
                      <tr
                        key={`${customer.customerId}-${idx}`}
                        className="border-b border-border hover:bg-muted/30"
                      >
                        <td className="p-4">
                          <span className="text-sm font-medium text-foreground">
                            {customer.customerName}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <span className="text-sm tabular-nums text-green-600">
                            {customer.current > 0
                              ? formatCurrency(customer.current)
                              : "-"}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <span className="text-sm tabular-nums text-yellow-600">
                            {customer.days1_30 > 0
                              ? formatCurrency(customer.days1_30)
                              : "-"}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <span className="text-sm tabular-nums text-orange-600">
                            {customer.days31_60 > 0
                              ? formatCurrency(customer.days31_60)
                              : "-"}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <span className="text-sm tabular-nums text-red-500">
                            {customer.days61_90 > 0
                              ? formatCurrency(customer.days61_90)
                              : "-"}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <span className="text-sm tabular-nums text-red-600 font-medium">
                            {customer.days90plus > 0
                              ? formatCurrency(customer.days90plus)
                              : "-"}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <span className="text-sm font-semibold tabular-nums text-foreground">
                            {formatCurrency(customer.total)}
                          </span>
                        </td>
                        <td className="p-4 text-center print:hidden">
                          <span className="text-sm text-muted-foreground">
                            {customer.invoiceCount}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/50 font-semibold">
                      <td className="p-4 text-sm text-foreground">TOTAL</td>
                      <td className="p-4 text-right text-sm tabular-nums text-green-600">
                        {formatCurrency(data.summary.current)}
                      </td>
                      <td className="p-4 text-right text-sm tabular-nums text-yellow-600">
                        {formatCurrency(data.summary.days1_30)}
                      </td>
                      <td className="p-4 text-right text-sm tabular-nums text-orange-600">
                        {formatCurrency(data.summary.days31_60)}
                      </td>
                      <td className="p-4 text-right text-sm tabular-nums text-red-500">
                        {formatCurrency(data.summary.days61_90)}
                      </td>
                      <td className="p-4 text-right text-sm tabular-nums text-red-600">
                        {formatCurrency(data.summary.days90plus)}
                      </td>
                      <td className="p-4 text-right text-sm tabular-nums text-foreground">
                        {formatCurrency(data.summary.total)}
                      </td>
                      <td className="p-4 text-center text-sm text-muted-foreground print:hidden">
                        {data.summary.invoiceCount}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Aging Distribution Bar */}
      {data?.summary?.total > 0 && (
        <Card className="mt-4 sm:mt-6 print:hidden">
          <CardHeader className="p-3 sm:p-4 pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">
              Aging Distribution
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-4 pt-0">
            <div className="flex h-6 sm:h-8 rounded-lg overflow-hidden">
              {[
                { key: "current", color: "bg-green-500", label: "Current" },
                { key: "days1_30", color: "bg-yellow-500", label: "1-30" },
                { key: "days31_60", color: "bg-orange-500", label: "31-60" },
                { key: "days61_90", color: "bg-red-400", label: "61-90" },
                { key: "days90plus", color: "bg-red-600", label: "90+" },
              ].map(({ key, color, label }) => {
                const value = data.summary[key];
                const percent = (value / data.summary.total) * 100;
                if (percent < 1) return null;
                return (
                  <div
                    key={key}
                    className={`${color} flex items-center justify-center text-[10px] sm:text-xs text-white font-medium`}
                    style={{ width: `${percent}%` }}
                    title={`${label}: ${formatCurrency(value)} (${percent.toFixed(1)}%)`}
                  >
                    {percent >= 10 && `${percent.toFixed(0)}%`}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap justify-between gap-2 mt-2 text-[10px] sm:text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-green-500 rounded" /> Current
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-yellow-500 rounded" /> 1-30
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-orange-500 rounded" /> 31-60
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-red-400 rounded" /> 61-90
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-red-600 rounded" /> 90+
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
