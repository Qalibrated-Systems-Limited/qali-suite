import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, CheckCircle, Send, AlertTriangle } from "lucide-react";
import {
  searchQuotes,
  fetchQuotePages,
  getQuoteStats,
} from "@/app/mongodb/queries/quote-queries";
import { QuotesTable } from "./QuotesTable";
import Pagination from "@/components/pagination";
import { formatCurrency } from "@/lib/utils";

// ============================================
// QUOTE STATS CARDS (Async Server Component)
// ============================================

export async function QuoteStatsCards({ filters }) {
  const stats = await getQuoteStats(filters);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
      <Card className="bg-card border-border">
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Total Quotes</p>
              <p className="text-lg sm:text-xl font-bold text-foreground">
                {stats.total}
              </p>
            </div>
            <FileText className="w-5 h-5 sm:w-6 sm:h-6 text-blue-500" />
          </div>
          <div className="hidden sm:block mt-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">Total Value</p>
            <p className="text-sm font-semibold text-blue-400">
              {formatCurrency(stats.totalValue)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Open Quotes</p>
              <p className="text-lg sm:text-xl font-bold text-orange-500">
                {stats.draft + stats.sent}
              </p>
            </div>
            <Send className="w-5 h-5 sm:w-6 sm:h-6 text-orange-500" />
          </div>
          <div className="hidden sm:block mt-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">Open Value</p>
            <p className="text-sm font-semibold text-orange-400">
              {formatCurrency(stats.openValue)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Converted</p>
              <p className="text-lg sm:text-xl font-bold text-green-500">
                {stats.converted + stats.accepted}
              </p>
            </div>
            <CheckCircle className="w-5 h-5 sm:w-6 sm:h-6 text-green-500" />
          </div>
          <div className="hidden sm:block mt-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">Converted Value</p>
            <p className="text-sm font-semibold text-green-400">
              {formatCurrency(stats.convertedValue)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Expiring Soon</p>
              <p className="text-lg sm:text-xl font-bold text-red-500">
                {stats.expiringCount}
              </p>
            </div>
            <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6 text-red-500" />
          </div>
          <div className="hidden sm:block mt-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">Conversion Rate</p>
            <p className="text-sm font-semibold text-purple-400">
              {stats.conversionRate}%
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// QUOTE STATS SKELETON
// ============================================

export function QuoteStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
      {[...Array(4)].map((_, index) => (
        <Card key={index} className="bg-card border-border">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-8 w-12" />
              </div>
              <Skeleton className="w-8 h-8 rounded" />
            </div>
            <div className="hidden sm:block mt-2 pt-2 border-t border-border">
              <Skeleton className="h-3 w-16 mb-1" />
              <Skeleton className="h-4 w-24" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================
// QUOTES TABLE SERVER (Async Server Component)
// ============================================

export async function QuotesTableServer({ query, page, filters }) {
  const quotes = await searchQuotes(query, page, filters);

  return <QuotesTable quotes={quotes} />;
}

// ============================================
// QUOTES TABLE SKELETON
// ============================================

export function QuotesTableSkeleton() {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <div className="border-b bg-muted/50 p-4">
            <div className="flex gap-6">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
          </div>
          {[...Array(8)].map((_, index) => (
            <div key={index} className="border-b p-4">
              <div className="flex gap-6 items-center">
                <Skeleton className="h-4 w-16" />
                <div className="space-y-1 flex-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-6 w-16" />
                <Skeleton className="h-8 w-8" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// QUOTES PAGINATION SERVER (Async Server Component)
// ============================================

export async function QuotesPaginationServer({ query, filters }) {
  const totalPages = await fetchQuotePages(query, filters);

  if (totalPages <= 1) return null;

  return (
    <div className="flex justify-center">
      <Pagination totalPages={totalPages} />
    </div>
  );
}

// ============================================
// PAGINATION SKELETON
// ============================================

export function PaginationSkeleton() {
  return (
    <div className="flex justify-center">
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-9" />
        <Skeleton className="h-9 w-9" />
        <Skeleton className="h-9 w-9" />
        <Skeleton className="h-9 w-9" />
        <Skeleton className="h-9 w-9" />
      </div>
    </div>
  );
}

// ============================================
// Helper to get stats for filters component
// ============================================

export async function getQuoteStatsForFilters(filters) {
  return await getQuoteStats(filters);
}
