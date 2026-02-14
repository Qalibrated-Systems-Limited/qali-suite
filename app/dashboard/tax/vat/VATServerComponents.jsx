import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Calculator,
  FileText,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { getVATStats } from "@/app/mongodb/queries/taxQueries";

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
// VAT STATS CARDS (Async Server Component)
// ============================================

export async function VATStatsCards({ period }) {
  const stats = await getVATStats(period);
  const isPayable = stats.netPosition > 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {/* VAT Output (Sales) */}
      <Card className="border-l-4 border-l-red-500">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-2">
            <ArrowUpCircle className="w-4 h-4 sm:w-5 sm:h-5 text-red-500" />
            <span className="text-xs sm:text-sm text-muted-foreground">
              VAT Output
            </span>
          </div>
          <p className="text-lg sm:text-2xl font-bold text-foreground tabular-nums">
            {formatCurrency(stats.outputVAT)}
          </p>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
            {stats.outputCount} invoices
          </p>
        </CardContent>
      </Card>

      {/* VAT Input (Purchases) */}
      <Card className="border-l-4 border-l-green-500">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-2">
            <ArrowDownCircle className="w-4 h-4 sm:w-5 sm:h-5 text-green-500" />
            <span className="text-xs sm:text-sm text-muted-foreground">
              VAT Input
            </span>
          </div>
          <p className="text-lg sm:text-2xl font-bold text-foreground tabular-nums">
            {formatCurrency(stats.inputVAT)}
          </p>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
            {stats.inputCount} bills
          </p>
        </CardContent>
      </Card>

      {/* Net VAT Position */}
      <Card
        className={`border-l-4 ${isPayable ? "border-l-orange-500" : "border-l-blue-500"}`}
      >
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-2">
            <Calculator className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground" />
            <span className="text-xs sm:text-sm text-muted-foreground">
              {isPayable ? "VAT Payable" : "VAT Refundable"}
            </span>
          </div>
          <p
            className={`text-lg sm:text-2xl font-bold tabular-nums ${isPayable ? "text-orange-600" : "text-blue-600"}`}
          >
            {formatCurrency(Math.abs(stats.netPosition))}
          </p>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
            {isPayable ? "Due to KRA" : "Claimable from KRA"}
          </p>
        </CardContent>
      </Card>

      {/* Filing Status */}
      <Card className="border-l-4 border-l-yellow-500">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-500" />
            <span className="text-xs sm:text-sm text-muted-foreground">
              Filing Status
            </span>
          </div>
          <div className="flex items-center gap-2">
            {stats.unfiledCount > 0 ? (
              <>
                <Clock className="w-4 h-4 text-yellow-500" />
                <span className="text-sm font-medium text-yellow-600">
                  Pending
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span className="text-sm font-medium text-green-600">
                  Filed
                </span>
              </>
            )}
          </div>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
            {stats.unfiledCount} unfiled
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// VAT STATS SKELETON
// ============================================

export function VATStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {[
        "border-l-red-500",
        "border-l-green-500",
        "border-l-orange-500",
        "border-l-yellow-500",
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
// VAT CONTENT SKELETON
// ============================================

export function VATContentSkeleton() {
  return (
    <div className="space-y-4">
      {/* Breakdown cards */}
      <div className="grid md:grid-cols-2 gap-4">
        {[...Array(2)].map((_, index) => (
          <Card key={index}>
            <CardContent className="p-4 space-y-3">
              <Skeleton className="h-5 w-32" />
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
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

      {/* Summary card */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-48" />
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex justify-between py-3 border-b">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
