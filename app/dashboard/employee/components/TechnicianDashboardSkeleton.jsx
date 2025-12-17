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
export function TechnicianStatsCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map((i) => (
        <Card key={i} className="bg-card border-border">
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="flex-1 space-y-3">
                <SkeletonWithShimmer className="h-3 w-24" />
                <SkeletonWithShimmer className="h-9 w-12" />
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
// QUICK ACTIONS SKELETON
// ============================================
export function QuickActionsCardSkeleton() {
  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <SkeletonWithShimmer className="h-6 w-32" />
        <SkeletonWithShimmer className="h-4 w-48 mt-2" />
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-24 rounded-lg border border-border p-4 space-y-2"
            >
              <SkeletonWithShimmer className="h-5 w-5" />
              <SkeletonWithShimmer className="h-4 w-24" />
              <SkeletonWithShimmer className="h-3 w-32" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// OVERDUE ALERT SKELETON
// ============================================
export function OverdueAlertSkeleton() {
  return (
    <Card className="bg-red-500/10 border-red-500/20">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <SkeletonWithShimmer className="h-5 w-5 rounded" />
          <div className="flex-1 space-y-3">
            <SkeletonWithShimmer className="h-5 w-32" />
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex-1 space-y-2">
                    <SkeletonWithShimmer className="h-4 w-48" />
                    <SkeletonWithShimmer className="h-3 w-32" />
                  </div>
                  <SkeletonWithShimmer className="h-8 w-24 rounded" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// BORROWED ITEMS SKELETON
// ============================================
export function MyBorrowedItemsSkeleton() {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div className="space-y-2">
          <SkeletonWithShimmer className="h-6 w-40" />
          <SkeletonWithShimmer className="h-4 w-56" />
        </div>
        <SkeletonWithShimmer className="h-8 w-20" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="p-4 rounded-lg border border-border">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 space-y-3">
                  <div className="flex items-center gap-2">
                    <SkeletonWithShimmer className="h-4 w-4 rounded" />
                    <SkeletonWithShimmer className="h-4 w-48" />
                  </div>
                  <div className="space-y-2">
                    <SkeletonWithShimmer className="h-3 w-40" />
                    <SkeletonWithShimmer className="h-3 w-32" />
                    <SkeletonWithShimmer className="h-3 w-36" />
                  </div>
                </div>
                <SkeletonWithShimmer className="h-8 w-20 rounded" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// MY REQUESTS SKELETON
// ============================================
export function MyRequestsSkeleton() {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div className="space-y-2">
          <SkeletonWithShimmer className="h-6 w-32" />
          <SkeletonWithShimmer className="h-4 w-48" />
        </div>
        <SkeletonWithShimmer className="h-8 w-20" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="p-3 rounded-lg border border-border">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <SkeletonWithShimmer className="h-4 w-32" />
                  <SkeletonWithShimmer className="h-6 w-20 rounded" />
                </div>
                <SkeletonWithShimmer className="h-3 w-48" />
                <SkeletonWithShimmer className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// RECENT ACTIVITY SKELETON
// ============================================
export function RecentActivitySkeleton() {
  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <SkeletonWithShimmer className="h-6 w-40" />
        <SkeletonWithShimmer className="h-4 w-56 mt-2" />
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="flex items-start gap-3">
              {/* Timeline dot */}
              <div className="flex flex-col items-center">
                <SkeletonWithShimmer className="w-8 h-8 rounded-full" />
                {i < 7 && <div className="w-0.5 h-12 bg-border mt-2" />}
              </div>
              {/* Activity content */}
              <div className="flex-1 space-y-2 pb-4">
                <SkeletonWithShimmer className="h-4 w-64" />
                <SkeletonWithShimmer className="h-3 w-32" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// FULL TECHNICIAN DASHBOARD SKELETON
// ============================================
export function TechnicianDashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="space-y-2">
        <SkeletonWithShimmer className="h-9 w-64" />
        <SkeletonWithShimmer className="h-5 w-48" />
      </div>

      {/* Stats Cards */}
      <TechnicianStatsCardsSkeleton />

      {/* Quick Actions */}
      <QuickActionsCardSkeleton />

      {/* Overdue Alert (optional - can be hidden) */}
      {/* <OverdueAlertSkeleton /> */}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MyBorrowedItemsSkeleton />
        <MyRequestsSkeleton />
      </div>

      {/* Recent Activity */}
      <RecentActivitySkeleton />
    </div>
  );
}

// ============================================
// INDIVIDUAL SECTION SKELETONS (for Suspense)
// ============================================
export function StatsSkeleton() {
  return <TechnicianStatsCardsSkeleton />;
}

export function BorrowedItemsSkeleton() {
  return <MyBorrowedItemsSkeleton />;
}

export function RequestsSkeleton() {
  return <MyRequestsSkeleton />;
}

export function ActivitySkeleton() {
  return <RecentActivitySkeleton />;
}
