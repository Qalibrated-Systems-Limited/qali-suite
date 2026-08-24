import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { getProductsPg } from "@/app/db/actions/product-actions";
import { getCategoriesPg } from "@/app/db/actions/category-actions";
import { ResponsiveInventoryTable } from "../table";
import Pagination from "@/components/pagination";
import { StockCategoryFilter } from "@/components/custom-filters";
import { auth } from "@/auth";
import { canSeePricing } from "@/lib/permissions";

// ============================================
// STOCK STATS CARDS (Async Server Component)
// ============================================

/**
 * The figures above the list, as one line rather than four cards.
 *
 * They were four 140px cards with 2xl numerals and 32px icons, which together
 * with the filter card put roughly 300px between the page heading and the
 * first product. On a list screen the LIST is the content; the summary is
 * context, and context belongs in a strip.
 *
 * Every figure that names a subset is a LINK that filters to it. A count you
 * cannot act on is decoration — this is the pattern every mature ERP list uses
 * (NetSuite saved searches, Odoo's filter bar, Xero's report tiles).
 *
 * `tabular-nums` so the digits line up between the groups instead of shifting
 * as counts change.
 */
export async function StockMetricsBar({ searchParams = {} }) {
  const { stats } = await getProductsPg({ perPage: 1 });

  /**
   * KEEP THE FILTERS ALREADY APPLIED. `href={withQuantity("low-stock")}` replaces
   * the whole query string, so clicking a figure while a search or a category
   * was active silently threw both away and showed a different set from the
   * one the number described.
   */
  const withQuantity = (value) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v != null && v !== "" && k !== "quantity" && k !== "page") {
        params.set(k, String(v));
      }
    }
    params.set("quantity", value);
    return `?${params.toString()}`;
  };

  const money = new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(Number(stats.stockValue || 0));

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border bg-card px-3 py-2 sm:gap-x-6 sm:px-4 sm:py-2.5">
      <Metric label="Products" value={stats.total} />
      <Metric
        label="Low stock"
        value={stats.lowStock}
        href={withQuantity("low-stock")}
        tone={stats.lowStock > 0 ? "warn" : "muted"}
      />
      <Metric
        label="Out of stock"
        value={stats.outOfStock}
        href={withQuantity("out-of-stock")}
        tone={stats.outOfStock > 0 ? "danger" : "muted"}
      />
      {/* Valued at cost, never at selling price — stock is carried at cost
          until it is sold, and valuing it at retail books unrealised profit. */}
      <Metric label="Stock value" value={money} title="Quantity × cost" />
    </div>
  );
}

const TONE = {
  muted: "text-foreground",
  warn: "text-orange-600 dark:text-orange-400",
  danger: "text-red-600 dark:text-red-400",
};

function Metric({ label, value, href, tone = "muted", title }) {
  const body = (
    <>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={`text-sm font-semibold tabular-nums ${TONE[tone] ?? TONE.muted}`}
      >
        {value}
      </span>
    </>
  );

  // Only a figure that names a subset is clickable; the total and the
  // valuation are not filters, so they are not offered as ones.
  if (!href) {
    return (
      <span className="flex items-baseline gap-2" title={title}>
        {body}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="flex items-baseline gap-2 rounded-sm px-1 -mx-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={`Show only ${label.toLowerCase()}`}
    >
      {body}
    </Link>
  );
}

export function StockMetricsSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border bg-card px-3 py-2 sm:gap-x-6 sm:px-4 sm:py-2.5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-baseline gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-10" />
        </div>
      ))}
    </div>
  );
}

/**
 * One query serves the table AND the pagination.
 *
 * The Mongo version called searchStock and then fetchStockPages separately, so
 * the row count and the page count were two round trips that could describe
 * different sets. searchProducts returns both from a single COUNT(*) OVER ().
 */
export async function StockTableServer({ query, page, filters, action }) {
  const [result, session] = await Promise.all([
    getProductsPg({
      query,
      page,
      category: filters?.category,
      lowStockOnly: filters?.quantity === "low-stock",
      status: filters?.status,
    }),
    auth(),
  ]);
  const stock = result.rows;
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
  const { pages: totalPages } = await getProductsPg({
    query,
    category: filters?.category,
    lowStockOnly: filters?.quantity === "low-stock",
    status: filters?.status,
    perPage: 25,
  });

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
  // The category TABLE (0062), not the distinct values found on products, so
  // a category with nothing filed under it yet is still offered.
  const categories = await getCategoriesPg();

  const categoryOptions = [
    { value: "all", label: "All Categories" },
    ...categories.map((c) => ({ value: c.name, label: c.name })),
  ];

  return (
    <StockCategoryFilter
      currentCategory={currentCategory}
      categories={categoryOptions}
    />
  );
}

export function CategoryFilterSkeleton() {
  // Matches the control it stands in for — no label row any more.
  return <Skeleton className="h-9 w-full sm:w-44" />;
}
