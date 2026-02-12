"use client";

import { Card } from "@/components/ui/card";
import {
  BookOpen,
  TrendingUp,
  FileEdit,
  RotateCcw,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export function JournalStatsCards({
  stats,
  isLoading = false,
}) {
  const formatNumber = (num) => {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toLocaleString();
  };

  const formatCurrency = (num) => {
    if (num >= 1000000) {
      return `KES ${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
      return `KES ${(num / 1000).toFixed(0)}K`;
    }
    return `KES ${num.toLocaleString()}`;
  };

  if (isLoading) {
    return <StatsCardsSkeleton />;
  }

  const cards = [
    {
      title: "Total Entries",
      value: formatNumber(stats?.totalEntries || 0),
      icon: BookOpen,
      color: "text-blue-600 dark:text-blue-400",
      bgColor: "bg-blue-50 dark:bg-blue-900/20",
      description: "All journal entries",
    },
    {
      title: "This Month",
      value: formatNumber(stats?.thisMonthEntries || 0),
      subValue: formatCurrency(stats?.thisMonthVolume || 0),
      icon: TrendingUp,
      color: "text-green-600 dark:text-green-400",
      bgColor: "bg-green-50 dark:bg-green-900/20",
      trend: stats?.trend,
    },
    {
      title: "Drafts",
      value: formatNumber(stats?.draftCount || 0),
      icon: FileEdit,
      color:
        (stats?.draftCount || 0) > 0
          ? "text-amber-600 dark:text-amber-400"
          : "text-gray-500",
      bgColor:
        (stats?.draftCount || 0) > 0
          ? "bg-amber-50 dark:bg-amber-900/20"
          : "bg-gray-50 dark:bg-gray-800/50",
      description: (stats?.draftCount || 0) > 0 ? "Pending review" : "All clear",
      highlight: (stats?.draftCount || 0) > 0,
    },
    {
      title: "Reversals",
      value: formatNumber(stats?.reversalCount || 0),
      icon: RotateCcw,
      color: "text-purple-600 dark:text-purple-400",
      bgColor: "bg-purple-50 dark:bg-purple-900/20",
      description: "This month",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
      {cards.map((card) => (
        <Card
          key={card.title}
          className={cn(
            "p-3 sm:p-4 transition-all hover:shadow-md",
            card.highlight && "ring-2 ring-amber-400 dark:ring-amber-500"
          )}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-xs sm:text-sm text-muted-foreground font-medium truncate">
                {card.title}
              </p>
              <p className="text-xl sm:text-2xl font-bold mt-1 tabular-nums">
                {card.value}
              </p>
              {card.subValue && (
                <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 truncate">
                  {card.subValue}
                </p>
              )}
              {card.trend !== undefined && (
                <div
                  className={cn(
                    "flex items-center gap-0.5 text-xs mt-1",
                    card.trend >= 0
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400"
                  )}
                >
                  {card.trend >= 0 ? (
                    <ArrowUpRight className="w-3 h-3" />
                  ) : (
                    <ArrowDownRight className="w-3 h-3" />
                  )}
                  <span>{Math.abs(card.trend)}% vs last month</span>
                </div>
              )}
              {card.description && !card.trend && (
                <p className="text-xs text-muted-foreground mt-1 hidden sm:block">
                  {card.description}
                </p>
              )}
            </div>
            <div className={cn("p-2 rounded-lg", card.bgColor)}>
              <card.icon className={cn("w-4 h-4 sm:w-5 sm:h-5", card.color)} />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function StatsCardsSkeleton() {
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
