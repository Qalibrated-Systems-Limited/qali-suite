"use client";

import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";

export function QuoteItemsTable({ items = [] }) {
  if (!items || items.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>No items in this quote</p>
      </div>
    );
  }

  return (
    <>
      {/* Desktop Table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Item
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Qty
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Unit Price
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Disc %
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Tax
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((item, index) => (
              <tr key={item._id || index} className="hover:bg-muted/30">
                <td className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    <Badge
                      variant="outline"
                      className={
                        item.itemType === "product"
                          ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
                          : "bg-purple-500/10 text-purple-600 border-purple-500/20"
                      }
                    >
                      {item.itemType === "product" ? "Product" : "Service"}
                    </Badge>
                    <div>
                      <p className="font-medium text-foreground">
                        {item.product?.name || item.description}
                      </p>
                      {item.product?.sku && (
                        <p className="text-xs text-muted-foreground">
                          SKU: {item.product.sku}
                        </p>
                      )}
                      {item.notes && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {item.notes}
                        </p>
                      )}
                      {/* Show invoiced status */}
                      {item.invoicedQuantity > 0 && (
                        <p className="text-xs text-purple-500 mt-1">
                          Invoiced: {item.invoicedQuantity} / {item.quantity}
                        </p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-sm text-foreground whitespace-nowrap">
                  {item.quantity} {item.unit}
                </td>
                <td className="px-4 py-3 text-right text-sm text-foreground whitespace-nowrap">
                  {formatCurrency(item.unitPrice)}
                </td>
                <td className="px-4 py-3 text-right text-sm text-foreground whitespace-nowrap">
                  {item.discountPercentage > 0 ? (
                    <span className="text-red-500">
                      {item.discountPercentage}%
                    </span>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-4 py-3 text-right text-sm text-foreground whitespace-nowrap">
                  {formatCurrency(item.taxAmount)}
                  <span className="text-xs text-muted-foreground ml-1">
                    ({item.taxRate}%)
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-sm font-semibold text-foreground whitespace-nowrap">
                  {formatCurrency(item.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="sm:hidden divide-y divide-border">
        {items.map((item, index) => (
          <div key={item._id || index} className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Badge
                    variant="outline"
                    className={
                      item.itemType === "product"
                        ? "bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs"
                        : "bg-purple-500/10 text-purple-600 border-purple-500/20 text-xs"
                    }
                  >
                    {item.itemType === "product" ? "Product" : "Service"}
                  </Badge>
                </div>
                <p className="font-medium text-foreground">
                  {item.product?.name || item.description}
                </p>
                {item.product?.sku && (
                  <p className="text-xs text-muted-foreground">
                    SKU: {item.product.sku}
                  </p>
                )}
              </div>
              <p className="text-lg font-bold text-foreground">
                {formatCurrency(item.lineTotal)}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Qty:</span>
                <span className="text-foreground">
                  {item.quantity} {item.unit}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Price:</span>
                <span className="text-foreground">
                  {formatCurrency(item.unitPrice)}
                </span>
              </div>
              {item.discountPercentage > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Discount:</span>
                  <span className="text-red-500">{item.discountPercentage}%</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax:</span>
                <span className="text-foreground">
                  {formatCurrency(item.taxAmount)} ({item.taxRate}%)
                </span>
              </div>
            </div>

            {item.invoicedQuantity > 0 && (
              <p className="text-xs text-purple-500">
                Invoiced: {item.invoicedQuantity} / {item.quantity}
              </p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
