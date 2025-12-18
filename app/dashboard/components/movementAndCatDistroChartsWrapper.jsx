import React from "react";
import {
  CategoryDistributionChart,
  MovementTrendChart,
} from "./dashboardCharts";
import {
  getMovementTrend,
  getStockByCategory,
} from "@/app/mongodb/queries/dashboard-queries";

export async function MovementAndCatDistroChartsWrapper() {
  const [movementTrend, categoryData] = await Promise.all([
    getMovementTrend(7),
    getStockByCategory(),
  ]);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <MovementTrendChart data={movementTrend} />
      <CategoryDistributionChart data={categoryData} />
    </div>
  );
}
