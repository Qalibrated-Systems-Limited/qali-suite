import Link from "next/link";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Wallet,
  Receipt,
  Landmark,
  Briefcase,
  ClipboardCheck,
  CreditCard,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cExecutiveSnapshot } from "@/app/mongodb/queries/executive-queries";

// Compact for phones, full for desktop — same convention as the reports.
const compact = (n) =>
  new Intl.NumberFormat("en-KE", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
const full = (n) =>
  new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(n || 0);

function Delta({ now, prev, downIsGood = false }) {
  if (!prev) return <span className="text-xs text-muted-foreground">— no prior month</span>;
  const pct = ((now - prev) / Math.abs(prev)) * 100;
  const up = pct >= 0.5;
  const down = pct <= -0.5;
  const good = (up && !downIsGood) || (down && downIsGood);
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${
        up || down
          ? good
            ? "text-emerald-600"
            : "text-red-600"
          : "text-muted-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {up || down ? `${pct > 0 ? "+" : ""}${pct.toFixed(0)}% vs last month` : "flat vs last month"}
    </span>
  );
}

function Kpi({ label, value, sub, icon: Icon, href, children }) {
  const body = (
    <Card className="h-full bg-card border-border transition-colors hover:border-primary/30">
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs">
            {label}
          </span>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
        <div className="mt-1 font-bold tabular-nums">
          <span className="text-xl sm:hidden">KES {compact(value)}</span>
          <span className="hidden text-2xl sm:inline">KES {full(value)}</span>
        </div>
        {sub && <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>}
        {children && <div className="mt-1">{children}</div>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}

// The executive overview VIEW — shared by the standalone /dashboard/executive
// route and the CEO's /dashboard home (rendered inline via the role registry,
// so the CEO gets a normal dashboard home like every other role; the old
// redirect tripped a Next Router dev bug mid-navigation).
export default async function ExecutiveOverview() {
  const s = await cExecutiveSnapshot();
  if (!s) {
    return (
      <p className="p-8 text-center text-sm text-muted-foreground">
        Could not load the snapshot. Try refreshing.
      </p>
    );
  }

  const net = s.revenue.total - s.expenses.total;
  const netPrev = s.revenue.prev - s.expenses.prev;

  return (
    <div className="space-y-5 sm:space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-2xl">
          Executive overview
        </h1>
        <p className="text-sm text-muted-foreground">
          Where the business stands this month, and which way it&apos;s moving.
        </p>
      </div>

      {/* This month — the direction */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
        <Kpi
          label="Revenue (this month)"
          value={s.revenue.total}
          icon={Receipt}
          href="/dashboard/invoices"
        >
          <Delta now={s.revenue.total} prev={s.revenue.prev} />
        </Kpi>
        <Kpi
          label="Expenses (this month)"
          value={s.expenses.total}
          icon={CreditCard}
          href="/dashboard/expenses"
        >
          <Delta now={s.expenses.total} prev={s.expenses.prev} downIsGood />
        </Kpi>
        <Kpi
          label="Net (rev − expenses)"
          value={net}
          icon={TrendingUp}
          href="/dashboard/reports/profit-loss"
        >
          <Delta now={net} prev={netPrev} />
        </Kpi>
      </div>

      {/* Position — what we hold and owe */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <Kpi
          label="Cash & bank"
          value={s.cash.total}
          sub={`${s.cash.count} account${s.cash.count === 1 ? "" : "s"}`}
          icon={Landmark}
          href="/dashboard/banking"
        />
        <Kpi
          label="Owed to us (AR)"
          value={s.ar.total}
          sub={`${s.ar.count} open invoice${s.ar.count === 1 ? "" : "s"}`}
          icon={Wallet}
          href="/dashboard/reports/ar-aging"
        />
        <Kpi
          label="We owe (AP)"
          value={s.ap.total}
          sub={`${s.ap.count} unpaid bill${s.ap.count === 1 ? "" : "s"}`}
          icon={Receipt}
          href="/dashboard/reports/ap-aging"
        />
        <Kpi
          label="Working position"
          value={s.cash.total + s.ar.total - s.ap.total}
          sub="cash + AR − AP"
          icon={TrendingUp}
        />
      </div>

      {/* What's coming — the future */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <Kpi
          label="Sales pipeline"
          value={s.pipeline.total}
          sub={`${s.pipeline.count} open deal${s.pipeline.count === 1 ? "" : "s"}`}
          icon={Briefcase}
          href="/dashboard/opportunities"
        />
        <Kpi
          label="Order backlog"
          value={s.backlog.total}
          sub={`${s.backlog.count} confirmed order${s.backlog.count === 1 ? "" : "s"} awaiting invoice`}
          icon={ClipboardCheck}
          href="/dashboard/sales-orders"
        />
      </div>

      {/* Drill-down */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: "Profit & Loss", href: "/dashboard/reports/profit-loss" },
          { label: "Balance Sheet", href: "/dashboard/reports/balance-sheet" },
          { label: "Cash Flow", href: "/dashboard/reports/cash-flow" },
          { label: "Sales Report", href: "/dashboard/reports/sales" },
        ].map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            {r.label} <ArrowRight className="h-3 w-3" />
          </Link>
        ))}
      </div>
    </div>
  );
}
