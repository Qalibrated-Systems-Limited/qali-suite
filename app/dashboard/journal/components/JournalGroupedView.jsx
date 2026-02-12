"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  CheckCircle2,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn, formatCurrency } from "@/lib/utils";
import { ENTRY_TYPE_CONFIG, EntryTypeBadge } from "./EntryTypeBadge";
import { StatusBadge } from "./StatusBadge";

export function JournalGroupedView({
  entries,
  isLoading,
  onPost,
  onReverse,
  onLoadMore,
  hasMore,
  groupBy = "type",
}) {
  const router = useRouter();
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const groupedData = useMemo(() => {
    const groups = new Map();

    entries.forEach((entry) => {
      let key;
      switch (groupBy) {
        case "status":
          key = entry.status;
          break;
        case "date":
          key = new Date(entry.entryDate).toISOString().split("T")[0];
          break;
        case "type":
        default:
          key = entry.entryType;
          break;
      }

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(entry);
    });

    return Array.from(groups.entries()).map(([key, groupEntries]) => {
      let label = key;
      let icon;
      let color;
      let bgColor;

      if (groupBy === "type") {
        const config = ENTRY_TYPE_CONFIG[key];
        if (config) {
          label = config.label;
          icon = config.icon;
          color = config.color;
          bgColor = config.bgColor;
        }
      } else if (groupBy === "status") {
        label = key.charAt(0).toUpperCase() + key.slice(1);
        if (key === "draft") {
          color = "text-yellow-700";
          bgColor = "bg-yellow-100";
        } else if (key === "posted") {
          color = "text-green-700";
          bgColor = "bg-green-100";
        } else if (key === "reversed") {
          color = "text-red-700";
          bgColor = "bg-red-100";
        }
      } else if (groupBy === "date") {
        const date = new Date(key);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.toDateString() === today.toDateString()) {
          label = "Today";
        } else if (date.toDateString() === yesterday.toDateString()) {
          label = "Yesterday";
        } else {
          label = date.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          });
        }
      }

      return {
        key,
        label,
        icon,
        color,
        bgColor,
        entries: groupEntries,
        totalDebits: groupEntries.reduce((sum, e) => sum + e.totalDebits, 0),
        totalCredits: groupEntries.reduce((sum, e) => sum + e.totalCredits, 0),
      };
    });
  }, [entries, groupBy]);

  const toggleGroup = (key) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedGroups(newExpanded);
  };

  const expandAll = () => {
    setExpandedGroups(new Set(groupedData.map((g) => g.key)));
  };

  const collapseAll = () => {
    setExpandedGroups(new Set());
  };

  if (entries.length === 0 && !isLoading) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No journal entries found</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Expand/Collapse Controls */}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={expandAll}>
          Expand All
        </Button>
        <Button variant="ghost" size="sm" onClick={collapseAll}>
          Collapse All
        </Button>
      </div>

      {/* Grouped Sections */}
      <div className="space-y-3">
        {groupedData.map((group) => {
          const Icon = group.icon;
          const isExpanded = expandedGroups.has(group.key);

          return (
            <Collapsible
              key={group.key}
              open={isExpanded}
              onOpenChange={() => toggleGroup(group.key)}
            >
              <Card className="overflow-hidden">
                {/* Group Header */}
                <CollapsibleTrigger asChild>
                  <button className="w-full p-4 flex items-center gap-3 hover:bg-muted/50 transition-colors">
                    {isExpanded ? (
                      <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                    )}

                    {Icon && (
                      <div
                        className={cn(
                          "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                          group.bgColor || "bg-muted"
                        )}
                      >
                        <Icon className={cn("w-5 h-5", group.color)} />
                      </div>
                    )}

                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{group.label}</span>
                        <span className="text-sm text-muted-foreground">
                          ({group.entries.length}{" "}
                          {group.entries.length === 1 ? "entry" : "entries"})
                        </span>
                      </div>
                    </div>

                    <div className="hidden sm:flex items-center gap-6 text-sm">
                      <div>
                        <span className="text-muted-foreground mr-2">DR</span>
                        <span className="font-mono font-medium text-blue-600">
                          {formatCurrency(group.totalDebits)}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground mr-2">CR</span>
                        <span className="font-mono font-medium text-green-600">
                          {formatCurrency(group.totalCredits)}
                        </span>
                      </div>
                    </div>
                  </button>
                </CollapsibleTrigger>

                {/* Group Content */}
                <CollapsibleContent>
                  <div className="border-t divide-y">
                    {group.entries.map((entry) => (
                      <div
                        key={entry._id}
                        className="p-4 hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => router.push(`/dashboard/journal/${entry._id}`)}
                      >
                        <div className="flex items-start gap-4">
                          {/* Entry Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-sm font-medium">
                                {entry.entryNumber}
                              </span>
                              <StatusBadge status={entry.status} size="sm" />
                              {groupBy !== "type" && (
                                <EntryTypeBadge type={entry.entryType} size="sm" />
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              {formatDate(entry.entryDate)}
                              {entry.party && ` • ${entry.party.name}`}
                            </p>
                            <p className="text-sm mt-1 line-clamp-1">
                              {entry.description}
                            </p>
                          </div>

                          {/* Amounts */}
                          <div className="text-right shrink-0">
                            <div className="flex flex-col gap-1 text-sm">
                              <div>
                                <span className="text-muted-foreground text-xs">DR </span>
                                <span className="font-mono text-blue-600">
                                  {formatCurrency(entry.totalDebits)}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground text-xs">CR </span>
                                <span className="font-mono text-green-600">
                                  {formatCurrency(entry.totalCredits)}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Actions */}
                          <div
                            className="flex items-center gap-1 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() =>
                                router.push(`/dashboard/journal/${entry._id}`)
                              }
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            {entry.status === "draft" && onPost && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-green-600 hover:text-green-700"
                                onClick={() => onPost(entry._id)}
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </Button>
                            )}
                            {entry.status === "posted" && onReverse && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-red-600 hover:text-red-700"
                                onClick={() => onReverse(entry._id)}
                              >
                                <RotateCcw className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          );
        })}
      </div>

      {/* Load More */}
      {hasMore && (
        <div className="flex justify-center pt-4">
          <Button
            variant="outline"
            onClick={onLoadMore}
            disabled={isLoading}
            className="min-w-[200px]"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Loading...
              </>
            ) : (
              "Load More Entries"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
