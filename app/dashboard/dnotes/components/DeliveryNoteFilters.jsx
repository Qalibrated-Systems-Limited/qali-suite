"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X, Filter, PackageCheck, TruckIcon } from "lucide-react";

// ============================================
// RETURN TYPE FILTER
// ============================================
export function ReturnTypeFilter({ currentType }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const handleTypeChange = (value) => {
    const params = new URLSearchParams(searchParams);
    params.set("returnType", value);
    params.set("page", "1"); // Reset to first page
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs text-muted-foreground">Type</Label>
      <Select value={currentType} onValueChange={handleTypeChange}>
        <SelectTrigger className="w-full md:w-[180px] bg-background border-border text-foreground">
          <Filter className="w-4 h-4 mr-2" />
          <SelectValue placeholder="All Types" />
        </SelectTrigger>
        <SelectContent className="bg-card border-border">
          <SelectItem value="all">All Types</SelectItem>
          <SelectItem value="sold">
            <div className="flex items-center">
              <PackageCheck className="w-4 h-4 mr-2 text-green-500" />
              Sold
            </div>
          </SelectItem>
          <SelectItem value="returnable">
            <div className="flex items-center">
              <TruckIcon className="w-4 h-4 mr-2 text-orange-500" />
              Returnable
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ============================================
// REASON FILTER
// ============================================
export function ReasonFilter({ currentReason, reasons = [] }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const handleReasonChange = (value) => {
    const params = new URLSearchParams(searchParams);
    params.set("reason", value);
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  };

  if (reasons.length === 0) {
    return null; // Don't show if no reasons available
  }

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs text-muted-foreground">Reason</Label>
      <Select value={currentReason} onValueChange={handleReasonChange}>
        <SelectTrigger className="w-full md:w-[180px] bg-background border-border text-foreground">
          <Filter className="w-4 h-4 mr-2" />
          <SelectValue placeholder="All Reasons" />
        </SelectTrigger>
        <SelectContent className="bg-card border-border">
          <SelectItem value="all">All Reasons</SelectItem>
          {reasons.map((reason) => (
            <SelectItem key={reason} value={reason}>
              {reason}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ============================================
// TECHNICIAN FILTER
// ============================================
export function TechnicianFilter({ currentTechnician, technicians = [] }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const handleTechnicianChange = (value) => {
    const params = new URLSearchParams(searchParams);
    if (value && value !== "all") {
      params.set("technician", value);
    } else {
      params.delete("technician");
    }
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  };

  if (technicians.length === 0) {
    return null; // Don't show if no technicians available
  }

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs text-muted-foreground">Technician</Label>
      <Select
        value={currentTechnician || "all"}
        onValueChange={handleTechnicianChange}
      >
        <SelectTrigger className="w-full md:w-[180px] bg-background border-border text-foreground">
          <Filter className="w-4 h-4 mr-2" />
          <SelectValue placeholder="All Technicians" />
        </SelectTrigger>
        <SelectContent className="bg-card border-border">
          <SelectItem value="all">All Technicians</SelectItem>
          {technicians.map((tech) => (
            <SelectItem key={tech} value={tech}>
              {tech}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ============================================
// DATE RANGE FILTER
// ============================================
export function DNoteDateFilter({ startDate, endDate }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const handleDateChange = (field, value) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(field, value);
    } else {
      params.delete(field);
    }
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex flex-col md:flex-row gap-3">
      <div className="flex flex-col gap-2">
        <Label className="text-xs text-muted-foreground">Start Date</Label>
        <Input
          type="date"
          value={startDate}
          onChange={(e) => handleDateChange("startDate", e.target.value)}
          className="bg-background border-border text-foreground"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label className="text-xs text-muted-foreground">End Date</Label>
        <Input
          type="date"
          value={endDate}
          onChange={(e) => handleDateChange("endDate", e.target.value)}
          className="bg-background border-border text-foreground"
        />
      </div>
    </div>
  );
}

// ============================================
// CLEAR FILTERS BUTTON
// ============================================
export function ClearDNoteFiltersButton() {
  const pathname = usePathname();
  const router = useRouter();

  const handleClearFilters = () => {
    router.push(pathname);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClearFilters}
      className="border-border text-foreground hover:bg-accent"
    >
      <X className="w-4 h-4 mr-1" />
      Clear All
    </Button>
  );
}

// ============================================
// FILTER BADGE
// ============================================
export function DNoteFilterBadge({ label, value, param }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const handleRemove = () => {
    const params = new URLSearchParams(searchParams);
    params.delete(param);
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  };

  const displayValue =
    typeof value === "string"
      ? value.charAt(0).toUpperCase() + value.slice(1)
      : value;

  return (
    <Badge
      variant="secondary"
      className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/20 cursor-pointer"
      onClick={handleRemove}
    >
      {label}: {displayValue}
      <X className="w-3 h-3 ml-1" />
    </Badge>
  );
}
