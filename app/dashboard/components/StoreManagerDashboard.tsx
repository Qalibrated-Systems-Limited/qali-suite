import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Package,
  AlertTriangle,
  ClipboardList,
  Activity,
  Boxes,
  PackagePlus,
  ChevronRight,
  Layers,
  TrendingUp,
  Clock,
  Plus,
  RotateCcw,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react";
import { AlertsStrip, AlertsStripSkeleton } from "./AlertsStrip";
import {
  cStockStats,
  cLowStockProducts,
  cRecentRequests,
  cRecentMovements,
  cOverdueCheckouts,
  cTodayMovementCount,
} from "@/app/mongodb/queries/dashboard-cache";

// ============================================
// STORE MANAGER DASHBOARD
// ============================================
// Industry-standard ops view:
//   1. Alerts: low stock + overdue checkouts + pending requests
//   2. Operational metrics including inventory value (Store Manager has
//      pricing-view authority — see lib/permissions.js)
//   3. Quick actions
//   4. Reorder list + Pending requests
//   5. Overdue checkouts + Recent movements
//
// Each block is its own Suspense; the heavy stockStats query is shared
// via React.cache() so the metric row + alerts strip dedupe.

export const metadata = { title: "Store Manager | ERP System" };

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatDate(d: Date) {
  return d.toLocaleDateString("en-KE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function formatRelative(d: Date) {
  return d.toLocaleDateString("en-KE", { day: "numeric", month: "short" });
}

function formatNumber(n: number) {
  return (n || 0).toLocaleString();
}

function formatCompact(amount: number) {
  const n = amount || 0;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-KE", { maximumFractionDigits: 0 });
}

function CardSkeleton({ height = "h-28" }: { height?: string }) {
  return (
    <div
      className={`${height} animate-pulse rounded-lg border border-border bg-muted`}
    />
  );
}

// ============================================
// METRIC CARDS
// ============================================
async function StoreMetrics() {
  const [stats, todayMoves] = await Promise.all([
    cStockStats(),
    cTodayMovementCount(),
  ]);

  const cards = [
    {
      label: "Products tracked",
      value: formatNumber(stats.totalProducts),
      hint: `${formatNumber(stats.totalQuantity)} units on hand`,
      icon: Layers,
      tone: "neutral" as const,
    },
    {
      label: "Inventory value",
      value: `KES ${formatCompact(stats.totalValue)}`,
      hint: "Qty × cost",
      icon: TrendingUp,
      tone: "primary" as const,
    },
    {
      label: "Low stock",
      value: formatNumber(stats.lowStockCount),
      hint: stats.lowStockCount > 0 ? "needs reorder" : "all replenished",
      icon: AlertTriangle,
      tone:
        stats.lowStockCount > 0 ? ("warn" as const) : ("ok" as const),
    },
    {
      label: "Today's movements",
      value: formatNumber(todayMoves),
      hint: "Stock in/out today",
      icon: Activity,
      tone: "neutral" as const,
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
                : "text-muted-foreground";
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
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {c.hint}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ============================================
// REORDER LIST
// ============================================
async function ReorderCard() {
  const products = await cLowStockProducts(8);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          Reorder soon
        </h2>
        <Link
          href="/dashboard/stocks?quantity=low-stock"
          className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
        >
          All low
          <ChevronRight className="h-3 w-3" />
        </Link>
      </header>
      {!products || products.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing to reorder. Stock levels are healthy.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {products.map((p: any) => {
            const onHand = p.inventory?.quantityOnHand ?? p.currentQty ?? 0;
            const reorder = p.inventory?.reorderLevel ?? p.reorderAt ?? 0;
            return (
              <li
                key={String(p._id)}
                className="px-4 py-2.5 transition-colors hover:bg-muted/40"
              >
                <Link
                  href={`/dashboard/stocks/${p._id}`}
                  className="flex items-start justify-between gap-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      {p.SKU}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                      {formatNumber(onHand)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      reorder at {formatNumber(reorder)}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ============================================
// PENDING REQUESTS
// ============================================
async function RequestsCard() {
  const requests = await cRecentRequests(8);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          Recent requests
        </h2>
        <Link
          href="/dashboard/requests"
          className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
        >
          All
          <ChevronRight className="h-3 w-3" />
        </Link>
      </header>
      {!requests || requests.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          No recent requests.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {requests.slice(0, 6).map((r: any) => {
            const statusClass =
              r.status === "pending"
                ? "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400"
                : r.status === "approved"
                  ? "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-400"
                  : r.status === "fulfilled"
                    ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400"
                    : "bg-muted text-muted-foreground ring-border";
            return (
              <li
                key={String(r._id)}
                className="px-4 py-2.5 transition-colors hover:bg-muted/40"
              >
                <Link
                  href={`/dashboard/requests/${r._id}`}
                  className="block"
                >
                  <div className="flex items-start justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {r.requestNumber || "Request"}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {r.requester?.name || r.customer?.name || r.customer || "—"}
                        {r.requestType && ` · ${r.requestType}`}
                        {r.createdAt &&
                          ` · ${formatRelative(new Date(r.createdAt))}`}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${statusClass}`}
                    >
                      {(r.status || "").replace("_", " ")}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ============================================
// OVERDUE CHECKOUTS
// ============================================
async function OverdueCheckoutsCard() {
  const overdue = await cOverdueCheckouts(8);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Clock className="h-4 w-4 text-muted-foreground" />
          Overdue checkouts
        </h2>
        <Link
          href="/dashboard/checkout"
          className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
        >
          All
          <ChevronRight className="h-3 w-3" />
        </Link>
      </header>
      {!overdue || overdue.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing overdue.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {overdue.map((c: any, i: number) => {
            const expected = c.expectedReturnDate
              ? new Date(c.expectedReturnDate)
              : null;
            const days = expected
              ? Math.floor(
                  (Date.now() - expected.getTime()) / (1000 * 60 * 60 * 24),
                )
              : 0;
            return (
              <li
                key={c._id || i}
                className="flex items-start justify-between gap-2 px-4 py-2.5 text-sm transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {c.productSnapshot?.name || c.product?.name || "Item"}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {c.checkedOutTo?.name || c.borrower?.name || "—"}
                    {expected && ` · due ${formatRelative(expected)}`}
                  </p>
                </div>
                <span className="shrink-0 inline-flex rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-500/20 dark:text-red-400">
                  {days}d late
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ============================================
// RECENT MOVEMENTS FEED
// ============================================
async function RecentMovementsCard() {
  const movements = await cRecentMovements(8);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Activity className="h-4 w-4 text-muted-foreground" />
          Recent movements
        </h2>
        <Link
          href="/dashboard/movements"
          className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
        >
          All
          <ChevronRight className="h-3 w-3" />
        </Link>
      </header>
      {!movements || movements.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          No movements yet today.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {movements.map((m: any) => {
            const isIn = m.direction === "in";
            return (
              <li
                key={m._id}
                className="flex items-start justify-between gap-2 px-4 py-2.5 text-sm transition-colors hover:bg-muted/40"
              >
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                      isIn
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "bg-red-500/10 text-red-700 dark:text-red-400"
                    }`}
                  >
                    {isIn ? (
                      <ArrowDownToLine className="h-3 w-3" />
                    ) : (
                      <ArrowUpFromLine className="h-3 w-3" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {m.productSnapshot?.name || m.product?.name || "Item"}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {m.movementType}
                      {m.createdAt &&
                        ` · ${formatRelative(new Date(m.createdAt))}`}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {isIn ? "+" : "−"}
                  {formatNumber(m.quantity || 0)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ============================================
// QUICK ACTIONS
// ============================================
function QuickActions() {
  const actions = [
    {
      label: "New adjustment",
      href: "/dashboard/adjustments/create",
      icon: PackagePlus,
      primary: true,
    },
    {
      label: "Receive stock",
      href: "/dashboard/purchase-orders/create",
      icon: Plus,
    },
    {
      label: "Find product",
      href: "/dashboard/stocks",
      icon: Boxes,
    },
    {
      label: "Stock returns",
      href: "/dashboard/checkout",
      icon: RotateCcw,
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
            className={
              a.primary
                ? "group flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm text-primary transition-colors hover:bg-primary/10"
                : "group flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-sm transition-colors hover:bg-muted/40"
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
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
export default async function StoreManagerDashboard() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const sessionUser = session.user as { name?: string };
  const firstName = sessionUser.name?.split(" ")[0] || "Manager";

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
          Stock levels, requests, and what's moving — at a glance.
        </p>
      </header>

      <Suspense fallback={<AlertsStripSkeleton />}>
        <AlertsStrip
          show={["lowStockCount", "overdueCheckouts", "pendingRequests"]}
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
        <StoreMetrics />
      </Suspense>

      <QuickActions />

      <div className="grid gap-3 lg:grid-cols-2">
        <Suspense fallback={<CardSkeleton height="h-72" />}>
          <ReorderCard />
        </Suspense>
        <Suspense fallback={<CardSkeleton height="h-72" />}>
          <RequestsCard />
        </Suspense>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Suspense fallback={<CardSkeleton height="h-72" />}>
          <OverdueCheckoutsCard />
        </Suspense>
        <Suspense fallback={<CardSkeleton height="h-72" />}>
          <RecentMovementsCard />
        </Suspense>
      </div>
    </div>
  );
}
