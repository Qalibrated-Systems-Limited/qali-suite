"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  Printer,
  AlertCircle,
  Package,
  DollarSign,
  TrendingUp,
  Search,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils/erp-utils";

export function StockValuationClient({ initialData, error }) {
  const [search, setSearch] = useState("");
  const [expandedCategories, setExpandedCategories] = useState(new Set());
  const [showZeroStock, setShowZeroStock] = useState(false);
  const data = initialData;

  const toggleCategory = (category) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  const expandAll = () => {
    setExpandedCategories(new Set(data.categories.map((c) => c.category)));
  };

  const collapseAll = () => {
    setExpandedCategories(new Set());
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportCSV = () => {
    if (!data?.products?.length) return;

    const headers = [
      "SKU",
      "Product Name",
      "Category",
      "Unit",
      "Quantity",
      "Cost Price",
      "Selling Price",
      "Inventory Value",
      "Retail Value",
      "Potential Profit",
    ];

    const rows = data.products
      .filter((p) => showZeroStock || p.quantity > 0)
      .map((p) => [
        p.SKU,
        p.name,
        p.category,
        p.unit,
        p.quantity,
        p.costPrice.toFixed(2),
        p.sellingPrice.toFixed(2),
        p.inventoryValue.toFixed(2),
        p.retailValue.toFixed(2),
        p.potentialProfit.toFixed(2),
      ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join(
      "\n"
    );

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-valuation-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Filter products by search
  const filteredCategories = data?.categories
    ?.map((cat) => ({
      ...cat,
      items: cat.items.filter((item) => {
        if (!showZeroStock && item.quantity === 0) return false;
        if (!search) return true;
        const searchLower = search.toLowerCase();
        return (
          item.name.toLowerCase().includes(searchLower) ||
          item.SKU?.toLowerCase().includes(searchLower)
        );
      }),
    }))
    .filter((cat) => cat.items.length > 0);

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
              Stock Valuation
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
              Inventory value by product
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

        {/* Search and Filters */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={expandAll}
              className="h-8 text-xs"
            >
              Expand All
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={collapseAll}
              className="h-8 text-xs"
            >
              Collapse All
            </Button>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto">
              <input
                type="checkbox"
                checked={showZeroStock}
                onChange={(e) => setShowZeroStock(e.target.checked)}
                className="rounded border-border h-3.5 w-3.5"
              />
              Zero stock
            </label>
          </div>
        </div>
      </div>

      {/* Print Header */}
      <div className="hidden print:block mb-6">
        <h1 className="text-2xl font-bold text-center">Stock Valuation Report</h1>
        <p className="text-center text-muted-foreground">
          Generated on {formatDate(data?.generatedAt)}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-2 sm:gap-4 grid-cols-2 lg:grid-cols-4 mb-4 sm:mb-6 print:grid-cols-4">
        <Card className="p-3 sm:p-0">
          <CardHeader className="p-0 sm:p-4 sm:pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-[10px] sm:text-sm font-medium text-muted-foreground">
              Inventory Value
            </CardTitle>
            <DollarSign className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground hidden sm:block" />
          </CardHeader>
          <CardContent className="p-0 sm:p-4 sm:pt-0 mt-1 sm:mt-0">
            <div className="text-base sm:text-xl lg:text-2xl font-bold text-foreground">
              {formatCurrency(data?.summary?.totalInventoryValue || 0)}
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              At cost price
            </p>
          </CardContent>
        </Card>

        <Card className="p-3 sm:p-0">
          <CardHeader className="p-0 sm:p-4 sm:pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-[10px] sm:text-sm font-medium text-muted-foreground">
              Retail Value
            </CardTitle>
            <TrendingUp className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-green-600 hidden sm:block" />
          </CardHeader>
          <CardContent className="p-0 sm:p-4 sm:pt-0 mt-1 sm:mt-0">
            <div className="text-base sm:text-xl lg:text-2xl font-bold text-green-600">
              {formatCurrency(data?.summary?.totalRetailValue || 0)}
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              At selling price
            </p>
          </CardContent>
        </Card>

        <Card className="p-3 sm:p-0">
          <CardHeader className="p-0 sm:p-4 sm:pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-[10px] sm:text-sm font-medium text-muted-foreground">
              Potential Profit
            </CardTitle>
            <DollarSign className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-green-600 hidden sm:block" />
          </CardHeader>
          <CardContent className="p-0 sm:p-4 sm:pt-0 mt-1 sm:mt-0">
            <div className="text-base sm:text-xl lg:text-2xl font-bold text-green-600">
              {formatCurrency(data?.summary?.totalPotentialProfit || 0)}
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              {(data?.summary?.averageMargin || 0).toFixed(1)}% margin
            </p>
          </CardContent>
        </Card>

        <Card className="p-3 sm:p-0">
          <CardHeader className="p-0 sm:p-4 sm:pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-[10px] sm:text-sm font-medium text-muted-foreground">
              Products
            </CardTitle>
            <Package className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground hidden sm:block" />
          </CardHeader>
          <CardContent className="p-0 sm:p-4 sm:pt-0 mt-1 sm:mt-0">
            <div className="text-base sm:text-xl lg:text-2xl font-bold text-foreground">
              {data?.summary?.productsWithStock || 0}
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              {data?.summary?.productsOutOfStock || 0} out of stock
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Category Groups */}
      {!filteredCategories?.length ? (
        <Card>
          <CardContent className="p-8 sm:p-12 text-center">
            <Package className="h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground mx-auto mb-3 sm:mb-4" />
            <h3 className="text-base sm:text-lg font-semibold text-foreground mb-1.5 sm:mb-2">
              No Products Found
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {search
                ? "No products match your search."
                : "No products with stock in inventory."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3 sm:space-y-4">
          {filteredCategories.map((category) => (
            <Card key={category.category}>
              {/* Category Header */}
              <button
                onClick={() => toggleCategory(category.category)}
                className="w-full p-3 sm:p-4 flex items-center justify-between hover:bg-muted/30 active:bg-muted/50 transition-colors print:pointer-events-none"
              >
                <div className="flex items-center gap-2 sm:gap-3">
                  {expandedCategories.has(category.category) ? (
                    <ChevronDown className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground print:hidden" />
                  ) : (
                    <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground print:hidden" />
                  )}
                  <div className="text-left">
                    <h3 className="font-semibold text-sm sm:text-base text-foreground">
                      {category.category}
                    </h3>
                    <p className="text-[10px] sm:text-xs text-muted-foreground">
                      {category.items.length} products • {category.totalQuantity} units
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-sm sm:text-base text-foreground">
                    {formatCurrency(category.totalInventoryValue)}
                  </p>
                  <p className="text-[10px] sm:text-xs text-green-600">
                    Retail: {formatCurrency(category.totalRetailValue)}
                  </p>
                </div>
              </button>

              {/* Category Items */}
              {(expandedCategories.has(category.category) || true) && (
                <div
                  className={`border-t border-border ${
                    !expandedCategories.has(category.category) ? "hidden print:block" : ""
                  }`}
                >
                  {/* Mobile Card View */}
                  <div className="md:hidden divide-y divide-border">
                    {category.items.map((item) => (
                      <div
                        key={item._id}
                        className="p-3 hover:bg-muted/20"
                      >
                        <div className="flex items-start justify-between mb-1">
                          <div className="min-w-0 flex-1">
                            <span className="font-medium text-sm text-foreground block truncate">
                              {item.name}
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground">
                              {item.SKU}
                            </span>
                          </div>
                          <span className="font-semibold text-sm tabular-nums ml-2">
                            {formatCurrency(item.inventoryValue)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-2">
                            <span>{item.quantity} {item.unit}</span>
                            {item.quantity === 0 && (
                              <Badge
                                variant="outline"
                                className="text-red-600 border-red-200 text-[9px] px-1 py-0"
                              >
                                Out
                              </Badge>
                            )}
                          </span>
                          <span>@ {formatCurrency(item.costPrice)}</span>
                        </div>
                      </div>
                    ))}
                    {/* Mobile Subtotal */}
                    <div className="p-3 bg-muted/50 flex items-center justify-between">
                      <span className="font-medium text-sm">Subtotal ({category.totalQuantity})</span>
                      <span className="font-semibold text-sm tabular-nums">
                        {formatCurrency(category.totalInventoryValue)}
                      </span>
                    </div>
                  </div>

                  {/* Desktop Table View */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-muted/30">
                          <th className="text-left p-3 text-xs font-medium text-muted-foreground">
                            SKU
                          </th>
                          <th className="text-left p-3 text-xs font-medium text-muted-foreground">
                            Product
                          </th>
                          <th className="text-right p-3 text-xs font-medium text-muted-foreground">
                            Qty
                          </th>
                          <th className="text-right p-3 text-xs font-medium text-muted-foreground">
                            Cost
                          </th>
                          <th className="text-right p-3 text-xs font-medium text-muted-foreground">
                            Selling
                          </th>
                          <th className="text-right p-3 text-xs font-medium text-muted-foreground">
                            Value
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {category.items.map((item) => (
                          <tr
                            key={item._id}
                            className="border-b border-border last:border-0 hover:bg-muted/20"
                          >
                            <td className="p-3 text-xs font-mono text-muted-foreground">
                              {item.SKU}
                            </td>
                            <td className="p-3">
                              <span className="text-sm text-foreground">
                                {item.name}
                              </span>
                              {item.quantity === 0 && (
                                <Badge
                                  variant="outline"
                                  className="ml-2 text-red-600 border-red-200"
                                >
                                  Out of stock
                                </Badge>
                              )}
                            </td>
                            <td className="p-3 text-right text-sm tabular-nums">
                              {item.quantity} {item.unit}
                            </td>
                            <td className="p-3 text-right text-sm tabular-nums text-muted-foreground">
                              {formatCurrency(item.costPrice)}
                            </td>
                            <td className="p-3 text-right text-sm tabular-nums text-muted-foreground">
                              {formatCurrency(item.sellingPrice)}
                            </td>
                            <td className="p-3 text-right text-sm tabular-nums font-medium">
                              {formatCurrency(item.inventoryValue)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted/50 font-medium">
                          <td colSpan={2} className="p-3 text-sm">
                            Subtotal
                          </td>
                          <td className="p-3 text-right text-sm tabular-nums">
                            {category.totalQuantity}
                          </td>
                          <td colSpan={2}></td>
                          <td className="p-3 text-right text-sm tabular-nums">
                            {formatCurrency(category.totalInventoryValue)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}
            </Card>
          ))}

          {/* Grand Total */}
          <Card className="bg-muted/30">
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm sm:text-lg font-semibold text-foreground">
                  Grand Total
                </span>
                <div className="text-right">
                  <p className="text-base sm:text-xl font-bold text-foreground">
                    {formatCurrency(data.summary.totalInventoryValue)}
                  </p>
                  <p className="text-xs sm:text-sm text-green-600">
                    Retail: {formatCurrency(data.summary.totalRetailValue)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
