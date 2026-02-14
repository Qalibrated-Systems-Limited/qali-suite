"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Filter,
  X,
  FileText,
  Send,
  CheckCircle,
  Package,
  CheckCheck,
  XCircle,
  Clock,
  Loader2,
} from "lucide-react";

// ============================================
// STATUS TABS
// ============================================
export function POStatusTabs({ currentStatus, stats }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const handleStatusChange = (status) => {
    const params = new URLSearchParams(searchParams);
    if (status === "all") {
      params.delete("status");
    } else {
      params.set("status", status);
    }
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const tabs = [
    { value: "all", label: "All", count: stats.total, icon: FileText },
    { value: "draft", label: "Draft", count: stats.draft, icon: FileText },
    { value: "sent", label: "Sent", count: stats.sent, icon: Send },
    { value: "confirmed", label: "Confirmed", count: stats.confirmed, icon: CheckCircle },
    { value: "partial", label: "Partial", count: stats.partial, icon: Package },
    { value: "received", label: "Received", count: stats.received, icon: CheckCheck },
    { value: "cancelled", label: "Cancelled", count: stats.cancelled, icon: XCircle },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const isActive =
          currentStatus === tab.value ||
          (tab.value === "all" && !currentStatus);
        const Icon = tab.icon;

        return (
          <button
            key={tab.value}
            onClick={() => handleStatusChange(tab.value)}
            disabled={isPending}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors disabled:opacity-50 ${
              isActive
                ? "bg-primary text-primary-foreground"
                : "bg-muted hover:bg-muted/80 text-muted-foreground"
            }`}
          >
            {isPending && isActive ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Icon className="h-3.5 w-3.5" />
            )}
            {tab.label}
            {tab.count > 0 && (
              <span
                className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${
                  isActive
                    ? "bg-primary-foreground/20"
                    : "bg-background"
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ============================================
// DATE FILTER
// ============================================
export function PODateFilter({ startDate, endDate }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const handleDateChange = (field, value) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(field, value);
    } else {
      params.delete(field);
    }
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      <div className="flex items-center gap-2">
        <Label htmlFor="startDate" className="text-sm text-muted-foreground whitespace-nowrap">
          From:
        </Label>
        <Input
          id="startDate"
          type="date"
          value={startDate || ""}
          onChange={(e) => handleDateChange("startDate", e.target.value)}
          disabled={isPending}
          className="h-8 w-auto"
        />
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor="endDate" className="text-sm text-muted-foreground whitespace-nowrap">
          To:
        </Label>
        <Input
          id="endDate"
          type="date"
          value={endDate || ""}
          onChange={(e) => handleDateChange("endDate", e.target.value)}
          disabled={isPending}
          className="h-8 w-auto"
        />
      </div>
    </div>
  );
}

// ============================================
// QUICK FILTERS
// ============================================
export function POQuickFilters({ overdueCount, expiringCount }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const handleQuickFilter = (filter) => {
    const params = new URLSearchParams(searchParams);

    if (filter === "overdue") {
      params.set("overdue", "true");
      params.delete("expiring");
    } else if (filter === "expiring") {
      params.set("expiring", "true");
      params.delete("overdue");
    }
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex gap-2">
      {overdueCount > 0 && (
        <button
          onClick={() => handleQuickFilter("overdue")}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors"
        >
          <Clock className="h-3.5 w-3.5" />
          Overdue ({overdueCount})
        </button>
      )}
      {expiringCount > 0 && (
        <button
          onClick={() => handleQuickFilter("expiring")}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-orange-500/10 text-orange-600 dark:text-orange-400 hover:bg-orange-500/20 transition-colors"
        >
          <Clock className="h-3.5 w-3.5" />
          Expiring ({expiringCount})
        </button>
      )}
    </div>
  );
}

// ============================================
// CLEAR FILTERS BUTTON
// ============================================
export function ClearPOFiltersButton() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  // Check if any filters are active (excluding 'query')
  const hasFilters =
    searchParams.has("status") ||
    searchParams.has("startDate") ||
    searchParams.has("endDate") ||
    searchParams.has("overdue") ||
    searchParams.has("expiring");

  if (!hasFilters) return null;

  const clearFilters = () => {
    const params = new URLSearchParams();
    // Keep only query param if present
    const query = searchParams.get("query");
    if (query) params.set("query", query);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={clearFilters}
      disabled={isPending}
      className="h-8 text-muted-foreground hover:text-foreground"
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
      ) : (
        <X className="h-4 w-4 mr-1" />
      )}
      Clear Filters
    </Button>
  );
}

// ============================================
// FILTER BADGE
// ============================================
export function POFilterBadge({ label, value, param }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const removeFilter = () => {
    const params = new URLSearchParams(searchParams);
    params.delete(param);
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <Badge
      variant="secondary"
      className="flex items-center gap-1 pr-1 cursor-pointer hover:bg-muted"
      onClick={removeFilter}
    >
      {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium">{value}</span>
      {!isPending && <X className="h-3 w-3 ml-1 hover:text-destructive" />}
    </Badge>
  );
}

// ============================================
// MOBILE FILTER SHEET
// ============================================
export function MobileFilterSheet({
  stats,
  currentStatus,
  startDate,
  endDate,
  overdueCount,
  expiringCount,
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const [localStatus, setLocalStatus] = useState(currentStatus || "all");
  const [localStartDate, setLocalStartDate] = useState(startDate || "");
  const [localEndDate, setLocalEndDate] = useState(endDate || "");

  const applyFilters = () => {
    const params = new URLSearchParams();
    if (localStatus && localStatus !== "all") params.set("status", localStatus);
    if (localStartDate) params.set("startDate", localStartDate);
    if (localEndDate) params.set("endDate", localEndDate);
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
  };

  const clearFilters = () => {
    setLocalStatus("all");
    setLocalStartDate("");
    setLocalEndDate("");
    router.push(pathname);
    setOpen(false);
  };

  // Count active filters
  const activeFilters = [
    currentStatus && currentStatus !== "all",
    startDate,
    endDate,
  ].filter(Boolean).length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="sm:hidden relative">
          <Filter className="h-4 w-4" />
          {activeFilters > 0 && (
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">
              {activeFilters}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[80vh]">
        <SheetHeader>
          <SheetTitle>Filter Purchase Orders</SheetTitle>
          <SheetDescription>
            Apply filters to find specific purchase orders
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 py-6">
          {/* Status Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Status</Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: "all", label: "All", count: stats.total },
                { value: "draft", label: "Draft", count: stats.draft },
                { value: "sent", label: "Sent", count: stats.sent },
                { value: "confirmed", label: "Confirmed", count: stats.confirmed },
                { value: "partial", label: "Partial", count: stats.partial },
                { value: "received", label: "Received", count: stats.received },
                { value: "cancelled", label: "Cancelled", count: stats.cancelled },
              ].map((status) => (
                <button
                  key={status.value}
                  onClick={() => setLocalStatus(status.value)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    localStatus === status.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted hover:bg-muted/80"
                  }`}
                >
                  {status.label} ({status.count})
                </button>
              ))}
            </div>
          </div>

          {/* Date Range */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Date Range</Label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="mobileStartDate" className="text-xs text-muted-foreground">
                  From
                </Label>
                <Input
                  id="mobileStartDate"
                  type="date"
                  value={localStartDate}
                  onChange={(e) => setLocalStartDate(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="mobileEndDate" className="text-xs text-muted-foreground">
                  To
                </Label>
                <Input
                  id="mobileEndDate"
                  type="date"
                  value={localEndDate}
                  onChange={(e) => setLocalEndDate(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-4 border-t">
          <Button variant="outline" onClick={clearFilters} className="flex-1">
            Clear All
          </Button>
          <Button onClick={applyFilters} className="flex-1">
            Apply Filters
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
