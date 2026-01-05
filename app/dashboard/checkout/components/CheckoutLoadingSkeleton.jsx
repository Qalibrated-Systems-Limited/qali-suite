import { Card, CardContent } from "@/components/ui/card";

// Enhanced Skeleton with Shimmer
function SkeletonWithShimmer({ className }) {
  return (
    <div
      className={`relative overflow-hidden bg-[#161b22] rounded ${className}`}
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-[#30363d]/50 to-transparent" />
    </div>
  );
}

// Main Checkouts Page Loading Skeleton
export function CheckoutsPageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {/* Header Skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <SkeletonWithShimmer className="h-8 w-48" />
      </div>

      {/* Search and Filters Skeleton */}
      <Card className="bg-[#161b22] border-[#30363d]">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4">
            <SkeletonWithShimmer className="h-10 w-full" />
            <div className="flex flex-col sm:flex-row gap-3">
              <SkeletonWithShimmer className="h-10 w-full sm:w-[200px]" />
              <SkeletonWithShimmer className="h-10 w-full sm:w-[200px]" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards Skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="bg-[#161b22] border-[#30363d]">
            <CardContent className="p-4 space-y-2">
              <SkeletonWithShimmer className="h-4 w-20" />
              <SkeletonWithShimmer className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table Skeleton */}
      <div className="hidden md:block">
        <CheckoutsTableSkeleton />
      </div>
      <div className="block md:hidden">
        <CheckoutsCardsSkeleton />
      </div>

      {/* Pagination Skeleton */}
      <div className="flex justify-center">
        <SkeletonWithShimmer className="h-10 w-64" />
      </div>
    </div>
  );
}

// Desktop Table Skeleton
function CheckoutsTableSkeleton() {
  return (
    <Card className="bg-[#161b22] border-[#30363d]">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          {/* Table Header */}
          <div className="border-b border-[#30363d] p-4">
            <div className="grid grid-cols-8 gap-4">
              <SkeletonWithShimmer className="h-4 w-24" />
              <SkeletonWithShimmer className="h-4 w-32" />
              <SkeletonWithShimmer className="h-4 w-32" />
              <SkeletonWithShimmer className="h-4 w-16" />
              <SkeletonWithShimmer className="h-4 w-20" />
              <SkeletonWithShimmer className="h-4 w-24" />
              <SkeletonWithShimmer className="h-4 w-16" />
              <SkeletonWithShimmer className="h-4 w-20 ml-auto" />
            </div>
          </div>

          {/* Table Rows */}
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="border-b border-[#30363d] p-4">
              <div className="grid grid-cols-8 gap-4 items-center">
                <SkeletonWithShimmer className="h-4 w-24" />
                <div className="space-y-1">
                  <SkeletonWithShimmer className="h-4 w-32" />
                  <SkeletonWithShimmer className="h-3 w-20" />
                </div>
                <div className="space-y-1">
                  <SkeletonWithShimmer className="h-4 w-28" />
                  <SkeletonWithShimmer className="h-3 w-24" />
                </div>
                <SkeletonWithShimmer className="h-4 w-8" />
                <SkeletonWithShimmer className="h-6 w-24 rounded" />
                <SkeletonWithShimmer className="h-4 w-24" />
                <SkeletonWithShimmer className="h-6 w-16 rounded" />
                <SkeletonWithShimmer className="h-8 w-8 rounded ml-auto" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// Mobile Cards Skeleton
function CheckoutsCardsSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <Card key={i} className="p-4 bg-[#161b22] border-[#30363d]">
          <div className="space-y-3">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="space-y-2 flex-1">
                <SkeletonWithShimmer className="h-5 w-40" />
                <SkeletonWithShimmer className="h-3 w-24" />
              </div>
              <SkeletonWithShimmer className="h-6 w-24 rounded" />
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <SkeletonWithShimmer className="h-3 w-20" />
                <SkeletonWithShimmer className="h-4 w-24" />
              </div>
              <div className="space-y-1">
                <SkeletonWithShimmer className="h-3 w-16" />
                <SkeletonWithShimmer className="h-4 w-12" />
              </div>
              <div className="space-y-1">
                <SkeletonWithShimmer className="h-3 w-20" />
                <SkeletonWithShimmer className="h-4 w-24" />
              </div>
              <div className="space-y-1">
                <SkeletonWithShimmer className="h-3 w-16" />
                <SkeletonWithShimmer className="h-4 w-16" />
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <SkeletonWithShimmer className="h-9 flex-1 rounded" />
              <SkeletonWithShimmer className="h-9 flex-1 rounded" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// Simple Loading Spinner
export function CheckoutsLoadingSpinner() {
  return (
    <div className="flex items-center justify-center p-12">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 border-4 border-[#30363d] rounded-full"></div>
        <div className="absolute inset-0 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    </div>
  );
}
