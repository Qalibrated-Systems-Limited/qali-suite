import { Suspense } from "react";

import { auth } from "@/auth";
import { DashboardStatsCards } from "./components/dashboardCardStats";
import {
  MovementTrendChart,
  CategoryDistributionChart,
  RequestStatusChart,
  TopProductsChart,
} from "./components/dashboardCharts";
import {
  RecentRequestsCard,
  RecentMovementsCard,
  LowStockAlertsCard,
  OverdueCheckoutsCard,
} from "./components/dashboardActivityCards";
import {
  StatsSkeleton,
  ChartsSkeleton,
  ActivitySkeleton,
  AlertsSkeleton,
  ChartSkeleton,
  AlertCardSkeleton,
} from "./components/dashboardLoadingSkeleton";
import { MovementAndCatDistroChartsWrapper } from "./components/movementAndCatDistroChartsWrapper";
import {
  RequestStatusChartServerComp,
  TopProductsChartServerComp,
} from "./components/ChartsServerComponents";
import { TechnicianDashboard } from "./employee/components/TechnicianDashboard";

export default async function DashboardPage() {
  const session = await auth();
  const { user } = session;

  // Fetch all data in parallel

  const isAdmin = ["Admin", "Store Manager", "Manager"].includes(user?.role);
  if (!isAdmin) {
    return <TechnicianDashboard />;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Welcome Header */}
      <div className="space-y-1">
        <h1 className="text-3xl font-bold text-foreground">
          Welcome back, {user?.name?.split(" ")[0] || "User"}! 👋
        </h1>
        <p className="text-muted-foreground">
          Here's what's happening with your inventory today
        </p>
      </div>

      {/* Stats Cards */}
      <Suspense fallback={<StatsSkeleton />}>
        <DashboardStatsCards />
      </Suspense>

      {/* Charts Row 1 - Movement Trend & Category Distribution */}
      <Suspense fallback={<ChartsSkeleton />}>
        <MovementAndCatDistroChartsWrapper />
      </Suspense>

      {/* Alerts Row - Low Stock & Overdue Checkouts */}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Suspense fallback={<AlertCardSkeleton />}>
          <LowStockAlertsCard />
        </Suspense>

        <Suspense fallback={<AlertCardSkeleton />}>
          <OverdueCheckoutsCard />
        </Suspense>
      </div>

      {/* Activity Row - Recent Requests & Movements */}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Suspense fallback={<ChartSkeleton />}>
          <RecentRequestsCard />
        </Suspense>
        <Suspense fallback={<ChartSkeleton />}>
          <RecentMovementsCard />
        </Suspense>
      </div>

      {/* Charts Row 2 - Request Status & Top Products */}
      <Suspense fallback={<ChartsSkeleton />}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Suspense fallback={<ChartSkeleton />}>
            <RequestStatusChartServerComp />
          </Suspense>
          <Suspense fallback={<ChartSkeleton />}>
            <TopProductsChartServerComp />
          </Suspense>
        </div>
      </Suspense>
    </div>
  );
}
