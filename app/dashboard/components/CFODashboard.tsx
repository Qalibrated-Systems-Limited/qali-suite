import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Receipt,
  Banknote,
  Activity,
  Users,
  Building2,
  DollarSign,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
} from "lucide-react";
import { AlertsStrip, AlertsStripSkeleton } from "./AlertsStrip";
import {
  cFinancialOverview,
  cARAgingSummary,
  cAPAgingSummary,
  cRevenueTrend,
  cRecentTransactions,
} from "@/app/mongodb/queries/dashboard-cache";

// ============================================
// CFO / FINANCE MANAGER DASHBOARD
// ============================================
// Industry-standard layout for senior finance:
//   1. Alerts strip — what needs attention (overdue invoices, claims)
//   2. Financial overview — cash, revenue, expenses, profit (this month)
//   3. Cash position with trend sparkline
//   4. AR + AP aging side-by-side
//   5. Recent posted transactions feed
//
// Each block is its own Suspense boundary so they stream independently.
// Shared queries flow through React.cache() — see dashboard-cache.js.

export const metadata = {
  title: "CFO Dashboard | ERP System",
};

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatCurrency(amount: number) {
  return (amount || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 });
}

function formatCompact(amount: number) {
  const n = amount || 0;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-KE", { maximumFractionDigits: 0 });
}

function formatDate(d: Date) {
  return d.toLocaleDateString("en-KE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

// ============================================
// SKELETONS
// ============================================
function CardSkeleton({ height = "h-28" }: { height?: string }) {
  return (
    <div
      className={`${height} animate-pulse rounded-lg border border-border bg-muted`}
    />
  );
}

function MetricCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <CardSkeleton key={i} height="h-24" />
      ))}
    </div>
  );
}

