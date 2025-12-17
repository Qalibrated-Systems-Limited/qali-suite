import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Main Stock Page Loading Skeleton
export function StockPageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {/* Header Skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-48 bg-[#161b22]" />
          <Skeleton className="h-4 w-32 mt-2 bg-[#161b22]" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-32 bg-[#161b22]" />
          <Skeleton className="h-10 w-32 bg-[#161b22]" />
        </div>
      </div>

      {/* Search and Filters Skeleton */}
      <Card className="bg-[#161b22] border-[#30363d]">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4">
            {/* Search Bar Skeleton */}
            <Skeleton className="h-10 w-full bg-[#0d1117]" />

            {/* Filters Row Skeleton */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Skeleton className="h-10 w-full sm:w-[200px] bg-[#0d1117]" />
              <Skeleton className="h-10 w-full sm:w-[200px] bg-[#0d1117]" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards Skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="bg-[#161b22] border-[#30363d]">
            <CardContent className="p-4">
              <Skeleton className="h-4 w-20 mb-2 bg-[#0d1117]" />
              <Skeleton className="h-8 w-16 bg-[#0d1117]" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table/Cards Skeleton */}
      <div className="hidden md:block">
        <StockTableSkeleton />
      </div>
      <div className="block md:hidden">
        <StockCardsSkeleton />
      </div>

      {/* Pagination Skeleton */}
      <div className="flex justify-center">
        <Skeleton className="h-10 w-64 bg-[#161b22]" />
      </div>
    </div>
  );
}

// Desktop Table Skeleton
export function StockTableSkeleton() {
  return (
    <Card className="bg-[#161b22] border-[#30363d]">
      <div className="overflow-x-auto">
        <div className="min-w-full">
          {/* Table Header */}
          <div className="border-b border-[#30363d] p-4">
            <div className="grid grid-cols-5 gap-4">
              <Skeleton className="h-4 w-16 bg-[#0d1117]" />
              <Skeleton className="h-4 w-32 bg-[#0d1117]" />
              <Skeleton className="h-4 w-24 bg-[#0d1117]" />
              <Skeleton className="h-4 w-16 bg-[#0d1117]" />
              <Skeleton className="h-4 w-20 ml-auto bg-[#0d1117]" />
            </div>
          </div>

          {/* Table Rows */}
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div
              key={i}
              className="border-b border-[#30363d] p-4 animate-pulse"
            >
              <div className="grid grid-cols-5 gap-4 items-center">
                {/* SKU */}
                <Skeleton className="h-4 w-20 bg-[#0d1117]" />
                {/* Product Name */}
                <Skeleton className="h-4 w-40 bg-[#0d1117]" />
                {/* Price */}
                <Skeleton className="h-4 w-24 bg-[#0d1117]" />
                {/* Stock */}
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-8 bg-[#0d1117]" />
                  <Skeleton className="h-5 w-12 rounded bg-[#0d1117]" />
                </div>
                {/* Actions */}
                <div className="flex items-center justify-end gap-2">
                  <Skeleton className="h-8 w-8 rounded bg-[#0d1117]" />
                  <Skeleton className="h-8 w-24 rounded-lg bg-[#0d1117]" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// Mobile Cards Skeleton
export function StockCardsSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <Card
          key={i}
          className="p-4 bg-[#161b22] border-[#30363d] animate-pulse"
        >
          <div className="space-y-3">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <Skeleton className="h-5 w-40 bg-[#0d1117]" />
                <Skeleton className="h-3 w-24 bg-[#0d1117]" />
              </div>
              <Skeleton className="h-6 w-20 rounded bg-[#0d1117]" />
            </div>

            {/* Details */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Skeleton className="h-3 w-12 bg-[#0d1117]" />
                <Skeleton className="h-4 w-20 bg-[#0d1117]" />
              </div>
              <div className="space-y-1">
                <Skeleton className="h-3 w-12 bg-[#0d1117]" />
                <Skeleton className="h-4 w-12 bg-[#0d1117]" />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2">
              <Skeleton className="h-9 flex-1 rounded bg-[#0d1117]" />
              <Skeleton className="h-9 w-24 rounded-lg bg-[#0d1117]" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// Minimal Loading State (for quick transitions)
export function StockLoadingMinimal() {
  return (
    <Card className="bg-[#161b22] border-[#30363d] p-8">
      <div className="flex flex-col items-center justify-center gap-4">
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 border-4 border-[#30363d] rounded-full"></div>
          <div className="absolute inset-0 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
        <p className="text-sm text-gray-400">Loading stock inventory...</p>
      </div>
    </Card>
  );
}

// Table Row Skeleton (for lazy loading / infinite scroll)
export function StockTableRowSkeleton() {
  return (
    <div className="border-b border-[#30363d] p-4 animate-pulse">
      <div className="grid grid-cols-5 gap-4 items-center">
        <Skeleton className="h-4 w-20 bg-[#0d1117]" />
        <Skeleton className="h-4 w-40 bg-[#0d1117]" />
        <Skeleton className="h-4 w-24 bg-[#0d1117]" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-8 bg-[#0d1117]" />
          <Skeleton className="h-5 w-12 rounded bg-[#0d1117]" />
        </div>
        <div className="flex items-center justify-end gap-2">
          <Skeleton className="h-8 w-8 rounded bg-[#0d1117]" />
          <Skeleton className="h-8 w-24 rounded-lg bg-[#0d1117]" />
        </div>
      </div>
    </div>
  );
}

// Stats Card Skeleton (individual)
export function StatsCardSkeleton() {
  return (
    <Card className="bg-[#161b22] border-[#30363d]">
      <CardContent className="p-4 animate-pulse">
        <Skeleton className="h-4 w-20 mb-2 bg-[#0d1117]" />
        <Skeleton className="h-8 w-16 bg-[#0d1117]" />
      </CardContent>
    </Card>
  );
}
