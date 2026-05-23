"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  TrendingDown,
  AlertCircle,
  ShoppingCart,
  Tag,
} from "lucide-react";

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

function formatPct(pct) {
  return `${(pct || 0).toFixed(1)}%`;
}

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function Stat({ label, value, sub, icon: Icon, accent }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
      <p
        className={`mt-0.5 text-base font-semibold tabular-nums ${accent || "text-foreground"}`}
      >
        {value}
      </p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function PurchaseReportClient({ initial, initialStart, initialEnd }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleDateChange = (key, value) => {
    const next = new URLSearchParams(searchParams);
    next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`);
  };

  const { period, summary, suppliers, categories } = initial || {
    period: { startDate: initialStart, endDate: initialEnd },
    summary: {},
    suppliers: [],
    categories: [],
  };

  const concentrationTone =
    summary.topFiveShare >= 70
      ? "text-red-700 dark:text-red-400"
      : summary.topFiveShare >= 50
        ? "text-amber-700 dark:text-amber-400"
        : "text-foreground";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Purchase Report
          </h1>
          <p className="text-xs text-muted-foreground">
            Spend, outstanding payable, and category breakdown per supplier
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground">From</label>
            <input
              type="date"
              defaultValue={initialStart}
              onChange={(e) => handleDateChange("startDate", e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground">To</label>
            <input
              type="date"
              defaultValue={initialEnd}
              onChange={(e) => handleDateChange("endDate", e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
            />
          </div>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat
          label="Suppliers"
          value={summary.totalSuppliers || 0}
          sub={`${summary.totalBills || 0} bills`}
          icon={Building2}
        />
        <Stat
          label="Total spend"
          value={formatCurrency(summary.totalSpend)}
          icon={ShoppingCart}
        />
        <Stat
          label="Outstanding"
          value={formatCurrency(summary.totalOutstanding)}
          sub={
            <Link
              href="/dashboard/reports/ap-aging"
              className="hover:underline"
            >
              View AP aging →
            </Link>
          }
          icon={AlertCircle}
          accent="text-orange-700 dark:text-orange-400"
        />
        <Stat
          label="Top 5 share"
          value={formatPct(summary.topFiveShare)}
          sub={`Top 1: ${formatPct(summary.topSupplierShare)}`}
          accent={concentrationTone}
        />
        <Stat
          label="Top category"
          value={
            categories[0]?.accountName
              ? categories[0].accountName.length > 14
                ? categories[0].accountName.slice(0, 14) + "…"
                : categories[0].accountName
              : "—"
          }
          sub={
            categories[0]
              ? `${formatPct(categories[0].spendShare)} of spend`
              : "—"
          }
          icon={Tag}
        />
      </div>

      {/* Suppliers Table */}
      {suppliers.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-card py-12 text-center">
          <p className="text-sm font-medium">No approved bills in this period</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatDate(period.startDate)} → {formatDate(period.endDate)}
          </p>
        </div>
      ) : (
        <>
          <div>
            <h2 className="mb-2 text-sm font-semibold text-foreground">
              Top suppliers by spend
            </h2>
            <div className="rounded-md border border-border bg-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 text-left font-medium">#</th>
                    <th className="px-3 py-2 text-left font-medium">
                      Supplier
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Spend</th>
                    <th className="px-3 py-2 text-right font-medium">% share</th>
                    <th className="px-3 py-2 text-right font-medium">Bills</th>
                    <th className="px-3 py-2 text-right font-medium">Avg</th>
                    <th className="px-3 py-2 text-right font-medium">Paid</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Outstanding
                    </th>
                    <th className="px-3 py-2 text-left font-medium">
                      Last bill
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {suppliers.map((r, i) => (
                    <tr
                      key={r.supplierId || i}
                      className="hover:bg-muted/40 transition-colors"
                    >
                      <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">
                        {i + 1}
                      </td>
                      <td className="px-3 py-2 font-medium text-foreground">
                        {r.supplierName || "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">
                        {formatCurrency(r.totalSpend)}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-muted-foreground tabular-nums">
                        {formatPct(r.spendShare)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.billCount}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                        {formatCurrency(r.averageBillValue)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                        {formatCurrency(r.totalPaid)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono ${
                          r.outstanding > 0
                            ? "text-orange-700 dark:text-orange-400"
                            : "text-muted-foreground"
                        }`}
                      >
                        {formatCurrency(r.outstanding)}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {formatDate(r.lastBillDate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Spend by category */}
          {categories.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-foreground">
                Spend by account
              </h2>
              <div className="rounded-md border border-border bg-card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 text-left font-medium">Code</th>
                      <th className="px-3 py-2 text-left font-medium">
                        Account
                      </th>
                      <th className="px-3 py-2 text-left font-medium">Type</th>
                      <th className="px-3 py-2 text-right font-medium">
                        Lines
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        Spend
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        % of spend
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {categories.map((c) => (
                      <tr
                        key={c.accountCode || c.accountName}
                        className="hover:bg-muted/40 transition-colors"
                      >
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          {c.accountCode || "—"}
                        </td>
                        <td className="px-3 py-2 text-foreground">
                          {c.accountName || "—"}
                        </td>
                        <td className="px-3 py-2 text-xs capitalize text-muted-foreground">
                          {c.accountType}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {c.lineCount}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-foreground">
                          {formatCurrency(c.totalSpend)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                          {formatPct(c.spendShare)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
