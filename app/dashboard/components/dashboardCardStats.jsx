import { getDashboardStats } from "@/app/mongodb/queries/dashboard-queries";
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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
      {statsConfig.map((stat, index) => (
        <Card
          key={index}
          className="bg-card border-border hover:shadow-lg transition-shadow"
        >
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  {stat.title}
                </p>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-bold text-foreground">
                    {stat.value}
                  </p>
                  {stat.alert && (
                    <span className="flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-orange-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {stat.subtitle}
                </p>
              </div>
              <div className={`${stat.bgColor} p-3 rounded-lg`}>
                <stat.icon className={`w-5 h-5 ${stat.iconColor}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
