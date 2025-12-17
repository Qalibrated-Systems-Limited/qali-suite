import { Card, CardContent, CardHeader } from "@/components/ui/card";

// Shimmer Skeleton Component
function SkeletonWithShimmer({ className }) {
  return (
    <div className={`relative overflow-hidden bg-muted rounded ${className}`}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-muted-foreground/10 to-transparent" />
    </div>
  );
}

// ============================================
// STATS CARDS SKELETON
// ============================================
export function StatsCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <Card key={i} className="bg-card border-border">
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="flex-1 space-y-3">
                <SkeletonWithShimmer className="h-3 w-24" />
                <SkeletonWithShimmer className="h-8 w-20" />
                <SkeletonWithShimmer className="h-3 w-28" />
              </div>
              <SkeletonWithShimmer className="h-11 w-11 rounded-lg" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================
// CHART SKELETON
// ============================================
export function ChartSkeleton({ title = "Chart" }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <SkeletonWithShimmer className="h-6 w-48" />
        <SkeletonWithShimmer className="h-4 w-32 mt-2" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Y-axis labels */}
          <div className="flex items-end justify-between h-48">
            {[1, 2, 3, 4, 5, 6, 7].map((i) => (
              <SkeletonWithShimmer
                key={i}
                className="w-8"
                style={{ height: `${Math.random() * 150 + 50}px` }}
              />
            ))}
          </div>
          {/* X-axis labels */}
          <div className="flex justify-between">
            {[1, 2, 3, 4, 5, 6, 7].map((i) => (
              <SkeletonWithShimmer key={i} className="h-3 w-8" />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// ACTIVITY CARD SKELETON
// ============================================
export function ActivityCardSkeleton({ title = "Activity" }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div className="space-y-2">
          <SkeletonWithShimmer className="h-6 w-32" />
          <SkeletonWithShimmer className="h-4 w-24" />
        </div>
        <SkeletonWithShimmer className="h-8 w-20" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-3 rounded-lg border border-border"
            >
              <SkeletonWithShimmer className="h-8 w-8 rounded flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <SkeletonWithShimmer className="h-4 w-full" />
                <SkeletonWithShimmer className="h-3 w-3/4" />
                <SkeletonWithShimmer className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// ALERT CARD SKELETON
// ============================================
export function AlertCardSkeleton({ title = "Alerts" }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <SkeletonWithShimmer className="h-5 w-5 rounded" />
            <SkeletonWithShimmer className="h-6 w-32" />
          </div>
          <SkeletonWithShimmer className="h-4 w-28" />
        </div>
        <SkeletonWithShimmer className="h-8 w-20" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between p-3 rounded-lg border border-border"
            >
              <div className="flex-1 space-y-2">
                <SkeletonWithShimmer className="h-4 w-48" />
                <SkeletonWithShimmer className="h-3 w-32" />
              </div>
              <div className="text-right space-y-1">
                <SkeletonWithShimmer className="h-6 w-12" />
                <SkeletonWithShimmer className="h-3 w-16" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// FULL DASHBOARD SKELETON
// ============================================
export function DashboardPageSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="space-y-2">
        <SkeletonWithShimmer className="h-8 w-48" />
        <SkeletonWithShimmer className="h-4 w-64" />
      </div>

      {/* Stats Cards */}
      <StatsCardsSkeleton />

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>

      {/* Activity & Alerts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ActivityCardSkeleton />
        <AlertCardSkeleton />
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ActivityCardSkeleton />
        <ChartSkeleton />
      </div>
    </div>
  );
}

// ============================================
// INDIVIDUAL SECTION SKELETONS (for Suspense)
// ============================================
export function StatsSkeleton() {
  return <StatsCardsSkeleton />;
}

export function ChartsSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <ChartSkeleton />
      <ChartSkeleton />
    </div>
  );
}

export function ActivitySkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <ActivityCardSkeleton title="Recent Requests" />
      <ActivityCardSkeleton title="Recent Movements" />
    </div>
  );
}

export function AlertsSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <AlertCardSkeleton title="Low Stock" />
      <AlertCardSkeleton title="Overdue" />
    </div>
  );
}
