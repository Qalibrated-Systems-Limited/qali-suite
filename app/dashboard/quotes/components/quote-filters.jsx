"use client";

import { useState } from "react";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { X, Calendar, Filter, ChevronDown, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

// Status configuration with colors
const STATUS_TABS = [
  { value: "all", label: "All", color: "gray" },
  { value: "draft", label: "Draft", color: "gray" },
  { value: "sent", label: "Sent", color: "blue" },
  { value: "accepted", label: "Accepted", color: "green" },
  { value: "converted", label: "Converted", color: "purple" },
  { value: "rejected", label: "Rejected", color: "red" },
  { value: "expired", label: "Expired", color: "orange" },
];

const getColorClasses = (color, isActive) => {
  const colors = {
    gray: isActive
      ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600"
      : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50",
    blue: isActive
      ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700"
      : "text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20",
    green: isActive
      ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-300 dark:border-green-700"
      : "text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20",
    purple: isActive
      ? "bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-700"
      : "text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20",
    red: isActive
      ? "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700"
      : "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20",
    orange: isActive
      ? "bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-700"
      : "text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20",
  };
  return colors[color] || colors.gray;
};

// Desktop: Horizontal tabs (lg and up)
// Tablet: Scrollable tabs (md)
// Mobile: Dropdown select (sm and below)
export function QuoteStatusTabs({ currentStatus, stats }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { replace } = useRouter();

  const handleStatusChange = (status) => {
    const params = new URLSearchParams(searchParams);
    if (status && status !== "all") {
      params.set("status", status);
    } else {
      params.delete("status");
    }
    params.set("page", "1");
    replace(`${pathname}?${params.toString()}`);
  };

  const getTabCount = (status) => {
    if (!stats) return null;
    switch (status) {
      case "all": return stats.total;
      case "draft": return stats.draft;
      case "sent": return stats.sent;
      case "accepted": return stats.accepted;
      case "converted": return stats.converted;
      case "rejected": return stats.rejected;
      case "expired": return stats.expired;
      default: return null;
    }
  };

  const activeStatus = currentStatus || "all";
  const activeTab = STATUS_TABS.find(t => t.value === activeStatus);

  return (
    <>
      {/* Mobile: Select dropdown */}
      <div className="block sm:hidden w-full">
        <Select value={activeStatus} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-full bg-background">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              <SelectValue placeholder="Filter by status" />
            </div>
          </SelectTrigger>
          <SelectContent>
            {STATUS_TABS.map((tab) => {
              const count = getTabCount(tab.value);
              return (
                <SelectItem key={tab.value} value={tab.value}>
                  <div className="flex items-center justify-between w-full gap-2">
                    <span>{tab.label}</span>
                    {count !== null && count > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {count}
                      </Badge>
                    )}
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Tablet: Scrollable horizontal tabs */}
      <div className="hidden sm:block lg:hidden overflow-x-auto pb-2 -mb-2">
        <div className="flex gap-1.5 min-w-max">
          {STATUS_TABS.map((tab) => {
            const isActive = activeStatus === tab.value;
            const count = getTabCount(tab.value);

            return (
              <button
                key={tab.value}
                onClick={() => handleStatusChange(tab.value)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-sm font-medium transition-all border whitespace-nowrap",
                  "flex items-center gap-1.5",
                  getColorClasses(tab.color, isActive),
                  isActive ? "border-current" : "border-transparent"
                )}
              >
                {tab.label}
                {count !== null && count > 0 && (
                  <span className={cn(
                    "text-xs px-1.5 py-0.5 rounded-full min-w-[20px] text-center",
                    isActive ? "bg-white/50 dark:bg-black/30" : "bg-current/10"
                  )}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Desktop: Full horizontal tabs */}
      <div className="hidden lg:flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => {
          const isActive = activeStatus === tab.value;
          const count = getTabCount(tab.value);

          return (
            <button
              key={tab.value}
              onClick={() => handleStatusChange(tab.value)}
              className={cn(
                "px-3 py-1.5 rounded-full text-sm font-medium transition-all border",
                "flex items-center gap-1.5",
                getColorClasses(tab.color, isActive),
                isActive ? "border-current" : "border-transparent"
              )}
            >
              {tab.label}
              {count !== null && count > 0 && (
                <span className={cn(
                  "text-xs px-1.5 py-0.5 rounded-full min-w-[20px] text-center",
                  isActive ? "bg-white/50 dark:bg-black/30" : "bg-current/10"
                )}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

// Responsive date filter
// Mobile: Stacked inputs
// Tablet+: Inline
export function QuoteDateFilter({ startDate, endDate }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { replace } = useRouter();

  const handleDateChange = (field, value) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(field, value);
    } else {
      params.delete(field);
    }
    params.set("page", "1");
    replace(`${pathname}?${params.toString()}`);
  };

  const clearDates = () => {
    const params = new URLSearchParams(searchParams);
    params.delete("startDate");
    params.delete("endDate");
    params.set("page", "1");
    replace(`${pathname}?${params.toString()}`);
  };

  const hasDateFilter = startDate || endDate;

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
        <Calendar className="h-4 w-4" />
        <span className="hidden sm:inline">Date Range:</span>
        <span className="sm:hidden">Dates</span>
      </div>

      {/* Mobile: Stacked */}
      <div className="flex flex-col sm:hidden gap-2 w-full">
        <Input
          type="date"
          value={startDate || ""}
          onChange={(e) => handleDateChange("startDate", e.target.value)}
          className="h-9 bg-background border-border text-sm"
          placeholder="Start date"
        />
        <Input
          type="date"
          value={endDate || ""}
          onChange={(e) => handleDateChange("endDate", e.target.value)}
          className="h-9 bg-background border-border text-sm"
          placeholder="End date"
        />
        {hasDateFilter && (
          <Button
            variant="outline"
            size="sm"
            onClick={clearDates}
            className="w-full"
          >
            <X className="h-4 w-4 mr-1" />
            Clear dates
          </Button>
        )}
      </div>

      {/* Tablet and up: Inline */}
      <div className="hidden sm:flex items-center gap-1.5">
        <Input
          type="date"
          value={startDate || ""}
          onChange={(e) => handleDateChange("startDate", e.target.value)}
          className="h-8 w-[130px] lg:w-[140px] bg-background border-border text-sm"
        />
        <span className="text-muted-foreground text-sm">to</span>
        <Input
          type="date"
          value={endDate || ""}
          onChange={(e) => handleDateChange("endDate", e.target.value)}
          className="h-8 w-[130px] lg:w-[140px] bg-background border-border text-sm"
        />
        {hasDateFilter && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 shrink-0"
            onClick={clearDates}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

// Quick filters with expiring soon indicator
export function QuoteQuickFilters({ expiringCount }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { replace } = useRouter();

  const isExpiringSoonActive = searchParams.get("expiringSoon") === "true";

  const toggleExpiringSoon = () => {
    const params = new URLSearchParams(searchParams);
    if (isExpiringSoonActive) {
      params.delete("expiringSoon");
    } else {
      params.set("expiringSoon", "true");
      params.delete("status");
    }
    params.set("page", "1");
    replace(`${pathname}?${params.toString()}`);
  };

  if (!expiringCount || expiringCount === 0) return null;

  return (
    <button
      onClick={toggleExpiringSoon}
      className={cn(
        "px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all flex items-center gap-1.5",
        isExpiringSoonActive
          ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 ring-1 ring-orange-300 dark:ring-orange-700"
          : "bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/30"
      )}
    >
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
      </span>
      <span className="hidden sm:inline">Expiring Soon</span>
      <span className="sm:hidden">Expiring</span>
      <span className="bg-orange-200 dark:bg-orange-800 px-1.5 rounded-full text-xs">
        {expiringCount}
      </span>
    </button>
  );
}

// Mobile filter sheet - all filters in one slide-out panel
export function MobileFilterSheet({ stats, currentStatus, startDate, endDate, expiringCount }) {
  const [open, setOpen] = useState(false);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { replace } = useRouter();

  const hasActiveFilters = (currentStatus && currentStatus !== "all") ||
                           startDate ||
                           endDate ||
                           searchParams.get("expiringSoon");

  const activeFilterCount = [
    currentStatus && currentStatus !== "all",
    startDate,
    endDate,
    searchParams.get("expiringSoon"),
  ].filter(Boolean).length;

  const handleStatusChange = (status) => {
    const params = new URLSearchParams(searchParams);
    if (status && status !== "all") {
      params.set("status", status);
    } else {
      params.delete("status");
    }
    params.set("page", "1");
    replace(`${pathname}?${params.toString()}`);
  };

  const handleDateChange = (field, value) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(field, value);
    } else {
      params.delete(field);
    }
    params.set("page", "1");
    replace(`${pathname}?${params.toString()}`);
  };

  const clearAllFilters = () => {
    replace(pathname);
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="sm:hidden relative">
          <SlidersHorizontal className="h-4 w-4 mr-2" />
          Filters
          {activeFilterCount > 0 && (
            <Badge
              variant="secondary"
              className="ml-2 h-5 w-5 p-0 flex items-center justify-center rounded-full bg-yellow-500 text-black"
            >
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[85vh] rounded-t-xl">
        <SheetHeader className="text-left">
          <SheetTitle>Filter Quotes</SheetTitle>
          <SheetDescription>
            Narrow down your quote list
          </SheetDescription>
        </SheetHeader>

        <div className="py-6 space-y-6 overflow-y-auto">
          {/* Status Filter */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-foreground">Status</label>
            <div className="grid grid-cols-2 gap-2">
              {STATUS_TABS.map((tab) => {
                const isActive = (currentStatus || "all") === tab.value;
                const count = stats?.[tab.value === "all" ? "total" : tab.value] || 0;

                return (
                  <button
                    key={tab.value}
                    onClick={() => handleStatusChange(tab.value)}
                    className={cn(
                      "px-3 py-2.5 rounded-lg text-sm font-medium transition-all border",
                      "flex items-center justify-between",
                      getColorClasses(tab.color, isActive),
                      isActive ? "border-current" : "border-border"
                    )}
                  >
                    <span>{tab.label}</span>
                    {count > 0 && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10">
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date Range */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-foreground">Date Range</label>
            <div className="space-y-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">From</label>
                <Input
                  type="date"
                  value={startDate || ""}
                  onChange={(e) => handleDateChange("startDate", e.target.value)}
                  className="bg-background"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">To</label>
                <Input
                  type="date"
                  value={endDate || ""}
                  onChange={(e) => handleDateChange("endDate", e.target.value)}
                  className="bg-background"
                />
              </div>
            </div>
          </div>

          {/* Quick Filters */}
          {expiringCount > 0 && (
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground">Quick Filters</label>
              <button
                onClick={() => {
                  const params = new URLSearchParams(searchParams);
                  const isActive = params.get("expiringSoon") === "true";
                  if (isActive) {
                    params.delete("expiringSoon");
                  } else {
                    params.set("expiringSoon", "true");
                    params.delete("status");
                  }
                  params.set("page", "1");
                  replace(`${pathname}?${params.toString()}`);
                }}
                className={cn(
                  "w-full px-4 py-3 rounded-lg text-sm font-medium transition-all flex items-center justify-between",
                  searchParams.get("expiringSoon") === "true"
                    ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 ring-1 ring-orange-300"
                    : "bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
                  </span>
                  Expiring Soon
                </div>
                <Badge variant="secondary">{expiringCount}</Badge>
              </button>
            </div>
          )}
        </div>

        <SheetFooter className="flex-row gap-2 sm:flex-row">
          {hasActiveFilters && (
            <Button
              variant="outline"
              onClick={clearAllFilters}
              className="flex-1"
            >
              Clear All
            </Button>
          )}
          <SheetClose asChild>
            <Button className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black">
              Apply Filters
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// Clear all filters button - shown on tablet and desktop
export function ClearQuoteFiltersButton() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { replace } = useRouter();

  const hasFilters = searchParams.get("status") ||
                     searchParams.get("startDate") ||
                     searchParams.get("endDate") ||
                     searchParams.get("expiringSoon");

  if (!hasFilters) return null;

  const handleClear = () => {
    replace(pathname);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClear}
      className="h-8 text-muted-foreground hover:text-foreground hidden sm:flex"
    >
      <X className="h-4 w-4 mr-1" />
      Clear all
    </Button>
  );
}

// Filter badge for showing active filters
export function QuoteFilterBadge({ label, value, param }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { replace } = useRouter();

  const handleRemove = () => {
    const params = new URLSearchParams(searchParams);
    params.delete(param);
    params.set("page", "1");
    replace(`${pathname}?${params.toString()}`);
  };

  return (
    <Badge
      variant="secondary"
      className="flex items-center gap-1 px-2 py-1 bg-muted hover:bg-muted/80 cursor-pointer group"
      onClick={handleRemove}
    >
      <span className="text-xs font-normal text-muted-foreground">{label}:</span>
      <span className="text-xs font-medium capitalize">{value}</span>
      <X className="h-3 w-3 ml-1 text-muted-foreground group-hover:text-destructive transition-colors" />
    </Badge>
  );
}

// Legacy export for backwards compatibility
export const QuoteStatusFilter = QuoteStatusTabs;