// ============================================
// FINANCIAL OVERVIEW (4 metric cards)
// ============================================
async function FinancialOverview() {
  const overview = await cFinancialOverview();
  const cards = [
    {
      label: "Cash & bank",
      value: `KES ${formatCompact(overview.cash.balance)}`,
      icon: Wallet,
      hint: `Cash ${formatCompact(overview.cash.cashOnly)} · Bank ${formatCompact(overview.cash.bankOnly)}`,
      tone: "primary" as const,
    },
    {
      label: "Revenue MTD",
      value: `KES ${formatCompact(overview.revenue.current)}`,
      icon: TrendingUp,
      trend: overview.revenue.trend,
      tone: "ok" as const,
    },
    {
      label: "Expenses MTD",
      value: `KES ${formatCompact(overview.expenses.current)}`,
      icon: TrendingDown,
      trend: overview.expenses.trend,
      // For expenses, "up" is bad
      tone: overview.expenses.trend > 0 ? ("warn" as const) : ("ok" as const),
    },
    {
      label: "Profit MTD",
      value: `KES ${formatCompact(overview.profit.current)}`,
      icon: DollarSign,
      trend: overview.profit.trend,
      tone:
        overview.profit.current >= 0 ? ("primary" as const) : ("bad" as const),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
      {cards.map((c) => {
        const Icon = c.icon;
        const accentClass =
          c.tone === "primary"
            ? "text-primary"
            : c.tone === "ok"
              ? "text-emerald-600 dark:text-emerald-400"
              : c.tone === "warn"
                ? "text-amber-600 dark:text-amber-400"
                : c.tone === "bad"
                  ? "text-red-600 dark:text-red-400"
                  : "text-muted-foreground";
        const trend = c.trend;
        const TrendIcon =
          trend === undefined
            ? null
            : trend > 0
              ? ArrowUpRight
              : trend < 0
                ? ArrowDownRight
                : null;
        const trendClass =
          trend === undefined
            ? ""
            : c.tone === "warn" || c.tone === "bad"
              ? "text-amber-600 dark:text-amber-400"
              : trend >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400";

        return (
          <div
            key={c.label}
            className="rounded-lg border border-border bg-card p-3 sm:p-4"
          >
            <div
              className={`flex items-center gap-2 text-xs font-medium uppercase tracking-wide ${accentClass}`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="truncate">{c.label}</span>
            </div>
            <p className="mt-1.5 truncate text-base font-semibold sm:text-lg">
              {c.value}
            </p>
            {trend !== undefined && (
              <p
                className={`mt-0.5 inline-flex items-center gap-0.5 text-[11px] tabular-nums ${trendClass}`}
              >
                {TrendIcon && <TrendIcon className="h-3 w-3" />}
                {Math.abs(trend).toFixed(1)}% vs last month
              </p>
            )}
            {c.hint && (
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {c.hint}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================
// REVENUE / EXPENSES SPARKLINE (6 mo)
// ============================================
async function TrendSection() {
  const data = await cRevenueTrend(6);
  const max = Math.max(
    1,
    ...data.flatMap((d: any) => [d.revenue, d.expenses]),
  );
  const w = 320;
  const h = 56;
  const stepX = data.length > 1 ? w / (data.length - 1) : 0;
  const scaleY = (v: number) => h - 4 - (v / max) * (h - 8);

  const linePath = (key: "revenue" | "expenses") =>
    data
      .map(
        (d: any, i: number) =>
          `${i === 0 ? "M" : "L"}${(i * stepX).toFixed(1)},${scaleY(d[key]).toFixed(1)}`,
      )
      .join(" ");

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Activity className="h-4 w-4 text-muted-foreground" />
          Revenue vs expenses (6 months)
        </h2>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Revenue
          </span>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            Expenses
          </span>
        </div>
      </header>
      <div className="p-4">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="h-14 w-full"
          preserveAspectRatio="none"
          role="img"
          aria-label="Revenue vs expenses trend"
        >
          <path
            d={linePath("revenue")}
            fill="none"
            stroke="rgb(16 185 129)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={linePath("expenses")}
            fill="none"
            stroke="rgb(239 68 68)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="3 3"
          />
        </svg>
        <div className="mt-2 flex justify-between text-[10px] tabular-nums text-muted-foreground">
          {data.map((d: any) => (
            <span key={d.month}>{d.month.slice(5)}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================
// AGING TABLE (AR or AP)
// ============================================
function AgingCard({
  title,
  buckets,
  href,
  totalLabel,
  type,
}: {
  title: string;
  buckets: Array<{ bucket: string; amount: number }>;
  href: string;
  totalLabel: string;
  type: "AR" | "AP";
}) {
  const total = buckets.reduce((s, b) => s + b.amount, 0);
  const max = Math.max(1, ...buckets.map((b) => b.amount));

  const labels: Record<string, string> = {
    current: "Current",
    "1-30": "1-30",
    "31-60": "31-60",
    "61-90": "61-90",
    "90+": "90+ days",
  };
  const accent = type === "AR" ? "bg-blue-500" : "bg-orange-500";

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {type === "AR" ? (
            <Users className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Building2 className="h-4 w-4 text-muted-foreground" />
          )}
          {title}
        </h2>
        <Link
          href={href}
          className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
        >
          View
          <ChevronRight className="h-3 w-3" />
        </Link>
      </header>
      <div className="space-y-2 p-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted-foreground">{totalLabel}</span>
          <span className="text-lg font-semibold tabular-nums sm:text-xl">
            KES {formatCurrency(total)}
          </span>
        </div>
        <ul className="space-y-1.5">
          {buckets.map((b) => {
            const pct = total > 0 ? (b.amount / max) * 100 : 0;
            const isOverdueBucket = b.bucket !== "current";
            return (
              <li key={b.bucket} className="text-xs">
                <div className="flex items-center justify-between">
                  <span
                    className={
                      isOverdueBucket
                        ? "font-medium text-foreground"
                        : "text-muted-foreground"
                    }
                  >
                    {labels[b.bucket] || b.bucket}
                  </span>
                  <span className="font-medium tabular-nums">
                    {formatCompact(b.amount)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full ${accent} transition-all`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

async function AgingPair() {
  const [ar, ap] = await Promise.all([cARAgingSummary(), cAPAgingSummary()]);
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <AgingCard
        title="Receivables aging"
        buckets={ar}
        href="/dashboard/reports/ar-aging"
        totalLabel="Outstanding"
        type="AR"
      />
      <AgingCard
        title="Payables aging"
        buckets={ap}
        href="/dashboard/reports/ap-aging"
        totalLabel="Owed"
        type="AP"
      />
    </div>
  );
}

// ============================================
// RECENT TRANSACTIONS FEED
// ============================================
async function RecentTransactions() {
  const txns = await cRecentTransactions(8);

  if (!txns || txns.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Receipt className="h-4 w-4 text-muted-foreground" />
            Recent transactions
          </h2>
        </header>
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          No recent transactions.
        </p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Receipt className="h-4 w-4 text-muted-foreground" />
          Recent posted entries
        </h2>
        <Link
          href="/dashboard/journal"
          className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
        >
          View journal
          <ChevronRight className="h-3 w-3" />
        </Link>
      </header>
      <ul className="divide-y divide-border">
        {txns.map((t: any, i: number) => (
          <li
            key={t.id || i}
            className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-muted/40"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">
                {t.description || t.entryNumber || "—"}
              </p>
              <p className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                {t.date
                  ? new Date(t.date).toLocaleDateString("en-KE", {
                      day: "numeric",
                      month: "short",
                    })
                  : "—"}
                {t.entryNumber && (
                  <>
                    <span>·</span>
                    <span className="font-mono">{t.entryNumber}</span>
                  </>
                )}
              </p>
            </div>
            <p className="shrink-0 text-sm font-semibold tabular-nums">
              KES {formatCompact(t.amount || 0)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ============================================
// QUICK ACTIONS
// ============================================
function QuickActions() {
  const actions = [
    {
      label: "Post journal entry",
      href: "/dashboard/journal/create",
      icon: Receipt,
    },
    {
      label: "Reconcile bank",
      href: "/dashboard/banking",
      icon: Banknote,
    },
    {
      label: "Run trial balance",
      href: "/dashboard/reports/trial-balance",
      icon: Activity,
    },
    {
      label: "Profit & Loss",
      href: "/dashboard/reports/profit-loss",
      icon: TrendingUp,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {actions.map((a) => {
        const Icon = a.icon;
        return (
          <Link
            key={a.label}
            href={a.href}
            className="group flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-sm transition-colors hover:bg-muted/40"
          >
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{a.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

// ============================================
// PAGE
// ============================================
export default async function CFODashboard() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const sessionUser = session.user as { name?: string; role?: string };
  const firstName = sessionUser.name?.split(" ")[0] || "there";
  const role = sessionUser.role || "CFO";

  return (
    <div className="space-y-5">
      {/* Header */}
      <header>
        <p className="text-xs text-muted-foreground">
          {formatDate(new Date())}
        </p>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight sm:text-2xl">
          {getGreeting()}, {firstName}
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
          {role === "Finance Manager"
            ? "Mid-tier approvals and financial state — at a glance."
            : "Approvals, cash position, and the company's financial state."}
        </p>
      </header>

      {/* Alerts — what needs attention */}
      <Suspense fallback={<AlertsStripSkeleton />}>
        <AlertsStrip
          show={[
            "pendingApprovals",
            "overdueInvoices",
            "pendingClaims",
            "lowStockCount",
          ]}
        />
      </Suspense>

      {/* Financial overview metrics */}
      <Suspense fallback={<MetricCardsSkeleton />}>
        <FinancialOverview />
      </Suspense>

      {/* Trend chart */}
      <Suspense fallback={<CardSkeleton height="h-32" />}>
        <TrendSection />
      </Suspense>

      {/* AR + AP aging */}
      <Suspense
        fallback={
          <div className="grid gap-3 lg:grid-cols-2">
            <CardSkeleton height="h-48" />
            <CardSkeleton height="h-48" />
          </div>
        }
      >
        <AgingPair />
      </Suspense>

      {/* Quick actions */}
      <QuickActions />

      {/* Recent transactions feed */}
      <Suspense fallback={<CardSkeleton height="h-64" />}>
        <RecentTransactions />
      </Suspense>
    </div>
  );
}
