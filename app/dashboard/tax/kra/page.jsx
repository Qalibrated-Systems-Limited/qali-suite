import { Suspense } from "react";
import KRAFilingsClient from "./KRAFilingsClient";
import {
  KRAStatsCards,
  KRAStatsSkeleton,
  KRAContentSkeleton,
} from "./KRAServerComponents";
import {
  getUnfiledTransactions,
  getUnremittedWHT,
  getFilingPeriods,
  getTaxSummary,
} from "@/app/mongodb/queries/taxQueries";

export const metadata = {
  title: "KRA Filings | Taxes",
  description: "KRA compliance dashboard - filing status, deadlines, and remittance tracking",
};

function getCurrentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default async function KRAFilingsPage({ searchParams }) {
  const params = await searchParams;
  const period = params?.period || null;

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">
            KRA Filings
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Tax compliance dashboard - filing status & deadlines
          </p>
        </div>
      </div>

      <Suspense fallback={<KRAStatsSkeleton />}>
        <KRAStatsCards />
      </Suspense>

      <Suspense fallback={<KRAContentSkeleton />}>
        <KRAContentServer period={period} />
      </Suspense>
    </div>
  );
}

async function KRAContentServer({ period }) {
  const activePeriod = period || getCurrentPeriod();

  const [unfiledRaw, unremittedRaw, periods, summary] = await Promise.all([
    getUnfiledTransactions(),
    getUnremittedWHT(),
    getFilingPeriods(24),
    getTaxSummary(),
  ]);

  // Serialize BSON types for client component
  const unfiled = JSON.parse(JSON.stringify(unfiledRaw || []));
  const unremittedWHT = JSON.parse(JSON.stringify(unremittedRaw || []));

  return (
    <KRAFilingsClient
      unfiled={unfiled}
      unremittedWHT={unremittedWHT}
      periods={periods}
      summary={JSON.parse(JSON.stringify(summary || {}))}
      initialPeriod={period}
    />
  );
}
