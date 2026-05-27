import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  TrendingUp,
  TrendingDown,
  Tag,
  Users,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Package,
  Activity,
  ShoppingBag,
  History,
} from "lucide-react";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, buildTenantMatch } from "@/lib/utils/tenant-utils";
import Product from "@/app/models/product";
import { AlertsStrip, AlertsStripSkeleton } from "./AlertsStrip";
import {
  cFinancialOverview,
  cTopProducts,
  cARAgingSummary,
} from "@/app/mongodb/queries/dashboard-cache";

// ============================================
// SALES MANAGER DASHBOARD
// ============================================
// Industry-standard layout for sales/commercial leadership:
//   1. Alerts: overdue invoices, low stock (commercial impact)
//   2. Revenue + margin metric cards
//   3. Recent price changes (audit log surfaced)
//   4. Top products by units moved
//   5. Customer aging (collection awareness)
//
// Each section streams in its own Suspense boundary.

export const metadata = { title: "Sales Manager Dashboard | ERP System" };

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

function formatRelativeDate(d: Date) {
  return d.toLocaleDateString("en-KE", { day: "numeric", month: "short" });
}

function CardSkeleton({ height = "h-28" }: { height?: string }) {
  return (
    <div
      className={`${height} animate-pulse rounded-lg border border-border bg-muted`}
    />
  );
}

