import { Suspense } from "react";
import Link from "next/link";
import { auth } from "@/auth";
import { FINANCE_WRITE_ROLES } from "@/lib/utils/role-gates";
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
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Journal Entries</h1>
        {FINANCE_WRITE_ROLES.includes(session.user.role as string) && (
          <Button asChild size="sm">
            <Link href="/dashboard/journal/create">
              <Plus className="h-3.5 w-3.5 mr-1.5" />
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
