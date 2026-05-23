import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, ArrowDownCircle, ArrowUpCircle, Package } from "lucide-react";

const typeConfig = {
  issue: {
    label: "Issue",
    color: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  },
  return: {
    label: "Return",
    color: "bg-green-500/10 text-green-500 border-green-500/20",
  },
  sale: {
    label: "Sale",
    color: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  },
  purchase: {
    label: "Purchase",
    color: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  },
  adjustment: {
    label: "Adjustment",
    color: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  },
  damage: {
    label: "Damage",
    color: "bg-red-500/10 text-red-500 border-red-500/20",
  },
  transfer: {
    label: "Transfer",
    color: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
  },
  initial: {
    label: "Initial",
    color: "bg-gray-500/10 text-gray-500 dark:text-gray-400 border-gray-500/20",
  },
};

export function MovementsTable({ movements }) {
  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatCurrency = (amount) => {
    // Handle undefined, null, or NaN values
    const safeAmount = typeof amount === "number" && !isNaN(amount) ? amount : 0;
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(safeAmount);
  };

  // Get movement value from costing fields (schema-defined)
  const getMovementValue = (movement) => {
    return movement.costing?.totalValue || movement.costing?.totalCost || 0;
  };

  return (
    <>
      {/* Desktop Table View */}
      <Card className="hidden md:block bg-card border-border">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent">
                  <TableHead className="font-semibold text-muted-foreground">
                    Movement #
                  </TableHead>
                  <TableHead className="font-semibold text-muted-foreground">
                    Product
                  </TableHead>
                  <TableHead className="font-semibold text-muted-foreground">
                    Type
                  </TableHead>
                  <TableHead className="font-semibold text-muted-foreground">
                    Direction
                  </TableHead>
                  <TableHead className="font-semibold text-muted-foreground">
                    Quantity
                  </TableHead>
                  <TableHead className="font-semibold text-muted-foreground">
                    Value
                  </TableHead>
                  <TableHead className="font-semibold text-muted-foreground">
                    Performed By
                  </TableHead>
                  <TableHead className="font-semibold text-muted-foreground">
                    Date
                  </TableHead>
                  <TableHead className="text-right font-semibold text-muted-foreground">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={9}
                      className="h-32 text-center text-muted-foreground"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <Package className="h-12 w-12 text-muted-foreground/50" />
                        <p>No movements found</p>
                        <p className="text-sm">
                          No stock movements recorded yet
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  movements.map((movement) => {
                    const typeStyle = typeConfig[movement.movementType]?.color;
                    const typeLabel = typeConfig[movement.movementType]?.label;

                    return (
                      <TableRow
                        key={movement._id}
                        className="border-b border-border hover:bg-muted/50 transition-colors"
                      >
                        <TableCell className="font-mono text-sm text-muted-foreground">
                          {movement.movementNumber}
                        </TableCell>

                        <TableCell>
                          <div>
                            <p className="font-medium text-foreground">
                              {movement.productSnapshot.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {movement.productSnapshot.SKU}
                            </p>
                          </div>
                        </TableCell>

                        <TableCell>
                          <Badge variant="outline" className={typeStyle}>
                            {typeLabel}
                          </Badge>
                        </TableCell>

                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              movement.direction === "in"
                                ? "bg-green-500/10 text-green-500 border-green-500/20"
                                : "bg-red-500/10 text-red-500 border-red-500/20"
                            }
                          >
                            {movement.direction === "in" ? (
                              <ArrowDownCircle className="mr-1 h-3 w-3" />
                            ) : (
                              <ArrowUpCircle className="mr-1 h-3 w-3" />
                            )}
                            {movement.direction === "in" ? "In" : "Out"}
                          </Badge>
                        </TableCell>

                        <TableCell className="text-foreground">
                          <span className="font-medium">
                            {movement.quantity}
                          </span>
                          <span className="text-xs text-muted-foreground ml-1">
                            ({movement.previousStock} → {movement.newStock})
                          </span>
                        </TableCell>

                        <TableCell className="font-medium text-foreground">
                          {formatCurrency(getMovementValue(movement))}
                        </TableCell>

                        <TableCell>
                          <div>
                            <p className="text-sm text-foreground">
                              {movement.performedBy.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {movement.performedBy.role}
                            </p>
                          </div>
                        </TableCell>

                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(movement.createdAt)}
                        </TableCell>

                        <TableCell className="text-right">
                          <Button
                            asChild
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-foreground hover:bg-accent"
                          >
                            <Link href={`/dashboard/movements/${movement._id}`}>
                              <Eye className="h-4 w-4" />
                              <span className="sr-only">
                                View movement details
                              </span>
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Mobile Card View */}
      <div className="space-y-4 md:hidden">
        {movements.length === 0 ? (
          <Card className="bg-card border-border">
            <CardContent className="p-8 text-center">
              <Package className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground mb-1">No movements found</p>
              <p className="text-sm text-muted-foreground">
                No stock movements recorded yet
              </p>
            </CardContent>
          </Card>
        ) : (
          movements.map((movement) => {
            const typeStyle = typeConfig[movement.movementType]?.color;
            const typeLabel = typeConfig[movement.movementType]?.label;

            return (
              <Card key={movement._id} className="bg-card border-border">
                <CardContent className="p-4">
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground">
                          {movement.productSnapshot.name}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">
                          {movement.movementNumber}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          movement.direction === "in"
                            ? "bg-green-500/10 text-green-500 border-green-500/20 shrink-0"
                            : "bg-red-500/10 text-red-500 border-red-500/20 shrink-0"
                        }
                      >
                        {movement.direction === "in" ? (
                          <ArrowDownCircle className="mr-1 h-3 w-3" />
                        ) : (
                          <ArrowUpCircle className="mr-1 h-3 w-3" />
                        )}
                        {movement.direction === "in" ? "In" : "Out"}
                      </Badge>
                    </div>

                    {/* Type Badge */}
                    <div>
                      <Badge variant="outline" className={typeStyle}>
                        {typeLabel}
                      </Badge>
                    </div>

                    {/* Details */}
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">
                          Quantity
                        </p>
                        <p className="font-medium text-foreground">
                          {movement.quantity}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Value</p>
                        <p className="font-medium text-foreground">
                          {formatCurrency(getMovementValue(movement))}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">
                          Performed By
                        </p>
                        <p className="font-medium text-foreground truncate">
                          {movement.performedBy.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {movement.performedBy.role}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">
                          Stock Change
                        </p>
                        <p className="font-medium text-foreground">
                          {movement.previousStock} → {movement.newStock}
                        </p>
                      </div>
                    </div>

                    {/* Date & Action */}
                    <div className="flex items-center justify-between pt-2 border-t border-border">
                      <p className="text-xs text-muted-foreground">
                        {formatDate(movement.createdAt)}
                      </p>
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="border-border text-foreground hover:bg-accent"
                      >
                        <Link href={`/dashboard/movements/${movement._id}`}>
                          <Eye className="mr-2 h-4 w-4" />
                          View
                        </Link>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

    </>
  );
}
