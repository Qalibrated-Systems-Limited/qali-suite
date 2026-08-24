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
  StockMetricsBar,
  StockMetricsSkeleton,
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

      {/* One line of context, then the list. Streams independently. */}
      <Suspense fallback={<StockMetricsSkeleton />}>
        <StockMetricsBar searchParams={searchParams} />
      </Suspense>

      {/*
        TOOLBAR, NOT A FILTER PANEL. Search and both filters sit on one row and
        wrap on narrow screens. The card wrapper this replaced added a border,
        16px of padding and a stacked layout, so search and filters alone were
        ~150px — on top of ~140px of summary cards, the first product row began
        below the fold on a laptop.

        The active-filter badges only appear when something is filtering, so
        the row costs nothing in the common case.
      */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {/* Narrower than the page-wide default so the filters sit beside it. */}
          <Search
            placeholder="Search by name or SKU..."
            className="md:min-w-0 sm:max-w-sm"
          />
          {/*
            MOBILE: the two selects share a row rather than stacking full-width,
            which would put the first product three controls down the screen.
            They go inline from sm up. Clear spans the row on mobile so it is
            not a half-width button beside a half-width select.
          */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <Suspense fallback={<CategoryFilterSkeleton />}>
              <StockCategoryFilterServer currentCategory={category} />
            </Suspense>
            <StockQuantityFilter currentQuantity={quantityFilter} />
            {hasActiveFilters && (
              <div className="col-span-2 sm:col-span-1">
                <ClearStockFiltersButton />
              </div>
            )}
          </div>
        </div>

        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-2">
            {category !== "all" && (
              <StockFilterBadge label="Category" value={category} param="category" />
            )}
            {quantityFilter !== "all" && (
              <StockFilterBadge label="Stock" value={quantityFilter} param="quantity" />
            )}
          </div>
        )}
      </div>

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
