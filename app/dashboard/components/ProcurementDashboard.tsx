import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ShoppingCart,
  Receipt,
  Building2,
  Package,
  ChevronRight,
  AlertTriangle,
  TrendingDown,
  Plus,
  Activity,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import { AlertsStrip, AlertsStripSkeleton } from "./AlertsStrip";
import { cLowStockProducts } from "@/app/mongodb/queries/dashboard-cache";
import {
  getProcurementSummary,
  getRecentPurchaseOrders,
  getTopSuppliersBySpend,
} from "@/app/mongodb/queries/procurement-queries";

// ============================================
// PROCUREMENT OFFICER DASHBOARD
// ============================================
// Industry-standard layout for procure-to-pay leadership:
//   1. Alerts (low stock, pending bills)
//   2. Counts: open POs, partial deliveries, pending bills, suppliers
//   3. Quick actions
//   4. Recent POs (status-tagged)
//   5. Top suppliers by 12mo spend
//   6. Items needing reorder

export const metadata = { title: "Procurement | ERP System" };

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

function formatCurrency(amount: number) {
  return (amount || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 });
}

function CardSkeleton({ height = "h-28" }: { height?: string }) {
  return (
    <div
      className={`${height} animate-pulse rounded-lg border border-border bg-muted`}
    />
  );
}

const PO_STATUS_STYLES: Record<
  string,
  { label: string; className: string; icon: React.ComponentType<{ className?: string }> }
> = {
  draft: {
    label: "Draft",
    className: "bg-muted text-muted-foreground ring-border",
    icon: Clock,
  },
  sent: {
    label: "Sent",
    className:
      "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-400",
    icon: ShoppingCart,
  },
  confirmed: {
    label: "Confirmed",
    className:
      "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-400",
    icon: CheckCircle2,
  },
  partial: {
    label: "Partial",
    className:
      "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400",
    icon: Activity,
  },
  received: {
    label: "Received",
    className:
      "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400",
    icon: CheckCircle2,
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-muted text-muted-foreground ring-border",
    icon: XCircle,
  },
  expired: {
    label: "Expired",
    className: "bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-400",
    icon: XCircle,
  },
};

function POStatusPill({ status }: { status: string }) {
  const cfg = PO_STATUS_STYLES[status] || PO_STATUS_STYLES.draft;
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${cfg.className}`}
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ============================================
// METRIC CARDS
// ============================================
async function ProcurementMetrics() {
  const summary = await getProcurementSummary();
  if (!summary.success) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {summary.error}
      </div>
    );
  }

  const cards = [
    {
      label: "Open POs",
      value: formatNumber(summary.openPOs),
      hint:
        summary.partialPOs > 0
          ? `${summary.partialPOs} awaiting balance`
          : "Sent / confirmed",
      icon: ShoppingCart,
      tone: "primary" as const,
    },
    {
      label: "Pending bills",
      value: formatNumber(summary.pendingBills),
      hint: summary.pendingBills > 0 ? "Needs review" : "All approved",
      icon: Receipt,
      tone: summary.pendingBills > 0 ? ("warn" as const) : ("ok" as const),
    },
    {
      label: "MTD spend",
      value: `KES ${formatCompact(summary.mtdSpend)}`,
      hint: "Posted bills this month",
      icon: TrendingDown,
      tone: "neutral" as const,
    },
    {
      label: "Suppliers",
      value: formatNumber(summary.activeSuppliers),
      hint: "Active suppliers",
      icon: Building2,
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
// RECENT POs
// ============================================
async function RecentPOs() {
  const result = await getRecentPurchaseOrders(8);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          Recent purchase orders
        </h2>
        <Link
          href="/dashboard/purchase-orders"
          className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
        >
          All POs
          <ChevronRight className="h-3 w-3" />
        </Link>
      </header>
      {!result.success ? (
        <p className="px-4 py-8 text-center text-sm text-destructive">
          {result.error}
        </p>
      ) : result.rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          No purchase orders yet.{" "}
          <Link
            href="/dashboard/purchase-orders/create"
            className="text-primary hover:underline"
          >
            Raise one
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {result.rows.map((p) => (
            <li
              key={p._id}
              className="px-4 py-2.5 transition-colors hover:bg-muted/40"
            >
              <Link href={`/dashboard/purchase-orders/${p._id}`} className="block">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-sm">
                      {p.supplierName}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      {p.poNumber}
                      {p.poDate && ` · ${formatRelative(new Date(p.poDate))}`}
                      {p.expectedDeliveryDate &&
                        ` · ETA ${formatRelative(new Date(p.expectedDeliveryDate))}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums">
                      {formatCompact(p.totalAmount)}
                    </p>
                    <div className="mt-1">
                      <POStatusPill status={p.status} />
                    </div>
                  </div>
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
// TOP SUPPLIERS
// ============================================
async function TopSuppliersCard() {
  const result = await getTopSuppliersBySpend(6);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          Top suppliers (12mo)
        </h2>
        <Link
          href="/dashboard/suppliers"
          className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
        >
          All
          <ChevronRight className="h-3 w-3" />
        </Link>
      </header>
      {!result.success || result.rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          No supplier spend yet.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {result.rows.map((r, i) => {
            const max = Math.max(1, result.rows[0].total || 1);
            const pct = ((r.total || 0) / max) * 100;
            return (
              <li
                key={r.supplierId || i}
                className="px-4 py-2.5"
              >
                <div className="flex items-center justify-between text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.supplierName}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {formatNumber(r.billCount)} bill
                      {r.billCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="ml-3 text-sm font-semibold tabular-nums">
                    KES {formatCompact(r.total)}
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
// LOW-STOCK REORDER LIST
// ============================================
async function ReorderList() {
  const products = await cLowStockProducts(8);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Package className="h-4 w-4 text-muted-foreground" />
          Items to reorder
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
          Stock levels are healthy.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {products.map((p: any) => (
            <li
              key={p._id || p.SKU}
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
                    {p.supplier?.name && ` · ${p.supplier.name}`}
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
// QUICK ACTIONS
// ============================================
function QuickActions() {
  const actions = [
    {
      label: "Raise PO",
      href: "/dashboard/purchase-orders/create",
      icon: Plus,
    },
    { label: "New bill", href: "/dashboard/bills/create", icon: Receipt },
    {
      label: "Suppliers",
      href: "/dashboard/suppliers",
      icon: Building2,
    },
    {
      label: "Low stock",
      href: "/dashboard/stocks?quantity=low-stock",
      icon: AlertTriangle,
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
export default async function ProcurementDashboard() {
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
          POs, bills, suppliers — the procure-to-pay pulse.
        </p>
      </header>

      <Suspense fallback={<AlertsStripSkeleton />}>
        <AlertsStrip
          show={["lowStockCount", "pendingRequests", "overdueCheckouts"]}
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
        <ProcurementMetrics />
      </Suspense>

      <QuickActions />

      <div className="grid gap-3 lg:grid-cols-2">
        <Suspense fallback={<CardSkeleton height="h-72" />}>
          <RecentPOs />
        </Suspense>
        <Suspense fallback={<CardSkeleton height="h-72" />}>
          <TopSuppliersCard />
        </Suspense>
      </div>

      <Suspense fallback={<CardSkeleton height="h-72" />}>
        <ReorderList />
      </Suspense>
    </div>
  );
}
