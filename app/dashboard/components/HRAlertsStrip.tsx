import Link from "next/link";
import {
  CalendarOff,
  Receipt,
  FileWarning,
  UserMinus,
} from "lucide-react";
import { getHrAlertCounts } from "@/app/db/actions/hr-employee-actions";
import { countClaimsAwaitingApprovalPg } from "@/app/db/actions/claim-actions";

// ============================================
// HR ALERTS STRIP
// ============================================
// HR-specific counterpart to the finance/inventory AlertsStrip.
// Surfaces the four highest-impact "needs attention" items for HR.

export const HRAlertsStripSkeleton = () => (
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
    {Array.from({ length: 4 }).map((_, i) => (
      <div
        key={i}
        className="h-16 animate-pulse rounded-lg border border-border bg-muted"
      />
    ))}
  </div>
);

/**
 * Both counts are Postgres, and each scopes itself through
 * withAuthorizedTenant — there is no tenant filter to write here.
 *
 * This replaced `cHRAlerts` in app/mongodb/queries/hr-alerts-queries.js, which
 * opened a Mongo connection and built `{ companyId: new ObjectId(companyId) }`
 * it then never used. Once companies became UUIDs the ObjectId cast threw on
 * every render — inside the query's own try/catch, so the strip reported four
 * zeros instead of failing. Leave and claims awaiting review have been showing
 * 0 however many were queued.
 */
export async function HRAlertsStrip() {
  const [hr, pendingClaims] = await Promise.all([
    getHrAlertCounts(),
    countClaimsAwaitingApprovalPg(),
  ]);
  const alerts = { ...hr, pendingClaims };

  const tiles = [
    {
      label: "Leave to review",
      icon: CalendarOff,
      href: "/dashboard/hr/leave?status=submitted",
      tone: alerts.pendingLeave > 0 ? "warn" : "neutral",
      value: alerts.pendingLeave || 0,
    },
    {
      label: "Claims to review",
      icon: Receipt,
      href: "/dashboard/claims?status=submitted",
      tone: alerts.pendingClaims > 0 ? "warn" : "neutral",
      value: alerts.pendingClaims || 0,
    },
    {
      label: "Contracts expiring",
      icon: FileWarning,
      href: "/dashboard/hr/employees?filter=contract-expiring",
      tone: alerts.contractsExpiring > 0 ? "bad" : "neutral",
      value: alerts.contractsExpiring || 0,
    },
    {
      label: "On leave today",
      icon: UserMinus,
      href: "/dashboard/hr/leave?status=approved",
      tone: "neutral",
      value: alerts.onLeaveToday || 0,
    },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
      {tiles.map((t) => {
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
            key={t.label}
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
