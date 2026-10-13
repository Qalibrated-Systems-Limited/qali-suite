import Link from "next/link";
import { Card } from "@/components/ui/card";
import {
  ShieldCheck,
  AlertTriangle,
  Archive,
  Tags,
  ArrowRight,
  BarChart3,
} from "lucide-react";
import {
  getProjectStats,
  getProjectFindings,
} from "@/app/db/actions/project-actions";
import { StatusDonut, MoneyBars } from "./PortfolioCharts";

/**
 * The portfolio dashboard — the module's home above the register.
 *
 * It answers three questions at a glance: what is the shape of the portfolio
 * (status mix), where is the money (budget vs committed vs spent vs certified),
 * and what needs attention (findings). Everything is a shortcut: the findings
 * banner and each analytics card deep-link to the screen that owns the detail,
 * so the dashboard is a way IN, not a dead end.
 *
 * Deliberately light: two small charts and a figure strip, not a wall of
 * gauges. The heavy per-project analysis lives on each project's own pages.
 */

const SHORTCUTS = [
  {
    href: "/dashboard/projects/sealed-budgets",
    label: "Sealed budgets",
    hint: "Approved budgets, margins & variance",
    icon: ShieldCheck,
    tone: "text-emerald-600 dark:text-emerald-500",
  },
  {
    href: "/dashboard/projects/findings",
    label: "Findings",
    hint: "Jobs with no budget, no margin or overspent",
    icon: AlertTriangle,
    tone: "text-amber-600 dark:text-amber-500",
    badgeKey: "findings",
  },
  {
    href: "/dashboard/projects/archive",
    label: "Completed",
    hint: "Closed-out jobs and their final record",
    icon: Archive,
    tone: "text-blue-600 dark:text-blue-500",
  },
  {
    href: "/dashboard/projects/cost-codes",
    label: "Cost codes",
    hint: "The vocabulary a budget is built from",
    icon: Tags,
    tone: "text-violet-600 dark:text-violet-500",
  },
];

function FindingsBanner({ findings }) {
  if (!findings || findings.total === 0) return null;
  const parts = [];
  if (findings.noApprovedBudget.length)
    parts.push(`${findings.noApprovedBudget.length} with no approved budget`);
  if (findings.noMargin.length) parts.push(`${findings.noMargin.length} with no margin`);
  if (findings.overspent.length) parts.push(`${findings.overspent.length} overspent`);
  if (findings.thinMargin.length) parts.push(`${findings.thinMargin.length} thin margin`);

  return (
    <Link href="/dashboard/projects/findings" className="group block">
      <div className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 transition-colors hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-900/20 dark:hover:bg-amber-900/30">
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {findings.total} finding{findings.total === 1 ? "" : "s"} need attention
          </p>
          <p className="truncate text-xs text-amber-800/80 dark:text-amber-300/80">
            {parts.join(" · ")}
          </p>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-amber-700 transition-transform group-hover:translate-x-0.5 dark:text-amber-400" />
      </div>
    </Link>
  );
}

function ShortcutCard({ item, badge }) {
  const Icon = item.icon;
  return (
    <Link href={item.href} className="group block">
      <Card className="flex h-full items-start gap-3 p-3.5 transition-colors hover:border-border hover:shadow-sm">
        <span className={`mt-0.5 shrink-0 ${item.tone}`}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">{item.label}</p>
            {badge != null && badge > 0 && (
              <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                {badge}
              </span>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">{item.hint}</p>
        </div>
        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Card>
    </Link>
  );
}

export default async function ProjectPortfolioAnalytics() {
  const [stats, findings] = await Promise.all([
    getProjectStats(),
    getProjectFindings(),
  ]);

  const badges = { findings: findings?.total ?? 0 };

  return (
    <div className="flex flex-col gap-4">
      <FindingsBanner findings={findings} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <StatusDonut counts={stats} />
        <MoneyBars stats={stats} />
      </div>

      {/* Analytics shortcuts — the portfolio screens, as first-class cards. */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Analytics &amp; registers</h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {SHORTCUTS.map((item) => (
            <ShortcutCard key={item.href} item={item} badge={item.badgeKey ? badges[item.badgeKey] : null} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Keeps the dashboard's shape while stats + findings load. */
export function ProjectPortfolioAnalyticsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i} className="h-[264px] animate-pulse bg-card" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="h-[72px] animate-pulse bg-card" />
        ))}
      </div>
    </div>
  );
}
