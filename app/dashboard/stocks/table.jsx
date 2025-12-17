import { Pencil } from "lucide-react";
import {
  AddSingleItem,
  AddToCartButton,
  RemoveSingleItem,
} from "./addToCartForm";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";

export function InventoryTable({ cart = [], stock, action }) {
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <Card className="bg-[#161b22] border-[#30363d]">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-[#30363d] hover:bg-transparent">
              <TableHead className="font-semibold text-gray-300">SKU</TableHead>
              <TableHead className="font-semibold text-gray-300">
                Product Name
              </TableHead>
              <TableHead className="font-semibold text-gray-300">
                Landing Cost
              </TableHead>
              <TableHead className="font-semibold text-gray-300">
                Stock
              </TableHead>
              <TableHead className="text-right font-semibold text-gray-300">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stock.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={5}
                  className="h-24 text-center text-gray-400"
                >
                  No products found
                </TableCell>
              </TableRow>
            ) : (
              stock.map((item) => {
                const cartItem = cart.find(
                  (cartItem) => cartItem.id === item.SKU
                );
                const isLowStock = item.stock < 10;
                const isOutOfStock = item.stock === 0;

                return (
                  <TableRow
                    key={item._id}
                    className="border-b border-[#30363d] hover:bg-[#161b22] transition-colors"
                  >
                    {/* SKU */}
                    <TableCell className="font-mono text-sm text-gray-400">
                      {item.SKU}
                    </TableCell>

                    {/* Product Name */}
                    <TableCell className="font-medium text-white">
                      {item.name}
                    </TableCell>

                    {/* Price */}
                    <TableCell className="font-medium text-gray-100">
                      {formatCurrency(item.price)}
                    </TableCell>

                    {/* Stock with Status Badge */}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-medium ${
                            isOutOfStock
                              ? "text-red-500"
                              : isLowStock
                              ? "text-orange-500"
                              : "text-gray-100"
                          }`}
                        >
                          {item.stock}
                        </span>
                        {isOutOfStock && (
                          <Badge
                            variant="outline"
                            className="text-xs bg-red-500/10 text-red-500 border-red-500/20"
                          >
                            Out
                          </Badge>
                        )}
                        {isLowStock && !isOutOfStock && (
                          <Badge
                            variant="outline"
                            className="text-xs bg-orange-500/10 text-orange-500 border-orange-500/20"
                          >
                            Low
                          </Badge>
                        )}
                      </div>
                    </TableCell>

                    {/* Actions */}
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        {/* Edit Button */}
                        {action !== "request" && (
                          <Button
                            asChild
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-gray-400 hover:text-white hover:bg-[#1f2937]"
                          >
                            <Link href={`/dashboard/stocks/${item._id}/update`}>
                              <Pencil className="h-4 w-4" />
                              <span className="sr-only">Edit {item.name}</span>
                            </Link>
                          </Button>
                        )}

                        {/* Cart Controls */}
                        {cartItem ? (
                          <div className="flex items-center gap-1 border border-[#30363d] rounded-lg px-2 py-1 bg-[#0d1117]">
                            <RemoveSingleItem id={item.SKU} />
                            <span className="px-2 text-sm font-semibold text-yellow-500 min-w-[2ch] text-center">
                              {cartItem.quantity}
                            </span>
                            <AddSingleItem id={item.SKU} />
                          </div>
                        ) : (
                          <AddToCartButton
                            id={item._id}
                            disabled={isOutOfStock}
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

// ============================================
// MOBILE-RESPONSIVE VERSION (Card Layout)
// ============================================
export function InventoryTableMobile({ cart = [], stock, action }) {
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="space-y-4">
      {stock.length === 0 ? (
        <Card className="p-8 text-center bg-[#161b22] border-[#30363d]">
          <p className="text-gray-400">No products found</p>
        </Card>
      ) : (
        stock.map((item) => {
          const cartItem = cart.find((cartItem) => cartItem.id === item.SKU);
          const isLowStock = item.stock < 10;
          const isOutOfStock = item.stock === 0;

          return (
            <Card key={item._id} className="p-4 bg-[#161b22] border-[#30363d]">
              <div className="space-y-3">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-white">{item.name}</h3>
                    <p className="text-xs text-gray-400 font-mono">
                      {item.SKU}
                    </p>
                  </div>
                  {(isOutOfStock || isLowStock) && (
                    <Badge
                      variant="outline"
                      className={
                        isOutOfStock
                          ? "bg-red-500/10 text-red-500 border-red-500/20"
                          : "bg-orange-500/10 text-orange-500 border-orange-500/20"
                      }
                    >
                      {isOutOfStock ? "Out of Stock" : "Low Stock"}
                    </Badge>
                  )}
                </div>

                {/* Details */}
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-gray-400 text-xs">Price</p>
                    <p className="font-semibold text-gray-100">
                      {formatCurrency(item.price)}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-xs">Stock</p>
                    <p
                      className={`font-semibold ${
                        isOutOfStock
                          ? "text-red-500"
                          : isLowStock
                          ? "text-orange-500"
                          : "text-gray-100"
                      }`}
                    >
                      {item.stock}
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-2">
                  {action !== "request" && (
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="flex-1 border-[#30363d] text-gray-300 hover:bg-[#1f2937] hover:text-white"
                    >
                      <Link href={`/dashboard/stocks/${item._id}/update`}>
                        <Pencil className="mr-2 h-3 w-3" />
                        Edit
                      </Link>
                    </Button>
                  )}

                  {cartItem ? (
                    <div className="flex items-center gap-1 border border-[#30363d] rounded-lg px-3 py-1.5 bg-[#0d1117]">
                      <RemoveSingleItem id={item.SKU} />
                      <span className="px-2 text-sm font-semibold text-yellow-500 min-w-[2ch] text-center">
                        {cartItem.quantity}
                      </span>
                      <AddSingleItem id={item.SKU} />
                    </div>
                  ) : (
                    <div className="flex-1">
                      <AddToCartButton id={item._id} disabled={isOutOfStock} />
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}

// ============================================
// RESPONSIVE WRAPPER (Auto-switches based on screen size)
// ============================================
export function ResponsiveInventoryTable({ cart = [], stock, action }) {
  return (
    <>
      {/* Desktop Table */}
      <div className="hidden md:block">
        <InventoryTable cart={cart} stock={stock} action={action} />
      </div>

      {/* Mobile Cards */}
      <div className="block md:hidden">
        <InventoryTableMobile cart={cart} stock={stock} action={action} />
      </div>
    </>
  );
}
