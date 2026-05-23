import { Pencil, Package, AlertTriangle, XCircle, Eye } from "lucide-react";
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
import { Card, CardContent } from "@/components/ui/card";

// ============================================
// DESKTOP TABLE VIEW
// ============================================
export function InventoryTable({ stock, action, showPricing = true }) {
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <Card className="bg-card border-border">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-border hover:bg-transparent">
              <TableHead className="font-semibold text-muted-foreground">
                SKU
              </TableHead>
              <TableHead className="font-semibold text-muted-foreground">
                Product Name
              </TableHead>
              <TableHead className="font-semibold text-muted-foreground">
                Category
              </TableHead>
              {showPricing && (
                <TableHead className="font-semibold text-muted-foreground">
                  Selling Price
                </TableHead>
              )}
              <TableHead className="font-semibold text-muted-foreground">
                Available
              </TableHead>
              <TableHead className="text-right font-semibold text-muted-foreground">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stock.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={6}
                  className="h-32 text-center text-muted-foreground"
                >
                  <div className="flex flex-col items-center gap-2">
                    <Package className="w-12 h-12 text-muted-foreground/50" />
                    <p>No products found</p>
                    <p className="text-sm">Try adjusting your filters</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              stock.map((item) => {
                const onHand = item.inventory?.quantityOnHand ?? 0;
                const committed = item.inventory?.quantityCommitted ?? 0;
                const available = item.inventory?.quantityAvailable ?? (onHand - committed);
                const reorderLevel = item.inventory?.reorderLevel ?? 10;
                const price = item.pricing?.sellingPrice ?? 0;
                const isOutOfStock = available <= 0;
                const isLowStock = !isOutOfStock && available <= reorderLevel;

                return (
                  <TableRow
                    key={item._id}
                    className="border-b border-border hover:bg-muted/50 transition-colors"
                  >
                    {/* SKU */}
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {item.SKU}
                    </TableCell>

                    {/* Product Name - Clickable to view details */}
                    <TableCell>
                      <Link
                        href={`/dashboard/stocks/${item._id}`}
                        className="block hover:underline underline-offset-2"
                      >
                        <p className="font-medium text-foreground">
                          {item.name}
                        </p>
                        {item.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                            {item.description}
                          </p>
                        )}
                      </Link>
                    </TableCell>

                    {/* Category */}
                    <TableCell className="text-muted-foreground">
                      {item.category || "N/A"}
                    </TableCell>

                    {/* Price — redacted for non-pricing roles */}
                    {showPricing && (
                      <TableCell className="font-medium text-foreground">
                        {formatCurrency(price)}
                      </TableCell>
                    )}

                    {/* Stock with Status Badge */}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-medium ${
                            isOutOfStock
                              ? "text-red-500"
                              : isLowStock
                              ? "text-orange-500"
                              : "text-green-500"
                          }`}
                          title={`On hand: ${onHand} • Committed: ${committed} • Reorder at: ${reorderLevel}`}
                        >
                          {available}
                        </span>
                        {committed > 0 && (
                          <span className="text-xs text-muted-foreground">
                            ({onHand} − {committed})
                          </span>
                        )}
                        {isOutOfStock && (
                          <Badge
                            variant="outline"
                            className="text-xs bg-red-500/10 text-red-500 border-red-500/20"
                          >
                            <XCircle className="w-3 h-3 mr-1" />
                            Out
                          </Badge>
                        )}
                        {isLowStock && (
                          <Badge
                            variant="outline"
                            className="text-xs bg-orange-500/10 text-orange-500 border-orange-500/20"
                          >
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            Low
                          </Badge>
                        )}
                        {!isOutOfStock && !isLowStock && (
                          <Badge
                            variant="outline"
                            className="text-xs bg-green-500/10 text-green-500 border-green-500/20"
                          >
                            In Stock
                          </Badge>
                        )}
                      </div>
                    </TableCell>

                    {/* Actions */}
                    <TableCell>
                      <div className="flex items-center justify-end gap-1 flex-wrap">
                        {/* View Details Button */}
                        <Button
                          asChild
                          variant="ghost"
                          size="icon"
                          className="h-10 w-10 text-muted-foreground hover:text-foreground hover:bg-accent"
                        >
                          <Link href={`/dashboard/stocks/${item._id}`}>
                            <Eye className="h-4 w-4" />
                            <span className="sr-only">View {item.name}</span>
                          </Link>
                        </Button>

                        {/* Edit Button */}
                        {action !== "request" && (
                          <Button
                            asChild
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 text-muted-foreground hover:text-foreground hover:bg-accent"
                          >
                            <Link href={`/dashboard/stocks/${item._id}/update`}>
                              <Pencil className="h-4 w-4" />
                              <span className="sr-only">Edit {item.name}</span>
                            </Link>
                          </Button>
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
// MOBILE CARD VIEW
// ============================================
export function InventoryTableMobile({ stock, action, showPricing = true }) {
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
        <Card className="bg-card border-border">
          <CardContent className="p-8 text-center">
            <Package className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
            <p className="text-muted-foreground mb-1">No products found</p>
            <p className="text-sm text-muted-foreground">
              Try adjusting your filters
            </p>
          </CardContent>
        </Card>
      ) : (
        stock.map((item) => {
          const onHand = item.inventory?.quantityOnHand ?? 0;
          const committed = item.inventory?.quantityCommitted ?? 0;
          const available = item.inventory?.quantityAvailable ?? (onHand - committed);
          const reorderLevel = item.inventory?.reorderLevel ?? 10;
          const price = item.pricing?.sellingPrice ?? 0;
          const isOutOfStock = available <= 0;
          const isLowStock = !isOutOfStock && available <= reorderLevel;

          return (
            <Card key={item._id} className="bg-card border-border">
              <CardContent className="p-4">
                <div className="space-y-3">
                  {/* Header - Clickable to view details */}
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/dashboard/stocks/${item._id}`}
                      className="flex-1 min-w-0"
                    >
                      <h3 className="font-semibold text-foreground hover:underline underline-offset-2">
                        {item.name}
                      </h3>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">
                        {item.SKU}
                      </p>
                    </Link>
                    {isOutOfStock ? (
                      <Badge
                        variant="outline"
                        className="bg-red-500/10 text-red-500 border-red-500/20 shrink-0"
                      >
                        <XCircle className="w-3 h-3 mr-1" />
                        Out
                      </Badge>
                    ) : isLowStock ? (
                      <Badge
                        variant="outline"
                        className="bg-orange-500/10 text-orange-500 border-orange-500/20 shrink-0"
                      >
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        Low
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="bg-green-500/10 text-green-500 border-green-500/20 shrink-0"
                      >
                        In Stock
                      </Badge>
                    )}
                  </div>

                  {/* Description */}
                  {item.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {item.description}
                    </p>
                  )}

                  {/* Details Grid */}
                  <div
                    className={`grid gap-3 text-sm ${
                      showPricing ? "grid-cols-3" : "grid-cols-2"
                    }`}
                  >
                    <div>
                      <p className="text-muted-foreground text-xs">Category</p>
                      <p className="font-medium text-foreground truncate">
                        {item.category || "N/A"}
                      </p>
                    </div>
                    {showPricing && (
                      <div>
                        <p className="text-muted-foreground text-xs">Price</p>
                        <p className="font-medium text-foreground">
                          {formatCurrency(price)}
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="text-muted-foreground text-xs">Available</p>
                      <p
                        className={`font-semibold ${
                          isOutOfStock
                            ? "text-red-500"
                            : isLowStock
                            ? "text-orange-500"
                            : "text-green-500"
                        }`}
                        title={`On hand: ${onHand} • Committed: ${committed} • Reorder at: ${reorderLevel}`}
                      >
                        {available}
                        {committed > 0 && (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            ({onHand}−{committed})
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-2 border-t border-border flex-wrap">
                    {/* View Details Button */}
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="border-border text-foreground hover:bg-accent"
                    >
                      <Link href={`/dashboard/stocks/${item._id}`}>
                        <Eye className="mr-1.5 h-3 w-3" />
                        View
                      </Link>
                    </Button>

                    {action !== "request" && (
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="border-border text-foreground hover:bg-accent"
                      >
                        <Link href={`/dashboard/stocks/${item._id}/update`}>
                          <Pencil className="mr-1.5 h-3 w-3" />
                          Edit
                        </Link>
                      </Button>
                    )}

                  </div>
                </div>
              </CardContent>
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
export function ResponsiveInventoryTable({ stock, action, showPricing = true }) {
  return (
    <>
      {/* Desktop Table */}
      <div className="hidden md:block">
        <InventoryTable
          stock={stock}
          action={action}
          showPricing={showPricing}
        />
      </div>

      {/* Mobile Cards */}
      <div className="block md:hidden">
        <InventoryTableMobile
          stock={stock}
          action={action}
          showPricing={showPricing}
        />
      </div>
    </>
  );
}
