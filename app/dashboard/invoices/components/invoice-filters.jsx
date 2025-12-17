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
import { X, Filter } from "lucide-react";

// ============================================
// PAYMENT STATUS FILTER
// ============================================
export function PaymentStatusFilter({ currentStatus }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const handleStatusChange = (value) => {
    const params = new URLSearchParams(searchParams);
    params.set("paymentStatus", value);
    params.set("page", "1"); // Reset to first page
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs text-muted-foreground">Payment Status</Label>
      <Select value={currentStatus} onValueChange={handleStatusChange}>
        <SelectTrigger className="w-full md:w-[180px] bg-background border-border text-foreground">
          <Filter className="w-4 h-4 mr-2" />
          <SelectValue placeholder="All Status" />
        </SelectTrigger>
        <SelectContent className="bg-card border-border">
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="paid">Paid</SelectItem>
          <SelectItem value="unpaid">Unpaid</SelectItem>
          <SelectItem value="partial">Partial</SelectItem>
          <SelectItem value="overdue">Overdue</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ============================================
// INVOICE STATUS FILTER
// ============================================
export function InvoiceStatusFilter({ currentStatus }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const handleStatusChange = (value) => {
    const params = new URLSearchParams(searchParams);
    params.set("status", value);
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs text-muted-foreground">Invoice Status</Label>
      <Select value={currentStatus} onValueChange={handleStatusChange}>
        <SelectTrigger className="w-full md:w-[180px] bg-background border-border text-foreground">
          <Filter className="w-4 h-4 mr-2" />
          <SelectValue placeholder="All Status" />
        </SelectTrigger>
        <SelectContent className="bg-card border-border">
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="draft">Draft</SelectItem>
          <SelectItem value="sent">Sent</SelectItem>
          <SelectItem value="paid">Paid</SelectItem>
          <SelectItem value="cancelled">Cancelled</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ============================================
// DATE RANGE FILTER
// ============================================
export function InvoiceDateFilter({ startDate, endDate }) {
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
export function ClearInvoiceFiltersButton() {
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
export function InvoiceFilterBadge({ label, value, param }) {
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
