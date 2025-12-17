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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  Eye,
  RotateCcw,
  AlertTriangle,
  Clock,
  Package,
} from "lucide-react";
import { ReturnDialog } from "./ReturnDialog";
import { ViewCheckoutDialog } from "./ViewCheckoutDialog";
import { EscalateDialog } from "./EscalateDialog";

const statusConfig = {
  checked_out: {
    label: "Checked Out",
    color: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    icon: Package,
  },
  returned: {
    label: "Returned",
    color: "bg-green-500/10 text-green-500 border-green-500/20",
    icon: RotateCcw,
  },
  overdue: {
    label: "Overdue",
    color: "bg-red-500/10 text-red-500 border-red-500/20",
    icon: AlertTriangle,
  },
  lost: {
    label: "Lost",
    color: "bg-gray-500/10 text-gray-500 border-gray-500/20",
    icon: AlertTriangle,
  },
  damaged: {
    label: "Damaged",
    color: "bg-orange-500/10 text-orange-500 border-orange-500/20",
    icon: AlertTriangle,
  },
};

export function CheckoutsTable({ checkouts, canManageCheckouts, userId }) {
  const [selectedCheckout, setSelectedCheckout] = useState(null);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [escalateDialogOpen, setEscalateDialogOpen] = useState(false);

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const canReturn = (checkout) => {
    return (
      canManageCheckouts &&
      checkout.status === "checked_out"
    );
  };

  const canEscalate = (checkout) => {
    return (
      canManageCheckouts &&
      checkout.status === "checked_out" &&
      checkout.isOverdue &&
      !checkout.isEscalated
    );
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
                  <TableHead className="font-semibold text-gray-300">Checkout #</TableHead>
                  <TableHead className="font-semibold text-gray-300">Product</TableHead>
                  <TableHead className="font-semibold text-gray-300">Checked Out To</TableHead>
                  <TableHead className="font-semibold text-gray-300">Quantity</TableHead>
                  <TableHead className="font-semibold text-gray-300">Status</TableHead>
                  <TableHead className="font-semibold text-gray-300">Due Date</TableHead>
                  <TableHead className="font-semibold text-gray-300">Days</TableHead>
                  <TableHead className="text-right font-semibold text-gray-300">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {checkouts.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={8} className="h-24 text-center text-gray-400">
                      <div className="flex flex-col items-center gap-2">
                        <Package className="h-8 w-8" />
                        <p>No checkouts found</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  checkouts.map((checkout) => {
                    const StatusIcon = statusConfig[checkout.status]?.icon || Package;
                    const statusStyle = statusConfig[checkout.status]?.color;
                    const statusLabel = statusConfig[checkout.status]?.label;

                    return (
                      <TableRow
                        key={checkout._id}
                        className="border-b border-[#30363d] hover:bg-[#161b22] transition-colors"
                      >
                        <TableCell className="font-mono text-sm text-gray-400">
                          {checkout.checkoutNumber}
                        </TableCell>

                        <TableCell>
                          <div>
                            <p className="font-medium text-white">{checkout.productSnapshot.name}</p>
                            <p className="text-xs text-gray-400">{checkout.productSnapshot.SKU}</p>
                          </div>
                        </TableCell>

                        <TableCell>
                          <div>
                            <p className="font-medium text-gray-100">{checkout.checkedOutTo.name}</p>
                            <p className="text-xs text-gray-400">{checkout.checkedOutTo.department}</p>
                          </div>
                        </TableCell>

                        <TableCell className="text-gray-100">{checkout.quantity}</TableCell>

                        <TableCell>
                          <Badge variant="outline" className={statusStyle}>
                            <StatusIcon className="mr-1 h-3 w-3" />
                            {statusLabel}
                          </Badge>
                        </TableCell>

                        <TableCell className="text-sm text-gray-100">
                          {formatDate(checkout.expectedReturnDate)}
                        </TableCell>

                        <TableCell>
                          {checkout.status === "checked_out" && (
                            <div className="flex items-center gap-1">
                              {checkout.isOverdue ? (
                                <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20 text-xs">
                                  {checkout.daysOverdue}d overdue
                                </Badge>
                              ) : checkout.daysUntilDue <= 3 ? (
                                <Badge variant="outline" className="bg-orange-500/10 text-orange-500 border-orange-500/20 text-xs">
                                  {checkout.daysUntilDue}d left
                                </Badge>
                              ) : (
                                <span className="text-sm text-gray-400">{checkout.daysUntilDue}d left</span>
                              )}
                            </div>
                          )}
                        </TableCell>

                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="text-gray-300 hover:text-white hover:bg-[#1f2937]">
                                <ChevronDown className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-[#161b22] border-[#30363d]">
                              <DropdownMenuItem
                                onClick={() => {
                                  setSelectedCheckout(checkout);
                                  setViewDialogOpen(true);
                                }}
                                className="text-gray-100 focus:bg-[#1f2937] focus:text-white"
                              >
                                <Eye className="mr-2 h-4 w-4" />
                                View Details
                              </DropdownMenuItem>

                              {canReturn(checkout) && (
                                <>
                                  <DropdownMenuSeparator className="bg-[#30363d]" />
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setSelectedCheckout(checkout);
                                      setReturnDialogOpen(true);
                                    }}
                                    className="text-green-500 focus:bg-[#1f2937] focus:text-green-400"
                                  >
                                    <RotateCcw className="mr-2 h-4 w-4" />
                                    Process Return
                                  </DropdownMenuItem>
                                </>
                              )}

                              {canEscalate(checkout) && (
                                <>
                                  <DropdownMenuSeparator className="bg-[#30363d]" />
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setSelectedCheckout(checkout);
                                      setEscalateDialogOpen(true);
                                    }}
                                    className="text-red-500 focus:bg-[#1f2937] focus:text-red-400"
                                  >
                                    <AlertTriangle className="mr-2 h-4 w-4" />
                                    Escalate
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
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
        {checkouts.length === 0 ? (
          <Card className="p-8 text-center bg-[#161b22] border-[#30363d]">
            <Package className="h-12 w-12 mx-auto text-gray-400 mb-4" />
            <p className="text-gray-400">No checkouts found</p>
          </Card>
        ) : (
          checkouts.map((checkout) => {
            const StatusIcon = statusConfig[checkout.status]?.icon || Package;
            const statusStyle = statusConfig[checkout.status]?.color;
            const statusLabel = statusConfig[checkout.status]?.label;

            return (
              <Card key={checkout._id} className="p-4 bg-[#161b22] border-[#30363d]">
                <div className="space-y-3">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-white">{checkout.productSnapshot.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{checkout.checkoutNumber}</p>
                    </div>
                    <Badge variant="outline" className={statusStyle}>
                      <StatusIcon className="mr-1 h-3 w-3" />
                      {statusLabel}
                    </Badge>
                  </div>

                  {/* Details */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-gray-400 text-xs">Checked Out To</p>
                      <p className="font-medium text-gray-100">{checkout.checkedOutTo.name}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-xs">Quantity</p>
                      <p className="font-medium text-gray-100">{checkout.quantity}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-xs">Due Date</p>
                      <p className="font-medium text-gray-100">{formatDate(checkout.expectedReturnDate)}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-xs">Status</p>
                      {checkout.status === "checked_out" && checkout.isOverdue && (
                        <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20 text-xs">
                          {checkout.daysOverdue}d overdue
                        </Badge>
                      )}
                      {checkout.status === "checked_out" && !checkout.isOverdue && (
                        <span className="text-sm text-gray-100">{checkout.daysUntilDue}d left</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedCheckout(checkout);
                        setViewDialogOpen(true);
                      }}
                      className="flex-1 border-[#30363d] text-gray-300 hover:bg-[#1f2937] hover:text-white"
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      View
                    </Button>

                    {canReturn(checkout) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedCheckout(checkout);
                          setReturnDialogOpen(true);
                        }}
                        className="flex-1 border-green-500/20 text-green-500 hover:bg-green-500/10"
                      >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Return
                      </Button>
                    )}

                    {canEscalate(checkout) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedCheckout(checkout);
                          setEscalateDialogOpen(true);
                        }}
                        className="border-red-500/20 text-red-500 hover:bg-red-500/10"
                      >
                        <AlertTriangle className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Dialogs */}
      {selectedCheckout && (
        <>
          <ViewCheckoutDialog
            checkout={selectedCheckout}
            open={viewDialogOpen}
            onOpenChange={setViewDialogOpen}
          />

          <ReturnDialog
            checkout={selectedCheckout}
            open={returnDialogOpen}
            onOpenChange={setReturnDialogOpen}
          />

          <EscalateDialog
            checkout={selectedCheckout}
            open={escalateDialogOpen}
            onOpenChange={setEscalateDialogOpen}
          />
        </>
      )}
    </>
  );
}