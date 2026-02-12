import { Suspense } from "react";
import VATReturnClient from "./VATReturnClient";
import { getVATDashboard, getFilingPeriods, getTaxTransactions } from "@/app/mongodb/queries/taxQueries";

export const metadata = {
  title: "VAT Returns | Tax Management",
  description: "VAT Output and Input tracking for Kenya Revenue Authority compliance",
};

export default async function VATReturnPage({ searchParams }) {
  const params = await searchParams;
  const period = params?.period || null;

  // Fetch VAT dashboard data, periods, and transaction details in parallel
  const [vatData, periods, outputTxns, inputTxns] = await Promise.all([
    getVATDashboard(period),
    getFilingPeriods(24),
    // Get VAT Output transactions for drill-down
    getTaxTransactions(1, {
      taxType: "vat_output",
      filingPeriod: period || getCurrentPeriod(),
    }),
    // Get VAT Input transactions for drill-down
    getTaxTransactions(1, {
      taxType: "vat_input",
      filingPeriod: period || getCurrentPeriod(),
    }),
  ]);

  // Combine transactions for client component
  const transactions = {
    output: outputTxns.transactions || [],
    input: inputTxns.transactions || [],
  };

  return (
    <Suspense fallback={<VATSkeleton />}>
      <VATReturnClient
        vatData={vatData}
        periods={periods}
        initialPeriod={period}
        transactions={transactions}
      />
    </Suspense>
  );
}

// Helper to get current filing period in YYYY-MM format
function getCurrentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function VATSkeleton() {
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
