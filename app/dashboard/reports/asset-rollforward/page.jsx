import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canSeeReportsNav } from "@/lib/permissions";
import Link from "next/link";
import { ChevronLeft, Calendar, AlertTriangle } from "lucide-react";
import { getAssetRollforward } from "@/app/mongodb/actions/asset-actions";

export const metadata = { title: "Asset Rollforward | Reports" };

// Single source of truth — same gate that shows the Reports nav link.
// (The previous inline VIEW_ROLES bounced CFO and Finance Manager to the
// dashboard.)

function formatCurrency(amount) {
  return (amount || 0).toLocaleString("en-KE", { minimumFractionDigits: 0 });
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function defaultPeriod() {
  const now = new Date();
  const year = now.getUTCFullYear();
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  };
}

function FilterForm({ start, end }) {
  return (
    <form className="grid gap-3 rounded-lg border border-border bg-card p-4 shadow-sm sm:grid-cols-[1fr_1fr_auto]">
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
          From
        </label>
        <input
          type="date"
          name="start"
          defaultValue={start}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
          To
        </label>
        <input
          type="date"
          name="end"
          defaultValue={end}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      <div className="flex items-end">
        <button
          type="submit"
          className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Run Report
        </button>
      </div>
    </form>
  );
}

async function RollforwardTable({ start, end }) {
  const result = await getAssetRollforward({ startDate: start, endDate: end });

  if (!result.success) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-500/5 p-4 text-sm text-amber-800 dark:border-amber-900 dark:text-amber-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">Could not load report</p>
          <p className="mt-1 text-xs">{result.error}</p>
        </div>
      </div>
    );
  }

  const { rows, totals, period } = result;

  return (
    <>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Calendar className="h-4 w-4" />
        <span>
          Period: <strong>{formatDate(period.start)}</strong> &ndash;{" "}
          <strong>{formatDate(period.end)}</strong>
        </span>
      </div>

      {/* Cost rollforward */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          Cost Rollforward
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2 text-right">Opening</th>
                <th className="px-3 py-2 text-right">+ Additions</th>
                <th className="px-3 py-2 text-right">− Disposals</th>
                <th className="px-3 py-2 text-right">= Closing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-6 text-center text-muted-foreground"
                  >
                    No assets on the books in this period.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.category} className="hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{r.label}</td>
                    <td className="px-3 py-2 text-right">
                      {formatCurrency(r.openingCost)}
                    </td>
                    <td className="px-3 py-2 text-right text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(r.additions)}
                    </td>
                    <td className="px-3 py-2 text-right text-red-700 dark:text-red-400">
                      {formatCurrency(r.disposalsCost)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">
                      {formatCurrency(r.closingCost)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/40 font-bold">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right">
                    {formatCurrency(totals.openingCost)}
                  </td>
                  <td className="px-3 py-2 text-right text-emerald-700 dark:text-emerald-400">
                    {formatCurrency(totals.additions)}
                  </td>
                  <td className="px-3 py-2 text-right text-red-700 dark:text-red-400">
                    {formatCurrency(totals.disposalsCost)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatCurrency(totals.closingCost)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {/* Accumulated depreciation rollforward */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          Accumulated Depreciation Rollforward
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2 text-right">Opening</th>
                <th className="px-3 py-2 text-right">+ Charge</th>
                <th className="px-3 py-2 text-right">− Disposals</th>
                <th className="px-3 py-2 text-right">= Closing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-6 text-center text-muted-foreground"
                  >
                    No depreciation activity in this period.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.category} className="hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{r.label}</td>
                    <td className="px-3 py-2 text-right">
                      {formatCurrency(r.openingAccDep)}
                    </td>
                    <td className="px-3 py-2 text-right text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(r.chargeAccDep)}
                    </td>
                    <td className="px-3 py-2 text-right text-red-700 dark:text-red-400">
                      {formatCurrency(r.disposalsAccDep)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">
                      {formatCurrency(r.closingAccDep)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/40 font-bold">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right">
                    {formatCurrency(totals.openingAccDep)}
                  </td>
                  <td className="px-3 py-2 text-right text-emerald-700 dark:text-emerald-400">
                    {formatCurrency(totals.chargeAccDep)}
                  </td>
                  <td className="px-3 py-2 text-right text-red-700 dark:text-red-400">
                    {formatCurrency(totals.disposalsAccDep)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatCurrency(totals.closingAccDep)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {/* Net Book Value summary */}
      {rows.length > 0 && (
        <section className="rounded-lg border border-primary/30 bg-primary/5 p-5">
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            Net Book Value Reconciliation
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Opening NBV
              </p>
              <p className="mt-1 text-lg font-bold">
                KES {formatCurrency(totals.openingNBV)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Net Movement
              </p>
              <p className="mt-1 text-lg font-bold">
                KES{" "}
                {formatCurrency(totals.closingNBV - totals.openingNBV)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-primary">
                Closing NBV
              </p>
              <p className="mt-1 text-lg font-bold text-primary">
                KES {formatCurrency(totals.closingNBV)}
              </p>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function ReportSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-32 animate-pulse rounded-lg bg-muted" />
      <div className="h-64 animate-pulse rounded-lg bg-muted" />
      <div className="h-64 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

export default async function AssetRollforwardPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeReportsNav(session.user.role)) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const defaults = defaultPeriod();
  const start = typeof params?.start === "string" ? params.start : defaults.start;
  const end = typeof params?.end === "string" ? params.end : defaults.end;

  return (
    <div className="max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href="/dashboard/reports"
          className="flex items-center gap-1 hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Reports
        </Link>
        <span>/</span>
        <span className="text-foreground">Asset Rollforward</span>
      </div>

      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">
          Fixed Asset Rollforward
        </h1>
        <p className="text-sm text-muted-foreground">
          Opening + additions − disposals = closing, by category. Reconciles cost
          and accumulated depreciation on the balance sheet.
        </p>
      </div>

      <FilterForm start={start} end={end} />

      <Suspense key={`${start}-${end}`} fallback={<ReportSkeleton />}>
        <RollforwardTable start={start} end={end} />
      </Suspense>
    </div>
  );
}
