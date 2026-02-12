"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import {
  Search,
  X,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  FileSpreadsheet,
  Building2,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Pagination from "@/components/pagination";
import { format } from "date-fns";
import AllocationDialog from "../[id]/AllocationDialog";

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
// FILTERS
// ============================================
function Filters({ filters, bankAccounts, onFilterChange }) {
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
        {/* Bank Account Filter */}
        <select
          value={filters.bankAccountId || ""}
          onChange={(e) =>
            onFilterChange({ ...filters, bankAccountId: e.target.value })
          }
          className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All Bank Accounts</option>
          {bankAccounts.map((account) => (
            <option key={account._id} value={account._id}>
              {account.accountCode} - {account.accountName}
            </option>
          ))}
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
        {(filters.bankAccountId || filters.type || filters.search) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onFilterChange({ bankAccountId: "", type: "", search: "" })
            }
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
// LINE ROW (Desktop)
// ============================================
function LineRow({ line, onAllocate }) {
  const isDebit = line.debitAmount > 0;
  const amount = isDebit ? line.debitAmount : line.creditAmount;

  return (
    <tr className="hover:bg-muted/50 transition-colors bg-amber-500/5">
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
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">{line.bankAccountCode}</p>
            <p className="text-xs text-muted-foreground truncate max-w-[150px]">
              {line.bankAccountName}
            </p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <Link
          href={`/dashboard/banking/${line.statementId}`}
          className="flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <FileSpreadsheet className="h-3 w-3" />
          <span className="truncate max-w-[120px]">{line.statementName}</span>
        </Link>
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
      <td className="px-4 py-3 text-right">
        <Button size="sm" onClick={() => onAllocate(line)}>
          Allocate
        </Button>
      </td>
    </tr>
  );
}

// ============================================
// LINE CARD (Mobile)
// ============================================
function LineCard({ line, onAllocate }) {
  const isDebit = line.debitAmount > 0;
  const amount = isDebit ? line.debitAmount : line.creditAmount;

  return (
    <div className="rounded-lg border bg-card p-4 border-amber-500/50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs text-muted-foreground">
              {format(new Date(line.transactionDate), "MMM d, yyyy")}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted">
              {line.bankAccountCode}
            </span>
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
        <Link
          href={`/dashboard/banking/${line.statementId}`}
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <FileSpreadsheet className="h-3 w-3" />
          <span className="truncate max-w-[150px]">{line.statementName}</span>
          <ExternalLink className="h-3 w-3" />
        </Link>
        <Button size="sm" onClick={() => onAllocate(line)}>
          Allocate
        </Button>
      </div>
    </div>
  );
}

// ============================================
// EMPTY STATE
// ============================================
function EmptyState({ hasFilters }) {
  return (
    <div className="rounded-lg border bg-card p-12 text-center">
      <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
        <FileSpreadsheet className="h-6 w-6 text-emerald-500" />
      </div>
      <h3 className="mt-4 font-semibold">
        {hasFilters ? "No matching transactions" : "All caught up!"}
      </h3>
      <p className="text-sm text-muted-foreground mt-1">
        {hasFilters
          ? "Try adjusting your filters"
          : "No pending transactions to allocate"}
      </p>
      {!hasFilters && (
        <Button asChild className="mt-4" variant="outline">
          <Link href="/dashboard/banking">Back to Bank Feed</Link>
        </Button>
      )}
    </div>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================
export default function UnallocatedLinesClient({
  lines,
  pagination,
  bankAccounts,
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

      if (newFilters.bankAccountId) {
        params.set("bankAccountId", newFilters.bankAccountId);
      } else {
        params.delete("bankAccountId");
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
    setSelectedLine(line);
    setShowAllocationDialog(true);
  };

  const handleAllocationComplete = () => {
    setShowAllocationDialog(false);
    setSelectedLine(null);
    router.refresh();
  };

  const hasFilters = filters.bankAccountId || filters.type || filters.search;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Filters
        filters={filters}
        bankAccounts={bankAccounts}
        onFilterChange={handleFilterChange}
      />

      {/* Loading Overlay */}
      {isPending && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Content */}
      {lines.length > 0 ? (
        <>
          {/* Table (Desktop) */}
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
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
                    Bank Account
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
                    Statement
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
                    Amount
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
