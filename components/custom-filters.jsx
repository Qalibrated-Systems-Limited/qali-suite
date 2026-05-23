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
import { Filter, X, AlertTriangle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const CATEGORIES = [
  { value: "all", label: "All Categories" },
  { value: "loadcell", label: "Loadcell" },
  { value: "analytical balances", label: "Analytical Balances" },
  { value: "indicator", label: "Indicator" },
  { value: "Spare part", label: "Spare Part" },
  { value: "hanging scale", label: "Hanging Scale" },
  { value: "bench scale", label: "Bench Scale" },
  { value: "platform", label: "Platform" },
  { value: "Overview camera", label: "Overview Camera" },
  { value: "anpr camera", label: "ANPR Camera" },
  { value: "other stock", label: "Other Stock" },
  { value: "indicator batteries", label: "Indicator Batteries" },
];

const QUANTITY_OPTIONS = [
  { value: "all", label: "All Stock Levels", icon: null },
  { value: "in-stock", label: "In Stock", icon: "green" },
  { value: "low-stock", label: "Low Stock (≤ reorder level)", icon: "orange" },
  { value: "out-of-stock", label: "Out of Stock", icon: "red" },
];

// ============================================
// CATEGORY FILTER COMPONENT
// ============================================
export function StockCategoryFilter({ currentCategory, categories }) {
  // Use passed categories or fall back to hardcoded
  const options = categories || CATEGORIES;

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs text-muted-foreground">Category</Label>
      <StockFilterSelect
        value={currentCategory}
        param="category"
        placeholder="All Categories"
        options={options}
      />
    </div>
  );
}

// ============================================
// QUANTITY/STOCK LEVEL FILTER COMPONENT
// ============================================
export function StockQuantityFilter({ currentQuantity }) {
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs text-muted-foreground">Stock Level</Label>
      <StockFilterSelect
        value={currentQuantity}
        param="quantity"
        placeholder="All Stock Levels"
        options={QUANTITY_OPTIONS}
        showIcons={true}
      />
    </div>
  );
}

// ============================================
// REUSABLE FILTER SELECT COMPONENT
// ============================================
function StockFilterSelect({
  value,
  param,
  placeholder,
  options,
  showIcons = false,
}) {
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

    // Use startTransition to prevent Suspense fallback from showing
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <Select value={value} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger className="w-full md:w-45 bg-background border-border text-foreground focus-visible:ring-yellow-500 focus-visible:border-yellow-500">
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
            <div className="flex items-center gap-2">
              {showIcons && option.icon && (
                <div
                  className={`w-2 h-2 rounded-full ${
                    option.icon === "green"
                      ? "bg-green-500"
                      : option.icon === "orange"
                      ? "bg-orange-500"
                      : "bg-red-500"
                  }`}
                />
              )}
              {showIcons && option.value === "low-stock" && (
                <AlertTriangle className="w-3 h-3 text-orange-500" />
              )}
              <span>{option.label}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ============================================
// CLEAR FILTERS BUTTON COMPONENT
// ============================================
export function ClearStockFiltersButton() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleClear = () => {
    const params = new URLSearchParams(searchParams);
    params.delete("category");
    params.delete("quantity");
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
// FILTER BADGE COMPONENT
// ============================================
export function StockFilterBadge({ label, value, param }) {
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
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return (
    <Badge
      variant="secondary"
      className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/20 cursor-pointer"
      onClick={handleRemove}
    >
      {isPending ? (
        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
      ) : null}
      <span className="text-muted-foreground">{label}:</span>
      <span className="ml-1 font-medium">{displayValue}</span>
      {!isPending && <X className="w-3 h-3 ml-1" />}
    </Badge>
  );
}

// ============================================
// ALTERNATIVE: INLINE FILTER BADGE (Smaller)
// ============================================
export function StockFilterBadgeInline({ label, value, param }) {
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

  const displayValue = value.replace(/-/g, " ");

  return (
    <div className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded-md text-xs">
      <span className="text-muted-foreground">{label}:</span>
      <span className="text-yellow-600 dark:text-yellow-400 font-medium capitalize">
        {displayValue}
      </span>
      <button
        onClick={handleRemove}
        disabled={isPending}
        className="ml-1 text-muted-foreground hover:text-yellow-500 transition-colors disabled:opacity-50"
        aria-label={`Remove ${label} filter`}
      >
        {isPending ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <X className="w-3 h-3" />
        )}
      </button>
    </div>
  );
}
