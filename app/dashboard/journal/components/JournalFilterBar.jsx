"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
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
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Search, SlidersHorizontal, X, Calendar } from "lucide-react";
import { ENTRY_TYPE_CONFIG } from "./EntryTypeBadge";

const STATUS_OPTIONS = [
  { value: "all", label: "All Status" },
  { value: "draft", label: "Draft" },
  { value: "posted", label: "Posted" },
  { value: "reversed", label: "Reversed" },
];

const PERIOD_PRESETS = [
  { value: "all", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "this_year", label: "This Year" },
  { value: "custom", label: "Custom Range" },
];

export function JournalFilterBar({
  filters,
  onFiltersChange,
  resultCount,
}) {
  const [mobileFilters, setMobileFilters] = useState(filters);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const updateFilter = (key, value) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const clearAllFilters = () => {
    const cleared = {
      search: "",
      status: "all",
      entryType: "all",
      period: "all",
    };
    onFiltersChange(cleared);
    setMobileFilters(cleared);
  };

  const applyMobileFilters = () => {
    onFiltersChange(mobileFilters);
    setIsSheetOpen(false);
  };

  const activeFilterCount = [
    filters.status !== "all",
    filters.entryType !== "all",
    filters.period !== "all",
    filters.search.length > 0,
  ].filter(Boolean).length;

  const entryTypeOptions = [
    { value: "all", label: "All Types" },
    ...Object.entries(ENTRY_TYPE_CONFIG).map(([value, config]) => ({
      value,
      label: config.label,
    })),
  ];

  return (
    <div className="space-y-3">
      {/* Search + Filter Button Row */}
      <div className="flex items-center gap-2">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search entries..."
            value={filters.search}
            onChange={(e) => updateFilter("search", e.target.value)}
            className="pl-9 h-10"
          />
          {filters.search && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
              onClick={() => updateFilter("search", "")}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>

        {/* Mobile: Filter Sheet Trigger */}
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 sm:hidden relative"
            >
              <SlidersHorizontal className="h-4 w-4" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-[10px] font-medium text-primary-foreground flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-[70vh] rounded-t-xl">
            <SheetHeader className="pb-4">
              <SheetTitle className="flex items-center justify-between">
                <span>Filters</span>
                {activeFilterCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const cleared = {
                        search: "",
                        status: "all",
                        entryType: "all",
                        period: "all",
                      };
                      setMobileFilters(cleared);
                    }}
                  >
                    Clear All
                  </Button>
                )}
              </SheetTitle>
            </SheetHeader>

            <div className="space-y-4 py-4">
              {/* Period Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Period</label>
                <Select
                  value={mobileFilters.period}
                  onValueChange={(v) =>
                    setMobileFilters({ ...mobileFilters, period: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select period" />
                  </SelectTrigger>
                  <SelectContent>
                    {PERIOD_PRESETS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Status Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Status</label>
                <Select
                  value={mobileFilters.status}
                  onValueChange={(v) =>
                    setMobileFilters({ ...mobileFilters, status: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Entry Type Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Entry Type</label>
                <Select
                  value={mobileFilters.entryType}
                  onValueChange={(v) =>
                    setMobileFilters({ ...mobileFilters, entryType: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {entryTypeOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <SheetFooter className="absolute bottom-0 left-0 right-0 p-4 border-t bg-background">
              <div className="flex gap-2 w-full">
                <SheetClose asChild>
                  <Button variant="outline" className="flex-1">
                    Cancel
                  </Button>
                </SheetClose>
                <Button className="flex-1" onClick={applyMobileFilters}>
                  Apply
                  {resultCount !== undefined && ` (${resultCount})`}
                </Button>
              </div>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        {/* Desktop: Inline Filters */}
        <div className="hidden sm:flex items-center gap-2">
          <Select
            value={filters.period}
            onValueChange={(v) => updateFilter("period", v)}
          >
            <SelectTrigger className="w-36 h-10">
              <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
              <SelectValue placeholder="Period" />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_PRESETS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.status}
            onValueChange={(v) => updateFilter("status", v)}
          >
            <SelectTrigger className="w-32 h-10">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.entryType}
            onValueChange={(v) => updateFilter("entryType", v)}
          >
            <SelectTrigger className="w-40 h-10">
              <SelectValue placeholder="Entry Type" />
            </SelectTrigger>
            <SelectContent>
              {entryTypeOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Active Filters Display */}
      {activeFilterCount > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground">Active:</span>
          {filters.search && (
            <Badge variant="secondary" className="gap-1">
              Search: "{filters.search}"
              <X
                className="h-3 w-3 cursor-pointer"
                onClick={() => updateFilter("search", "")}
              />
            </Badge>
          )}
          {filters.status !== "all" && (
            <Badge variant="secondary" className="gap-1 capitalize">
              {filters.status}
              <X
                className="h-3 w-3 cursor-pointer"
                onClick={() => updateFilter("status", "all")}
              />
            </Badge>
          )}
          {filters.entryType !== "all" && (
            <Badge variant="secondary" className="gap-1">
              {ENTRY_TYPE_CONFIG[filters.entryType]?.label || filters.entryType}
              <X
                className="h-3 w-3 cursor-pointer"
                onClick={() => updateFilter("entryType", "all")}
              />
            </Badge>
          )}
          {filters.period !== "all" && (
            <Badge variant="secondary" className="gap-1">
              {PERIOD_PRESETS.find((p) => p.value === filters.period)?.label ||
                filters.period}
              <X
                className="h-3 w-3 cursor-pointer"
                onClick={() => updateFilter("period", "all")}
              />
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={clearAllFilters}
          >
            Clear All
          </Button>
        </div>
      )}
    </div>
  );
}
