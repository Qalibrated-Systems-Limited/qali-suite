import { Card, CardContent } from "@/components/ui/card";

// Shimmer Skeleton Component
function SkeletonWithShimmer({ className }) {
  return (
    <div className={`relative overflow-hidden bg-muted rounded ${className}`}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-muted-foreground/10 to-transparent" />
    </div>
  );
}

// Users Table Skeleton (Desktop)
function UsersTableSkeleton() {
  return (
    <Card className="hidden md:block bg-card border-border">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          {/* Table Header */}
          <div className="border-b border-border p-4">
            <div className="grid grid-cols-7 gap-4">
              <SkeletonWithShimmer className="h-4 w-20" />
              <SkeletonWithShimmer className="h-4 w-24" />
              <SkeletonWithShimmer className="h-4 w-24" />
              <SkeletonWithShimmer className="h-4 w-16" />
              <SkeletonWithShimmer className="h-4 w-16" />
              <SkeletonWithShimmer className="h-4 w-20" />
              <SkeletonWithShimmer className="h-4 w-16 ml-auto" />
            </div>
          </div>

          {/* Table Rows */}
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="border-b border-border p-4">
              <div className="grid grid-cols-7 gap-4 items-center">
                {/* Name with avatar */}
                <div className="flex items-center gap-2">
                  <SkeletonWithShimmer className="h-8 w-8 rounded-full" />
                  <SkeletonWithShimmer className="h-4 w-24" />
                </div>
                {/* Email */}
                <SkeletonWithShimmer className="h-4 w-32" />
                {/* Department */}
                <SkeletonWithShimmer className="h-4 w-20" />
                {/* Role Badge */}
                <SkeletonWithShimmer className="h-6 w-20 rounded" />
                {/* Status Badge */}
                <SkeletonWithShimmer className="h-6 w-16 rounded" />
                {/* Date */}
                <SkeletonWithShimmer className="h-4 w-24" />
                {/* Actions */}
                <SkeletonWithShimmer className="h-8 w-8 rounded ml-auto" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// Users Cards Skeleton (Mobile)
function UsersCardsSkeleton() {
  return (
    <div className="space-y-4 md:hidden">
      {[1, 2, 3, 4, 5].map((i) => (
        <Card key={i} className="p-4 bg-card border-border">
          <div className="space-y-3">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3 flex-1">
                <SkeletonWithShimmer className="h-10 w-10 rounded-full flex-shrink-0" />
                <div className="space-y-2 flex-1">
                  <SkeletonWithShimmer className="h-4 w-32" />
                  <SkeletonWithShimmer className="h-3 w-40" />
                </div>
              </div>
              <SkeletonWithShimmer className="h-6 w-16 rounded" />
            </div>

            {/* Details */}
            <div className="space-y-2">
              <SkeletonWithShimmer className="h-4 w-full" />
              <SkeletonWithShimmer className="h-6 w-24 rounded" />
              <SkeletonWithShimmer className="h-3 w-32" />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2 border-t border-border">
              <SkeletonWithShimmer className="h-9 flex-1 rounded" />
              <SkeletonWithShimmer className="h-9 flex-1 rounded" />
              <SkeletonWithShimmer className="h-9 w-9 rounded" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// Full Page Skeleton
export function UsersPageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <SkeletonWithShimmer className="h-8 w-48" />
          <SkeletonWithShimmer className="h-4 w-64" />
        </div>
        <SkeletonWithShimmer className="h-10 w-32 rounded" />
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="bg-card border-border">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2 flex-1">
                  <SkeletonWithShimmer className="h-3 w-20" />
                  <SkeletonWithShimmer className="h-8 w-12" />
                </div>
                <SkeletonWithShimmer className="h-8 w-8 rounded" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search and Filters */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4">
            <SkeletonWithShimmer className="h-10 w-full" />
            <div className="flex flex-col sm:flex-row gap-3">
              <SkeletonWithShimmer className="h-10 w-full sm:w-[180px]" />
              <SkeletonWithShimmer className="h-10 w-full sm:w-[180px]" />
              <SkeletonWithShimmer className="h-10 w-full sm:w-[180px]" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table/Cards */}
      <div className="hidden md:block">
        <UsersTableSkeleton />
      </div>
      <div className="block md:hidden">
        <UsersCardsSkeleton />
      </div>

      {/* Pagination */}
      <div className="flex justify-center">
        <SkeletonWithShimmer className="h-10 w-64 rounded" />
      </div>
    </div>
  );
}

// Export individual skeletons
export { UsersTableSkeleton, UsersCardsSkeleton };
