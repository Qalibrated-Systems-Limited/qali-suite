"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Filter,
  X,
  Calendar,
  ArrowDownCircle,
  ArrowUpCircle,
  Loader2,
} from "lucide-react";

// ============================================
// MOVEMENT TYPE FILTER
// ============================================
export function MovementTypeFilter({ currentType }) {
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs text-muted-foreground">Movement Type</Label>
      <MovementFilterSelect
        value={currentType}
        param="movementType"
        placeholder="All Types"
        options={[
          { value: "all", label: "All Types" },
          { value: "issue", label: "Issue" },
          { value: "return", label: "Return" },
          { value: "sale", label: "Sale" },
          { value: "purchase", label: "Purchase" },
          { value: "adjustment", label: "Adjustment" },
          { value: "damage", label: "Damage" },
          { value: "transfer", label: "Transfer" },
          { value: "initial", label: "Initial Stock" },
        ]}
      />
    </div>
  );
}

// ============================================
// DIRECTION FILTER
// ============================================
export function MovementDirectionFilter({ currentDirection }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleChange = (newValue) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", "1");

    if (newValue === "all") {
      params.delete("direction");
    } else {
      params.set("direction", newValue);
    }

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs text-muted-foreground">Direction</Label>
      <Select value={currentDirection} onValueChange={handleChange} disabled={isPending}>
        <SelectTrigger className="w-full bg-background border-border text-foreground">
          {isPending ? (
            <Loader2 className="w-4 h-4 mr-2 text-muted-foreground animate-spin" />
          ) : (
            <Filter className="w-4 h-4 mr-2 text-muted-foreground" />
          )}
          <SelectValue placeholder="All Directions" />
        </SelectTrigger>
        <SelectContent className="bg-card border-border">
          <SelectItem value="all">All Directions</SelectItem>
          <SelectItem value="in">
            <div className="flex items-center">
              <ArrowDownCircle className="w-3 h-3 mr-2 text-green-500" />
              Stock In
            </div>
          </SelectItem>
          <SelectItem value="out">
            <div className="flex items-center">
              <ArrowUpCircle className="w-3 h-3 mr-2 text-red-500" />
              Stock Out
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ============================================
// DATE RANGE FILTER
// ============================================
export function MovementDateFilter({ startDate, endDate }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleDateChange = (field, value) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", "1");

    if (value) {
      params.set(field, value);
    } else {
      params.delete(field);
    }

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <div className="flex flex-col md:flex-row gap-3 w-full">
      <div className="flex-1 space-y-2">
        <Label
          htmlFor="startDate"
          className="text-xs text-muted-foreground flex items-center gap-1"
        >
          <Calendar className="w-3 h-3" />
          Start Date
        </Label>
        <Input
          id="startDate"
          type="date"
          value={startDate || ""}
          onChange={(e) => handleDateChange("startDate", e.target.value)}
          className="bg-background border-border text-foreground focus-visible:ring-yellow-500 focus-visible:border-yellow-500"
        />
      </div>
      <div className="flex-1 space-y-2">
        <Label
          htmlFor="endDate"
          className="text-xs text-muted-foreground flex items-center gap-1"
        >
          <Calendar className="w-3 h-3" />
          End Date
        </Label>
        <Input
          id="endDate"
          type="date"
          value={endDate || ""}
          onChange={(e) => handleDateChange("endDate", e.target.value)}
          className="bg-background border-border text-foreground focus-visible:ring-yellow-500 focus-visible:border-yellow-500"
        />
      </div>
    </div>
  );
}

// ============================================
// REUSABLE FILTER SELECT
// ============================================
function MovementFilterSelect({ value, param, placeholder, options }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleChange = (newValue) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", "1");

    if (newValue === "all") {
      params.delete(param);
    } else {
      params.set(param, newValue);
    }

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <Select value={value} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger className="w-full bg-background border-border text-foreground focus-visible:ring-yellow-500 focus-visible:border-yellow-500">
        <div className="flex items-center gap-2">
          {isPending ? (
            <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
          ) : (
            <Filter className="w-4 h-4 text-muted-foreground" />
          )}
          <SelectValue placeholder={placeholder} />
        </div>
      </SelectTrigger>
      <SelectContent className="bg-card border-border">
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="text-foreground focus:bg-accent focus:text-accent-foreground cursor-pointer"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ============================================
// CLEAR FILTERS BUTTON
// ============================================
export function ClearMovementFiltersButton() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleClear = () => {
    const params = new URLSearchParams(searchParams);
    params.delete("movementType");
    params.delete("direction");
    params.delete("startDate");
    params.delete("endDate");
    params.set("page", "1");

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClear}
      disabled={isPending}
      className="border-border text-foreground hover:bg-accent self-end"
    >
      {isPending ? (
        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
      ) : (
        <X className="w-4 h-4 mr-1" />
      )}
      Clear All
    </Button>
  );
}

// ============================================
// FILTER BADGE
// ============================================
export function MovementFilterBadge({ label, value, param }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleRemove = () => {
    const params = new URLSearchParams(searchParams);
    params.delete(param);
    params.set("page", "1");

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  };

  // Format the display value
  const displayValue = value
    .replace(/-/g, " ")
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return (
    <Badge
      variant="secondary"
      className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/20 cursor-pointer"
      onClick={handleRemove}
    >
      {isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
      <span className="text-muted-foreground">{label}:</span>
      <span className="ml-1 font-medium">{displayValue}</span>
      {!isPending && <X className="w-3 h-3 ml-1" />}
    </Badge>
  );
}
