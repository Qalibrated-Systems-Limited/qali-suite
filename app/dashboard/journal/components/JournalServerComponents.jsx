import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getJournalStatsForDashboard,
  getJournalEntriesForTimeline,
} from "@/app/mongodb/queries/journalQueries";
import { serializeBsonType } from "@/lib/utils";
import { JournalStatsCards } from "./JournalStatsCards";

// ============================================
// JOURNAL STATS SERVER (Async Server Component)
// ============================================

export async function JournalStatsServer() {
  const statsResult = await getJournalStatsForDashboard();
  const stats = serializeBsonType(statsResult);

  return <JournalStatsCards stats={stats} />;
}

// ============================================
// JOURNAL STATS SKELETON
// ============================================

export function JournalStatsSkeleton() {
  return (
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
  );
}

// ============================================
// JOURNAL ENTRIES SERVER (Async Server Component)
// Returns serialized entries data for the client component
// ============================================

export async function getJournalEntriesData(filters) {
  const entriesResult = await getJournalEntriesForTimeline(filters, 20);
  return serializeBsonType(entriesResult);
}

// ============================================
// JOURNAL PAGE SKELETON
// Full page skeleton for initial load
// ============================================

export function JournalPageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Stats skeleton */}
      <JournalStatsSkeleton />

      {/* Filter bar skeleton */}
      <div className="h-10 rounded-lg bg-muted animate-pulse" />

      {/* Timeline skeleton */}
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="p-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
                <Skeleton className="h-6 w-16" />
              </div>
              <Skeleton className="h-3 w-full" />
              <div className="flex gap-4">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================
// JOURNAL ENTRIES SKELETON
// For entries-only loading state
// ============================================

export function JournalEntriesSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <Card key={i} className="p-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="space-y-1">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
              <Skeleton className="h-6 w-16" />
            </div>
            <Skeleton className="h-3 w-full" />
            <div className="flex gap-4">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
