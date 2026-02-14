import { Suspense } from "react";
import {
  SupplierStatementStatsCards,
  SupplierStatementStatsSkeleton,
  APAgingBreakdown,
  APAgingSkeleton,
  StatementGeneratorServer,
  StatementGeneratorSkeleton,
} from "./components/SupplierStatementServerComponents";

export const metadata = {
  title: "Supplier Statements",
  description: "Generate supplier account statements",
};

export default async function SupplierStatementsPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Supplier Statements</h1>
        <p className="text-muted-foreground">
          Generate and download supplier account statements
        </p>
      </div>

      {/* Stats Cards - Stream independently */}
      <Suspense fallback={<SupplierStatementStatsSkeleton />}>
        <SupplierStatementStatsCards />
      </Suspense>

      {/* Aging Breakdown - Stream independently */}
      <Suspense fallback={<APAgingSkeleton />}>
        <APAgingBreakdown />
      </Suspense>

      {/* Statement Generator - Stream independently */}
      <Suspense fallback={<StatementGeneratorSkeleton />}>
        <StatementGeneratorServer />
      </Suspense>
    </div>
  );
}
