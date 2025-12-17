"use client";

import { useState } from "react";
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
import { ViewMovementDialog } from "./viewMovementDialog";

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
    color: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  },
};

export function MovementsTable({ movements }) {
  const [selectedMovement, setSelectedMovement] = useState(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);

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
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <>
      {/* Desktop Table View */}
      <Card className="hidden md:block bg-[#161b22] border-[#30363d]">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-[#30363d] hover:bg-transparent">
                  <TableHead className="font-semibold text-gray-300">
                    Movement #
                  </TableHead>
                  <TableHead className="font-semibold text-gray-300">
                    Product
                  </TableHead>
                  <TableHead className="font-semibold text-gray-300">
                    Type
                  </TableHead>
                  <TableHead className="font-semibold text-gray-300">
                    Direction
                  </TableHead>
                  <TableHead className="font-semibold text-gray-300">
                    Quantity
                  </TableHead>
                  <TableHead className="font-semibold text-gray-300">
                    Value
                  </TableHead>
                  <TableHead className="font-semibold text-gray-300">
                    Performed By
                  </TableHead>
                  <TableHead className="font-semibold text-gray-300">
                    Date
                  </TableHead>
                  <TableHead className="text-right font-semibold text-gray-300">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={9}
                      className="h-24 text-center text-gray-400"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <Package className="h-8 w-8" />
                        <p>No movements found</p>
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
                        className="border-b border-[#30363d] hover:bg-[#161b22] transition-colors"
                      >
                        <TableCell className="font-mono text-sm text-gray-400">
                          {movement.movementNumber}
                        </TableCell>

                        <TableCell>
                          <div>
                            <p className="font-medium text-white">
                              {movement.productSnapshot.name}
                            </p>
                            <p className="text-xs text-gray-400">
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

                        <TableCell className="text-gray-100">
                          <span className="font-medium">
                            {movement.quantity}
                          </span>
                          <span className="text-xs text-gray-400 ml-1">
                            ({movement.previousStock} → {movement.newStock})
                          </span>
                        </TableCell>

                        <TableCell className="font-medium text-gray-100">
                          {formatCurrency(movement.totalValue)}
                        </TableCell>

                        <TableCell>
                          <div>
                            <p className="text-sm text-gray-100">
                              {movement.performedBy.name}
                            </p>
                            <p className="text-xs text-gray-400">
                              {movement.performedBy.role}
                            </p>
                          </div>
                        </TableCell>

                        <TableCell className="text-sm text-gray-400">
                          {formatDate(movement.createdAt)}
                        </TableCell>

                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedMovement(movement);
                              setViewDialogOpen(true);
                            }}
                            className="text-gray-300 hover:text-white hover:bg-[#1f2937]"
                          >
                            <Eye className="h-4 w-4" />
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
          <Card className="p-8 text-center bg-[#161b22] border-[#30363d]">
            <Package className="h-12 w-12 mx-auto text-gray-400 mb-4" />
            <p className="text-gray-400">No movements found</p>
          </Card>
        ) : (
          movements.map((movement) => {
            const typeStyle = typeConfig[movement.movementType]?.color;
            const typeLabel = typeConfig[movement.movementType]?.label;

            return (
              <Card
                key={movement._id}
                className="p-4 bg-[#161b22] border-[#30363d]"
              >
                <div className="space-y-3">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-white">
                        {movement.productSnapshot.name}
                      </p>
                      <p className="text-xs text-gray-400 font-mono">
                        {movement.movementNumber}
                      </p>
                    </div>
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
                  </div>

                  {/* Type Badge */}
                  <div>
                    <Badge variant="outline" className={typeStyle}>
                      {typeLabel}
                    </Badge>
                  </div>

                  {/* Details */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-gray-400 text-xs">Quantity</p>
                      <p className="font-medium text-gray-100">
                        {movement.quantity}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-xs">Value</p>
                      <p className="font-medium text-gray-100">
                        {formatCurrency(movement.totalValue)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-xs">Performed By</p>
                      <p className="font-medium text-gray-100">
                        {movement.performedBy.name}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-xs">Stock Change</p>
                      <p className="font-medium text-gray-100">
                        {movement.previousStock} → {movement.newStock}
                      </p>
                    </div>
                  </div>

                  {/* Date & Action */}
                  <div className="flex items-center justify-between pt-2 border-t border-[#30363d]">
                    <p className="text-xs text-gray-400">
                      {formatDate(movement.createdAt)}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedMovement(movement);
                        setViewDialogOpen(true);
                      }}
                      className="border-[#30363d] text-gray-300 hover:bg-[#1f2937] hover:text-white"
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      View
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* View Dialog */}
      {selectedMovement && (
        <ViewMovementDialog
          movement={selectedMovement}
          open={viewDialogOpen}
          onOpenChange={setViewDialogOpen}
        />
      )}
    </>
  );
}
