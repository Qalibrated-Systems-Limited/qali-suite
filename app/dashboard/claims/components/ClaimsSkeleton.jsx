import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Claim Card Skeleton
 * Loading state for ClaimCard component
 */
export function ClaimCardSkeleton() {
  return (
    <Card className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-32 sm:w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <div className="flex flex-col items-end gap-2">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-6 w-24" />
        </div>
      </div>

      {/* Amount */}
      <div className="mb-4 p-4 bg-muted/50 rounded-lg">
        <Skeleton className="h-8 w-36" />
      </div>

      {/* Details */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
    </Card>
  );
}

/**
 * Claims List Skeleton
 * Loading state for list of claims
 */
export function ClaimsListSkeleton({ count = 6 }) {
  return (
    <div className="space-y-6">
      {/* Filter skeletons */}
      <div className="space-y-3">
        <Skeleton className="h-5 w-32" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <Skeleton className="h-5 w-32" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>

      {/* Count skeleton */}
      <Skeleton className="h-4 w-40" />

      {/* Cards skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        {Array.from({ length: count }).map((_, i) => (
          <ClaimCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

/**
 * Stats Card Skeleton
 * Loading state for stats cards
 */
export function StatsCardSkeleton() {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Skeleton className="w-10 h-10 rounded-lg" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-16" />
        </div>
      </div>
    </Card>
  );
}

export function StatsCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-md border border-border bg-card px-3 py-2 space-y-1"
        >
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-5 w-10" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

/**
 * Stats Grid Skeleton
 * Loading state for stats grid
 */
export function StatsGridSkeleton({ cols = 4 }) {
  return (
    <div
      className={`grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-${cols} gap-3 sm:gap-4`}
    >
      {Array.from({ length: cols }).map((_, i) => (
        <StatsCardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Page Header Skeleton
 * Loading state for page headers
 */
export function PageHeaderSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-48 sm:w-64" />
      <Skeleton className="h-4 w-64 sm:w-96" />
    </div>
  );
}

/**
 * Amount Summary Skeleton
 * Loading state for amount summary card
 */
export function AmountSummarySkeleton() {
  return (
    <Card className="p-5 sm:p-6 bg-muted/50">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 sm:gap-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-40" />
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * Form Section Skeleton
 * Loading state for form sections
 */
export function FormSectionSkeleton() {
  return (
    <Card className="p-5 sm:p-6 lg:p-8 space-y-6">
      {/* Banner */}
      <Skeleton className="h-20 w-full rounded-lg" />

      {/* Section 1 */}
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <div className="space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-14 w-full" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>

      {/* Section 2 */}
      <div className="space-y-4 pt-4 border-t">
        <Skeleton className="h-6 w-32" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-12 w-full" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex gap-3 justify-end pt-6 border-t">
        <Skeleton className="h-12 w-24" />
        <Skeleton className="h-12 w-40" />
      </div>
    </Card>
  );
}

/**
 * Claim Detail Skeleton
 * Loading state for claim detail page
 */
export function ClaimDetailSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Skeleton className="w-10 h-10 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>

      {/* Status & Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-28" />
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-28" />
        </div>
      </div>

      {/* Main Info Card */}
      <Card className="p-6">
        <div className="space-y-6">
          {/* Amount */}
          <div className="p-4 bg-muted/50 rounded-lg">
            <Skeleton className="h-12 w-48" />
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-5 w-full" />
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Items Card (for reimbursements) */}
      <Card className="p-6">
        <Skeleton className="h-6 w-32 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-4 bg-muted/50 rounded-lg">
              <div className="grid grid-cols-2 gap-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Timeline Card */}
      <Card className="p-6">
        <Skeleton className="h-6 w-24 mb-4" />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-4">
              <Skeleton className="w-2 h-16 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/**
 * Expense Item Skeleton
 * Loading state for expense items in reimbursement form
 */
export function ExpenseItemSkeleton() {
  return (
    <div className="p-5 sm:p-6 border-2 border-border rounded-lg space-y-4 bg-muted/30">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-9 w-24" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-11 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-11 w-full" />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-11 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-11 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-11 w-full" />
        </div>
      </div>
    </div>
  );
}

/**
 * Info Banner Skeleton
 * Loading state for info banners
 */
export function InfoBannerSkeleton() {
  return (
    <Card className="p-4 sm:p-5 bg-muted/50">
      <div className="flex items-start gap-3">
        <Skeleton className="w-5 h-5 rounded-full flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    </Card>
  );
}
