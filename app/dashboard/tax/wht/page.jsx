import { Suspense } from "react";
import WHTReportClient from "./WHTReportClient";
import { getWHTDashboard, getTaxTransactions } from "@/app/mongodb/queries/taxQueries";

export const metadata = {
  title: "WHT Reports | Tax Management",
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

  // Fetch WHT dashboard and transactions in parallel
  const [whtData, txnData] = await Promise.all([
    getWHTDashboard(startDate, endDate),
    getTaxTransactions(1, {
      taxType: "wht",
      startDate: startDate.toISOString().split("T")[0],
      endDate: endDate.toISOString().split("T")[0],
    }),
  ]);

  return (
    <Suspense fallback={<WHTSkeleton />}>
      <WHTReportClient
        whtData={whtData}
        initialStartDate={startDate.toISOString().split("T")[0]}
        initialEndDate={endDate.toISOString().split("T")[0]}
        transactions={txnData.transactions || []}
      />
    </Suspense>
  );
}

function WHTSkeleton() {
  return (
    <div className="p-4 sm:p-6 space-y-6 animate-pulse">
      <div className="h-8 w-48 bg-muted rounded" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 bg-muted rounded-lg" />
        ))}
      </div>
      <div className="h-64 bg-muted rounded-lg" />
    </div>
  );
}
