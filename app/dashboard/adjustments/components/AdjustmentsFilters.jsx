"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, X, Loader2 } from "lucide-react";

const ADJUSTMENT_TYPES = [
  { value: "all", label: "All Types" },
  { value: "physical_count", label: "Physical Count" },
  { value: "damage", label: "Damage" },
  { value: "expiry", label: "Expiry" },
  { value: "theft", label: "Theft/Loss" },
  { value: "correction", label: "Correction" },
  { value: "write_off", label: "Write Off" },
  { value: "found", label: "Found" },
  { value: "other", label: "Other" },
];

const STATUSES = [
  { value: "all", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "cancelled", label: "Cancelled" },
];

export function AdjustmentsFilters({
  currentStatus = "all",
  currentType = "all",
  currentSearch = "",
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(currentSearch);

  const updateFilters = (updates) => {
    const params = new URLSearchParams(searchParams.toString());

    // Reset to page 1 when filtering
    params.delete("page");

    Object.entries(updates).forEach(([key, value]) => {
      if (value && value !== "all" && value !== "") {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });

    startTransition(() => {
      router.push(`/dashboard/adjustments?${params.toString()}`);
    });
  };

  const handleSearch = (e) => {
    e.preventDefault();
    updateFilters({ search });
  };

  const clearFilters = () => {
    setSearch("");
    startTransition(() => {
      router.push("/dashboard/adjustments");
    });
  };

  const hasFilters =
    currentStatus !== "all" || currentType !== "all" || currentSearch;

  return (
    <div className="flex flex-col sm:flex-row gap-3 mb-6">
      {/* Search */}
      <form onSubmit={handleSearch} className="flex-1 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search adjustments..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-background"
          />
        </div>
        <Button type="submit" variant="outline" disabled={isPending}>
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Search"
          )}
        </Button>
      </form>

      {/* Type Filter */}
      <Select
        value={currentType}
        onValueChange={(value) => updateFilters({ type: value })}
      >
        <SelectTrigger className="w-full sm:w-[160px] bg-background">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          {ADJUSTMENT_TYPES.map((type) => (
            <SelectItem key={type.value} value={type.value}>
              {type.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Status Filter */}
      <Select
        value={currentStatus}
        onValueChange={(value) => updateFilters({ status: value })}
      >
        <SelectTrigger className="w-full sm:w-[140px] bg-background">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          {STATUSES.map((status) => (
            <SelectItem key={status.value} value={status.value}>
              {status.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Clear Filters */}
      {hasFilters && (
        <Button
          variant="ghost"
          size="icon"
          onClick={clearFilters}
          className="shrink-0"
          title="Clear filters"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
