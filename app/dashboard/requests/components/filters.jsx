"use client";

import { useTransition } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  X,
  Filter,
  CheckCircle,
  Clock,
  XCircle,
  AlertCircle,
  Loader2,
} from "lucide-react";

// ============================================
// STATUS FILTER
// ============================================
export function StatusFilter({ currentStatus }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleStatusChange = (value) => {
    const params = new URLSearchParams(searchParams);
    params.set("status", value);
    params.set("page", "1");

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs text-muted-foreground">Status</Label>
      <Select value={currentStatus} onValueChange={handleStatusChange} disabled={isPending}>
        <SelectTrigger className="w-full md:w-45 bg-background border-border text-foreground">
          {isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Filter className="w-4 h-4 mr-2" />
          )}
          <SelectValue placeholder="All Status" />
        </SelectTrigger>
        <SelectContent className="bg-card border-border">
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="pending">
            <div className="flex items-center">
              <Clock className="w-3 h-3 mr-2 text-yellow-500" />
              Pending
            </div>
          </SelectItem>
          <SelectItem value="approved">
            <div className="flex items-center">
              <CheckCircle className="w-3 h-3 mr-2 text-green-500" />
              Approved
            </div>
          </SelectItem>
          <SelectItem value="cancelled">
            <div className="flex items-center">
              <XCircle className="w-3 h-3 mr-2 text-red-500" />
              Rejected
            </div>
          </SelectItem>
          <SelectItem value="fulfilled">
            <div className="flex items-center">
              <CheckCircle className="w-3 h-3 mr-2 text-blue-500" />
              Fulfilled
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ============================================
// PRIORITY FILTER
// ============================================
export function PriorityFilter({ currentPriority }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handlePriorityChange = (value) => {
    const params = new URLSearchParams(searchParams);
    params.set("priority", value);
    params.set("page", "1");

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs text-muted-foreground">Priority</Label>
      <Select value={currentPriority} onValueChange={handlePriorityChange} disabled={isPending}>
        <SelectTrigger className="w-full md:w-45 bg-background border-border text-foreground">
          {isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Filter className="w-4 h-4 mr-2" />
          )}
          <SelectValue placeholder="All Priorities" />
        </SelectTrigger>
        <SelectContent className="bg-card border-border">
          <SelectItem value="all">All Priorities</SelectItem>
          <SelectItem value="low">
            <div className="flex items-center">
              <div className="w-2 h-2 rounded-full bg-gray-500 mr-2" />
              Low
            </div>
          </SelectItem>
          <SelectItem value="medium">
            <div className="flex items-center">
              <div className="w-2 h-2 rounded-full bg-yellow-500 mr-2" />
              Medium
            </div>
          </SelectItem>
          <SelectItem value="high">
            <div className="flex items-center">
              <AlertCircle className="w-3 h-3 mr-2 text-red-500" />
              High
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ============================================
// REQUEST TYPE FILTER
// ============================================
export function RequestTypeFilter({ currentType }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleTypeChange = (value) => {
    const params = new URLSearchParams(searchParams);
    params.set("type", value);
    params.set("page", "1");

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs text-muted-foreground">Type</Label>
      <Select value={currentType} onValueChange={handleTypeChange} disabled={isPending}>
        <SelectTrigger className="w-full md:w-45 bg-background border-border text-foreground">
          {isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Filter className="w-4 h-4 mr-2" />
          )}
          <SelectValue placeholder="All Types" />
        </SelectTrigger>
        <SelectContent className="bg-card border-border">
          <SelectItem value="all">All Types</SelectItem>
          <SelectItem value="sale">Sale</SelectItem>
          <SelectItem value="demo">Demo/Loan</SelectItem>
          <SelectItem value="installation">Installation</SelectItem>
          <SelectItem value="internal">Internal Use</SelectItem>
          <SelectItem value="repair">Repair/Service</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ============================================
// CLEAR FILTERS BUTTON
// ============================================
export function ClearFiltersButton() {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleClearFilters = () => {
    startTransition(() => {
      router.replace(pathname);
    });
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClearFilters}
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
export function FilterBadge({ label, value, param }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
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
      {isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
      {label}: {displayValue}
      {!isPending && <X className="w-3 h-3 ml-1" />}
    </Badge>
  );
}
