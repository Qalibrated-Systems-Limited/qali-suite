import { Suspense } from "react";
import {
  StatementStatsCards,
  StatementStatsSkeleton,
  ARAgingBreakdown,
  ARAgingSkeleton,
  StatementGeneratorServer,
  StatementGeneratorSkeleton,
} from "./components/StatementServerComponents";

export const metadata = {
  title: "Statement of Accounts",
  description: "Generate customer account statements",
};

export default async function StatementsPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Statement of Accounts</h1>
        <p className="text-muted-foreground">
          Generate and download customer account statements
        </p>
      </div>

      {/* Stats Cards - Stream independently */}
      <Suspense fallback={<StatementStatsSkeleton />}>
        <StatementStatsCards />
      </Suspense>

      {/* Aging Breakdown - Stream independently */}
      <Suspense fallback={<ARAgingSkeleton />}>
        <ARAgingBreakdown />
      </Suspense>

      {/* Statement Generator - Stream independently */}
      <Suspense fallback={<StatementGeneratorSkeleton />}>
        <StatementGeneratorServer />
      </Suspense>
    </div>
  );
}
