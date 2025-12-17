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
import { Filter, X } from "lucide-react";

// Status Filter Component
export function StatusFilter({ currentStatus }) {
  return (
    <FilterSelect
      value={currentStatus}
      param="status"
      placeholder="All Statuses"
      options={[
        { value: "all", label: "All Statuses" },
        { value: "pending", label: "Pending" },
        { value: "approved", label: "Approved" },
        { value: "fulfilled", label: "Fulfilled" },
        { value: "partially_fulfilled", label: "Partially Fulfilled" },
        { value: "rejected", label: "Rejected" },
        { value: "cancelled", label: "Cancelled" },
      ]}
    />
  );
}

// Priority Filter Component
export function PriorityFilter({ currentPriority }) {
  return (
    <FilterSelect
      value={currentPriority}
      param="priority"
      placeholder="All Priorities"
      options={[
        { value: "all", label: "All Priorities" },
        { value: "low", label: "Low" },
        { value: "normal", label: "Normal" },
        { value: "high", label: "High" },
        { value: "urgent", label: "Urgent" },
      ]}
    />
  );
}

// Reusable Filter Select Component
function FilterSelect({ value, param, placeholder, options }) {
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
      <SelectTrigger className="w-full sm:w-[200px] bg-[#0d1117] border-[#30363d] text-gray-100 focus:border-yellow-500 focus:ring-yellow-500">
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

// Clear Filters Button Component
export function ClearFiltersButton() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const handleClear = () => {
    const params = new URLSearchParams(searchParams);
    params.delete("status");
    params.delete("priority");
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
      Clear Filters
    </Button>
  );
}

// Filter Badge Component
export function FilterBadge({ label, value, param }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const handleRemove = () => {
    const params = new URLSearchParams(searchParams);
    params.delete(param);
    params.set("page", "1");
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded-md text-xs">
      <span className="text-gray-400">{label}:</span>
      <span className="text-yellow-500 font-medium capitalize">
        {value.replace(/_/g, " ")}
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
