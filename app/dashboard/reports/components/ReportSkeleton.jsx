"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function ReportSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header Skeleton */}
      <div className="bg-card border-b border-border px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64 mt-2" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
        <div className="flex gap-3 mt-4">
          <Skeleton className="h-9 w-40" />
        </div>
      </div>

      {/* Summary Cards Skeleton */}
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-card border border-border rounded-lg p-4">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-8 w-28 mt-2" />
            </div>
          ))}
        </div>
      </div>

      {/* Table Skeleton */}
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="bg-muted/50 px-4 py-3 border-b border-border">
            <div className="flex justify-between">
              <Skeleton className="h-5 w-32" />
              <div className="flex gap-8">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-20" />
              </div>
            </div>
          </div>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div
              key={i}
              className="px-4 py-3 border-b border-border/50 flex justify-between"
            >
              <Skeleton className="h-5 w-48" />
              <div className="flex gap-8">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-20" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
