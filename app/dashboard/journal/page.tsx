import { Suspense } from "react";
import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getJournalStatsForDashboard,
  getJournalEntriesForTimeline,
} from "@/app/mongodb/queries/journalQueries";
import { serializeBsonType } from "@/lib/utils";
import { JournalPageClient } from "./JournalPageClient";

export const metadata = {
  title: "Journal Entries | ERP System",
  description: "Browse and manage journal entries",
};

interface SearchParams {
  search?: string;
  status?: string;
  entryType?: string;
  period?: string;
}

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const params = await searchParams;

  // Build filters from search params
  const filters = {
    search: params.search || "",
    status: params.status || "all",
    entryType: params.entryType || "all",
    period: params.period || "all",
  };

  // Fetch data in parallel
  const [statsResult, entriesResult] = await Promise.all([
    getJournalStatsForDashboard(),
    getJournalEntriesForTimeline(filters, 20),
  ]);

  // Serialize for client
  const stats = serializeBsonType(statsResult);
  const { entries, hasMore, nextCursor } = serializeBsonType(entriesResult);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Journal Entries</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Browse and manage your accounting journal
          </p>
        </div>
        {["Admin", "Accountant"].includes(session.user.role as string) && (
          <Button asChild className="sm:w-auto">
            <Link href="/dashboard/journal/create">
              <Plus className="w-4 h-4 mr-2" />
              New Entry
            </Link>
          </Button>
        )}
      </div>

      {/* Client-side interactive content */}
      <Suspense fallback={<JournalPageSkeleton />}>
        <JournalPageClient
          initialStats={stats}
          initialEntries={entries}
          initialHasMore={hasMore}
          initialCursor={nextCursor}
          initialFilters={filters}
        />
      </Suspense>
    </div>
  );
}

function JournalPageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Stats skeleton */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-24 rounded-lg border bg-card animate-pulse"
          />
        ))}
      </div>

      {/* Filter bar skeleton */}
      <div className="h-10 rounded-lg bg-muted animate-pulse" />

      {/* Timeline skeleton */}
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-32 rounded-lg border bg-card animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}
