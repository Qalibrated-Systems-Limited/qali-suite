import { Suspense } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Package,
  AlertTriangle,
  TrendingUp,
  ChevronRight,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ✅ USE CENTRALIZED QUERIES
import {
 getStockStats,
  getLowStockProducts,
  getTopMovedProducts,
  getCategoryDistribution,
  getOverdueCheckouts,
} from "@/app/mongodb/queries/erp-dashboard-queries";

// Charts (Client Components)
import { CategoryDistributionChart } from "../CategoryDistroChart";

// Utils
import { formatCurrency } from "@/lib/utils";

// ============================================
// INVENTORY TAB - Server Component
// ============================================
export async function InventoryTab() {
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* KPI Cards */}
      <Suspense fallback={<KPIsSkeleton />}>
        <InventoryKPIs />
      </Suspense>

      {/* Stock Health */}
      <Suspense fallback={<StockHealthSkeleton />}>
        <StockHealthCard />
      </Suspense>

      {/* Overdue Checkouts Alert */}
      <Suspense fallback={<OverdueCheckoutsSkeleton />}>
        <OverdueCheckoutsCard />
      </Suspense>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <Suspense fallback={<ChartSkeleton />}>
          <CategoryDistributionChartWrapper />
        </Suspense>
        <Suspense fallback={<ListSkeleton />}>
          <FastMovingItemsCard />
        </Suspense>
      </div>
    </div>
  );
}

