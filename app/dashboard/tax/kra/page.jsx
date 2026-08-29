import { Suspense } from "react";
import KRAFilingsClient from "./KRAFilingsClient";
import {
  KRAStatsCards,
  KRAStatsSkeleton,
  KRAContentSkeleton,
} from "./KRAServerComponents";
import {
  getUnfiledTransactionsPg,
  getUnremittedWHTPg,
  getFilingPeriodsPg,
} from "@/app/db/actions/tax-actions";

export const metadata = {
  title: "KRA Filings | Taxes",
  description: "KRA compliance dashboard - filing status, deadlines, and remittance tracking",
};

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
  // The period is passed to the client as `initialPeriod` and filtered there —
  // `activePeriod` was computed here and never read, along with the helper that
  // produced it. None of these three reads takes a period.
  // getTaxSummary() was fetched here too and passed as `summary`, which
  // KRAFilingsClient destructures and never reads — a second round trip for a
  // prop with no consumer. KRAStatsCards is the real one and fetches its own.
  const [unfiled, unremittedWHT, periods] = await Promise.all([
    getUnfiledTransactionsPg(),
    getUnremittedWHTPg(),
    getFilingPeriodsPg(24),
  ]);

  // No JSON round trip: the action layer serializes, so nothing BSON reaches
  // here any more.
  return (
    <KRAFilingsClient
      unfiled={unfiled}
      unremittedWHT={unremittedWHT}
      periods={periods}
      initialPeriod={period}
    />
  );
}
