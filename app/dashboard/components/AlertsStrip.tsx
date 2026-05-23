import Link from "next/link";
import {
  AlertTriangle,
  Receipt,
  Package,
  Clock,
  Inbox,
  CheckSquare,
} from "lucide-react";
import { cDashboardAlerts } from "@/app/mongodb/queries/dashboard-cache";
import { cMyPendingApprovals } from "@/app/mongodb/queries/approval-queries";

// ============================================
// ALERTS STRIP
// ============================================
// Compact horizontal strip surfacing the highest-impact "needs attention"
// items. Renders only the alert types relevant to the caller's role —
// pass `show` to scope which alerts appear (e.g. CFO doesn't need stock
// alerts; Storekeeper doesn't need overdue invoice alerts).
//
// Per-card style is intentionally GitHub-ish: subtle bordered tiles, ring-1
// inset for status colors, mono numbers, compact padding.

type AlertKey =
  | "overdueInvoices"
  | "lowStockCount"
  | "pendingClaims"
  | "overdueCheckouts"
  | "pendingRequests"
  | "pendingApprovals";

interface AlertsStripProps {
  /** which alerts to render (and in what order). */
  show?: AlertKey[];
}

export const AlertsStripSkeleton = () => (
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
    {Array.from({ length: 4 }).map((_, i) => (
      <div
        key={i}
        className="h-16 animate-pulse rounded-lg border border-border bg-muted"
      />
    ))}
  </div>
);

export async function AlertsStrip({
  show = [
    "pendingApprovals",
    "overdueInvoices",
    "lowStockCount",
    "overdueCheckouts",
  ],
}: AlertsStripProps) {
  const [alerts, pendingApprovals] = await Promise.all([
    cDashboardAlerts(),
    cMyPendingApprovals(),
  ]);

  const tiles: Array<{
    key: AlertKey;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    href: string;
    tone: "warn" | "bad" | "neutral";
    value: number;
  }> = [
    {
      key: "overdueInvoices",
      label: "Overdue invoices",
      icon: Receipt,
      href: "/dashboard/reports/ar-aging",
      tone: alerts.overdueInvoices > 0 ? "bad" : "neutral",
      value: alerts.overdueInvoices || 0,
    },
    {
      key: "lowStockCount",
      label: "Low stock items",
      icon: Package,
      href: "/dashboard/stocks?quantity=low-stock",
      tone: alerts.lowStockCount > 0 ? "warn" : "neutral",
      value: alerts.lowStockCount || 0,
    },
    {
      key: "pendingClaims",
      label: "Pending claims",
      icon: Inbox,
      href: "/dashboard/claims",
      tone: alerts.pendingClaims > 0 ? "warn" : "neutral",
      value: alerts.pendingClaims || 0,
    },
    {
      key: "overdueCheckouts",
      label: "Overdue checkouts",
      icon: Clock,
      href: "/dashboard/checkout?filter=overdue",
      tone: alerts.overdueCheckouts > 0 ? "bad" : "neutral",
      value: alerts.overdueCheckouts || 0,
    },
    {
      key: "pendingRequests",
      label: "Pending requests",
      icon: AlertTriangle,
      href: "/dashboard/requests?status=pending",
      tone: alerts.pendingRequests > 0 ? "warn" : "neutral",
      value: alerts.pendingRequests || 0,
    },
    {
      key: "pendingApprovals",
      label: "Approvals",
      icon: CheckSquare,
      href: "/dashboard/approvals",
      tone: pendingApprovals > 0 ? "warn" : "neutral",
      value: pendingApprovals || 0,
    },
  ];

  const filtered = show
    .map((k) => tiles.find((t) => t.key === k))
    .filter(Boolean) as typeof tiles;

  if (filtered.length === 0) return null;

  return (
    <div
      className={`grid gap-2 sm:gap-3 ${
        filtered.length === 1
          ? "grid-cols-1"
          : filtered.length === 2
            ? "grid-cols-2"
            : filtered.length === 3
              ? "grid-cols-2 sm:grid-cols-3"
              : "grid-cols-2 sm:grid-cols-4"
      }`}
    >
      {filtered.map((t) => {
        const Icon = t.icon;
        const toneClass =
          t.tone === "bad"
            ? "border-red-500/30 bg-red-500/5"
            : t.tone === "warn"
              ? "border-amber-500/30 bg-amber-500/5"
              : "border-border bg-card";
        const labelTone =
          t.tone === "bad"
            ? "text-red-700 dark:text-red-400"
            : t.tone === "warn"
              ? "text-amber-700 dark:text-amber-400"
              : "text-muted-foreground";
        return (
          <Link
            key={t.key}
            href={t.href}
            className={`group rounded-lg border p-3 transition-colors hover:bg-muted/40 ${toneClass}`}
          >
            <div className="flex items-center gap-2">
              <Icon className={`h-3.5 w-3.5 ${labelTone}`} />
              <span
                className={`truncate text-[11px] font-medium uppercase tracking-wide ${labelTone}`}
              >
                {t.label}
              </span>
            </div>
            <p className="mt-1 text-lg font-semibold tabular-nums sm:text-xl">
              {t.value.toLocaleString()}
            </p>
          </Link>
        );
      })}
    </div>
  );
}
