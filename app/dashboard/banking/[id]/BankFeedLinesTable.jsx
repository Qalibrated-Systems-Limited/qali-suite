"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  Clock,
  Ban,
  MoreHorizontal,
  FileText,
  Receipt,
  Wallet,
  X,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Pagination from "@/components/pagination";
import { format } from "date-fns";
import AllocationDialog from "./AllocationDialog";
import { serializeBsonType } from "@/lib/utils";

// ============================================
// HELPER
// ============================================
function formatCurrency(amount) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
  }).format(amount);
}

// ============================================
// STATUS BADGE
// ============================================
function StatusBadge({ status }) {
  const config = {
    unallocated: {
      label: "Pending",
      className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
      icon: Clock,
    },
    allocated: {
      label: "Allocated",
      className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
      icon: CheckCircle2,
    },
    matched: {
      label: "Matched",
      className: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
      icon: CheckCircle2,
    },
    excluded: {
      label: "Excluded",
      className: "bg-gray-500/15 text-gray-700 dark:text-gray-400",
      icon: Ban,
    },
  };

  const { label, className, icon: Icon } = config[status] || config.unallocated;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${className}`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

// ============================================
// FILTERS
// ============================================
function Filters({ filters, onFilterChange }) {
  const [searchValue, setSearchValue] = useState(filters.search || "");

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    onFilterChange({ ...filters, search: searchValue });
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {/* Search */}
      <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder="Search description or reference..."
          className="w-full pl-9 pr-4 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </form>

      {/* Filter Buttons */}
      <div className="flex flex-wrap gap-2">
        {/* Status Filter */}
        <select
          value={filters.status || ""}
          onChange={(e) =>
            onFilterChange({ ...filters, status: e.target.value })
          }
          className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All Status</option>
          <option value="unallocated">Pending</option>
          <option value="allocated">Allocated</option>
          <option value="excluded">Excluded</option>
        </select>

        {/* Type Filter */}
        <select
          value={filters.type || ""}
          onChange={(e) => onFilterChange({ ...filters, type: e.target.value })}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All Types</option>
          <option value="debit">Money Out</option>
          <option value="credit">Money In</option>
        </select>

        {/* Clear Filters */}
        {(filters.status || filters.type || filters.search) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onFilterChange({ status: "", type: "", search: "" })}
          >
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

// ============================================
// LINE ROW
// ============================================
function LineRow({ line, onAllocate }) {
  const [expanded, setExpanded] = useState(false);
  const isDebit = line.debitAmount > 0;
  const amount = isDebit ? line.debitAmount : line.creditAmount;

  return (
    <>
      <tr
        className={`hover:bg-muted/50 transition-colors ${
          line.status === "unallocated" ? "bg-amber-500/5" : ""
        }`}
      >
        <td className="px-4 py-3">
          <span className="text-sm">
            {format(new Date(line.transactionDate), "MMM d, yyyy")}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="max-w-xs">
            <p className="font-medium text-sm truncate">{line.description}</p>
            {line.reference && (
              <p className="text-xs text-muted-foreground truncate">
                Ref: {line.reference}
              </p>
            )}
          </div>
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-2">
            {isDebit ? (
              <ArrowUpRight className="h-4 w-4 text-red-500" />
            ) : (
              <ArrowDownRight className="h-4 w-4 text-emerald-500" />
            )}
            <span
              className={`font-mono text-sm font-medium ${
                isDebit ? "text-red-600" : "text-emerald-600"
              }`}
            >
              {formatCurrency(amount)}
            </span>
          </div>
        </td>
        <td className="px-4 py-3 text-center">
          <StatusBadge status={line.status} />
        </td>
        <td className="px-4 py-3">
          {line.status === "unallocated" ? (
            <div className="flex items-center justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onAllocate(line)}
              >
                Allocate
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-end">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </div>
          )}
        </td>
      </tr>

      {/* Expanded Details */}
      {expanded && (
        <tr className="bg-muted/30">
          <td colSpan={5} className="px-4 py-3">
            <div className="text-sm space-y-2">
              {/* Allocation Details */}
              {line.status === "allocated" && line.allocationType && (
                <div className="flex items-start gap-4">
                  <span className="text-muted-foreground">Allocated as:</span>
                  <div>
                    <span className="font-medium capitalize">
                      {line.allocationType.replace(/_/g, " ")}
                    </span>
                    {line.matchedDocument && (
                      <p className="text-muted-foreground">
                        {line.matchedDocument.type === "invoice"
                          ? "Invoice"
                          : "Bill"}{" "}
                        # {line.matchedDocument.documentNumber} -{" "}
                        {line.matchedDocument.partyName}
                      </p>
                    )}
                    {line.allocations?.[0] && (
                      <p className="text-muted-foreground">
                        Account: {line.allocations[0].accountCode} -{" "}
                        {line.allocations[0].accountName}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Exclude Details */}
              {line.status === "excluded" && (
                <div className="flex items-start gap-4">
                  <span className="text-muted-foreground">Excluded:</span>
                  <div>
                    <span className="font-medium capitalize">
                      {line.excludeReason?.replace(/_/g, " ") || "Manual"}
                    </span>
                    {line.excludeNote && (
                      <p className="text-muted-foreground">
                        {line.excludeNote}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Suggestions */}
              {line.status === "unallocated" &&
                line.suggestions?.length > 0 && (
                  <div>
                    <span className="text-muted-foreground mb-2 block">
                      Suggested matches:
                    </span>
                    <div className="space-y-1">
                      {line.suggestions.slice(0, 3).map((suggestion, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between p-2 rounded bg-background border"
                        >
                          <div className="flex items-center gap-2">
                            {suggestion.type === "invoice" ? (
                              <FileText className="h-4 w-4 text-blue-500" />
                            ) : (
                              <Receipt className="h-4 w-4 text-purple-500" />
                            )}
                            <span>
                              {suggestion.type === "invoice"
                                ? "Invoice"
                                : "Bill"}{" "}
                              #{suggestion.documentNumber}
                            </span>
                            <span className="text-muted-foreground">
                              {suggestion.partyName}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono">
                              {formatCurrency(suggestion.amount)}
                            </span>
                            <span
                              className={`text-xs px-1.5 py-0.5 rounded ${
                                suggestion.confidence >= 70
                                  ? "bg-emerald-500/15 text-emerald-700"
                                  : suggestion.confidence >= 50
                                    ? "bg-amber-500/15 text-amber-700"
                                    : "bg-gray-500/15 text-gray-700"
                              }`}
                            >
                              {suggestion.confidence}% match
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {/* Allocated By */}
              {line.allocatedBy && (
                <p className="text-xs text-muted-foreground">
                  {line.status === "excluded" ? "Excluded" : "Allocated"} by{" "}
                  {line.allocatedBy.name} on{" "}
                  {format(
                    new Date(line.allocatedAt),
                    "MMM d, yyyy 'at' h:mm a",
                  )}
                </p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ============================================
// MOBILE CARD
// ============================================
function LineCard({ line, onAllocate }) {
  const [expanded, setExpanded] = useState(false);
  const isDebit = line.debitAmount > 0;
  const amount = isDebit ? line.debitAmount : line.creditAmount;

  return (
    <div
      className={`rounded-lg border bg-card p-4 ${
        line.status === "unallocated" ? "border-amber-500/50" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-muted-foreground">
              {format(new Date(line.transactionDate), "MMM d, yyyy")}
            </span>
            <StatusBadge status={line.status} />
          </div>
          <p className="font-medium text-sm truncate">{line.description}</p>
          {line.reference && (
            <p className="text-xs text-muted-foreground truncate">
              Ref: {line.reference}
            </p>
          )}
        </div>
        <div className="text-right">
          <div className="flex items-center gap-1">
            {isDebit ? (
              <ArrowUpRight className="h-4 w-4 text-red-500" />
            ) : (
              <ArrowDownRight className="h-4 w-4 text-emerald-500" />
            )}
            <span
              className={`font-mono font-medium ${
                isDebit ? "text-red-600" : "text-emerald-600"
              }`}
            >
              {formatCurrency(amount)}
            </span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Hide Details" : "Show Details"}
          {expanded ? (
            <ChevronUp className="h-4 w-4 ml-1" />
          ) : (
            <ChevronDown className="h-4 w-4 ml-1" />
          )}
        </Button>
        {line.status === "unallocated" && (
          <Button size="sm" onClick={() => onAllocate(line)}>
            Allocate
          </Button>
        )}
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="mt-3 pt-3 border-t text-sm space-y-2">
          {line.status === "allocated" && line.allocationType && (
            <div>
              <span className="text-muted-foreground">Allocated as: </span>
              <span className="font-medium capitalize">
                {line.allocationType.replace(/_/g, " ")}
              </span>
            </div>
          )}
          {line.suggestions?.length > 0 && line.status === "unallocated" && (
            <div className="text-xs text-muted-foreground">
              {line.suggestions.length} suggested match(es)
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// EMPTY STATE
// ============================================
function EmptyState({ hasFilters }) {
  return (
    <div className="rounded-lg border bg-card p-12 text-center">
      <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
        <FileText className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="mt-4 font-semibold">
        {hasFilters ? "No matching transactions" : "No transactions"}
      </h3>
      <p className="text-sm text-muted-foreground mt-1">
        {hasFilters
          ? "Try adjusting your filters"
          : "This statement has no transactions"}
      </p>
    </div>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================
export default function BankFeedLinesTable({
  lines,
  pagination,
  statementId,
  filters,
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [selectedLine, setSelectedLine] = useState(null);
  const [showAllocationDialog, setShowAllocationDialog] = useState(false);

  const handleFilterChange = (newFilters) => {
    startTransition(() => {
      const params = new URLSearchParams(searchParams);

      if (newFilters.status) {
        params.set("status", newFilters.status);
      } else {
        params.delete("status");
      }

      if (newFilters.type) {
        params.set("type", newFilters.type);
      } else {
        params.delete("type");
      }

      if (newFilters.search) {
        params.set("search", newFilters.search);
      } else {
        params.delete("search");
      }

      // Reset to page 1 when filtering
      params.delete("page");

      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const handleAllocate = (line) => {
    const serialisedLine = serializeBsonType(line);
    setSelectedLine(serialisedLine);
    setShowAllocationDialog(true);
  };

  const handleAllocationComplete = () => {
    setShowAllocationDialog(false);
    setSelectedLine(null);
    router.refresh();
  };

  const hasFilters = filters.status || filters.type || filters.search;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Filters filters={filters} onFilterChange={handleFilterChange} />

      {/* Loading Overlay */}
      {isPending && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Table (Desktop) */}
      {lines.length > 0 ? (
        <>
          <div className="hidden md:block rounded-lg border bg-card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
                    Description
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lines.map((line) => (
                  <LineRow
                    key={line._id}
                    line={line}
                    onAllocate={handleAllocate}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Cards (Mobile) */}
          <div className="md:hidden space-y-3">
            {lines.map((line) => (
              <LineCard
                key={line._id}
                line={line}
                onAllocate={handleAllocate}
              />
            ))}
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="mt-6">
              <Pagination
                currentPage={pagination.page}
                totalPages={pagination.totalPages}
                totalItems={pagination.total}
              />
            </div>
          )}
        </>
      ) : (
        <EmptyState hasFilters={hasFilters} />
      )}

      {/* Allocation Dialog */}
      {showAllocationDialog && selectedLine && (
        <AllocationDialog
          line={selectedLine}
          onClose={() => setShowAllocationDialog(false)}
          onComplete={handleAllocationComplete}
        />
      )}
    </div>
  );
}
