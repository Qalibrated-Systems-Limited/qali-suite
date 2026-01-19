"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
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
  FileText,
  Edit,
  CheckCircle,
  Loader2,
  Send,
  ThumbsUp,
  ThumbsDown,
  ArrowRightCircle,
  Copy,
} from "lucide-react";
import { sendQuote, acceptQuote, rejectQuote, cancelQuote } from "@/app/mongodb/actions/quote-actions";
import { toast } from "sonner";

// Action Button with form wrapper
function QuoteActionButton({ quoteId, action, label, icon: Icon, className }) {
  const { pending } = useFormStatus();
  const actionWithId = action.bind(null, quoteId);

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

export function QuotesTable({ quotes }) {
  const router = useRouter();

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

  const getStatusColor = (status) => {
    switch (status) {
      case "draft":
        return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20";
      case "sent":
        return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
      case "accepted":
        return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20";
      case "rejected":
        return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
      case "converted":
        return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20";
      case "expired":
        return "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20";
      case "cancelled":
        return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
      default:
        return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20";
    }
  };

  const isExpiringSoon = (quote) => {
    if (!quote.validUntil) return false;
    const validUntil = new Date(quote.validUntil);
    const now = new Date();
    const daysUntilExpiry = Math.ceil((validUntil - now) / (1000 * 60 * 60 * 24));
    return daysUntilExpiry <= 7 && daysUntilExpiry > 0 && ["draft", "sent"].includes(quote.status);
  };

  if (!quotes || quotes.length === 0) {
    return (
      <div className="text-center py-12 bg-card border border-border rounded-lg">
        <FileText className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
        <h3 className="text-lg font-semibold text-foreground mb-2">
          No quotes found
        </h3>
        <p className="text-muted-foreground mb-4">
          Create your first quote to get started
        </p>
        <Button
          className="bg-yellow-500 hover:bg-yellow-600 text-black font-medium"
          asChild
        >
          <Link href="/dashboard/quotes/create">
            <FileText className="mr-2 h-4 w-4" />
            Create Quote
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
                  Quote #
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Customer
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Valid Until
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
              {quotes.map((quote) => (
                <tr
                  key={quote._id}
                  className="hover:bg-muted/50 transition-colors"
                >
                  <td className="px-4 py-4 whitespace-nowrap">
                    <Link
                      href={`/dashboard/quotes/${quote._id}`}
                      className="text-sm font-mono font-semibold text-yellow-600 dark:text-yellow-400 hover:underline"
                    >
                      {quote.quoteNumber}
                    </Link>
                    {isExpiringSoon(quote) && (
                      <span className="ml-2 text-xs text-orange-500">
                        Expiring soon
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <div className="text-sm">
                      <p className="font-medium text-foreground">
                        {quote.customer?.name || "Unknown"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {quote.customer?.email || quote.customer?.phone || "-"}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="text-sm text-foreground">
                      {formatDate(quote.quoteDate)}
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className={`text-sm ${isExpiringSoon(quote) ? "text-orange-500 font-medium" : "text-foreground"}`}>
                      {formatDate(quote.validUntil)}
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="text-sm font-semibold text-foreground">
                      {formatCurrency(quote.total)}
                    </div>
                    {quote.invoices?.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {quote.invoices.length} invoice(s)
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <Badge
                      variant="outline"
                      className={getStatusColor(quote.status)}
                    >
                      {quote.status}
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
                            href={`/dashboard/quotes/${quote._id}`}
                            className="cursor-pointer"
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            View Details
                          </Link>
                        </DropdownMenuItem>

                        {/* Edit - only for draft quotes */}
                        {quote.status === "draft" && (
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/dashboard/quotes/${quote._id}/update`}
                              className="cursor-pointer"
                            >
                              <Edit className="mr-2 h-4 w-4" />
                              Edit Quote
                            </Link>
                          </DropdownMenuItem>
                        )}

                        {/* Send Quote - for draft */}
                        {quote.status === "draft" && (
                          <>
                            <DropdownMenuSeparator />
                            <QuoteActionButton
                              quoteId={quote._id}
                              action={sendQuote}
                              label="Send Quote"
                              icon={Send}
                              className="text-blue-600 dark:text-blue-400"
                            />
                          </>
                        )}

                        {/* Accept/Reject - for sent quotes */}
                        {quote.status === "sent" && (
                          <>
                            <DropdownMenuSeparator />
                            <QuoteActionButton
                              quoteId={quote._id}
                              action={acceptQuote}
                              label="Mark Accepted"
                              icon={ThumbsUp}
                              className="text-green-600 dark:text-green-400"
                            />
                            <QuoteActionButton
                              quoteId={quote._id}
                              action={rejectQuote}
                              label="Mark Rejected"
                              icon={ThumbsDown}
                              className="text-red-600 dark:text-red-400"
                            />
                          </>
                        )}

                        {/* Convert to Invoice - for sent or accepted quotes */}
                        {["sent", "accepted"].includes(quote.status) && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem asChild>
                              <Link
                                href={`/dashboard/quotes/${quote._id}?convert=true`}
                                className="cursor-pointer text-purple-600 dark:text-purple-400"
                              >
                                <ArrowRightCircle className="mr-2 h-4 w-4" />
                                Convert to Invoice
                              </Link>
                            </DropdownMenuItem>
                          </>
                        )}

                        {/* Duplicate */}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                          <Link
                            href={`/dashboard/quotes/create?from=${quote._id}`}
                            className="cursor-pointer"
                          >
                            <Copy className="mr-2 h-4 w-4" />
                            Duplicate Quote
                          </Link>
                        </DropdownMenuItem>

                        {/* Cancel - for non-cancelled, non-converted */}
                        {!["cancelled", "converted", "rejected"].includes(quote.status) && (
                          <>
                            <DropdownMenuSeparator />
                            <QuoteActionButton
                              quoteId={quote._id}
                              action={cancelQuote}
                              label="Cancel Quote"
                              icon={XCircle}
                              className="text-red-600 dark:text-red-400"
                            />
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
        {quotes.map((quote) => (
          <div
            key={quote._id}
            className="bg-card border border-border rounded-lg p-4"
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <Link
                  href={`/dashboard/quotes/${quote._id}`}
                  className="text-sm font-mono font-semibold text-yellow-600 dark:text-yellow-400 hover:underline"
                >
                  {quote.quoteNumber}
                </Link>
                <p className="text-sm font-medium text-foreground mt-1">
                  {quote.customer?.name || "Unknown"}
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
                    <Link href={`/dashboard/quotes/${quote._id}`}>
                      <Eye className="mr-2 h-4 w-4" />
                      View Details
                    </Link>
                  </DropdownMenuItem>
                  {quote.status === "draft" && (
                    <DropdownMenuItem asChild>
                      <Link href={`/dashboard/quotes/${quote._id}/update`}>
                        <Edit className="mr-2 h-4 w-4" />
                        Edit Quote
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {quote.status === "draft" && (
                    <>
                      <DropdownMenuSeparator />
                      <QuoteActionButton
                        quoteId={quote._id}
                        action={sendQuote}
                        label="Send Quote"
                        icon={Send}
                        className="text-blue-600 dark:text-blue-400"
                      />
                    </>
                  )}
                  {["sent", "accepted"].includes(quote.status) && (
                    <DropdownMenuItem asChild>
                      <Link
                        href={`/dashboard/quotes/${quote._id}?convert=true`}
                        className="cursor-pointer text-purple-600 dark:text-purple-400"
                      >
                        <ArrowRightCircle className="mr-2 h-4 w-4" />
                        Convert to Invoice
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
                  {formatDate(quote.quoteDate)}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Valid Until:</span>
                <span className={isExpiringSoon(quote) ? "text-orange-500 font-medium" : "text-foreground"}>
                  {formatDate(quote.validUntil)}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Amount:</span>
                <span className="font-semibold text-foreground">
                  {formatCurrency(quote.total)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status:</span>
                <Badge
                  variant="outline"
                  className={getStatusColor(quote.status)}
                >
                  {quote.status}
                </Badge>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