// ============================================
// REVENUE + AVG MARGIN METRICS
// ============================================
async function CommercialMetrics() {
  // Three independent reads — run in parallel rather than three sequential
  // awaits (cuts response time to the slowest single call).
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantMatch(companyId, isSuperAdmin);
  await dbConnect();

  const [overview, marginAgg, belowFloorAgg] = await Promise.all([
    cFinancialOverview(),
    // Average margin across active products with both cost & selling set.
    Product.aggregate([
      { $match: { ...tenantMatch, status: "active" } },
      {
        $project: {
          cost: { $ifNull: ["$costing.costPrice", 0] },
          selling: { $ifNull: ["$pricing.sellingPrice", 0] },
        },
      },
      { $match: { cost: { $gt: 0 }, selling: { $gt: 0 } } },
      {
        $group: {
          _id: null,
          avgMargin: {
            $avg: {
              $multiply: [
                { $divide: [{ $subtract: ["$selling", "$cost"] }, "$selling"] },
                100,
              ],
            },
          },
          priced: { $sum: 1 },
        },
      },
    ]),
    // Below-floor count — products where selling < minimumPrice.
    Product.aggregate([
      { $match: { ...tenantMatch, status: "active" } },
      {
        $project: {
          selling: { $ifNull: ["$pricing.sellingPrice", 0] },
          floor: { $ifNull: ["$pricing.minimumPrice", 0] },
        },
      },
      {
        $match: {
          floor: { $gt: 0 },
          $expr: { $lt: ["$selling", "$floor"] },
        },
      },
      { $count: "count" },
    ]),
  ]);

  const avgMargin = marginAgg[0]?.avgMargin || 0;
  const pricedCount = marginAgg[0]?.priced || 0;
  const belowFloor = belowFloorAgg[0]?.count || 0;

  const cards = [
    {
      label: "Revenue MTD",
      value: `KES ${formatCompact(overview.revenue.current)}`,
      icon: TrendingUp,
      trend: overview.revenue.trend,
      tone: "ok" as const,
    },
    {
      label: "Avg margin",
      value: `${avgMargin.toFixed(1)}%`,
      icon: Activity,
      hint: `${pricedCount} priced products`,
      tone: avgMargin >= 25 ? ("ok" as const) : ("warn" as const),
    },
    {
      label: "Below floor",
      value: belowFloor.toLocaleString(),
      icon: TrendingDown,
      hint: belowFloor > 0 ? "Selling below minimum" : "All within floor",
      tone: belowFloor > 0 ? ("bad" as const) : ("ok" as const),
    },
    {
      label: "Profit MTD",
      value: `KES ${formatCompact(overview.profit.current)}`,
      icon: TrendingUp,
      trend: overview.profit.trend,
      tone: overview.profit.current >= 0 ? ("primary" as const) : ("bad" as const),
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
// RECENT PRICE CHANGES (audit log)
// ============================================
async function RecentPriceChanges() {
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantMatch(companyId, isSuperAdmin);
  await dbConnect();

  // Single aggregation — flatten priceHistory across products and pull the
  // 8 most recent. Index-friendly thanks to companyId match.
  const recent = await Product.aggregate([
    { $match: { ...tenantMatch, "pricing.priceHistory.0": { $exists: true } } },
    {
      $project: {
        SKU: 1,
        name: 1,
        history: { $slice: ["$pricing.priceHistory", -1] },
      },
    },
    { $unwind: "$history" },
    { $sort: { "history.changedAt": -1 } },
    { $limit: 8 },
  ]);

  if (recent.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <History className="h-4 w-4 text-muted-foreground" />
            Recent price changes
          </h2>
        </header>
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          No price changes logged yet. Use{" "}
          <Link
            href="/dashboard/stocks"
            className="text-primary hover:underline"
          >
            Manage pricing
          </Link>{" "}
          on a product to start tracking.
        </p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4 text-muted-foreground" />
          Recent price changes
        </h2>
        <Link
          href="/dashboard/stocks"
          className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
        >
          All products
          <ChevronRight className="h-3 w-3" />
        </Link>
      </header>
      <ul className="divide-y divide-border">
        {recent.map((r: any) => {
          const h = r.history;
          const delta = (h.newPrice || 0) - (h.previousPrice || 0);
          const pct =
            h.previousPrice > 0 ? (delta / h.previousPrice) * 100 : 0;
          const up = delta > 0;
          return (
            <li
              key={`${r._id}-${h.changedAt}`}
              className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-muted/40"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/dashboard/stocks/${r._id}`}
                  className="block hover:underline"
                >
                  <p className="truncate font-medium">{r.name}</p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {r.SKU}
                    {h.changedBy?.name && ` · ${h.changedBy.name}`}
                    {h.changedAt &&
                      ` · ${formatRelativeDate(new Date(h.changedAt))}`}
                  </p>
                </Link>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold tabular-nums">
                  {formatCompact(h.newPrice || 0)}
                </p>
                <p
                  className={`mt-0.5 inline-flex items-center gap-0.5 text-[11px] tabular-nums ${
                    up
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {up ? (
                    <ArrowUpRight className="h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3" />
                  )}
                  {Math.abs(pct).toFixed(1)}%
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ============================================
// TOP PRODUCTS BY UNITS MOVED
// ============================================
async function TopProductsCard() {
  const products = await cTopProducts(6);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Package className="h-4 w-4 text-muted-foreground" />
          Top products (units sold)
        </h2>
        <Link
          href="/dashboard/reports/sales"
          className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
        >
          Sales report
          <ChevronRight className="h-3 w-3" />
        </Link>
      </header>
      {products.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          No movement data yet.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {products.map((p: any, i: number) => {
            const max = Math.max(1, products[0].quantity || 1);
            const pct = ((p.quantity || 0) / max) * 100;
            return (
              <li key={p.sku || i} className="px-4 py-2.5">
                <div className="flex items-center justify-between text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      {p.sku}
                    </p>
                  </div>
                  <span className="ml-3 text-sm font-semibold tabular-nums">
                    {(p.quantity || 0).toLocaleString()}
                  </span>
                </div>
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ============================================
// CUSTOMER AGING SNAPSHOT
// ============================================
async function CustomerAgingSnapshot() {
  const buckets = await cARAgingSummary();
  const total = buckets.reduce((s, b) => s + b.amount, 0);
  const overdue = buckets
    .filter((b) => b.bucket !== "current")
    .reduce((s, b) => s + b.amount, 0);

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4 text-muted-foreground" />
          Customer collections
        </h2>
        <Link
          href="/dashboard/reports/ar-aging"
          className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
        >
          Aging
          <ChevronRight className="h-3 w-3" />
        </Link>
      </header>
      <div className="grid grid-cols-2 gap-3 p-4 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Outstanding</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums sm:text-xl">
            KES {formatCurrency(total)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Overdue</p>
          <p
            className={`mt-0.5 text-lg font-semibold tabular-nums sm:text-xl ${
              overdue > 0 ? "text-red-600 dark:text-red-400" : ""
            }`}
          >
            KES {formatCurrency(overdue)}
          </p>
        </div>
      </div>
    </section>
  );
}

// ============================================
// QUICK ACTIONS
// ============================================
function QuickActions() {
  const actions = [
    {
      label: "New invoice",
      href: "/dashboard/invoices/create",
      icon: Plus,
    },
    { label: "New quote", href: "/dashboard/quotes/create", icon: Plus },
    { label: "Manage pricing", href: "/dashboard/stocks", icon: Tag },
    {
      label: "Sales report",
      href: "/dashboard/reports/sales",
      icon: ShoppingBag,
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
export default async function SalesManagerDashboard() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const sessionUser = session.user as { name?: string };
  const firstName = sessionUser.name?.split(" ")[0] || "there";

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs text-muted-foreground">
          {formatDate(new Date())}
        </p>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight sm:text-2xl">
          {getGreeting()}, {firstName}
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
          Pricing, margins, and what's selling — the commercial pulse.
        </p>
      </header>

      <Suspense fallback={<AlertsStripSkeleton />}>
        <AlertsStrip
          show={[
            "pendingApprovals",
            "overdueInvoices",
            "lowStockCount",
            "pendingRequests",
          ]}
        />
      </Suspense>

      <Suspense
        fallback={
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <CardSkeleton key={i} height="h-24" />
            ))}
          </div>
        }
      >
        <CommercialMetrics />
      </Suspense>

      <QuickActions />

      <div className="grid gap-3 lg:grid-cols-2">
        <Suspense fallback={<CardSkeleton height="h-64" />}>
          <RecentPriceChanges />
        </Suspense>
        <Suspense fallback={<CardSkeleton height="h-64" />}>
          <TopProductsCard />
        </Suspense>
      </div>

      <Suspense fallback={<CardSkeleton height="h-32" />}>
        <CustomerAgingSnapshot />
      </Suspense>
    </div>
  );
}
