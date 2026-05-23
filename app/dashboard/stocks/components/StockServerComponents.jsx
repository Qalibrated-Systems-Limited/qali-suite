import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, AlertTriangle, XCircle, CheckCircle } from "lucide-react";
import {
  getStockStats,
  searchStock,
  fetchStockPages,
  getProductCategories,
} from "@/app/mongodb/queries/product-queries";
import { ResponsiveInventoryTable } from "../table";
import Pagination from "@/components/pagination";
import { StockCategoryFilter } from "@/components/custom-filters";
import { auth } from "@/auth";
import { canSeePricing } from "@/lib/permissions";

// ============================================
// STOCK STATS CARDS (Async Server Component)
// ============================================

export async function StockStatsCards() {
  const stats = await getStockStats();

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card className="bg-card border-border hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Total Items</p>
              <p className="text-2xl font-bold text-foreground">
                {stats.totalItems}
              </p>
            </div>
            <Package className="w-8 h-8 text-blue-500" />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Low Stock</p>
              <p className="text-2xl font-bold text-orange-500">
                {stats.lowStock}
              </p>
            </div>
            <AlertTriangle className="w-8 h-8 text-orange-500" />
          </div>
          <div className="mt-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">Below 10 units</p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Out of Stock</p>
              <p className="text-2xl font-bold text-red-500">
                {stats.outOfStock}
              </p>
            </div>
            <XCircle className="w-8 h-8 text-red-500" />
          </div>
          <div className="mt-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">Requires restock</p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">In Stock</p>
              <p className="text-2xl font-bold text-green-500">
                {stats.inStock}
              </p>
            </div>
            <CheckCircle className="w-8 h-8 text-green-500" />
          </div>
          <div className="mt-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">10+ units available</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// STOCK STATS SKELETON
// ============================================

export function StockStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {[...Array(4)].map((_, index) => (
        <Card key={index} className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2 flex-1">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-8 w-16" />
              </div>
              <Skeleton className="h-8 w-8 rounded" />
            </div>
            {index > 0 && (
              <div className="mt-2 pt-2 border-t border-border">
                <Skeleton className="h-3 w-24" />
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================
// STOCK TABLE (Async Server Component)
// ============================================

export async function StockTableServer({ query, page, filters, action }) {
  const [stock, session] = await Promise.all([
    searchStock(query, page, filters),
    auth(),
  ]);
  const showPricing = canSeePricing(session?.user?.role);

  return (
    <ResponsiveInventoryTable
      stock={stock}
      action={action}
      showPricing={showPricing}
    />
  );
}

// ============================================
// STOCK TABLE SKELETON
// ============================================

export function StockTableSkeleton() {
  return (
    <>
      {/* Desktop Table Skeleton */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="border-b bg-muted/50 p-4">
              <div className="flex gap-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
              </div>
            </div>
            {[...Array(10)].map((_, index) => (
              <div
                key={index}
                className="border-b p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex gap-4 items-center">
                  <Skeleton className="h-4 w-24" />
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-6 w-16 rounded-full" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-8 rounded" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Mobile Card View Skeleton */}
      <div className="md:hidden space-y-4">
        {[...Array(6)].map((_, index) => (
          <Card key={index} className="bg-card border-border">
            <CardContent className="p-4">
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-3 w-full" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="space-y-2">
                      <Skeleton className="h-3 w-16" />
                      <Skeleton className="h-4 w-20" />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-2">
                  <Skeleton className="h-9 flex-1" />
                  <Skeleton className="h-9 w-9 rounded" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

// ============================================
// STOCK PAGINATION (Async Server Component)
// ============================================

export async function StockPaginationServer({ query, filters }) {
  const totalPages = await fetchStockPages(query, filters);

  if (totalPages <= 1) return null;

  return (
    <div className="flex justify-center">
      <Pagination totalPages={totalPages} />
    </div>
  );
}

// ============================================
// CATEGORY FILTER (Async Server Component)
// ============================================

export async function StockCategoryFilterServer({ currentCategory }) {
  const categories = await getProductCategories();

  // Transform to options format
  const categoryOptions = [
    { value: "all", label: "All Categories" },
    ...categories.map((cat) => ({
      value: cat,
      label: cat.charAt(0).toUpperCase() + cat.slice(1),
    })),
  ];

  return (
    <StockCategoryFilter
      currentCategory={currentCategory}
      categories={categoryOptions}
    />
  );
}

export function CategoryFilterSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-10 w-full md:w-45" />
    </div>
  );
}