// ============================================
// INVENTORY KPIs - Using centralized query
// ============================================
async function InventoryKPIs() {
  // ✅ Single query function returns all stats
  const stats = await getStockStats();

  const kpis = [
    {
      label: "Stock Value",
      value: formatCurrency(stats.totalValue),
      subtext: `${stats.totalProducts} products`,
      icon: Package,
      color: "text-violet-500",
      bgColor: "bg-violet-500/10",
    },
    {
      label: "Low Stock",
      value: stats.lowStockCount,
      subtext:
        stats.outOfStockCount > 0
          ? `${stats.outOfStockCount} out of stock`
          : "to reorder",
      icon: AlertTriangle,
      color: stats.lowStockCount > 0 ? "text-amber-500" : "text-emerald-500",
      bgColor:
        stats.lowStockCount > 0 ? "bg-amber-500/10" : "bg-emerald-500/10",
      alert: stats.lowStockCount > 0,
      href: "/dashboard/stocks?quantity=low-stock",
    },
    {
      label: "Overdue",
      value: stats.overdueCheckouts,
      subtext: "checkouts",
      icon: Clock,
      color: stats.overdueCheckouts > 0 ? "text-rose-500" : "text-emerald-500",
      bgColor:
        stats.overdueCheckouts > 0 ? "bg-rose-500/10" : "bg-emerald-500/10",
      alert: stats.overdueCheckouts > 0,
      href: "/dashboard/checkouts?status=overdue",
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-4">
      {kpis.map((kpi, index) => {
        const content = (
          <Card
            className={cn(
              "p-3 sm:p-4 border-border/40 transition-colors",
              kpi.href && "hover:border-border cursor-pointer",
              kpi.alert && "border-amber-500/30"
            )}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className={cn("p-1.5 sm:p-2 rounded-lg", kpi.bgColor)}>
                <kpi.icon
                  className={cn("w-3.5 h-3.5 sm:w-4 sm:h-4", kpi.color)}
                />
              </div>
              <span className="text-xs sm:text-sm text-muted-foreground truncate">
                {kpi.label}
              </span>
              {kpi.alert && (
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              )}
            </div>

            <p className="text-lg sm:text-xl lg:text-2xl font-bold text-foreground tabular-nums">
              {kpi.value}
            </p>

            <p className="text-xs text-muted-foreground mt-0.5">
              {kpi.subtext}
            </p>
          </Card>
        );

        if (kpi.href) {
          return (
            <Link key={index} href={kpi.href}>
              {content}
            </Link>
          );
        }

        return <div key={index}>{content}</div>;
      })}
    </div>
  );
}

// ============================================
// STOCK HEALTH CARD - Using centralized query
// ============================================
async function StockHealthCard() {
  // ✅ Use centralized query
  const lowStockItems = await getLowStockProducts(6);

  if (lowStockItems.length === 0) {
    return (
      <Card className="p-3 sm:p-4 bg-emerald-500/5 border-emerald-500/20">
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-sm font-medium">Stock levels healthy</span>
          <span className="text-xs text-muted-foreground">
            All items above reorder level
          </span>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-border/40">
      <div className="p-3 sm:p-4 border-b border-border/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <h3 className="font-semibold text-sm sm:text-base">Stock Health</h3>
            <Badge
              variant="secondary"
              className="bg-amber-500/10 text-amber-500 text-xs"
            >
              {lowStockItems.length} low
            </Badge>
          </div>
          <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
            <Link href="/dashboard/stocks?quantity=low-stock">
              View all <ChevronRight className="w-3 h-3 ml-1" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="p-3 sm:p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {lowStockItems.map((item: any) => {
            // ✅ Query already returns normalized fields
            const qty = item.stock || 0;
            const reorderLevel = item.reorderLevel || 10;
            const percentage = Math.min((qty / reorderLevel) * 100, 100);
            const isCritical = percentage <= 25;
            const isWarning = percentage <= 50;

            return (
              <Link
                key={item._id.toString()}
                href={`/dashboard/stocks/${item._id}`}
                className={cn(
                  "p-3 rounded-lg border transition-all",
                  "hover:shadow-sm hover:border-border",
                  isCritical
                    ? "border-rose-500/30 bg-rose-500/5"
                    : isWarning
                    ? "border-amber-500/30 bg-amber-500/5"
                    : "border-border/40"
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">
                      {item.name}
                    </p>
                    <p className="text-xs text-muted-foreground">{item.SKU}</p>
                  </div>
                  <div
                    className={cn(
                      "shrink-0 text-right",
                      isCritical
                        ? "text-rose-500"
                        : isWarning
                        ? "text-amber-500"
                        : "text-foreground"
                    )}
                  >
                    <p className="text-lg font-bold tabular-nums">{qty}</p>
                    <p className="text-xs">left</p>
                  </div>
                </div>

                <div className="space-y-1">
                  <Progress
                    value={percentage}
                    className={cn(
                      "h-1.5",
                      isCritical
                        ? "[&>div]:bg-rose-500"
                        : isWarning
                        ? "[&>div]:bg-amber-500"
                        : "[&>div]:bg-emerald-500"
                    )}
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Reorder: {reorderLevel}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-5 text-xs px-2"
                    >
                      Order
                    </Button>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ============================================
// FAST MOVING ITEMS CARD - Using centralized query
// ============================================
async function FastMovingItemsCard() {
  // ✅ Use centralized query
  const fastMoving = await getTopMovedProducts(5);

  return (
    <Card className="border-border/40">
      <div className="p-3 sm:p-4 border-b border-border/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-500" />
            <h3 className="font-semibold text-sm sm:text-base">
              Fast Moving Items
            </h3>
          </div>
          <span className="text-xs text-muted-foreground">Last 30 days</span>
        </div>
      </div>

      <div className="divide-y divide-border/40">
        {fastMoving.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No movement data yet
            </p>
          </div>
        ) : (
          fastMoving.map((item: any, index: number) => (
            <div
              key={item.productId?.toString() || index}
              className="flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium",
                    index === 0
                      ? "bg-yellow-500 text-black"
                      : index === 1
                      ? "bg-gray-300 text-gray-700 dark:bg-gray-600 dark:text-gray-200"
                      : index === 2
                      ? "bg-amber-600 text-white"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {item.name}
                  </p>
                  <p className="text-xs text-muted-foreground">{item.sku}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-foreground tabular-nums">
                  {item.quantity}
                </p>
                <p className="text-xs text-muted-foreground">units</p>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// ============================================
// OVERDUE CHECKOUTS CARD - Using centralized query
// ============================================
async function OverdueCheckoutsCard() {
  // ✅ Use centralized query
  const overdueItems = await getOverdueCheckouts(5);

  if (overdueItems.length === 0) {
    return null; // Don't show if no overdue items
  }

  const getDaysOverdue = (expectedDate: Date) => {
    const diff = Date.now() - new Date(expectedDate).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  return (
    <Card className="border-rose-500/30 bg-rose-500/5">
      <div className="p-3 sm:p-4 border-b border-rose-500/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-rose-500/10">
              <Clock className="w-4 h-4 text-rose-500" />
            </div>
            <h3 className="font-semibold text-sm sm:text-base text-rose-600 dark:text-rose-400">
              Overdue Checkouts
            </h3>
            <Badge
              variant="secondary"
              className="bg-rose-500/10 text-rose-500 text-xs"
            >
              {overdueItems.length} items
            </Badge>
          </div>
          <Button
            variant="outline"
            size="sm"
            asChild
            className="h-7 text-xs border-rose-500/30 text-rose-600 hover:bg-rose-500/10"
          >
            <Link href="/dashboard/checkouts?status=overdue">
              View all <ChevronRight className="w-3 h-3 ml-1" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="p-3 sm:p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2">
          {overdueItems.map((item: any) => {
            const daysOverdue = getDaysOverdue(item.expectedReturnDate);
            const isCritical = daysOverdue > 7;

            return (
              <Link
                key={item._id.toString()}
                href={`/dashboard/checkouts/${item._id}`}
                className={cn(
                  "p-3 rounded-lg border transition-all",
                  "hover:shadow-sm",
                  isCritical
                    ? "border-rose-500/50 bg-rose-500/10"
                    : "border-rose-500/30 bg-background"
                )}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">
                      {item.productSnapshot?.name || "Unknown"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {item.productSnapshot?.SKU}
                    </p>
                  </div>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "shrink-0 text-xs",
                      isCritical
                        ? "bg-rose-500 text-white"
                        : "bg-rose-500/10 text-rose-500"
                    )}
                  >
                    {daysOverdue}d
                  </Badge>
                </div>

                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {item.checkedOutTo?.name}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Qty: {item.quantity} •{" "}
                    {item.checkedOutTo?.department || "No dept"}
                  </p>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="w-full mt-2 h-6 text-xs border-rose-500/30 text-rose-600 hover:bg-rose-500/10"
                >
                  Send Reminder
                </Button>
              </Link>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ============================================
// CATEGORY DISTRIBUTION WRAPPER - Using centralized query
// ============================================
async function CategoryDistributionChartWrapper() {
  // ✅ Use centralized query
  const data = await getCategoryDistribution();
  return <CategoryDistributionChart data={data} />;
}

// ============================================
// SKELETONS
// ============================================
function KPIsSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-4">
      {[1, 2, 3].map((i) => (
        <Card key={i} className="p-3 sm:p-4 border-border/40">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-muted animate-pulse" />
            <div className="h-3 w-14 bg-muted animate-pulse rounded" />
          </div>
          <div className="h-6 sm:h-7 w-16 bg-muted animate-pulse rounded" />
          <div className="h-3 w-20 bg-muted animate-pulse rounded mt-1" />
        </Card>
      ))}
    </div>
  );
}

function StockHealthSkeleton() {
  return (
    <Card className="border-border/40">
      <div className="p-3 sm:p-4 border-b border-border/40">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-muted animate-pulse rounded" />
          <div className="h-5 w-24 bg-muted animate-pulse rounded" />
          <div className="h-5 w-12 bg-muted animate-pulse rounded-full" />
        </div>
      </div>
      <div className="p-3 sm:p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="p-3 rounded-lg border border-border/40 space-y-2"
            >
              <div className="flex justify-between">
                <div className="space-y-1">
                  <div className="h-4 w-20 bg-muted animate-pulse rounded" />
                  <div className="h-3 w-12 bg-muted animate-pulse rounded" />
                </div>
                <div className="h-6 w-8 bg-muted animate-pulse rounded" />
              </div>
              <div className="h-1.5 w-full bg-muted animate-pulse rounded" />
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function ChartSkeleton() {
  return (
    <Card className="border-border/40">
      <div className="p-3 sm:p-4 border-b border-border/40">
        <div className="h-5 w-32 bg-muted animate-pulse rounded" />
      </div>
      <div className="p-4">
        <div className="h-[280px] bg-muted/50 animate-pulse rounded-lg flex items-center justify-center">
          <span className="text-muted-foreground text-sm">Loading...</span>
        </div>
      </div>
    </Card>
  );
}

function ListSkeleton() {
  return (
    <Card className="border-border/40">
      <div className="p-3 sm:p-4 border-b border-border/40">
        <div className="h-5 w-32 bg-muted animate-pulse rounded" />
      </div>
      <div className="divide-y divide-border/40">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-muted animate-pulse" />
              <div className="space-y-1">
                <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                <div className="h-3 w-16 bg-muted animate-pulse rounded" />
              </div>
            </div>
            <div className="text-right space-y-1">
              <div className="h-4 w-10 bg-muted animate-pulse rounded" />
              <div className="h-3 w-8 bg-muted animate-pulse rounded" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function OverdueCheckoutsSkeleton() {
  return (
    <Card className="border-border/40">
      <div className="p-3 sm:p-4 border-b border-border/40">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-muted animate-pulse" />
          <div className="h-5 w-32 bg-muted animate-pulse rounded" />
          <div className="h-5 w-16 bg-muted animate-pulse rounded-full" />
        </div>
      </div>
      <div className="p-3 sm:p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="p-3 rounded-lg border border-border/40 space-y-2"
            >
              <div className="flex justify-between">
                <div className="space-y-1 flex-1">
                  <div className="h-4 w-20 bg-muted animate-pulse rounded" />
                  <div className="h-3 w-12 bg-muted animate-pulse rounded" />
                </div>
                <div className="h-5 w-8 bg-muted animate-pulse rounded" />
              </div>
              <div className="h-3 w-24 bg-muted animate-pulse rounded" />
              <div className="h-6 w-full bg-muted animate-pulse rounded" />
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ============================================
// EXPORTED SKELETON
// ============================================
export function InventoryTabSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <KPIsSkeleton />
      <StockHealthSkeleton />
      <OverdueCheckoutsSkeleton />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <ChartSkeleton />
        <ListSkeleton />
      </div>
    </div>
  );
}
