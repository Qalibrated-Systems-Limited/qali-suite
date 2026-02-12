import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export default function JournalLoading() {
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="p-3 sm:p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-7 w-16" />
                <Skeleton className="h-3 w-24 hidden sm:block" />
              </div>
              <Skeleton className="w-9 h-9 rounded-lg" />
            </div>
          </Card>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="h-10 w-10 sm:hidden" />
        <Skeleton className="h-10 w-32 hidden sm:block" />
        <Skeleton className="h-10 w-32 hidden sm:block" />
        <Skeleton className="h-10 w-40 hidden sm:block" />
      </div>

      {/* Timeline */}
      <div className="space-y-6">
        {[1, 2].map((groupIndex) => (
          <div key={groupIndex}>
            {/* Date header */}
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 h-px bg-border" />
              <Skeleton className="h-7 w-32 rounded-full" />
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* Entry cards */}
            <div className="space-y-3">
              {[1, 2, 3].map((cardIndex) => (
                <Card key={cardIndex} className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-6 w-20" />
                        <Skeleton className="h-5 w-16 rounded-full" />
                      </div>
                      <Skeleton className="h-4 w-48" />
                    </div>
                    <Skeleton className="h-8 w-8 rounded" />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-8" />
                      <Skeleton className="h-2 flex-1 rounded-full" />
                      <Skeleton className="h-4 w-16" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-8" />
                      <Skeleton className="h-2 flex-1 rounded-full" />
                      <Skeleton className="h-4 w-16" />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
