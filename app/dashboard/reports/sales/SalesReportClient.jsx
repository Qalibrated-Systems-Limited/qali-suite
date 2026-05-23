"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  Loader2,
  AlertCircle,
  Users,
  Package,
  DollarSign,
  TrendingUp,
  FileText,
  ChevronRight,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils/erp-utils";

export function SalesReportClient({
  initialData,
  initialStartDate,
  initialEndDate,
  initialView,
  error,
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [view, setView] = useState(initialView);
  const data = initialData;

  const handleApply = () => {
    startTransition(() => {
      router.push(
        `/dashboard/reports/sales?startDate=${startDate}&endDate=${endDate}&view=${view}`,
      );
    });
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportCSV = () => {
    if (!data) return;

    let headers, rows;

    if (view === "product") {
      headers = [
        "SKU",
        "Product",
        "Qty Sold",
        "Revenue",
        "Avg Price",
        "Invoices",
      ];
      rows = data.products.map((p) => [
        p.productSKU || "",
        p.productName,
        p.quantitySold,
        p.totalRevenue.toFixed(2),
        (p.avgPrice || 0).toFixed(2),
        p.invoiceCount,
      ]);
    } else {
      headers = [
        "Customer",
        "Invoices",
        "Total Sales",
        "% share",
        "Margin %",
        "COGS",
        "Gross Profit",
        "Paid",
        "Outstanding",
      ];
      rows = data.customers.map((c) => [
        c.customerName,
        c.invoiceCount,
        c.totalSales.toFixed(2),
        (c.revenueShare || 0).toFixed(1),
        (c.grossMarginPct || 0).toFixed(1),
        (c.totalCOGS || 0).toFixed(2),
        (c.grossProfit || 0).toFixed(2),
        c.totalPaid.toFixed(2),
        c.totalOutstanding.toFixed(2),
      ]);
    }

    const csvContent = [
      headers.join(","),
      ...rows.map((r) => r.join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-by-${view}-${startDate}-to-${endDate}.csv`;
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
              Sales Reports
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
              Analyze sales by customer or product
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

        {/* Filters - Stack on mobile */}
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-3 items-center">
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-9 text-sm"
          />
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-9 text-sm"
          />
          <Select value={view} onValueChange={setView}>
            <SelectTrigger className="h-9 text-sm col-span-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="customer">By Customer</SelectItem>
              <SelectItem value="product">By Product</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="default"
            onClick={handleApply}
            disabled={isPending}
            className="h-9 text-sm col-span-1"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Apply"
            )}
          </Button>
        </div>
      </div>

      {/* Print Header */}
      <div className="hidden print:block mb-6">
        <h1 className="text-2xl font-bold text-center">
          Sales by {view === "product" ? "Product" : "Customer"}
        </h1>
        <p className="text-center text-muted-foreground">
          {formatDate(data?.period?.startDate)} -{" "}
          {formatDate(data?.period?.endDate)}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-2 sm:gap-4 grid-cols-2 lg:grid-cols-4 mb-4 sm:mb-6 print:grid-cols-4">
        <Card className="p-3 sm:p-0">
          <CardHeader className="p-0 sm:p-4 sm:pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-[10px] sm:text-sm font-medium text-muted-foreground">
              Total Sales
            </CardTitle>
            <DollarSign className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground hidden sm:block" />
          </CardHeader>
          <CardContent className="p-0 sm:p-4 sm:pt-0 mt-1 sm:mt-0">
            <div className="text-base sm:text-xl lg:text-2xl font-bold text-foreground">
              {formatCurrency(
                view === "product"
                  ? data?.summary?.totalRevenue || 0
                  : data?.summary?.totalSales || 0,
              )}
            </div>
          </CardContent>
        </Card>

        {view === "customer" ? (
          <>
            <Card className="p-3 sm:p-0">
              <CardHeader className="p-0 sm:p-4 sm:pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-[10px] sm:text-sm font-medium text-muted-foreground">
                  Gross Margin
                </CardTitle>
                <TrendingUp className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-green-600 hidden sm:block" />
              </CardHeader>
              <CardContent className="p-0 sm:p-4 sm:pt-0 mt-1 sm:mt-0">
                <div
                  className={`text-base sm:text-xl lg:text-2xl font-bold ${
                    (data?.summary?.grossMarginPct || 0) < 0
                      ? "text-red-600"
                      : (data?.summary?.grossMarginPct || 0) < 10
                        ? "text-amber-600"
                        : "text-green-600"
                  }`}
                >
                  {(data?.summary?.grossMarginPct || 0).toFixed(1)}%
                </div>
                <p className="text-[10px] sm:text-xs text-muted-foreground">
                  {formatCurrency(data?.summary?.grossProfit || 0)} profit
                </p>
              </CardContent>
            </Card>

            <Card className="p-3 sm:p-0">
              <CardHeader className="p-0 sm:p-4 sm:pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-[10px] sm:text-sm font-medium text-muted-foreground">
                  Outstanding
                </CardTitle>
                <AlertCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-orange-600 hidden sm:block" />
              </CardHeader>
              <CardContent className="p-0 sm:p-4 sm:pt-0 mt-1 sm:mt-0">
                <div className="text-base sm:text-xl lg:text-2xl font-bold text-orange-600">
                  {formatCurrency(data?.summary?.totalOutstanding || 0)}
                </div>
                <a
                  href="/dashboard/reports/ar-aging"
                  className="text-[10px] sm:text-xs text-muted-foreground hover:underline"
                >
                  View AR aging →
                </a>
              </CardContent>
            </Card>

            <Card className="p-3 sm:p-0">
              <CardHeader className="p-0 sm:p-4 sm:pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-[10px] sm:text-sm font-medium text-muted-foreground">
                  Top 5 share
                </CardTitle>
                <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground hidden sm:block" />
              </CardHeader>
              <CardContent className="p-0 sm:p-4 sm:pt-0 mt-1 sm:mt-0">
                <div
                  className={`text-base sm:text-xl lg:text-2xl font-bold ${
                    (data?.summary?.topFiveShare || 0) >= 70
                      ? "text-red-600"
                      : (data?.summary?.topFiveShare || 0) >= 50
                        ? "text-amber-600"
                        : "text-foreground"
                  }`}
                >
                  {(data?.summary?.topFiveShare || 0).toFixed(1)}%
                </div>
                <p className="text-[10px] sm:text-xs text-muted-foreground">
                  {data?.summary?.totalCustomers || 0} customers ·{" "}
                  {data?.summary?.totalInvoices || 0} invoices
                </p>
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            <Card className="p-3 sm:p-0">
              <CardHeader className="p-0 sm:p-4 sm:pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-[10px] sm:text-sm font-medium text-muted-foreground">
                  Units Sold
                </CardTitle>
                <Package className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground hidden sm:block" />
              </CardHeader>
              <CardContent className="p-0 sm:p-4 sm:pt-0 mt-1 sm:mt-0">
                <div className="text-base sm:text-xl lg:text-2xl font-bold text-foreground">
                  {data?.summary?.totalQuantity || 0}
                </div>
              </CardContent>
            </Card>

            <Card className="p-3 sm:p-0">
              <CardHeader className="p-0 sm:p-4 sm:pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-[10px] sm:text-sm font-medium text-muted-foreground">
                  Products
                </CardTitle>
                <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground hidden sm:block" />
              </CardHeader>
              <CardContent className="p-0 sm:p-4 sm:pt-0 mt-1 sm:mt-0">
                <div className="text-base sm:text-xl lg:text-2xl font-bold text-foreground">
                  {data?.summary?.totalProducts || 0}
                </div>
              </CardContent>
            </Card>

            <Card className="p-3 sm:p-0">
              <CardHeader className="p-0 sm:p-4 sm:pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-[10px] sm:text-sm font-medium text-muted-foreground">
                  Avg/Product
                </CardTitle>
                <TrendingUp className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground hidden sm:block" />
              </CardHeader>
              <CardContent className="p-0 sm:p-4 sm:pt-0 mt-1 sm:mt-0">
                <div className="text-base sm:text-xl lg:text-2xl font-bold text-foreground">
                  {formatCurrency(
                    data?.summary?.totalProducts > 0
                      ? data.summary.totalRevenue / data.summary.totalProducts
                      : 0,
                  )}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Data - Mobile Cards + Desktop Table */}
      <Card>
        <CardContent className="p-0">
          {view === "customer" ? (
            !data?.customers?.length ? (
              <div className="p-8 sm:p-12 text-center">
                <Users className="h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground mx-auto mb-3 sm:mb-4" />
                <h3 className="text-base sm:text-lg font-semibold text-foreground mb-1.5 sm:mb-2">
                  No Sales Data
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  No completed invoices in the selected period.
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
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground block">Sales</span>
                          <span className="font-medium tabular-nums">
                            {formatCurrency(customer.totalSales)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block">Paid</span>
                          <span className="font-medium tabular-nums text-green-600">
                            {formatCurrency(customer.totalPaid)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block">Due</span>
                          <span className={`font-medium tabular-nums ${customer.totalOutstanding > 0 ? "text-orange-600" : "text-muted-foreground"}`}>
                            {customer.totalOutstanding > 0
                              ? formatCurrency(customer.totalOutstanding)
                              : "-"}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {/* Mobile Total */}
                  <div className="p-3 bg-muted/50">
                    <div className="font-semibold text-sm mb-2">TOTAL</div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground block">Sales</span>
                        <span className="font-semibold tabular-nums">
                          {formatCurrency(data.summary.totalSales)}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Paid</span>
                        <span className="font-semibold tabular-nums text-green-600">
                          {formatCurrency(data.summary.totalPaid)}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Due</span>
                        <span className="font-semibold tabular-nums text-orange-600">
                          {formatCurrency(data.summary.totalOutstanding)}
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
                        <th className="text-center p-4 text-xs font-medium text-muted-foreground">
                          Invoices
                        </th>
                        <th className="text-right p-4 text-xs font-medium text-muted-foreground">
                          Total Sales
                        </th>
                        <th className="text-right p-4 text-xs font-medium text-muted-foreground">
                          % share
                        </th>
                        <th className="text-right p-4 text-xs font-medium text-muted-foreground">
                          Margin
                        </th>
                        <th className="text-right p-4 text-xs font-medium text-muted-foreground">
                          Paid
                        </th>
                        <th className="text-right p-4 text-xs font-medium text-muted-foreground">
                          Outstanding
                        </th>
                        <th className="text-right p-4 text-xs font-medium text-muted-foreground print:hidden">
                          Avg Invoice
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
                            {customer.customerEmail && (
                              <span className="block text-[11px] text-muted-foreground">
                                {customer.customerEmail}
                              </span>
                            )}
                          </td>
                          <td className="p-4 text-center text-sm text-muted-foreground">
                            {customer.invoiceCount}
                          </td>
                          <td className="p-4 text-right text-sm font-medium tabular-nums">
                            {formatCurrency(customer.totalSales)}
                          </td>
                          <td className="p-4 text-right text-xs tabular-nums text-muted-foreground">
                            {(customer.revenueShare || 0).toFixed(1)}%
                          </td>
                          <td
                            className={`p-4 text-right text-sm tabular-nums ${
                              (customer.grossMarginPct || 0) < 0
                                ? "text-red-600"
                                : (customer.grossMarginPct || 0) < 10
                                  ? "text-amber-600"
                                  : "text-green-600"
                            }`}
                          >
                            {(customer.grossMarginPct || 0).toFixed(1)}%
                          </td>
                          <td className="p-4 text-right text-sm tabular-nums text-green-600">
                            {formatCurrency(customer.totalPaid)}
                          </td>
                          <td className="p-4 text-right text-sm tabular-nums">
                            {customer.totalOutstanding > 0 ? (
                              <span className="text-orange-600">
                                {formatCurrency(customer.totalOutstanding)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="p-4 text-right text-sm tabular-nums text-muted-foreground print:hidden">
                            {formatCurrency(customer.avgInvoiceValue || 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-muted/50 font-semibold">
                        <td className="p-4 text-sm">TOTAL</td>
                        <td className="p-4 text-center text-sm">
                          {data.summary.totalInvoices}
                        </td>
                        <td className="p-4 text-right text-sm tabular-nums">
                          {formatCurrency(data.summary.totalSales)}
                        </td>
                        <td className="p-4"></td>
                        <td
                          className={`p-4 text-right text-sm tabular-nums ${
                            (data.summary.grossMarginPct || 0) < 0
                              ? "text-red-600"
                              : (data.summary.grossMarginPct || 0) < 10
                                ? "text-amber-600"
                                : "text-green-600"
                          }`}
                        >
                          {(data.summary.grossMarginPct || 0).toFixed(1)}%
                        </td>
                        <td className="p-4 text-right text-sm tabular-nums text-green-600">
                          {formatCurrency(data.summary.totalPaid)}
                        </td>
                        <td className="p-4 text-right text-sm tabular-nums text-orange-600">
                          {formatCurrency(data.summary.totalOutstanding)}
                        </td>
                        <td className="p-4 print:hidden"></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )
          ) : !data?.products?.length ? (
            <div className="p-8 sm:p-12 text-center">
              <Package className="h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground mx-auto mb-3 sm:mb-4" />
              <h3 className="text-base sm:text-lg font-semibold text-foreground mb-1.5 sm:mb-2">
                No Sales Data
              </h3>
              <p className="text-xs sm:text-sm text-muted-foreground">
                No completed invoices in the selected period.
              </p>
            </div>
          ) : (
            <>
              {/* Mobile Card View */}
              <div className="md:hidden divide-y divide-border">
                {data.products.map((product, idx) => (
                  <div
                    key={product.productId || idx}
                    className="p-3 hover:bg-muted/30 active:bg-muted/50"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="min-w-0 flex-1">
                        <span className="font-medium text-sm text-foreground block truncate">
                          {product.productName}
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {product.productSKU || "-"}
                        </span>
                      </div>
                      <span className="font-semibold text-sm tabular-nums ml-2">
                        {formatCurrency(product.totalRevenue)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{product.quantitySold} units sold</span>
                      <span>@ {formatCurrency(product.avgPrice || 0)} avg</span>
                    </div>
                  </div>
                ))}
                {/* Mobile Total */}
                <div className="p-3 bg-muted/50">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-sm">TOTAL</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {data.summary.totalQuantity} units
                      </span>
                    </div>
                    <span className="font-semibold text-sm tabular-nums">
                      {formatCurrency(data.summary.totalRevenue)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left p-4 text-xs font-medium text-muted-foreground">
                        SKU
                      </th>
                      <th className="text-left p-4 text-xs font-medium text-muted-foreground">
                        Product
                      </th>
                      <th className="text-right p-4 text-xs font-medium text-muted-foreground">
                        Qty Sold
                      </th>
                      <th className="text-right p-4 text-xs font-medium text-muted-foreground">
                        Revenue
                      </th>
                      <th className="text-right p-4 text-xs font-medium text-muted-foreground print:hidden">
                        Avg Price
                      </th>
                      <th className="text-center p-4 text-xs font-medium text-muted-foreground print:hidden">
                        Invoices
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.products.map((product, idx) => (
                      <tr
                        key={product.productId || idx}
                        className="border-b border-border hover:bg-muted/30"
                      >
                        <td className="p-4 text-xs font-mono text-muted-foreground">
                          {product.productSKU || "-"}
                        </td>
                        <td className="p-4">
                          <span className="text-sm font-medium text-foreground">
                            {product.productName}
                          </span>
                        </td>
                        <td className="p-4 text-right text-sm tabular-nums">
                          {product.quantitySold}
                        </td>
                        <td className="p-4 text-right text-sm font-medium tabular-nums">
                          {formatCurrency(product.totalRevenue)}
                        </td>
                        <td className="p-4 text-right text-sm tabular-nums text-muted-foreground print:hidden">
                          {formatCurrency(product.avgPrice || 0)}
                        </td>
                        <td className="p-4 text-center text-sm text-muted-foreground print:hidden">
                          {product.invoiceCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/50 font-semibold">
                      <td className="p-4"></td>
                      <td className="p-4 text-sm">TOTAL</td>
                      <td className="p-4 text-right text-sm tabular-nums">
                        {data.summary.totalQuantity}
                      </td>
                      <td className="p-4 text-right text-sm tabular-nums">
                        {formatCurrency(data.summary.totalRevenue)}
                      </td>
                      <td className="p-4 print:hidden"></td>
                      <td className="p-4 print:hidden"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
