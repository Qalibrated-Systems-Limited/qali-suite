"use client";

import { useState, useCallback, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  JournalFilterBar,
  JournalTimeline,
  JournalTableView,
  JournalGroupedView,
  JournalViewToggle,
} from "./components";

export function JournalPageClient({
  initialEntries,
  initialHasMore,
  initialCursor,
  initialFilters,
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [entries, setEntries] = useState(initialEntries);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [cursor, setCursor] = useState(initialCursor);
  const [filters, setFilters] = useState(initialFilters);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // View state
  const [viewMode, setViewMode] = useState("timeline");
  const [groupBy, setGroupBy] = useState("type");

  // Sync state with props when server returns new data (e.g., after filter change)
  useEffect(() => {
    setEntries(initialEntries);
    setHasMore(initialHasMore);
    setCursor(initialCursor);
    setFilters(initialFilters);
  }, [initialEntries, initialHasMore, initialCursor, initialFilters]);

  // Update URL when filters change
  const handleFiltersChange = useCallback(
    (newFilters) => {
      setFilters(newFilters);

      // Build URL params
      const params = new URLSearchParams();
      if (newFilters.search) params.set("search", newFilters.search);
      if (newFilters.status !== "all") params.set("status", newFilters.status);
      if (newFilters.entryType !== "all")
        params.set("entryType", newFilters.entryType);
      if (newFilters.period !== "all") params.set("period", newFilters.period);

      // Update URL and trigger server refetch
      startTransition(() => {
        router.push(`/dashboard/journal?${params.toString()}`);
      });
    },
    [router]
  );

  // Load more entries
  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || !cursor) return;

    setIsLoadingMore(true);
    try {
      const params = new URLSearchParams();
      params.set("cursor", cursor);
      if (filters.search) params.set("search", filters.search);
      if (filters.status !== "all") params.set("status", filters.status);
      if (filters.entryType !== "all")
        params.set("entryType", filters.entryType);
      if (filters.period !== "all") params.set("period", filters.period);

      const response = await fetch(
        `/api/journal/timeline?${params.toString()}`
      );
      const data = await response.json();

      if (data.entries) {
        setEntries((prev) => [...prev, ...data.entries]);
        setHasMore(data.hasMore);
        setCursor(data.nextCursor);
      }
    } catch (error) {
      toast.error("Failed to load more entries");
    } finally {
      setIsLoadingMore(false);
    }
  }, [cursor, filters, hasMore, isLoadingMore]);

  // Post entry action
  const handlePost = useCallback(
    async (entryId) => {
      try {
        const response = await fetch(`/api/journal/${entryId}/post`, {
          method: "POST",
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to post entry");
        }

        toast.success("Entry posted successfully");
        // Refresh the page to get updated data
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to post entry"
        );
      }
    },
    [router]
  );

  // Reverse entry action
  const handleReverse = useCallback(
    async (entryId) => {
      // In a real app, you'd show a dialog to get the reversal reason
      const reason = prompt("Enter reason for reversal:");
      if (!reason) return;

      try {
        const response = await fetch(`/api/journal/${entryId}/reverse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to reverse entry");
        }

        toast.success("Entry reversed successfully");
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to reverse entry"
        );
      }
    },
    [router]
  );

  // Render the appropriate view based on viewMode
  const renderView = () => {
    const commonProps = {
      entries,
      isLoading: isPending || isLoadingMore,
      onPost: handlePost,
      onReverse: handleReverse,
      onLoadMore: handleLoadMore,
      hasMore,
    };

    switch (viewMode) {
      case "table":
        return <JournalTableView {...commonProps} />;
      case "grouped":
        return <JournalGroupedView {...commonProps} groupBy={groupBy} />;
      case "timeline":
      default:
        return <JournalTimeline {...commonProps} />;
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Filter Bar + View Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1">
          <JournalFilterBar
            filters={filters}
            onFiltersChange={handleFiltersChange}
            resultCount={entries.length}
          />
        </div>
        <JournalViewToggle
          view={viewMode}
          onViewChange={setViewMode}
          groupBy={groupBy}
          onGroupByChange={setGroupBy}
        />
      </div>

      {/* Dynamic View */}
      {renderView()}
    </div>
  );
}
