import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Receipt, CheckCircle2, Clock, FileText } from "lucide-react";
import { getWHTStats } from "@/app/mongodb/queries/taxQueries";

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
// WHT STATS CARDS (Async Server Component)
// ============================================

export async function WHTStatsCards({ startDate, endDate }) {
  const stats = await getWHTStats(startDate, endDate);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {/* Total WHT */}
      <Card className="border-l-4 border-l-purple-500">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-2">
            <Receipt className="w-4 h-4 sm:w-5 sm:h-5 text-purple-500" />
            <span className="text-xs sm:text-sm text-muted-foreground">
              Total WHT
            </span>
          </div>
          <p className="text-lg sm:text-2xl font-bold text-foreground tabular-nums">
            {formatCurrency(stats.totalWHT)}
          </p>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
            {stats.transactionCount} transactions
          </p>
        </CardContent>
      </Card>

      {/* Remitted */}
      <Card className="border-l-4 border-l-green-500">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-green-500" />
            <span className="text-xs sm:text-sm text-muted-foreground">
              Remitted
            </span>
          </div>
          <p className="text-lg sm:text-2xl font-bold text-green-600 tabular-nums">
            {formatCurrency(stats.remitted)}
          </p>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
            Paid to KRA
          </p>
        </CardContent>
      </Card>

      {/* Unremitted */}
      <Card className="border-l-4 border-l-orange-500">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-orange-500" />
            <span className="text-xs sm:text-sm text-muted-foreground">
              Pending
            </span>
          </div>
          <p className="text-lg sm:text-2xl font-bold text-orange-600 tabular-nums">
            {formatCurrency(stats.unremitted)}
          </p>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
            {stats.unremittedCount} pending
          </p>
        </CardContent>
      </Card>

      {/* Certificates */}
      <Card className="border-l-4 border-l-blue-500">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500" />
            <span className="text-xs sm:text-sm text-muted-foreground">
              Certificates
            </span>
          </div>
          <p className="text-lg sm:text-2xl font-bold text-foreground">
            {stats.transactionCount}
          </p>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
            To be issued
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// WHT STATS SKELETON
// ============================================

export function WHTStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {[
        "border-l-purple-500",
        "border-l-green-500",
        "border-l-orange-500",
        "border-l-blue-500",
      ].map((border, index) => (
        <Card key={index} className={`border-l-4 ${border}`}>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-2">
              <Skeleton className="w-4 h-4 sm:w-5 sm:h-5" />
              <Skeleton className="h-3 sm:h-4 w-20" />
            </div>
            <Skeleton className="h-6 sm:h-8 w-24 mb-1" />
            <Skeleton className="h-3 w-16" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================
// WHT CONTENT SKELETON
// ============================================

export function WHTContentSkeleton() {
  return (
    <div className="space-y-4">
      {/* Alert skeleton */}
      <Skeleton className="h-16 w-full rounded-lg" />

      {/* Breakdown cards */}
      <div className="grid lg:grid-cols-2 gap-4">
        {[...Array(2)].map((_, index) => (
          <Card key={index}>
            <CardContent className="p-4 space-y-3">
              <Skeleton className="h-5 w-32" />
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex justify-between py-2 border-b">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Transactions table skeleton */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-40" />
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex justify-between py-2 border-b">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
