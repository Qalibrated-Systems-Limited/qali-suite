"use client";

import { useRouter } from "next/navigation";
import { useState, useCallback } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Calendar,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Printer,
  Download,
  MoreHorizontal,
  Building2,
  Hash,
  Link as LinkIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, formatCurrency } from "@/lib/utils";
import { EntryTypeBadge } from "../components/EntryTypeBadge";
import { StatusBadge } from "../components/StatusBadge";

const ACCOUNT_TYPE_COLORS = {
  asset: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  liability: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  equity: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  revenue: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  expense: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

export function JournalEntryDetail({ entry }) {
  const router = useRouter();
  const [isPostDialogOpen, setIsPostDialogOpen] = useState(false);
  const [isReverseDialogOpen, setIsReverseDialogOpen] = useState(false);
  const [reversalReason, setReversalReason] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatDateTime = (dateStr) => {
    return new Date(dateStr).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handlePost = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/journal/${entry._id}/post`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to post entry");
      }

      toast.success("Entry posted successfully");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to post entry");
    } finally {
      setIsLoading(false);
      setIsPostDialogOpen(false);
    }
  }, [entry._id, router]);

  const handleReverse = useCallback(async () => {
    if (!reversalReason.trim()) {
      toast.error("Please enter a reason for reversal");
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/journal/${entry._id}/reverse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reversalReason }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to reverse entry");
      }

      toast.success("Entry reversed successfully");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reverse entry");
    } finally {
      setIsLoading(false);
      setIsReverseDialogOpen(false);
      setReversalReason("");
    }
  }, [entry._id, reversalReason, router]);

  // Group debit and credit lines
  const debitLines = entry.lines.filter((l) => l.debit > 0);
  const creditLines = entry.lines.filter((l) => l.credit > 0);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Back Button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/dashboard/journal")}
        className="gap-2"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Journal
      </Button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="text-xl sm:text-2xl font-bold">{entry.entryNumber}</h1>
            <EntryTypeBadge type={entry.entryType} />
            <StatusBadge status={entry.status} />
          </div>
          <p className="text-muted-foreground mt-1">{entry.description}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {entry.status === "draft" && (
            <Button onClick={() => setIsPostDialogOpen(true)} disabled={isLoading}>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Post Entry
            </Button>
          )}
          {entry.status === "posted" && (
            <Button
              variant="outline"
              onClick={() => setIsReverseDialogOpen(true)}
              disabled={isLoading}
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Reverse
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <Printer className="w-4 h-4 mr-2" />
                Print
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Download className="w-4 h-4 mr-2" />
                Export PDF
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <FileText className="w-4 h-4 mr-2" />
                View Audit Log
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <Card className="p-3 sm:p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Calendar className="w-4 h-4" />
            Entry Date
          </div>
          <p className="font-semibold mt-1">{formatDate(entry.entryDate)}</p>
        </Card>

        <Card className="p-3 sm:p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Hash className="w-4 h-4" />
            Lines
          </div>
          <p className="font-semibold mt-1">{entry.lines.length} accounts</p>
        </Card>

        <Card className="p-3 sm:p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            Total Debits
          </div>
          <p className="font-semibold mt-1 text-blue-600">
            {formatCurrency(entry.totals.debit)}
          </p>
        </Card>

        <Card className="p-3 sm:p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            Total Credits
          </div>
          <p className="font-semibold mt-1 text-green-600">
            {formatCurrency(entry.totals.credit)}
          </p>
        </Card>
      </div>

      {/* Balance Warning */}
      {!entry.totals.isBalanced && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-center gap-3">
          <XCircle className="w-5 h-5 text-red-600 shrink-0" />
          <div>
            <p className="font-medium text-red-800 dark:text-red-200">
              Entry is not balanced
            </p>
            <p className="text-sm text-red-600 dark:text-red-300">
              Debits ({formatCurrency(entry.totals.debit)}) do not equal Credits (
              {formatCurrency(entry.totals.credit)}). Difference:{" "}
              {formatCurrency(Math.abs(entry.totals.debit - entry.totals.credit))}
            </p>
          </div>
        </div>
      )}

      {/* Journal Lines - T-Account Style */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b bg-muted/30">
          <h2 className="font-semibold flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Journal Lines
          </h2>
        </div>

        {/* Desktop View - T-Account Layout */}
        <div className="hidden sm:block">
          <div className="grid grid-cols-2 divide-x">
            {/* Debit Side */}
            <div>
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border-b font-medium text-blue-700 dark:text-blue-300 text-center">
                DEBIT
              </div>
              <div className="divide-y">
                {debitLines.map((line, idx) => (
                  <div key={idx} className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {line.accountCode}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] px-1.5 py-0",
                              ACCOUNT_TYPE_COLORS[line.accountType]
                            )}
                          >
                            {line.accountType}
                          </Badge>
                        </div>
                        <p className="font-medium truncate">{line.accountName}</p>
                        {line.description && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {line.description}
                          </p>
                        )}
                      </div>
                      <span className="font-mono font-semibold text-blue-600 whitespace-nowrap">
                        {formatCurrency(line.debit)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Credit Side */}
            <div>
              <div className="p-3 bg-green-50 dark:bg-green-900/20 border-b font-medium text-green-700 dark:text-green-300 text-center">
                CREDIT
              </div>
              <div className="divide-y">
                {creditLines.map((line, idx) => (
                  <div key={idx} className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {line.accountCode}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] px-1.5 py-0",
                              ACCOUNT_TYPE_COLORS[line.accountType]
                            )}
                          >
                            {line.accountType}
                          </Badge>
                        </div>
                        <p className="font-medium truncate">{line.accountName}</p>
                        {line.description && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {line.description}
                          </p>
                        )}
                      </div>
                      <span className="font-mono font-semibold text-green-600 whitespace-nowrap">
                        {formatCurrency(line.credit)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Totals Row */}
          <div className="grid grid-cols-2 divide-x border-t bg-muted/30">
            <div className="p-4 flex justify-end">
              <span className="font-mono font-bold text-blue-700 dark:text-blue-400">
                {formatCurrency(entry.totals.debit)}
              </span>
            </div>
            <div className="p-4 flex justify-end">
              <span className="font-mono font-bold text-green-700 dark:text-green-400">
                {formatCurrency(entry.totals.credit)}
              </span>
            </div>
          </div>
        </div>

        {/* Mobile View - Stacked */}
        <div className="sm:hidden divide-y">
          {entry.lines.map((line, idx) => (
            <div key={idx} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-muted-foreground">
                      {line.accountCode}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] px-1.5 py-0",
                        ACCOUNT_TYPE_COLORS[line.accountType]
                      )}
                    >
                      {line.accountType}
                    </Badge>
                  </div>
                  <p className="font-medium">{line.accountName}</p>
                  {line.description && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {line.description}
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  {line.debit > 0 && (
                    <div>
                      <span className="text-xs text-muted-foreground">DR</span>
                      <p className="font-mono font-semibold text-blue-600">
                        {formatCurrency(line.debit)}
                      </p>
                    </div>
                  )}
                  {line.credit > 0 && (
                    <div>
                      <span className="text-xs text-muted-foreground">CR</span>
                      <p className="font-mono font-semibold text-green-600">
                        {formatCurrency(line.credit)}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Mobile Totals */}
          <div className="p-4 bg-muted/30">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total Debits</span>
              <span className="font-mono font-bold text-blue-600">
                {formatCurrency(entry.totals.debit)}
              </span>
            </div>
            <div className="flex justify-between text-sm mt-2">
              <span className="text-muted-foreground">Total Credits</span>
              <span className="font-mono font-bold text-green-600">
                {formatCurrency(entry.totals.credit)}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* Details & Audit Trail */}
      <div className="grid sm:grid-cols-2 gap-4">
        {/* Entry Details */}
        <Card className="p-4">
          <h3 className="font-semibold flex items-center gap-2 mb-4">
            <FileText className="w-4 h-4" />
            Entry Details
          </h3>
          <dl className="space-y-3 text-sm">
            {entry.reference && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Reference</dt>
                <dd className="font-medium">{entry.reference}</dd>
              </div>
            )}
            {entry.party && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground flex items-center gap-1">
                  <Building2 className="w-3 h-3" />
                  {entry.party.type === "customer" ? "Customer" : "Supplier"}
                </dt>
                <dd className="font-medium">{entry.party.name}</dd>
              </div>
            )}
            {entry.fiscalYear && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Fiscal Period</dt>
                <dd className="font-medium">
                  {entry.fiscalYear}-{String(entry.fiscalMonth).padStart(2, "0")}
                </dd>
              </div>
            )}
            {entry.relatedDocuments?.invoiceNumber && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground flex items-center gap-1">
                  <LinkIcon className="w-3 h-3" />
                  Invoice
                </dt>
                <dd>
                  <Button variant="link" size="sm" className="h-auto p-0 font-medium">
                    {entry.relatedDocuments.invoiceNumber}
                  </Button>
                </dd>
              </div>
            )}
            {entry.relatedDocuments?.billNumber && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground flex items-center gap-1">
                  <LinkIcon className="w-3 h-3" />
                  Bill
                </dt>
                <dd>
                  <Button variant="link" size="sm" className="h-auto p-0 font-medium">
                    {entry.relatedDocuments.billNumber}
                  </Button>
                </dd>
              </div>
            )}
            {entry.relatedDocuments?.paymentNumber && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground flex items-center gap-1">
                  <LinkIcon className="w-3 h-3" />
                  Payment
                </dt>
                <dd>
                  <Button variant="link" size="sm" className="h-auto p-0 font-medium">
                    {entry.relatedDocuments.paymentNumber}
                  </Button>
                </dd>
              </div>
            )}
            {entry.notes && (
              <div className="pt-2 border-t">
                <dt className="text-muted-foreground mb-1">Notes</dt>
                <dd className="text-sm">{entry.notes}</dd>
              </div>
            )}
          </dl>
        </Card>

        {/* Audit Trail */}
        <Card className="p-4">
          <h3 className="font-semibold flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4" />
            Audit Trail
          </h3>
          <div className="space-y-4">
            {/* Created */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="font-medium text-sm">Created</p>
                <p className="text-xs text-muted-foreground">
                  {entry.createdBy?.name || "System"} • {formatDateTime(entry.createdAt)}
                </p>
              </div>
            </div>

            {/* Posted */}
            {entry.postedAt && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                </div>
                <div>
                  <p className="font-medium text-sm">Posted</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.postedBy?.name || "System"} • {formatDateTime(entry.postedAt)}
                  </p>
                </div>
              </div>
            )}

            {/* Reversed */}
            {entry.reversedAt && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                  <RotateCcw className="w-4 h-4 text-red-600" />
                </div>
                <div>
                  <p className="font-medium text-sm">Reversed</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.reversedBy?.name || "System"} •{" "}
                    {formatDateTime(entry.reversedAt)}
                  </p>
                  {entry.reversalEntryId && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={() =>
                        router.push(`/dashboard/journal/${entry.reversalEntryId}`)
                      }
                    >
                      View reversal entry →
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Original Entry Link */}
            {entry.originalEntryId && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
                  <LinkIcon className="w-4 h-4 text-gray-600" />
                </div>
                <div>
                  <p className="font-medium text-sm">Reversal of</p>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() =>
                      router.push(`/dashboard/journal/${entry.originalEntryId}`)
                    }
                  >
                    View original entry →
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Post Dialog */}
      <AlertDialog open={isPostDialogOpen} onOpenChange={setIsPostDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post Journal Entry</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to post this journal entry? Once posted, the entry
              cannot be edited, only reversed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handlePost} disabled={isLoading}>
              {isLoading ? "Posting..." : "Post Entry"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reverse Dialog */}
      <AlertDialog open={isReverseDialogOpen} onOpenChange={setIsReverseDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reverse Journal Entry</AlertDialogTitle>
            <AlertDialogDescription>
              This will create a new journal entry that reverses all debits and credits.
              Please provide a reason for the reversal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Label htmlFor="reversal-reason">Reason for reversal</Label>
            <Input
              id="reversal-reason"
              value={reversalReason}
              onChange={(e) => setReversalReason(e.target.value)}
              placeholder="Enter reason..."
              className="mt-2"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReverse}
              disabled={isLoading || !reversalReason.trim()}
              className="bg-red-600 hover:bg-red-700"
            >
              {isLoading ? "Reversing..." : "Reverse Entry"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
