import { Suspense } from "react";
import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getJournalEntriesForTimeline } from "@/app/mongodb/queries/journalQueries";
import { serializeBsonType } from "@/lib/utils";
import { JournalPageClient } from "./JournalPageClient";
import {
  JournalStatsServer,
  JournalStatsSkeleton,
  JournalEntriesSkeleton,
} from "./components/JournalServerComponents";

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

// Async server component for entries data
async function JournalEntriesServer({
  filters,
}: {
  filters: {
    search: string;
    status: string;
    entryType: string;
    period: string;
  };
}) {
  const entriesResult = await getJournalEntriesForTimeline(filters, 20);
  const { entries, hasMore, nextCursor } = serializeBsonType(entriesResult);

  return (
    <JournalPageClient
      initialEntries={entries}
      initialHasMore={hasMore}
      initialCursor={nextCursor}
      initialFilters={filters}
    />
  );
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

      {/* Stats Cards - Stream independently */}
      <Suspense fallback={<JournalStatsSkeleton />}>
        <JournalStatsServer />
      </Suspense>

      {/* Journal Entries - Stream independently */}
      <Suspense fallback={<JournalEntriesSkeleton />}>
        <JournalEntriesServer filters={filters} />
      </Suspense>
    </div>
  );
}
