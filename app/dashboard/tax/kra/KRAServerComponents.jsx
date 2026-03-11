import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, AlertTriangle, Clock, CheckCircle2 } from "lucide-react";
import { getTaxSummary } from "@/app/mongodb/queries/taxQueries";

const formatCurrency = (amount) => {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
};

export async function KRAStatsCards() {
  const summary = await getTaxSummary();

  const totalUnfiled = (summary?.unfiled?.vat || 0) + (summary?.unfiled?.wht || 0);
  const totalFiled = (summary?.filed?.vat || 0) + (summary?.filed?.wht || 0);
  const pendingRemittance = summary?.unremittedWHT || 0;
  const totalTax = summary?.totalTax || 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      <Card className="border-l-4 border-l-red-500">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-red-500" />
            <span className="text-xs sm:text-sm text-muted-foreground">
              Unfiled
            </span>
          </div>
          <p className="text-lg sm:text-2xl font-bold text-red-600 tabular-nums">
            {totalUnfiled}
          </p>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
            Transactions pending filing
          </p>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-green-500">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-green-500" />
            <span className="text-xs sm:text-sm text-muted-foreground">
              Filed
            </span>
          </div>
          <p className="text-lg sm:text-2xl font-bold text-green-600 tabular-nums">
            {totalFiled}
          </p>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
            Filed with KRA
          </p>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-orange-500">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-orange-500" />
            <span className="text-xs sm:text-sm text-muted-foreground">
              WHT Pending
            </span>
          </div>
          <p className="text-lg sm:text-2xl font-bold text-orange-600 tabular-nums">
            {formatCurrency(pendingRemittance)}
          </p>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
            Unremitted to KRA
          </p>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-blue-500">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500" />
            <span className="text-xs sm:text-sm text-muted-foreground">
              Total Tax
            </span>
          </div>
          <p className="text-lg sm:text-2xl font-bold text-foreground tabular-nums">
            {formatCurrency(totalTax)}
          </p>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
            All tax types
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export function KRAStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {[
        "border-l-red-500",
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

export function KRAContentSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-16 w-full rounded-lg" />
      <div className="grid lg:grid-cols-2 gap-4">
        {[...Array(2)].map((_, index) => (
          <Card key={index}>
            <CardContent className="p-4 space-y-3">
              <Skeleton className="h-5 w-32" />
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
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
    </div>
  );
}
