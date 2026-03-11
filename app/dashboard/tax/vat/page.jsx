import { Suspense } from "react";
import VATReturnClient from "./VATReturnClient";
import {
  VATStatsCards,
  VATStatsSkeleton,
  VATContentSkeleton,
} from "./VATServerComponents";
import { getVATDashboard, getFilingPeriods, getTaxTransactions } from "@/app/mongodb/queries/taxQueries";

export const metadata = {
  title: "VAT Returns | Taxes",
  description: "VAT Output and Input tracking for Kenya Revenue Authority compliance",
};

// Helper to get current filing period in YYYY-MM format
function getCurrentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default async function VATReturnPage({ searchParams }) {
  const params = await searchParams;
  const period = params?.period || null;

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">
            VAT Returns
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Kenya VAT compliance - 16% standard rate
          </p>
        </div>
      </div>

      {/* Stats Cards - Stream independently */}
      <Suspense fallback={<VATStatsSkeleton />}>
        <VATStatsCards period={period} />
      </Suspense>

      {/* VAT Content - Stream independently */}
      <Suspense fallback={<VATContentSkeleton />}>
        <VATContentServer period={period} />
      </Suspense>
    </div>
  );
}

// ============================================
// VAT CONTENT SERVER (Async Server Component)
// ============================================

async function VATContentServer({ period }) {
  const activePeriod = period || getCurrentPeriod();

  // Fetch VAT dashboard data, periods, and transaction details in parallel
  const [vatData, periods, outputTxns, inputTxns] = await Promise.all([
    getVATDashboard(period),
    getFilingPeriods(24),
    // Get VAT Output transactions for drill-down
    getTaxTransactions(1, {
      taxType: "vat_output",
      filingPeriod: activePeriod,
    }),
    // Get VAT Input transactions for drill-down
    getTaxTransactions(1, {
      taxType: "vat_input",
      filingPeriod: activePeriod,
    }),
  ]);

  // Combine transactions for client component
  const transactions = {
    output: outputTxns.transactions || [],
    input: inputTxns.transactions || [],
  };

  return (
    <VATReturnClient
      vatData={vatData}
      periods={periods}
      initialPeriod={period}
      transactions={transactions}
    />
  );
}
