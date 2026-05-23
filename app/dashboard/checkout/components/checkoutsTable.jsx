"use client";

import { useState } from "react";
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
  Package,
  Receipt,
  ShoppingCart,
} from "lucide-react";
import { ReturnDialog } from "./ReturnDialog";
import { EscalateDialog } from "./EscalateDialog";
import { ExpenseInternalDialog } from "./ExpenseInternalDialog";

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
    color: "bg-gray-500/10 text-gray-500 dark:text-gray-400 border-gray-500/20",
    icon: AlertTriangle,
  },
  damaged: {
    label: "Damaged",
    color: "bg-orange-500/10 text-orange-500 border-orange-500/20",
    icon: AlertTriangle,
  },
  converted_to_sale: {
    label: "Sold",
    color: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    icon: ShoppingCart,
  },
  expensed: {
    label: "Expensed",
    color: "bg-purple-500/10 text-purple-500 border-purple-500/20",
    icon: Receipt,
  },
};

export function CheckoutsTable({ checkouts, canManageCheckouts, expenseAccounts = [] }) {
  const [selectedCheckout, setSelectedCheckout] = useState(null);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [escalateDialogOpen, setEscalateDialogOpen] = useState(false);
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const canReturn = (checkout) => {
    return canManageCheckouts && checkout.status === "checked_out";
  };

  const canEscalate = (checkout) => {
    return (
      canManageCheckouts &&
      checkout.status === "checked_out" &&
      checkout.isOverdue &&
      !checkout.isEscalated
    );
  };

  // Can expense internal use checkouts (not for sale)
  const canExpense = (checkout) => {
    return (
      canManageCheckouts &&
      checkout.status === "checked_out" &&
      checkout.requestType === "internal"
    );
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
                    Checkout #
                  </TableHead>
                  <TableHead className="font-semibold text-muted-foreground">
                    Product
                  </TableHead>
                  <TableHead className="font-semibold text-muted-foreground">
                    Checked Out To
                  </TableHead>
                  <TableHead className="font-semibold text-muted-foreground">
                    Quantity
                  </TableHead>
                  <TableHead className="font-semibold text-muted-foreground">
                    Status
                  </TableHead>
                  <TableHead className="font-semibold text-muted-foreground">
                    Due Date
                  </TableHead>
                  <TableHead className="font-semibold text-muted-foreground">
                    Days
                  </TableHead>
                  <TableHead className="text-right font-semibold text-muted-foreground">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {checkouts.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={8}
                      className="h-32 text-center text-muted-foreground"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <Package className="h-12 w-12 text-muted-foreground/50" />
                        <p>No checkouts found</p>
                        <p className="text-sm">
                          No items are currently checked out
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  checkouts.map((checkout) => {
                    const StatusIcon =
                      statusConfig[checkout.status]?.icon || Package;
                    const statusStyle = statusConfig[checkout.status]?.color;
                    const statusLabel = statusConfig[checkout.status]?.label;

                    return (
                      <TableRow
                        key={checkout._id}
                        className="border-b border-border hover:bg-muted/50 transition-colors"
                      >
                        <TableCell className="font-mono text-sm text-muted-foreground">
                          {checkout.checkoutNumber}
                        </TableCell>

                        <TableCell>
                          <div>
                            <p className="font-medium text-foreground">
                              {checkout.productSnapshot.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {checkout.productSnapshot.SKU}
                            </p>
                          </div>
                        </TableCell>

                        <TableCell>
                          <div>
                            <p className="font-medium text-foreground">
                              {checkout.checkedOutTo.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {checkout.checkedOutTo.department}
                            </p>
                          </div>
                        </TableCell>

                        <TableCell className="text-foreground">
                          {checkout.quantity}
                        </TableCell>

                        <TableCell>
                          <Badge variant="outline" className={statusStyle}>
                            <StatusIcon className="mr-1 h-3 w-3" />
                            {statusLabel}
                          </Badge>
                        </TableCell>

                        <TableCell className="text-sm text-foreground">
                          {formatDate(checkout.expectedReturnDate)}
                        </TableCell>

                        <TableCell>
                          {["checked_out", "overdue"].includes(checkout.status) ? (
                            <div className="flex items-center gap-1">
                              {checkout.isOverdue ? (
                                <Badge
                                  variant="outline"
                                  className="bg-red-500/10 text-red-500 border-red-500/20 text-xs"
                                >
                                  {checkout.daysOverdue}d overdue
                                </Badge>
                              ) : checkout.daysUntilDue !== null &&
                                checkout.daysUntilDue <= 3 ? (
                                <Badge
                                  variant="outline"
                                  className="bg-orange-500/10 text-orange-500 border-orange-500/20 text-xs"
                                >
                                  {checkout.daysUntilDue}d left
                                </Badge>
                              ) : checkout.daysUntilDue !== null ? (
                                <span className="text-sm text-muted-foreground">
                                  {checkout.daysUntilDue}d left
                                </span>
                              ) : (
                                <span className="text-sm text-muted-foreground">—</span>
                              )}
                            </div>
                          ) : checkout.daysHeld !== null &&
                            checkout.daysHeld !== undefined ? (
                            <span className="text-sm text-muted-foreground">
                              Held {checkout.daysHeld}d
                            </span>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>

                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground hover:text-foreground hover:bg-accent"
                              >
                                <ChevronDown className="h-4 w-4" />
                                <span className="sr-only">
                                  Open actions menu
                                </span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              className="bg-card border-border"
                            >
                              <DropdownMenuItem
                                asChild
                                className="text-foreground focus:bg-accent focus:text-accent-foreground cursor-pointer"
                              >
                                <Link href={`/dashboard/checkout/${checkout._id}`}>
                                  <Eye className="mr-2 h-4 w-4" />
                                  View Details
                                </Link>
                              </DropdownMenuItem>

                              {canReturn(checkout) && (
                                <>
                                  <DropdownMenuSeparator className="bg-border" />
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setSelectedCheckout(checkout);
                                      setReturnDialogOpen(true);
                                    }}
                                    className="text-green-500 focus:bg-green-500/10 focus:text-green-500 cursor-pointer"
                                  >
                                    <RotateCcw className="mr-2 h-4 w-4" />
                                    Process Return
                                  </DropdownMenuItem>
                                </>
                              )}

                              {canEscalate(checkout) && (
                                <>
                                  <DropdownMenuSeparator className="bg-border" />
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setSelectedCheckout(checkout);
                                      setEscalateDialogOpen(true);
                                    }}
                                    className="text-red-500 focus:bg-red-500/10 focus:text-red-500 cursor-pointer"
                                  >
                                    <AlertTriangle className="mr-2 h-4 w-4" />
                                    Escalate
                                  </DropdownMenuItem>
                                </>
                              )}

                              {canExpense(checkout) && (
                                <>
                                  <DropdownMenuSeparator className="bg-border" />
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setSelectedCheckout(checkout);
                                      setExpenseDialogOpen(true);
                                    }}
                                    className="text-purple-500 focus:bg-purple-500/10 focus:text-purple-500 cursor-pointer"
                                  >
                                    <Receipt className="mr-2 h-4 w-4" />
                                    Expense Item
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
          <Card className="bg-card border-border">
            <CardContent className="p-8 text-center">
              <Package className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground mb-1">No checkouts found</p>
              <p className="text-sm text-muted-foreground">
                No items are currently checked out
              </p>
            </CardContent>
          </Card>
        ) : (
          checkouts.map((checkout) => {
            const StatusIcon = statusConfig[checkout.status]?.icon || Package;
            const statusStyle = statusConfig[checkout.status]?.color;
            const statusLabel = statusConfig[checkout.status]?.label;

            return (
              <Card key={checkout._id} className="bg-card border-border">
                <CardContent className="p-4">
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground">
                          {checkout.productSnapshot.name}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">
                          {checkout.checkoutNumber}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={`${statusStyle} shrink-0`}
                      >
                        <StatusIcon className="mr-1 h-3 w-3" />
                        {statusLabel}
                      </Badge>
                    </div>

                    {/* Details */}
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">
                          Checked Out To
                        </p>
                        <p className="font-medium text-foreground truncate">
                          {checkout.checkedOutTo.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {checkout.checkedOutTo.department}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">
                          Quantity
                        </p>
                        <p className="font-medium text-foreground">
                          {checkout.quantity}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">
                          Due Date
                        </p>
                        <p className="font-medium text-foreground">
                          {formatDate(checkout.expectedReturnDate)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Days</p>
                        {["checked_out", "overdue"].includes(checkout.status) ? (
                          checkout.isOverdue ? (
                            <Badge
                              variant="outline"
                              className="bg-red-500/10 text-red-500 border-red-500/20 text-xs"
                            >
                              {checkout.daysOverdue}d overdue
                            </Badge>
                          ) : checkout.daysUntilDue !== null ? (
                            <span className="text-sm text-foreground">
                              {checkout.daysUntilDue}d left
                            </span>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )
                        ) : checkout.daysHeld !== null &&
                          checkout.daysHeld !== undefined ? (
                          <span className="text-sm text-foreground">
                            Held {checkout.daysHeld}d
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="flex-1 border-border text-foreground hover:bg-accent"
                      >
                        <Link href={`/dashboard/checkout/${checkout._id}`}>
                          <Eye className="mr-2 h-4 w-4" />
                          View
                        </Link>
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
                          <span className="sr-only">Escalate</span>
                        </Button>
                      )}

                      {canExpense(checkout) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedCheckout(checkout);
                            setExpenseDialogOpen(true);
                          }}
                          className="border-purple-500/20 text-purple-500 hover:bg-purple-500/10"
                        >
                          <Receipt className="h-4 w-4" />
                          <span className="sr-only">Expense</span>
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

      {/* Dialogs */}
      {selectedCheckout && (
        <>
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

          <ExpenseInternalDialog
            checkout={selectedCheckout}
            expenseAccounts={expenseAccounts}
            open={expenseDialogOpen}
            onOpenChange={setExpenseDialogOpen}
          />
        </>
      )}
    </>
  );
}
