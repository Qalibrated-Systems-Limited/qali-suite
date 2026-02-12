import { Suspense } from "react";
import TaxTransactionsClient from "./TaxTransactionsClient";
import { getTaxTransactions, getFilingPeriods } from "@/app/mongodb/queries/taxQueries";

export const metadata = {
  title: "Tax Transactions | Tax Management",
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

  const [data, periods] = await Promise.all([
    getTaxTransactions(page, filters),
    getFilingPeriods(24),
  ]);

  return (
    <Suspense fallback={<TransactionsSkeleton />}>
      <TaxTransactionsClient
        transactions={data.transactions}
        pagination={data.pagination}
        periods={periods}
        initialFilters={{
          taxType,
          filed,
          period,
          remitted,
          source,
          startDate,
          endDate,
          search,
        }}
      />
    </Suspense>
  );
}

function TransactionsSkeleton() {
  return (
    <div className="p-4 sm:p-6 space-y-6 animate-pulse">
      {/* Header */}
      <div className="flex justify-between">
        <div>
          <div className="h-7 w-48 bg-muted rounded" />
          <div className="h-4 w-64 bg-muted rounded mt-2" />
        </div>
        <div className="h-9 w-24 bg-muted rounded" />
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 bg-muted rounded-lg" />
        ))}
      </div>

      {/* Filters */}
      <div className="h-14 bg-muted rounded-lg" />

      {/* Table */}
      <div className="space-y-2">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-14 bg-muted rounded-lg" />
        ))}
      </div>
    </div>
  );
}
