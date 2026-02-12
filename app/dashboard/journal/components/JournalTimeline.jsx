"use client";

import { useMemo } from "react";
import { format, isToday, isYesterday, parseISO } from "date-fns";
import { JournalEntryCard } from "./JournalEntryCard";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { FileX } from "lucide-react";

export function JournalTimeline({
  entries,
  isLoading = false,
  onPost,
  onReverse,
  onLoadMore,
  hasMore = false,
}) {
  // Group entries by date
  const groupedEntries = useMemo(() => {
    const groups = {};

    entries.forEach((entry) => {
      const date = format(parseISO(entry.entryDate), "yyyy-MM-dd");

      if (!groups[date]) {
        const entryDate = parseISO(entry.entryDate);
        let label;

        if (isToday(entryDate)) {
          label = "Today";
        } else if (isYesterday(entryDate)) {
          label = "Yesterday";
        } else {
          label = format(entryDate, "EEEE, MMMM d, yyyy");
        }

        groups[date] = {
          date,
          label,
          entries: [],
          totalDebits: 0,
          totalCredits: 0,
        };
      }

      groups[date].entries.push(entry);
      groups[date].totalDebits += entry.totalDebits || 0;
      groups[date].totalCredits += entry.totalCredits || 0;
    });

    // Sort by date descending and return
    return Object.values(groups).sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [entries]);

  const formatCurrency = (amount) => {
    if (amount >= 1000000) {
      return `${(amount / 1000000).toFixed(1)}M`;
    }
    if (amount >= 1000) {
      return `${(amount / 1000).toFixed(0)}K`;
    }
    return amount.toLocaleString();
  };

  if (isLoading && entries.length === 0) {
    return <TimelineSkeleton />;
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <FileX className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="font-semibold text-lg">No entries found</h3>
        <p className="text-muted-foreground text-sm mt-1">
          Try adjusting your filters or create a new entry
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groupedEntries.map((group) => (
        <div key={group.date}>
          {/* Date Header */}
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 h-px bg-border" />
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-muted">
              <span className="text-sm font-medium">{group.label}</span>
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {group.entries.length} {group.entries.length === 1 ? "entry" : "entries"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground hidden sm:flex">
              <span className="text-blue-600 dark:text-blue-400 font-medium">
                DR {formatCurrency(group.totalDebits)}
              </span>
              <span>|</span>
              <span className="text-green-600 dark:text-green-400 font-medium">
                CR {formatCurrency(group.totalCredits)}
              </span>
            </div>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Entries */}
          <div className="space-y-3">
            {group.entries.map((entry) => (
              <JournalEntryCard
                key={entry._id}
                entry={entry}
                onPost={onPost}
                onReverse={onReverse}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Load More */}
      {hasMore && (
        <div className="flex justify-center pt-4">
          <button
            onClick={onLoadMore}
            disabled={isLoading}
            className={cn(
              "px-4 py-2 text-sm font-medium rounded-lg",
              "bg-muted hover:bg-muted/80 transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {isLoading ? "Loading..." : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="space-y-6">
      {[1, 2].map((groupIndex) => (
        <div key={groupIndex}>
          {/* Date header skeleton */}
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 h-px bg-border" />
            <Skeleton className="h-7 w-32 rounded-full" />
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Entry cards skeleton */}
          <div className="space-y-3">
            {[1, 2, 3].map((cardIndex) => (
              <div
                key={cardIndex}
                className="rounded-lg border bg-card p-4 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-6 w-20" />
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </div>
                    <Skeleton className="h-4 w-48" />
                  </div>
                  <Skeleton className="h-8 w-8 rounded" />
                </div>
                <div className="space-y-1">
                  <Skeleton className="h-2 w-full rounded-full" />
                  <Skeleton className="h-2 w-3/4 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
