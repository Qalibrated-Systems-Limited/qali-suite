import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getQuoteStats } from "@/app/mongodb/queries/quote-queries";
import Search from "@/components/search";
import { Card, CardContent } from "@/components/ui/card";
import {
  QuoteStatusTabs,
  QuoteDateFilter,
  QuoteQuickFilters,
  ClearQuoteFiltersButton,
  QuoteFilterBadge,
  MobileFilterSheet,
} from "../components/quote-filters";
import {
  QuoteStatsCards,
  QuoteStatsSkeleton,
  QuotesTableServer,
  QuotesTableSkeleton,
  QuotesPaginationServer,
  PaginationSkeleton,
} from "../components/QuoteServerComponents";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

async function QuotesPage(props) {
  const searchParams = await props.searchParams;
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;

  const query = searchParams.query || "";
  const status = searchParams.status || "all";
  const startDate = searchParams.startDate || "";
  const endDate = searchParams.endDate || "";
  const currentPage = Number(searchParams.page) || 1;

  // Build filters object
  const filters = {
    status: status !== "all" ? status : "",
    startDate,
    endDate,
  };

  // Fetch stats for filter components (needed for tabs and mobile sheet)
  const stats = await getQuoteStats(filters);

  // Check if any filters are active
  const hasActiveFilters = status !== "all" || startDate || endDate;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Quotes</h1>
        <Button asChild size="sm">
          <Link href="/dashboard/quotes/create">
            <Plus className="h-3.5 w-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">New Quote</span>
          </Link>
        </Button>
      </div>

      {/* Stats Cards - Stream independently */}
      <Suspense fallback={<QuoteStatsSkeleton />}>
        <QuoteStatsCards filters={filters} />
      </Suspense>

      {/* Search and Filters */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4">
            {/* Search Bar + Mobile Filter Button */}
            <div className="flex gap-2">
              <div className="flex-1">
                <Search placeholder="Search by quote #, customer..." />
              </div>
              {/* Mobile filter sheet trigger */}
              <MobileFilterSheet
                stats={stats}
                currentStatus={status}
                startDate={startDate}
                endDate={endDate}
                expiringCount={stats.expiringCount}
              />
            </div>

            {/* Status Tabs - hidden on mobile (use sheet instead) */}
            <div className="hidden sm:block">
              <div className="flex flex-wrap items-center gap-3">
                <QuoteStatusTabs currentStatus={status} stats={stats} />
                <QuoteQuickFilters expiringCount={stats.expiringCount} />
                <ClearQuoteFiltersButton />
              </div>
            </div>

            {/* Date Range Filter - hidden on mobile */}
            <div className="hidden sm:block">
              <QuoteDateFilter startDate={startDate} endDate={endDate} />
            </div>

            {/* Active Filters Display - hidden on mobile */}
            {hasActiveFilters && (
              <div className="hidden sm:flex flex-wrap gap-2 pt-2 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  Active filters:
                </span>
                {status !== "all" && (
                  <QuoteFilterBadge
                    label="Status"
                    value={status}
                    param="status"
                  />
                )}
                {startDate && (
                  <QuoteFilterBadge
                    label="From"
                    value={startDate}
                    param="startDate"
                  />
                )}
                {endDate && (
                  <QuoteFilterBadge
                    label="To"
                    value={endDate}
                    param="endDate"
                  />
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Quotes Table - Stream independently */}
      <Suspense fallback={<QuotesTableSkeleton />}>
        <QuotesTableServer query={query} page={currentPage} filters={filters} />
      </Suspense>

      {/* Pagination - Stream independently */}
      <Suspense fallback={<PaginationSkeleton />}>
        <QuotesPaginationServer query={query} filters={filters} />
      </Suspense>
    </div>
  );
}

export default QuotesPage;
