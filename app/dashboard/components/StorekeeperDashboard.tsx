import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Package,
  AlertTriangle,
  Clock,
  Inbox,
  ChevronRight,
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Layers,
  Plus,
  RotateCcw,
} from "lucide-react";
import { AlertsStrip, AlertsStripSkeleton } from "./AlertsStrip";
import {
  cStockStats,
  cLowStockProducts,
  cOverdueCheckouts,
  cRecentMovements,
  cRecentRequests,
} from "@/app/mongodb/queries/dashboard-cache";

// ============================================
// STOREKEEPER DASHBOARD
// ============================================
// Industry-standard SoD: Storekeeper sees only what's needed to do their
// job — physical custody, counts, issues, returns. Zero pricing/cost/value
// information surfaces here, by design.
//
// Layout:
//   1. Alerts: low stock, overdue checkouts, pending requests (no money)
//   2. Operational counts: total products, low/out, pending requests
//   3. Pending stock requests to action
//   4. Overdue items still out
//   5. Low-stock list to flag for reorder
//   6. Recent movements feed

export const metadata = { title: "Storekeeper | ERP System" };

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

function CardSkeleton({ height = "h-28" }: { height?: string }) {
  return (
    <div
      className={`${height} animate-pulse rounded-lg border border-border bg-muted`}
    />
  );
}

// ============================================
// OPERATIONAL METRICS (no money)
// ============================================
async function StockMetrics() {
  const stats = await cStockStats();
  const cards = [
    {
      label: "Products tracked",
      value: formatNumber(stats.totalProducts),
      hint: `${formatNumber(stats.totalQuantity)} units on hand`,
      icon: Layers,
      tone: "neutral" as const,
    },
    {
      label: "Low stock",
      value: formatNumber(stats.lowStockCount),
      hint: stats.lowStockCount > 0 ? "needs reorder" : "all replenished",
      icon: AlertTriangle,
      tone: stats.lowStockCount > 0 ? ("warn" as const) : ("ok" as const),
    },
    {
      label: "Out of stock",
      value: formatNumber(stats.outOfStockCount),
      hint: stats.outOfStockCount > 0 ? "need attention" : "in stock",
      icon: Package,
      tone: stats.outOfStockCount > 0 ? ("bad" as const) : ("ok" as const),
    },
    {
      label: "Overdue checkouts",
      value: formatNumber(stats.overdueCheckouts),
      hint: stats.overdueCheckouts > 0 ? "follow up" : "all returned on time",
      icon: Clock,
      tone:
        stats.overdueCheckouts > 0 ? ("bad" as const) : ("ok" as const),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
      {cards.map((c) => {
        const Icon = c.icon;
        const accentClass =
          c.tone === "ok"
            ? "text-emerald-600 dark:text-emerald-400"
            : c.tone === "warn"
              ? "text-amber-600 dark:text-amber-400"
              : c.tone === "bad"
                ? "text-red-600 dark:text-red-400"
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
// PENDING REQUESTS
// ============================================
async function PendingRequestsCard() {
  const requests = await cRecentRequests(8);
  const pending = requests.filter(
    (r: any) => r.status === "pending" || r.status === "approved",
  );

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Inbox className="h-4 w-4 text-muted-foreground" />
          Stock requests to action
        </h2>
        <Link
          href="/dashboard/requests"
          className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
        >
          All
          <ChevronRight className="h-3 w-3" />
        </Link>
      </header>
      {pending.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          No requests waiting on you. Nice work.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {pending.slice(0, 6).map((r: any) => (
            <li
              key={r._id || r.id}
              className="px-4 py-2.5 text-sm transition-colors hover:bg-muted/40"
            >
              <Link
                href={`/dashboard/requests/${r._id || r.id}`}
                className="block"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate font-medium">
                    {r.requestNumber || r.requester?.name || "Request"}
                  </p>
                  <span
                    className={`shrink-0 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${
                      r.status === "approved"
                        ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400"
                        : "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400"
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {r.requester?.name && `${r.requester.name} · `}
                  {r.requestType || "—"}
                  {r.createdAt &&
                    ` · ${formatRelative(new Date(r.createdAt))}`}
                </p>
              </Link>
            </li>
          ))}
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
      {overdue.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          Everything checked out has been returned on time.
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
// LOW STOCK LIST
// ============================================
async function LowStockCard() {
  const products = await cLowStockProducts(8);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          Low stock
        </h2>
        <Link
          href="/dashboard/stocks?quantity=low-stock"
          className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
        >
          All
          <ChevronRight className="h-3 w-3" />
        </Link>
      </header>
      {products.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          All items above their reorder level.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {products.map((p: any) => (
            <li
              key={p._id || p.SKU}
              className="px-4 py-2.5 text-sm transition-colors hover:bg-muted/40"
            >
              <Link
                href={`/dashboard/stocks/${p._id}`}
                className="flex items-start justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {p.SKU}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums">
                    {formatNumber(p.currentQty || 0)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    reorder at {formatNumber(p.reorderAt || 0)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
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
      {movements.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          No movements logged today.
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
      label: "Receive stock",
      href: "/dashboard/stocks/create",
      icon: Plus,
    },
    {
      label: "Stock adjustment",
      href: "/dashboard/adjustments",
      icon: RotateCcw,
    },
    {
      label: "Item checkouts",
      href: "/dashboard/checkout",
      icon: Package,
    },
    {
      label: "Stock requests",
      href: "/dashboard/requests",
      icon: Inbox,
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
export default async function StorekeeperDashboard() {
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
          Today's receipts, issues, and items to action.
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
        <StockMetrics />
      </Suspense>

      <QuickActions />

      <div className="grid gap-3 lg:grid-cols-2">
        <Suspense fallback={<CardSkeleton height="h-72" />}>
          <PendingRequestsCard />
        </Suspense>
        <Suspense fallback={<CardSkeleton height="h-72" />}>
          <OverdueCheckoutsCard />
        </Suspense>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Suspense fallback={<CardSkeleton height="h-72" />}>
          <LowStockCard />
        </Suspense>
        <Suspense fallback={<CardSkeleton height="h-72" />}>
          <RecentMovementsCard />
        </Suspense>
      </div>
    </div>
  );
}
