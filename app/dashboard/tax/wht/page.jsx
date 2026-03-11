import { Suspense } from "react";
import WHTReportClient from "./WHTReportClient";
import {
  WHTStatsCards,
  WHTStatsSkeleton,
  WHTContentSkeleton,
} from "./WHTServerComponents";
import { getWHTDashboard, getTaxTransactions } from "@/app/mongodb/queries/taxQueries";

export const metadata = {
  title: "WHT Reports | Taxes",
  description: "Withholding Tax tracking and KRA compliance",
};

export default async function WHTReportPage({ searchParams }) {
  const params = await searchParams;

  // Get date range from params or use current month
  const now = new Date();
  const startDate = params?.startDate
    ? new Date(params.startDate)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const endDate = params?.endDate
    ? new Date(params.endDate)
    : new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">
            WHT Reports
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Withholding Tax on supplier payments
          </p>
        </div>
      </div>

      {/* Stats Cards - Stream independently */}
      <Suspense fallback={<WHTStatsSkeleton />}>
        <WHTStatsCards startDate={startDate} endDate={endDate} />
      </Suspense>

      {/* WHT Content - Stream independently */}
      <Suspense fallback={<WHTContentSkeleton />}>
        <WHTContentServer
          startDate={startDate}
          endDate={endDate}
          startDateStr={startDateStr}
          endDateStr={endDateStr}
        />
      </Suspense>
    </div>
  );
}

// ============================================
// WHT CONTENT SERVER (Async Server Component)
// ============================================

async function WHTContentServer({ startDate, endDate, startDateStr, endDateStr }) {
  // Fetch WHT dashboard and transactions in parallel
  const [whtData, txnData] = await Promise.all([
    getWHTDashboard(startDate, endDate),
    getTaxTransactions(1, {
      taxType: "wht",
      startDate: startDateStr,
      endDate: endDateStr,
    }),
  ]);

  return (
    <WHTReportClient
      whtData={whtData}
      initialStartDate={startDateStr}
      initialEndDate={endDateStr}
      transactions={txnData.transactions || []}
    />
  );
}
