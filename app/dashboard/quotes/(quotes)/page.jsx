import { auth } from "@/auth";
import { redirect } from "next/navigation";
import {
  searchQuotes,
  fetchQuotePages,
  getQuoteStats,
} from "@/app/mongodb/queries/quote-queries";
import Pagination from "@/components/pagination";
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
import { QuotesTable } from "../components/QuotesTable";
import {
  FileText,
  CheckCircle,
  Send,
  AlertTriangle,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";

async function QuotesPage(props) {
  const searchParams = await props.searchParams;
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;

  // Check permissions - Admin, Accountant, and Sales can view quotes
  if (!["Admin", "Accountant", "Sales"].includes(user.role)) {
    return (
      <div className="flex min-h-100 items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Access Denied
          </h2>
          <p className="text-muted-foreground">
            Only Admins, Accountants, and Sales staff can view quotes.
          </p>
        </div>
      </div>
    );
  }

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

  // Fetch data in parallel
  const [totalPages, quotes, stats] = await Promise.all([
    fetchQuotePages(query, filters),
    searchQuotes(query, currentPage, filters),
    getQuoteStats(filters),
  ]);

  // Check if any filters are active
  const hasActiveFilters = status !== "all" || startDate || endDate;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Quotes</h1>
        <p className="text-muted-foreground">
          Create and manage customer quotations
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Total Quotes</p>
                <p className="text-2xl font-bold text-foreground">
                  {stats.total}
                </p>
              </div>
              <FileText className="w-8 h-8 text-blue-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Total Value</p>
              <p className="text-sm font-semibold text-blue-400">
                {formatCurrency(stats.totalValue)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Open Quotes</p>
                <p className="text-2xl font-bold text-orange-500">
                  {stats.draft + stats.sent}
                </p>
              </div>
              <Send className="w-8 h-8 text-orange-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Open Value</p>
              <p className="text-sm font-semibold text-orange-400">
                {formatCurrency(stats.openValue)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Converted</p>
                <p className="text-2xl font-bold text-green-500">
                  {stats.converted + stats.accepted}
                </p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Converted Value</p>
              <p className="text-sm font-semibold text-green-400">
                {formatCurrency(stats.convertedValue)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Expiring Soon</p>
                <p className="text-2xl font-bold text-red-500">
                  {stats.expiringCount}
                </p>
              </div>
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Conversion Rate</p>
              <p className="text-sm font-semibold text-purple-400">
                {stats.conversionRate}%
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

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

      {/* Quotes Table */}
      <QuotesTable quotes={quotes} />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination totalPages={totalPages} />
        </div>
      )}
    </div>
  );
}

export default QuotesPage;
