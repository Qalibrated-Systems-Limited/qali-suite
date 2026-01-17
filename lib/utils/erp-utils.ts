import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// ============================================
// CLASSNAME MERGE UTILITY
// ============================================
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ============================================
// FORMAT CURRENCY
// ============================================
interface FormatCurrencyOptions {
  currency?: string;
  locale?: string;
  compact?: boolean;
  showSign?: boolean;
}

export function formatCurrency(
  amount: number,
  options: FormatCurrencyOptions = {}
): string {
  const {
    currency = "KES",
    locale = "en-KE",
    compact = false,
    showSign = false,
  } = options;

  const absAmount = Math.abs(amount);
  const sign = amount < 0 ? "-" : showSign && amount > 0 ? "+" : "";

  if (compact) {
    // Compact notation for large numbers
    if (absAmount >= 1_000_000) {
      return `${sign}${currency} ${(absAmount / 1_000_000).toFixed(1)}M`;
    }
    if (absAmount >= 1_000) {
      return `${sign}${currency} ${(absAmount / 1_000).toFixed(1)}K`;
    }
    return `${sign}${currency} ${absAmount.toFixed(0)}`;
  }

  // Full format with Intl
  const formatted = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(absAmount);

  return `${sign}${formatted}`;
}

// ============================================
// FORMAT DATE
// ============================================
export function formatDate(
  date: Date | string,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const d = typeof date === "string" ? new Date(date) : date;

  const defaultOptions: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    ...options,
  };

  return d.toLocaleDateString("en-US", defaultOptions);
}

// ============================================
// RELATIVE TIME
// ============================================
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();

  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return formatDate(d);
}

// ============================================
// FORMAT NUMBER
// ============================================
export function formatNumber(
  value: number,
  options: { compact?: boolean; decimals?: number } = {}
): string {
  const { compact = false, decimals = 0 } = options;

  if (compact) {
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
      return `${(value / 1_000).toFixed(1)}K`;
    }
  }

  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ============================================
// PERCENTAGE
// ============================================
export function formatPercentage(
  value: number,
  options: { decimals?: number; showSign?: boolean } = {}
): string {
  const { decimals = 1, showSign = false } = options;
  const sign = showSign && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}
