"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Eye,
  MoreHorizontal,
  Edit,
  Send,
  CheckCircle,
  XCircle,
  Loader2,
  FileText,
  Package,
  Receipt,
  Copy,
} from "lucide-react";
import {
  sendPurchaseOrder,
  confirmPurchaseOrder,
} from "@/app/mongodb/actions/purchase-order-actions";

// ============================================
// ACTION BUTTON WITH FORM WRAPPER
// ============================================
function POActionButton({ poId, action, label, icon: Icon, className }) {
  const { pending } = useFormStatus();
  const actionWithId = action.bind(null, poId);

  return (
    <form action={actionWithId}>
      <button
        type="submit"
        disabled={pending}
        className={`relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent focus:bg-accent disabled:pointer-events-none disabled:opacity-50 ${className}`}
      >
        {pending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Icon className="mr-2 h-4 w-4" />
        )}
        {label}
      </button>
    </form>
  );
}

// ============================================
// STATUS BADGE
// ============================================
function POStatusBadge({ status }) {
  const config = {
    draft: {
      label: "Draft",
      className: "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20",
    },
    sent: {
      label: "Sent",
      className: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    },
    confirmed: {
      label: "Confirmed",
      className: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
    },
    partial: {
      label: "Partial",
      className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    },
    received: {
      label: "Received",
      className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    },
    cancelled: {
      label: "Cancelled",
      className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
    },
    expired: {
      label: "Expired",
      className: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
    },
  };

  const { label, className } = config[status] || config.draft;

  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  );
}

