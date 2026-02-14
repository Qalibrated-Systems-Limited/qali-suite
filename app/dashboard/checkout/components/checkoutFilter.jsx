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
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Filter,
  X,
  Package,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Clock,
  Loader2,
} from "lucide-react";

// ============================================
// STATUS FILTER COMPONENT
// ============================================
export function CheckoutStatusFilter({ currentStatus }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleChange = (newValue) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", "1");

    if (newValue === "all") {
      params.delete("status");
    } else {
      params.set("status", newValue);
    }

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs text-muted-foreground">Status</Label>
      <Select value={currentStatus} onValueChange={handleChange} disabled={isPending}>
        <SelectTrigger className="w-full md:w-[200px] bg-background border-border text-foreground">
          {isPending ? (
            <Loader2 className="w-4 h-4 mr-2 text-muted-foreground animate-spin" />
          ) : (
            <Filter className="w-4 h-4 mr-2 text-muted-foreground" />
          )}
          <SelectValue placeholder="All Statuses" />
        </SelectTrigger>
        <SelectContent className="bg-card border-border">
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="checked_out">
            <div className="flex items-center">
              <Package className="w-3 h-3 mr-2 text-blue-500" />
              Checked Out
            </div>
          </SelectItem>
          <SelectItem value="returned">
            <div className="flex items-center">
              <CheckCircle className="w-3 h-3 mr-2 text-green-500" />
              Returned
            </div>
          </SelectItem>
          <SelectItem value="overdue">
            <div className="flex items-center">
              <AlertTriangle className="w-3 h-3 mr-2 text-red-500" />
              Overdue
            </div>
          </SelectItem>
          <SelectItem value="lost">
            <div className="flex items-center">
              <XCircle className="w-3 h-3 mr-2 text-gray-500" />
              Lost
            </div>
          </SelectItem>
          <SelectItem value="damaged">
            <div className="flex items-center">
              <AlertTriangle className="w-3 h-3 mr-2 text-orange-500" />
              Damaged
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ============================================
// DUE STATUS FILTER COMPONENT
// ============================================
export function CheckoutDueFilter({ currentDueStatus }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleChange = (newValue) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", "1");

    if (newValue === "all") {
      params.delete("dueStatus");
    } else {
      params.set("dueStatus", newValue);
    }

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs text-muted-foreground">Due Status</Label>
      <Select value={currentDueStatus} onValueChange={handleChange} disabled={isPending}>
        <SelectTrigger className="w-full md:w-[200px] bg-background border-border text-foreground">
          {isPending ? (
            <Loader2 className="w-4 h-4 mr-2 text-muted-foreground animate-spin" />
          ) : (
            <Filter className="w-4 h-4 mr-2 text-muted-foreground" />
          )}
          <SelectValue placeholder="All Items" />
        </SelectTrigger>
        <SelectContent className="bg-card border-border">
          <SelectItem value="all">All Items</SelectItem>
          <SelectItem value="due-soon">
            <div className="flex items-center">
              <Clock className="w-3 h-3 mr-2 text-orange-500" />
              Due Soon (3 days)
            </div>
          </SelectItem>
          <SelectItem value="overdue">
            <div className="flex items-center">
              <AlertTriangle className="w-3 h-3 mr-2 text-red-500" />
              Overdue
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ============================================
// CLEAR FILTERS BUTTON
// ============================================
export function ClearCheckoutFiltersButton() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleClear = () => {
    const params = new URLSearchParams(searchParams);
    params.delete("status");
    params.delete("dueStatus");
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
export function CheckoutFilterBadge({ label, value, param }) {
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
