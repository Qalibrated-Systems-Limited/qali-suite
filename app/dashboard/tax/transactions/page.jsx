import { Suspense } from "react";
import TaxTransactionsClient from "./TaxTransactionsClient";
import {
  TaxTransactionsStatsCards,
  TaxTransactionsStatsSkeleton,
  TaxTransactionsTableSkeleton,
} from "./TaxTransactionsServerComponents";
import { getTaxTransactions, getFilingPeriods } from "@/app/mongodb/queries/taxQueries";

export const metadata = {
  title: "Tax Transactions | Taxes",
  description: "View all tax transactions including VAT, WHT, PAYE for KRA compliance",
};

export default async function TaxTransactionsPage({ searchParams }) {
  const params = await searchParams;

  // Parse all filter parameters
  const page = parseInt(params?.page) || 1;
  const taxType = params?.taxType || "";
  const filed = params?.filed || "";
  const period = params?.period || "";
  const remitted = params?.remitted || "";
  const source = params?.source || "";
  const startDate = params?.startDate || "";
  const endDate = params?.endDate || "";
  const search = params?.search || "";

  // Build filters object for query
  const filters = {};
  if (taxType && taxType !== "all") filters.taxType = taxType;
  if (filed && filed !== "all") filters.filed = filed;
  if (period && period !== "all") filters.filingPeriod = period;
  if (remitted && remitted !== "all") filters.remitted = remitted;
  if (source && source !== "all") filters.sourceType = source;
  if (startDate) filters.startDate = startDate;
  if (endDate) filters.endDate = endDate;
  if (search) filters.search = search;

  const initialFilters = {
    taxType,
    filed,
    period,
    remitted,
    source,
    startDate,
    endDate,
    search,
  };

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">
            Tax Transactions
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            VAT, WHT, PAYE, and all tax transactions for KRA compliance
          </p>
        </div>
      </div>

      {/* Stats Cards - Stream independently */}
      <Suspense fallback={<TaxTransactionsStatsSkeleton />}>
        <TaxTransactionsStatsCards filters={filters} />
      </Suspense>

      {/* Transactions Table - Stream independently */}
      <Suspense fallback={<TaxTransactionsTableSkeleton />}>
        <TaxTransactionsTableServer
          page={page}
          filters={filters}
          initialFilters={initialFilters}
        />
      </Suspense>
    </div>
  );
}

// ============================================
// TAX TRANSACTIONS TABLE SERVER (Async Server Component)
// ============================================

async function TaxTransactionsTableServer({ page, filters, initialFilters }) {
  const [data, periods] = await Promise.all([
    getTaxTransactions(page, filters),
    getFilingPeriods(24),
  ]);

  return (
    <TaxTransactionsClient
      transactions={data.transactions}
      pagination={data.pagination}
      periods={periods}
      initialFilters={initialFilters}
    />
  );
}
