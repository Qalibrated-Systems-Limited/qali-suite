import { Suspense } from "react";
import Link from "next/link";
import { auth } from "@/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/site-header";
import {
  StockQuantityFilter,
  ClearStockFiltersButton,
  StockFilterBadge,
} from "@/components/custom-filters";
import { FormBanner } from "@/components/ui/form-banner";
import Search from "@/components/search";
import {
  StockStatsCards,
  StockStatsSkeleton,
  StockTableServer,
  StockTableSkeleton,
  StockPaginationServer,
  StockCategoryFilterServer,
  CategoryFilterSkeleton,
} from "../components/StockServerComponents";
import { GenerateStockPDF } from "../export-to-pdf";
import { Plus } from "lucide-react";

// ============================================
// ACTION BUTTONS
// ============================================

function ActionButtons({ canCreate }) {
  return (
    <div className="flex items-center gap-2">
      {canCreate && (
        <Button asChild size="sm">
          <Link href="/dashboard/stocks/create">
            <Plus className="h-4 w-4 sm:mr-1.5" />
            <span className="hidden sm:inline">Add Product</span>
          </Link>
        </Button>
      )}
      {/* Fetches data only on click — removed from the SSR critical path. */}
      <GenerateStockPDF />
    </div>
  );
}

// ============================================
// MAIN PAGE COMPONENT
// ============================================

async function StockPage(props) {
  const searchParams = await props.searchParams;
  const session = await auth();

  const query = searchParams.query || "";
  const category = searchParams.category || "all";
  const quantityFilter = searchParams.quantity || "all";
  const action = searchParams.action || "";
  const currentPage = Number(searchParams.page) || 1;

  const { user } = session;

  // Build filters object
  const filters = {
    category: category !== "all" ? category : "",
    quantity: quantityFilter !== "all" ? quantityFilter : "",
  };

  // Check if any filters are active
  const hasActiveFilters = category !== "all" || quantityFilter !== "all";

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <SiteHeader
        title={action === "request" ? "Select Items" : "Stock"}
        description={
          action === "request"
            ? "Add items to your stock request"
            : "Manage inventory and stock levels"
        }
        Action={() => (
          <ActionButtons
            canCreate={
              action !== "request" &&
              ["Admin", "Store Manager", "SuperAdmin"].includes(user?.role)
            }
          />
        )}
      />

      {/* Success/Error Banner */}
      <FormBanner searchParams={searchParams} />

      {/* Stock Summary Stats - Streams in independently */}
      <Suspense fallback={<StockStatsSkeleton />}>
        <StockStatsCards />
      </Suspense>

      {/* Search and Filters - Renders immediately (no data fetch) */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4">
            {/* Search Bar */}
            <div className="w-full">
              <Search placeholder="Search by product name or SKU..." />
            </div>

            {/* Filters Row */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Suspense fallback={<CategoryFilterSkeleton />}>
                <StockCategoryFilterServer currentCategory={category} />
              </Suspense>
              <StockQuantityFilter currentQuantity={quantityFilter} />

              {/* Clear Filters Button */}
              {hasActiveFilters && <ClearStockFiltersButton />}
            </div>

            {/* Active Filters Display */}
            {hasActiveFilters && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  Active filters:
                </span>
                {category !== "all" && (
                  <StockFilterBadge
                    label="Category"
                    value={category}
                    param="category"
                  />
                )}
                {quantityFilter !== "all" && (
                  <StockFilterBadge
                    label="Stock Level"
                    value={quantityFilter}
                    param="quantity"
                  />
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Stock Table - Streams in independently */}
      <Suspense fallback={<StockTableSkeleton />}>
        <StockTableServer
          query={query}
          page={currentPage}
          filters={filters}
          action={action}
        />
      </Suspense>

      {/* Pagination - Streams in after table */}
      <Suspense fallback={null}>
        <StockPaginationServer query={query} filters={filters} />
      </Suspense>
    </div>
  );
}

export default StockPage;
