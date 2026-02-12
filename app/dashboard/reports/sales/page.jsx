import { auth } from "@/auth";
import {
  getSalesByCustomerReport,
  getSalesByProductReport,
} from "@/app/mongodb/queries/sales-queries";
import { SalesReportClient } from "./SalesReportClient";

export const metadata = {
  title: "Sales Reports | Reports",
  description: "View sales by customer and product",
};

export default async function SalesReportsPage({ searchParams }) {
  const session = await auth();
  const { user } = session;

  // Check permission
  if (!["Admin", "Accountant", "Sales"].includes(user?.role)) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Access Denied
          </h1>
          <p className="text-muted-foreground">
            You don't have permission to view this report.
          </p>
        </div>
      </div>
    );
  }

  const params = await searchParams;

  // Default to current month
  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split("T")[0];
  const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    .toISOString()
    .split("T")[0];

  const startDate = params?.startDate || defaultStart;
  const endDate = params?.endDate || defaultEnd;
  const view = params?.view || "customer";

  let reportData = null;
  let error = null;

  try {
    if (view === "product") {
      reportData = await getSalesByProductReport(startDate, endDate);
    } else {
      reportData = await getSalesByCustomerReport(startDate, endDate);
    }
  } catch (err) {
    console.error("Error fetching sales report:", err);
    error = err.message;
  }

  return (
    <SalesReportClient
      initialData={reportData}
      initialStartDate={startDate}
      initialEndDate={endDate}
      initialView={view}
      error={error}
    />
  );
}
