"use client";

import { cn } from "@/lib/utils";

export function ReportTable({ children, className }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function ReportTableHeader({ children, className }) {
  return (
    <thead className={cn("bg-muted/50", className)}>
      <tr>{children}</tr>
    </thead>
  );
}

export function ReportTableHeaderCell({
  children,
  align = "left",
  className,
}) {
  return (
    <th
      className={cn(
        "px-4 py-3 font-semibold text-foreground border-b border-border",
        {
          "text-left": align === "left",
          "text-right": align === "right",
          "text-center": align === "center",
        },
        className
      )}
    >
      {children}
    </th>
  );
}

export function ReportTableBody({ children, className }) {
  return <tbody className={className}>{children}</tbody>;
}

export function ReportTableRow({
  children,
  className,
  isHeader = false,
  isTotal = false,
  isSubtotal = false,
  onClick,
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        "border-b border-border/50 transition-colors",
        {
          "bg-muted/30 font-semibold": isHeader,
          "bg-muted font-bold border-t-2 border-border": isTotal,
          "bg-muted/20 font-medium": isSubtotal,
          "hover:bg-muted/30 cursor-pointer": onClick,
        },
        className
      )}
    >
      {children}
    </tr>
  );
}

export function ReportTableCell({
  children,
  align = "left",
  className,
  indent = 0,
  isNegative = false,
}) {
  return (
    <td
      className={cn(
        "px-4 py-2.5",
        {
          "text-left": align === "left",
          "text-right": align === "right",
          "text-center": align === "center",
          "text-red-600 dark:text-red-400": isNegative,
        },
        className
      )}
      style={{ paddingLeft: indent > 0 ? `${indent * 1.5 + 1}rem` : undefined }}
    >
      {children}
    </td>
  );
}

// Summary card for report KPIs
export function ReportSummaryCard({
  label,
  value,
  subValue,
  trend,
  className,
}) {
  return (
    <div
      className={cn(
        "bg-card border border-border rounded-lg p-4",
        className
      )}
    >
      <p className="text-sm text-muted-foreground font-medium">{label}</p>
      <p className="mt-1 break-words text-lg font-bold tabular-nums sm:text-2xl">{value}</p>
      {subValue && (
        <p className="text-sm text-muted-foreground mt-1">{subValue}</p>
      )}
      {trend !== undefined && (
        <p
          className={cn(
            "text-sm mt-1",
            trend >= 0
              ? "text-green-600 dark:text-green-400"
              : "text-red-600 dark:text-red-400"
          )}
        >
          {trend >= 0 ? "+" : ""}
          {trend.toFixed(1)}% vs last period
        </p>
      )}
    </div>
  );
}

// Section header for grouping accounts
export function ReportSectionHeader({ title, total, className }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between px-4 py-3 bg-muted/50 border-y border-border font-semibold",
        className
      )}
    >
      <span>{title}</span>
      {total !== undefined && (
        <span className="tabular-nums">{formatCurrency(total)}</span>
      )}
    </div>
  );
}

// Format helpers
export function formatCurrency(amount, showSign = false) {
  const formatted = new Intl.NumberFormat("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.abs(amount));

  if (amount < 0) {
    return `(${formatted})`;
  }
  if (showSign && amount > 0) {
    return `+${formatted}`;
  }
  return formatted;
}

// Compact form for summary KPI cards on small screens — "12.35M" instead
// of "12,345,678", which overflows a half-width card on phones. Detail
// rows keep full precision; this is for headlines only.
export function formatCurrencyCompact(amount) {
  const formatted = new Intl.NumberFormat("en-KE", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(Math.abs(amount || 0));
  return amount < 0 ? `(${formatted})` : formatted;
}

export function formatPercent(value) {
  return `${value >= 0 ? "" : "-"}${Math.abs(value).toFixed(1)}%`;
}
