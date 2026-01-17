// app/(dashboard)/products/[id]/loading.jsx
// Loading skeleton for Product Detail Page

import { Skeleton } from "@/components/ui/skeleton";

function KPICardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <Skeleton className="size-10 sm:size-11 rounded-lg" />
      <Skeleton className="h-4 w-16 mt-3" />
      <Skeleton className="h-8 w-20 mt-1" />
    </div>
  );
}

function SectionSkeleton({ rows = 4 }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 sm:px-5 py-3.5 border-b border-border">
        <Skeleton className="size-4 rounded" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="px-4 sm:px-5 py-4 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex justify-between items-center py-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ListItemSkeleton() {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/50 last:border-0">
      <Skeleton className="size-8 rounded-lg" />
      <div className="flex-1">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-16 mt-1" />
      </div>
      <Skeleton className="h-4 w-8" />
    </div>
  );
}

export default function ProductDetailLoading() {
  return (
    <div className="flex-1 space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="size-4" />
          <Skeleton className="h-4 w-40" />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
            <Skeleton className="h-4 w-48" />
          </div>

          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-28" />
            <Skeleton className="size-9" />
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPICardSkeleton />
        <KPICardSkeleton />
        <KPICardSkeleton />
        <KPICardSkeleton />
      </div>

      {/* Pricing Row */}
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="text-center sm:text-left">
              <Skeleton className="h-4 w-20 mx-auto sm:mx-0" />
              <Skeleton className="h-7 w-24 mt-1 mx-auto sm:mx-0" />
            </div>
          ))}
        </div>
      </div>

      {/* Quick Info */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-16" />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Skeleton className="h-4 w-full max-w-2xl" />
        <Skeleton className="h-4 w-3/4 max-w-xl" />
      </div>

      {/* Content Grid */}
      <div className="grid lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          <SectionSkeleton rows={4} />
          <SectionSkeleton rows={6} />
          <SectionSkeleton rows={4} />
          <SectionSkeleton rows={4} />
        </div>

        {/* Right Column */}
        <div className="space-y-4 sm:space-y-6">
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-border">
              <Skeleton className="size-4 rounded" />
              <Skeleton className="h-4 w-32" />
            </div>
            <div className="px-4 py-2">
              <ListItemSkeleton />
              <ListItemSkeleton />
              <ListItemSkeleton />
              <ListItemSkeleton />
              <ListItemSkeleton />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-border">
              <Skeleton className="size-4 rounded" />
              <Skeleton className="h-4 w-32" />
            </div>
            <div className="px-4 py-2">
              <ListItemSkeleton />
              <ListItemSkeleton />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <Skeleton className="h-3 w-20 mb-3" />
            <div className="space-y-2">
              <div className="flex justify-between">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-24" />
              </div>
              <div className="flex justify-between">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
