import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canSeeSalesNav } from "@/lib/permissions";
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
  if (!session?.user) redirect("/login");
  const { user } = session;

  // Single source of truth — same gate the sidebar uses to surface the link.
  if (!canSeeSalesNav(user.role)) {
    redirect("/dashboard");
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
