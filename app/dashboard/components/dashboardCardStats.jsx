import { getDashboardStats } from "@/app/db/actions/inventory-dashboard-actions";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import {
  Package,
  AlertTriangle,
  FileText,
  ShoppingCart,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
} from "lucide-react";

export async function DashboardStatsCards({}) {
  const stats = await getDashboardStats();

  const statsConfig = [
    {
      title: "Total Stock Value",
      value: formatCurrency(stats.totalStockValue),
      icon: DollarSign,
      iconColor: "text-yellow-500",
      bgColor: "bg-yellow-500/10",
      subtitle: `${stats.totalProducts} products`,
    },
    {
      title: "Low Stock Items",
      value: stats.lowStockCount,
      icon: AlertTriangle,
      iconColor: "text-orange-500",
      bgColor: "bg-orange-500/10",
      subtitle: `${stats.outOfStockCount} out of stock`,
      alert: stats.lowStockCount > 0,
    },
    {
      title: "Pending Requests",
      value: stats.pendingRequests,
      icon: FileText,
      iconColor: "text-blue-500",
      bgColor: "bg-blue-500/10",
      subtitle: "Awaiting approval",
    },
    {
      title: "Active Checkouts",
      value: stats.activeCheckouts,
      icon: ShoppingCart,
      iconColor: "text-purple-500",
      bgColor: "bg-purple-500/10",
      subtitle: `${stats.overdueCheckouts} overdue`,
      alert: stats.overdueCheckouts > 0,
    },
    {
      title: "Monthly Movements",
      value: stats.monthlyMovements,
      icon: Activity,
      iconColor: "text-green-500",
      bgColor: "bg-green-500/10",
      subtitle: "This month",
    },
  ];

  return (
    /*
      TWO ACROSS ON A PHONE, not one. `grid-cols-1` meant five full-width
      cards at p-6 stacked before any content began — five screens of
      scrolling to reach the thing the page is for.

      These keep their card shape rather than becoming a MetricBar, because
      each carries a SUBTITLE that says something the number does not
      ("2 out of stock", "3 overdue"). The bar is for three or four bare
      figures; folding a second line into it would only move the clutter.
    */
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3 xl:grid-cols-5 sm:gap-3">
      {statsConfig.map((stat, index) => (
        <Card
          key={index}
          className="bg-card border-border transition-shadow hover:shadow-md"
        >
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {stat.title}
                </p>
                <div className="mt-1 flex items-baseline gap-2">
                  {/* tabular-nums so the row does not jitter as counts change. */}
                  <p className="text-lg font-semibold tabular-nums text-foreground sm:text-xl">
                    {stat.value}
                  </p>
                  {stat.alert && (
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-orange-400 opacity-75"></span>
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-500"></span>
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {stat.subtitle}
                </p>
              </div>
              {/* Hidden on the narrowest screens: at two columns the icon tile
                  costs more width than the number it decorates. */}
              <div className={`${stat.bgColor} hidden shrink-0 rounded-md p-2 sm:block`}>
                <stat.icon className={`h-4 w-4 ${stat.iconColor}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
