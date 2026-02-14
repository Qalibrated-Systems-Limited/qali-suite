import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Receipt, FileCheck, Clock, Calculator } from "lucide-react";
import { getTaxTransactionStats } from "@/app/mongodb/queries/taxQueries";

// ============================================
// FORMAT CURRENCY HELPER
// ============================================
const formatCurrency = (amount) => {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
};

// ============================================
// TAX TRANSACTIONS STATS CARDS (Async Server Component)
// ============================================

export async function TaxTransactionsStatsCards({ filters = {} }) {
  const stats = await getTaxTransactionStats(filters);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Card className="bg-muted/30">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Receipt className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Total Transactions</span>
          </div>
          <p className="text-lg font-bold">{stats.totalTransactions}</p>
        </CardContent>
      </Card>

      <Card className="bg-muted/30">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Calculator className="w-4 h-4 text-purple-500" />
            <span className="text-xs text-muted-foreground">Total Tax</span>
          </div>
          <p className="text-lg font-bold text-purple-600">
            {formatCurrency(stats.totalTaxAmount)}
          </p>
        </CardContent>
      </Card>

      <Card className="bg-muted/30">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <FileCheck className="w-4 h-4 text-green-500" />
            <span className="text-xs text-muted-foreground">Filed</span>
          </div>
          <p className="text-lg font-bold text-green-600">{stats.filedCount}</p>
        </CardContent>
      </Card>

      <Card className="bg-muted/30">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-amber-500" />
            <span className="text-xs text-muted-foreground">Pending Filing</span>
          </div>
          <p className="text-lg font-bold text-amber-600">{stats.unfiledCount}</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// TAX TRANSACTIONS STATS SKELETON
// ============================================

export function TaxTransactionsStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {[...Array(4)].map((_, index) => (
        <Card key={index} className="bg-muted/30">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Skeleton className="w-4 h-4" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-6 w-16" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================
// TRANSACTIONS TABLE SKELETON
// ============================================

export function TaxTransactionsTableSkeleton() {
  return (
    <Card>
      <CardContent className="p-0">
        {/* Filters skeleton */}
        <div className="p-3 sm:p-4 space-y-3 border-b">
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <Skeleton className="h-9 flex-1" />
            <Skeleton className="h-9 w-full sm:w-[160px]" />
            <Skeleton className="h-9 w-full sm:w-[140px]" />
            <Skeleton className="h-9 w-full sm:w-[130px]" />
          </div>
        </div>

        {/* Table skeleton */}
        <div className="divide-y">
          {[...Array(6)].map((_, index) => (
            <div key={index} className="p-3 sm:p-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-6 w-16" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
