"use client";

import { useState, useEffect, useActionState } from "react";
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
  Mail,
  XCircle,
  DollarSign,
  FileText,
  Edit,
  CheckCircle,
  Loader2,
} from "lucide-react";
import { InvoicePrintDialog } from "./invoicePrintDialog";
import { InvoicePaymentDialog } from "./InvoicePaymentDialog";
import { completeInvoice } from "@/app/mongodb/invoice-actions";
import { toast } from "sonner";

// Post Invoice Button with form wrapper and error handling
function PostInvoiceButton({ invoiceId }) {
  const postInvoiceWithId = completeInvoice.bind(null, invoiceId);
  const [state, formAction, isPending] = useActionState(postInvoiceWithId, null);

  // Show error toast when action fails
  useEffect(() => {
    if (state?.message) {
      toast.error("Failed to post invoice", {
        description: state.message,
        duration: 5000,
      });
    }
  }, [state]);

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={isPending}
        className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none text-blue-600 dark:text-blue-400 hover:bg-accent focus:bg-accent disabled:pointer-events-none disabled:opacity-50"
      >
        {isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <CheckCircle className="mr-2 h-4 w-4" />
        )}
        Post Invoice
      </button>
    </form>
  );
}

export function InvoicesTable({ invoices, paymentAccounts = [] }) {
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState(null);

  const handlePrintClick = (invoice) => {
    setSelectedInvoice(invoice);
    setPrintDialogOpen(true);
  };

  const handlePaymentClick = (invoice) => {
    setPaymentInvoice(invoice);
    setPaymentDialogOpen(true);
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getPaymentStatusColor = (status) => {
    switch (status) {
      case "paid":
        return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20";
      case "unpaid":
        return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
      case "partial":
        return "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20";
      case "overdue":
        return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20";
      default:
        return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20";
    }
  };

  const getInvoiceStatusColor = (status) => {
    switch (status) {
      case "paid":
        return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20";
      case "sent":
        return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
      case "draft":
        return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20";
      case "cancelled":
        return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
      default:
        return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20";
    }
  };

  if (!invoices || invoices.length === 0) {
    return (
      <div className="text-center py-12 bg-card border border-border rounded-lg">
        <FileText className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
        <h3 className="text-lg font-semibold text-foreground mb-2">
          No invoices found
        </h3>
        <p className="text-muted-foreground mb-4">
          Create your first invoice to get started
        </p>
        <Button
          className="bg-yellow-500 hover:bg-yellow-600 text-black font-medium"
          asChild
        >
          <Link href="/dashboard/invoices/create">
            <FileText className="mr-2 h-4 w-4" />
            Create Invoice
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
                  Invoice #
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Customer
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Payment Status
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
              {invoices.map((invoice) => (
                <tr
                  key={invoice._id}
                  className="hover:bg-muted/50 transition-colors"
                >
                  <td className="px-4 py-4 whitespace-nowrap">
                    <Link
                      href={`/dashboard/invoices/${invoice._id}`}
                      className="text-sm font-mono font-semibold text-yellow-600 dark:text-yellow-400 hover:underline"
                    >
                      {invoice.invoiceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-4">
                    <div className="text-sm">
                      <p className="font-medium text-foreground">
                        {invoice.customer.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {invoice.customer.email || invoice.customer.phone}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="text-sm text-foreground">
                      {formatDate(invoice.invoiceDate)}
                    </div>
                    {invoice.dueDate && (
                      <div className="text-xs text-muted-foreground">
                        Due: {formatDate(invoice.dueDate)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="text-sm font-semibold text-foreground">
                      {formatCurrency(invoice.total)}
                    </div>
                    {invoice.amountPaid > 0 && (
                      <div className="text-xs text-muted-foreground">
                        Paid: {formatCurrency(invoice.amountPaid)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <Badge
                      variant="outline"
                      className={getPaymentStatusColor(invoice.paymentStatus)}
                    >
                      {invoice.paymentStatus}
                    </Badge>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <Badge
                      variant="outline"
                      className={getInvoiceStatusColor(invoice.status)}
                    >
                      {invoice.status}
                    </Badge>
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
                            href={`/dashboard/invoices/${invoice._id}`}
                            className="cursor-pointer"
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            View Details
                          </Link>
                        </DropdownMenuItem>
                        {invoice.paymentStatus !== "paid" &&
                          invoice.status !== "cancelled" &&
                          invoice.status !== "completed" && (
                            <DropdownMenuItem asChild>
                              <Link
                                href={`/dashboard/invoices/${invoice._id}/update`}
                                className="cursor-pointer"
                              >
                                <Edit className="mr-2 h-4 w-4" />
                                Edit Invoice
                              </Link>
                            </DropdownMenuItem>
                          )}
                        {(invoice.status === "draft" || invoice.status === "sent") && (
                          <>
                            <DropdownMenuSeparator />
                            <PostInvoiceButton invoiceId={invoice._id} />
                          </>
                        )}

                        <DropdownMenuItem>
                          <Mail className="mr-2 h-4 w-4" />
                          Send Email
                        </DropdownMenuItem>
                        {invoice.paymentStatus !== "paid" &&
                          invoice.status === "completed" && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handlePaymentClick(invoice)}
                              >
                                <DollarSign className="mr-2 h-4 w-4" />
                                Receive Payment
                              </DropdownMenuItem>
                            </>
                          )}
                        {invoice.status !== "cancelled" && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-red-600 dark:text-red-400">
                              <XCircle className="mr-2 h-4 w-4" />
                              Cancel Invoice
                            </DropdownMenuItem>
                          </>
                        )}
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
        {invoices.map((invoice) => (
          <div
            key={invoice._id}
            className="bg-card border border-border rounded-lg p-4"
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <Link
                  href={`/dashboard/invoices/${invoice._id}`}
                  className="text-sm font-mono font-semibold text-yellow-600 dark:text-yellow-400 hover:underline"
                >
                  {invoice.invoiceNumber}
                </Link>
                <p className="text-sm font-medium text-foreground mt-1">
                  {invoice.customer.name}
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
                    <Link href={`/dashboard/invoices/${invoice._id}`}>
                      <Eye className="mr-2 h-4 w-4" />
                      View Details
                    </Link>
                  </DropdownMenuItem>
                  {invoice.paymentStatus !== "paid" &&
                    invoice.status !== "cancelled" &&
                    invoice.status !== "completed" && (
                      <DropdownMenuItem asChild>
                        <Link href={`/dashboard/invoices/${invoice._id}/update`}>
                          <Edit className="mr-2 h-4 w-4" />
                          Edit Invoice
                        </Link>
                      </DropdownMenuItem>
                    )}
                  {(invoice.status === "draft" || invoice.status === "sent") && (
                    <>
                      <DropdownMenuSeparator />
                      <PostInvoiceButton invoiceId={invoice._id} />
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Date:</span>
                <span className="text-foreground">
                  {formatDate(invoice.invoiceDate)}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Amount:</span>
                <span className="font-semibold text-foreground">
                  {formatCurrency(invoice.total)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Payment:</span>
                <Badge
                  variant="outline"
                  className={getPaymentStatusColor(invoice.paymentStatus)}
                >
                  {invoice.paymentStatus}
                </Badge>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status:</span>
                <Badge
                  variant="outline"
                  className={getInvoiceStatusColor(invoice.status)}
                >
                  {invoice.status}
                </Badge>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Print Dialog */}
      {selectedInvoice && (
        <InvoicePrintDialog
          invoice={selectedInvoice}
          open={printDialogOpen}
          onOpenChange={setPrintDialogOpen}
        />
      )}

      {/* Payment Dialog */}
      {paymentInvoice && (
        <InvoicePaymentDialog
          open={paymentDialogOpen}
          onOpenChange={setPaymentDialogOpen}
          invoice={paymentInvoice}
          paymentAccounts={paymentAccounts}
        />
      )}
    </>
  );
}