// ============================================
// MAIN TABLE COMPONENT
// ============================================
export function POTable({ purchaseOrders }) {
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(amount || 0);
  };

  const formatDate = (dateString) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const isOverdue = (po) => {
    if (!po.expectedDeliveryDate) return false;
    const expected = new Date(po.expectedDeliveryDate);
    const now = new Date();
    return expected < now && ["sent", "confirmed", "partial"].includes(po.status);
  };

  const isExpiring = (po) => {
    if (!po.validUntil) return false;
    const validUntil = new Date(po.validUntil);
    const now = new Date();
    const daysUntilExpiry = Math.ceil((validUntil - now) / (1000 * 60 * 60 * 24));
    return daysUntilExpiry <= 7 && daysUntilExpiry > 0 && ["draft", "sent"].includes(po.status);
  };

  if (!purchaseOrders || purchaseOrders.length === 0) {
    return (
      <div className="text-center py-12 bg-card border border-border rounded-lg">
        <FileText className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
        <h3 className="text-lg font-semibold text-foreground mb-2">
          No purchase orders found
        </h3>
        <p className="text-muted-foreground mb-4">
          Create your first purchase order to get started
        </p>
        <Button
          className="bg-primary hover:bg-primary/90"
          asChild
        >
          <Link href="/dashboard/purchase-orders/create">
            <FileText className="mr-2 h-4 w-4" />
            Create Purchase Order
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      {/* Desktop Table */}
      <div className="hidden md:block bg-card border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  PO #
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Supplier
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Expected
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {purchaseOrders.map((po) => (
                <tr
                  key={po._id}
                  className="hover:bg-muted/50 transition-colors"
                >
                  <td className="px-4 py-4 whitespace-nowrap">
                    <Link
                      href={`/dashboard/purchase-orders/${po._id}`}
                      className="text-sm font-mono font-semibold text-primary hover:underline"
                    >
                      {po.poNumber}
                    </Link>
                    {isOverdue(po) && (
                      <span className="ml-2 text-xs text-red-500 font-medium">
                        Overdue
                      </span>
                    )}
                    {isExpiring(po) && (
                      <span className="ml-2 text-xs text-orange-500 font-medium">
                        Expiring
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <div className="text-sm">
                      <p className="font-medium text-foreground">
                        {po.supplier?.name || "Unknown"}
                      </p>
                      {po.supplier?.taxPin && (
                        <p className="text-xs text-muted-foreground">
                          PIN: {po.supplier.taxPin}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="text-sm text-foreground">
                      {formatDate(po.poDate)}
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className={`text-sm ${isOverdue(po) ? "text-red-500 font-medium" : "text-foreground"}`}>
                      {formatDate(po.expectedDeliveryDate)}
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="text-sm font-semibold text-foreground">
                      {formatCurrency(po.amounts?.total)}
                    </div>
                    {po.linkedBills?.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {po.linkedBills.length} bill(s)
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <POStatusBadge status={po.status} />
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 hover:bg-accent"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="bg-card border-border"
                      >
                        <DropdownMenuItem asChild>
                          <Link
                            href={`/dashboard/purchase-orders/${po._id}`}
                            className="cursor-pointer"
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            View Details
                          </Link>
                        </DropdownMenuItem>

                        {/* Edit - only for draft POs */}
                        {po.status === "draft" && (
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/dashboard/purchase-orders/${po._id}/update`}
                              className="cursor-pointer"
                            >
                              <Edit className="mr-2 h-4 w-4" />
                              Edit PO
                            </Link>
                          </DropdownMenuItem>
                        )}

                        {/* Send PO - for draft */}
                        {po.status === "draft" && (
                          <>
                            <DropdownMenuSeparator />
                            <POActionButton
                              poId={po._id}
                              action={sendPurchaseOrder}
                              label="Send to Supplier"
                              icon={Send}
                              className="text-blue-600 dark:text-blue-400"
                            />
                          </>
                        )}

                        {/* Confirm PO - for sent */}
                        {po.status === "sent" && (
                          <>
                            <DropdownMenuSeparator />
                            <POActionButton
                              poId={po._id}
                              action={confirmPurchaseOrder}
                              label="Mark Confirmed"
                              icon={CheckCircle}
                              className="text-green-600 dark:text-green-400"
                            />
                          </>
                        )}

                        {/* Receive - for sent, confirmed, or partial */}
                        {["sent", "confirmed", "partial"].includes(po.status) && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem asChild>
                              <Link
                                href={`/dashboard/purchase-orders/${po._id}?receive=true`}
                                className="cursor-pointer text-emerald-600 dark:text-emerald-400"
                              >
                                <Package className="mr-2 h-4 w-4" />
                                Receive Items
                              </Link>
                            </DropdownMenuItem>
                          </>
                        )}

                        {/* Convert to Bill - for confirmed/partial/received with items */}
                        {["confirmed", "partial", "received"].includes(po.status) && (
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/dashboard/purchase-orders/${po._id}?bill=true`}
                              className="cursor-pointer text-purple-600 dark:text-purple-400"
                            >
                              <Receipt className="mr-2 h-4 w-4" />
                              Create Bill
                            </Link>
                          </DropdownMenuItem>
                        )}

                        {/* Duplicate */}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                          <Link
                            href={`/dashboard/purchase-orders/create?from=${po._id}`}
                            className="cursor-pointer"
                          >
                            <Copy className="mr-2 h-4 w-4" />
                            Duplicate PO
                          </Link>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-4">
        {purchaseOrders.map((po) => (
          <div
            key={po._id}
            className="bg-card border border-border rounded-lg p-4"
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <Link
                  href={`/dashboard/purchase-orders/${po._id}`}
                  className="text-sm font-mono font-semibold text-primary hover:underline"
                >
                  {po.poNumber}
                </Link>
                <p className="text-sm font-medium text-foreground mt-1">
                  {po.supplier?.name || "Unknown"}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="bg-card border-border"
                >
                  <DropdownMenuItem asChild>
                    <Link href={`/dashboard/purchase-orders/${po._id}`}>
                      <Eye className="mr-2 h-4 w-4" />
                      View Details
                    </Link>
                  </DropdownMenuItem>
                  {po.status === "draft" && (
                    <DropdownMenuItem asChild>
                      <Link href={`/dashboard/purchase-orders/${po._id}/update`}>
                        <Edit className="mr-2 h-4 w-4" />
                        Edit PO
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {po.status === "draft" && (
                    <>
                      <DropdownMenuSeparator />
                      <POActionButton
                        poId={po._id}
                        action={sendPurchaseOrder}
                        label="Send to Supplier"
                        icon={Send}
                        className="text-blue-600 dark:text-blue-400"
                      />
                    </>
                  )}
                  {["sent", "confirmed", "partial"].includes(po.status) && (
                    <DropdownMenuItem asChild>
                      <Link
                        href={`/dashboard/purchase-orders/${po._id}?receive=true`}
                        className="cursor-pointer text-emerald-600 dark:text-emerald-400"
                      >
                        <Package className="mr-2 h-4 w-4" />
                        Receive Items
                      </Link>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Date:</span>
                <span className="text-foreground">
                  {formatDate(po.poDate)}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Expected:</span>
                <span className={isOverdue(po) ? "text-red-500 font-medium" : "text-foreground"}>
                  {formatDate(po.expectedDeliveryDate)}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Amount:</span>
                <span className="font-semibold text-foreground">
                  {formatCurrency(po.amounts?.total)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status:</span>
                <POStatusBadge status={po.status} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
