"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  MoreHorizontal,
  Eye,
  CheckCircle,
  RotateCcw,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { EntryTypeBadge, EntryTypeIcon } from "./EntryTypeBadge";
import { StatusBadge } from "./StatusBadge";
import { DebitCreditBar, DebitCreditInline } from "./DebitCreditBar";
import Link from "next/link";

export function JournalEntryCard({ entry, onPost, onReverse }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const formatTime = (date) => {
    return format(new Date(date), "h:mm a");
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <Card
      className={cn(
        "overflow-hidden transition-all",
        entry.status === "reversed" && "opacity-60",
        "hover:shadow-md"
      )}
    >
      {/* Main Card Content */}
      <div
        className="p-3 sm:p-4 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* Header Row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            {/* Entry Type Icon - visible on mobile */}
            <div className="sm:hidden">
              <EntryTypeIcon type={entry.entryType} size="md" />
            </div>
            {/* Entry Type Badge - visible on desktop */}
            <div className="hidden sm:block">
              <EntryTypeBadge type={entry.entryType} size="sm" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm sm:text-base truncate">
                  {entry.entryNumber}
                </span>
                <StatusBadge status={entry.status} size="sm" />
              </div>
              {/* Description - truncated on mobile */}
              <p className="text-sm text-muted-foreground truncate mt-0.5">
                {entry.description}
              </p>
            </div>
          </div>

          {/* Time & Actions */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <span className="text-xs sm:text-sm text-muted-foreground hidden sm:block">
              {formatTime(entry.postedAt || entry.createdAt)}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={`/dashboard/journal/${entry._id}`}>
                    <Eye className="mr-2 h-4 w-4" />
                    View Details
                  </Link>
                </DropdownMenuItem>
                {entry.status === "draft" && onPost && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        onPost(entry._id);
                      }}
                    >
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Post Entry
                    </DropdownMenuItem>
                  </>
                )}
                {entry.status === "posted" && onReverse && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        onReverse(entry._id);
                      }}
                      className="text-red-600"
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Reverse Entry
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Party & Reference - Mobile compact view */}
        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground sm:hidden">
          {entry.party?.name && <span>{entry.party.name}</span>}
          {entry.party?.name && entry.reference && <span>•</span>}
          {entry.reference && <span>{entry.reference}</span>}
          <span className="ml-auto">
            {formatTime(entry.postedAt || entry.createdAt)}
          </span>
        </div>

        {/* Desktop: Party info */}
        {entry.party?.name && (
          <div className="hidden sm:flex items-center gap-2 mt-2">
            <span className="text-sm text-muted-foreground">
              {entry.party.type === "customer" ? "Customer" : "Supplier"}:
            </span>
            <span className="text-sm font-medium">{entry.party.name}</span>
            {entry.reference && (
              <>
                <span className="text-muted-foreground">•</span>
                <span className="text-sm text-muted-foreground">
                  Ref: {entry.reference}
                </span>
              </>
            )}
          </div>
        )}

        {/* Debit/Credit Summary */}
        <div className="mt-3">
          {/* Mobile: Inline compact */}
          <div className="sm:hidden">
            <DebitCreditInline
              debit={entry.totalDebits}
              credit={entry.totalCredits}
            />
          </div>
          {/* Desktop: Full bars */}
          <div className="hidden sm:block">
            <DebitCreditBar
              debit={entry.totalDebits}
              credit={entry.totalCredits}
              size="sm"
            />
          </div>
        </div>

        {/* Expand/Collapse indicator */}
        <div className="flex justify-center mt-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
          >
            {isExpanded ? (
              <>
                <ChevronUp className="h-3 w-3 mr-1" />
                Less
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3 mr-1" />
                {entry.lines?.length || 0} lines
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Expanded Content: Journal Lines */}
      {isExpanded && entry.lines && entry.lines.length > 0 && (
        <div className="border-t bg-muted/30 p-3 sm:p-4">
          <div className="space-y-2">
            {entry.lines.map((line, index) => (
              <div
                key={index}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-xs text-muted-foreground mr-2">
                    {line.accountCode}
                  </span>
                  <span className="truncate">{line.accountName}</span>
                  {line.description && (
                    <span className="text-muted-foreground ml-2 text-xs hidden sm:inline">
                      - {line.description}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 shrink-0 font-mono text-sm">
                  <span
                    className={cn(
                      "w-20 text-right",
                      line.debit > 0 ? "text-blue-600 dark:text-blue-400" : "text-transparent"
                    )}
                  >
                    {line.debit > 0 ? formatCurrency(line.debit) : "-"}
                  </span>
                  <span
                    className={cn(
                      "w-20 text-right",
                      line.credit > 0 ? "text-green-600 dark:text-green-400" : "text-transparent"
                    )}
                  >
                    {line.credit > 0 ? formatCurrency(line.credit) : "-"}
                  </span>
                </div>
              </div>
            ))}
            {/* Totals Row */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t text-sm font-semibold">
              <span>Total</span>
              <div className="flex items-center gap-4 font-mono">
                <span className="w-20 text-right text-blue-600 dark:text-blue-400">
                  {formatCurrency(entry.totalDebits)}
                </span>
                <span className="w-20 text-right text-green-600 dark:text-green-400">
                  {formatCurrency(entry.totalCredits)}
                </span>
              </div>
            </div>
          </div>

          {/* View Full Details Link */}
          <div className="mt-3 pt-3 border-t">
            <Button variant="outline" size="sm" asChild className="w-full sm:w-auto">
              <Link href={`/dashboard/journal/${entry._id}`}>
                <ExternalLink className="h-4 w-4 mr-2" />
                View Full Details
              </Link>
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
