import { Suspense } from "react";
import { auth } from "@/auth";
import { Card, CardContent } from "@/components/ui/card";
import User from "@/app/models/user";
import { SiteHeader } from "@/components/site-header";
import { AddButton } from "@/components/buttons";
import {
  StockQuantityFilter,
  ClearStockFiltersButton,
  StockFilterBadge,
} from "@/components/custom-filters";
import { FormBanner } from "@/components/ui/form-banner";
import Search from "@/components/search";
import dbConnect from "@/app/config/dbConnect";
import {
  StockStatsCards,
  StockStatsSkeleton,
  StockTableServer,
  StockTableSkeleton,
  StockPaginationServer,
  StockPDFExportServer,
  PDFExportSkeleton,
  StockCategoryFilterServer,
  CategoryFilterSkeleton,
} from "../components/StockServerComponents";

// ============================================
// ACTION BUTTONS (with lazy PDF export)
// ============================================

function ActionButtons({ canCreateStock }) {
  return (
    <div className="flex gap-2 items-center">
      <Suspense fallback={<PDFExportSkeleton />}>
        <StockPDFExportServer />
      </Suspense>
      {canCreateStock && <AddButton url="/dashboard/stocks/create" />}
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
  const userId = user.id;

  // Get user cart (needed for request action)
  await dbConnect();
  const userCart = await User.findById(userId).select("cart").lean();

  // Serialize cart data for client component
  const cart =
    userCart?.cart?.map((item) => ({
      ...item,
      _id: item._id?.toString(),
      productId: item.productId?.toString(),
    })) ?? [];

  const canCreateStock = user.role === "Store Manager" || user.role === "Admin";

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
        title={
          action === "request"
            ? "Add Items you are requesting to cart"
            : "Stock Inventory"
        }
        description={
          action === "request"
            ? "Select items to add to your request"
            : "Manage your inventory and stock levels"
        }
        Action={canCreateStock ? () => <ActionButtons canCreateStock={canCreateStock} /> : undefined}
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
          cart={cart}
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
