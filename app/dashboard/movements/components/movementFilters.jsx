"use client";

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
import { Filter, X, Calendar } from "lucide-react";

// Movement Type Filter
export function MovementTypeFilter({ currentType }) {
  return (
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
  );
}

// Direction Filter
export function MovementDirectionFilter({ currentDirection }) {
  return (
    <MovementFilterSelect
      value={currentDirection}
      param="direction"
      placeholder="All Directions"
      options={[
        { value: "all", label: "All Directions" },
        { value: "in", label: "Stock In" },
        { value: "out", label: "Stock Out" },
      ]}
    />
  );
}

// Date Range Filter
export function MovementDateFilter({ startDate, endDate }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const handleDateChange = (field, value) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", "1");

    if (value) {
      params.set(field, value);
    } else {
      params.delete(field);
    }

    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex flex-col sm:flex-row gap-3 w-full">
      <div className="flex-1 space-y-2">
        <Label
          htmlFor="startDate"
          className="text-xs text-gray-400 flex items-center gap-1"
        >
          <Calendar className="w-3 h-3" />
          Start Date
        </Label>
        <Input
          id="startDate"
          type="date"
          value={startDate || ""}
          onChange={(e) => handleDateChange("startDate", e.target.value)}
          className="bg-[#0d1117] border-[#30363d] text-gray-100 focus:border-yellow-500 focus:ring-yellow-500"
        />
      </div>
      <div className="flex-1 space-y-2">
        <Label
          htmlFor="endDate"
          className="text-xs text-gray-400 flex items-center gap-1"
        >
          <Calendar className="w-3 h-3" />
          End Date
        </Label>
        <Input
          id="endDate"
          type="date"
          value={endDate || ""}
          onChange={(e) => handleDateChange("endDate", e.target.value)}
          className="bg-[#0d1117] border-[#30363d] text-gray-100 focus:border-yellow-500 focus:ring-yellow-500"
        />
      </div>
    </div>
  );
}

// Reusable Filter Select
function MovementFilterSelect({ value, param, placeholder, options }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const handleChange = (newValue) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", "1");

    if (newValue === "all") {
      params.delete(param);
    } else {
      params.set(param, newValue);
    }

    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger className="w-full  bg-[#0d1117] border-[#30363d] text-gray-100 focus:border-yellow-500 focus:ring-yellow-500">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <SelectValue placeholder={placeholder} />
        </div>
      </SelectTrigger>
      <SelectContent className="bg-[#161b22] border-[#30363d]">
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="text-gray-100 focus:bg-[#1f2937] focus:text-white"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Clear Filters Button
export function ClearMovementFiltersButton() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const handleClear = () => {
    const params = new URLSearchParams(searchParams);
    params.delete("movementType");
    params.delete("direction");
    params.delete("startDate");
    params.delete("endDate");
    params.set("page", "1");
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClear}
      className="text-yellow-500 hover:text-yellow-400 hover:bg-[#1f2937]"
    >
      <X className="w-4 h-4 mr-2" />
      Clear All
    </Button>
  );
}

// Filter Badge
export function MovementFilterBadge({ label, value, param }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const handleRemove = () => {
    const params = new URLSearchParams(searchParams);
    params.delete(param);
    params.set("page", "1");
    router.replace(`${pathname}?${params.toString()}`);
  };

  // Format the display value
  const displayValue = value.replace(/-/g, " ").replace(/_/g, " ");

  return (
    <div className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded-md text-xs">
      <span className="text-gray-400">{label}:</span>
      <span className="text-yellow-500 font-medium capitalize">
        {displayValue}
      </span>
      <button
        onClick={handleRemove}
        className="ml-1 text-gray-400 hover:text-yellow-500 transition-colors"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
