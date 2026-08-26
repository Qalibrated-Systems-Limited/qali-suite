import {
  getRequestStatusBreakdown,
  getTopProducts,
} from "@/app/db/actions/inventory-dashboard-actions";
import { RequestStatusChart, TopProductsChart } from "./dashboardCharts";
import { da } from "date-fns/locale";

export async function RequestStatusChartServerComp() {
  const data = await getRequestStatusBreakdown();

  return <RequestStatusChart data={data} />;
}

export async function TopProductsChartServerComp() {
  const data = await getTopProducts(5);
  return <TopProductsChart data={data} />;
}
