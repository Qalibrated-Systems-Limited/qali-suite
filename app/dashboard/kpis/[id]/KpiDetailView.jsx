"use client";

import { useState, useTransition, useActionState } from "react";
import { Loader2, Plus, RefreshCw, Trash2, AlertCircle, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  recordKpiSnapshot,
  computeKpiSnapshot,
  deleteKpiSnapshot,
  setKpiActive,
  updateKpiTarget,
} from "@/app/mongodb/actions/kpi-actions";
import {
  formatKpiValue,
  kpiStatus,
  kpiStatusLabel,
  percentVsTarget,
  periodLabel,
  shortPeriodLabel,
  formatDelta,
  deltaClass,
} from "../lib/kpi-format";
import { KpiLineChart } from "../components/KpiCharts";

export default function KpiDetailView({ kpi, canManage, canEnter }) {
  const latest = kpi.snapshots[0] || null;
  const status = latest
    ? kpiStatus(latest.actualValue, latest.targetAtTime, kpi.targetDirection, kpi.customThresholds)
    : "no-data";

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Left column — current status + meta */}
      <div className="space-y-4 lg:col-span-1">
        <CurrentStatusCard kpi={kpi} latest={latest} status={status} />
        <DefinitionCard kpi={kpi} canManage={canManage} />
      </div>

      {/* Right column — chart + snapshots */}
      <div className="space-y-4 lg:col-span-2">
        <TrendChartCard kpi={kpi} />
        <SnapshotsCard kpi={kpi} canEnter={canEnter} canManage={canManage} />
      </div>
    </div>
  );
}

// ─── Trend Chart ───────────────────────────────────────────────
function TrendChartCard({ kpi }) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="space-y-2 p-4">
        <h2 className="text-sm font-semibold">Trend</h2>
        <KpiLineChart
          series={kpi.chartSeries}
          target={kpi.target}
          unit={kpi.unit}
          periodicity={kpi.periodicity}
          height={220}
        />
      </CardContent>
    </Card>
  );
}

// ─── Current Status ────────────────────────────────────────────
function CurrentStatusCard({ kpi, latest, status }) {
  const styles = {
    on_target: "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400",
    near_target: "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400",
    off_target: "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400",
    "no-data": "bg-muted/40 border-border text-muted-foreground",
  };
  const pct = latest ? percentVsTarget(latest.actualValue, latest.targetAtTime) : null;

  return (
    <Card className={`border ${styles[status]}`}>
      <CardContent className="space-y-1 p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide">Latest snapshot</p>
          {latest && (
            <span className="rounded-full bg-background/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
              {kpiStatusLabel(status, kpi.statusLabels)}
            </span>
          )}
        </div>
        {latest ? (
          <>
            <p className="text-3xl font-bold tabular-nums">{formatKpiValue(latest.actualValue, kpi.unit)}</p>
            <p className="text-sm">
              Target {formatKpiValue(latest.targetAtTime, kpi.unit)} · {pct?.toFixed(0)}%
            </p>
            <div className="flex flex-wrap gap-3 pt-1 text-xs">
              <span>
                vs prior:{" "}
                <span className={`tabular-nums font-medium ${deltaClass(latest.priorDeltaPct, kpi.targetDirection)}`}>
                  {formatDelta(latest.priorDeltaPct)}
                </span>
              </span>
              <span>
                vs YoY:{" "}
                <span className={`tabular-nums font-medium ${deltaClass(latest.yoyDeltaPct, kpi.targetDirection)}`}>
                  {formatDelta(latest.yoyDeltaPct)}
                </span>
              </span>
            </div>
            <p className="text-xs opacity-80 pt-1">
              {periodLabel(latest.periodYear, latest.periodMonth, latest.periodicity || kpi.periodicity)} ·{" "}
              {latest.source === "auto" ? "Auto-computed" : "Manual entry"}
            </p>
          </>
        ) : (
          <p className="text-sm italic">No snapshot recorded yet</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Definition ─────────────────────────────────────────────────
function DefinitionCard({ kpi, canManage }) {
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState(null);

  function handleToggleActive() {
    setActionError(null);
    startTransition(async () => {
      // Action redirects on success — only the failure path returns here.
      const res = await setKpiActive(kpi._id, !kpi.isActive);
      if (res && !res.success) setActionError(res.error || "Could not update status");
    });
  }

  return (
    <Card className="bg-card border-border">
      <CardContent className="space-y-3 p-4 text-sm">
        <Meta label="Category" value={kpi.category} capitalize />
        <Meta label="Source" value={kpi.source === "manual" ? "Manual entry" : kpi.source.replace(/_/g, " ")} capitalize />
        <Meta label="Unit" value={kpi.unit} capitalize />
        <Meta label="Periodicity" value={kpi.periodicity} capitalize />
        <TargetRow kpi={kpi} canManage={canManage} />
        <Meta
          label="Owner"
          value={
            kpi.owner?.name
              ? kpi.owner.employeeNumber
                ? `${kpi.owner.name} (${kpi.owner.employeeNumber})`
                : kpi.owner.name
              : "—"
          }
        />
        <Meta label="Status" value={kpi.isActive ? "Active" : "Inactive"} />

        {actionError && (
          <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:text-red-400">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {actionError}
          </div>
        )}

        {canManage && (
          <Button type="button" variant="outline" size="sm" onClick={handleToggleActive} disabled={isPending} className="w-full mt-2">
            {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            {kpi.isActive ? "Deactivate" : "Reactivate"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Inline-editable Target row ────────────────────────────────
// Click the pencil → input + Save/Cancel inline. On Save, server action
// redirects back to this same URL so the new value just appears in the
// re-rendered row. Errors render below the input.
function TargetRow({ kpi, canManage }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(kpi.target ?? ""));
  const [error, setError] = useState(null);
  const [isPending, start] = useTransition();

  function handleSave() {
    setError(null);
    start(async () => {
      const res = await updateKpiTarget(kpi._id, parseFloat(draft));
      if (res && !res.success) {
        setError(res.error || "Could not save target");
      }
      // Success: server redirect re-renders the page, this component remounts
      // with the new value and editing closed by default.
    });
  }

  function handleCancel() {
    setDraft(String(kpi.target ?? ""));
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">Target</span>
        <span className="font-medium text-foreground text-right">
          {formatKpiValue(kpi.target, kpi.unit)}
          <span className="text-xs text-muted-foreground ml-1">
            ({kpi.targetDirection === "higher_is_better" ? "higher is better" : "lower is better"})
          </span>
          {canManage && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="ml-2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Edit target"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs">Target</span>
        <input
          type="number"
          step="any"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={isPending}
          autoFocus
          className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="rounded p-1 text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-50"
          title="Save"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={isPending}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Cancel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

function Meta({ label, value, capitalize }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium text-foreground text-right ${capitalize ? "capitalize" : ""}`}>{value || "—"}</span>
    </div>
  );
}

// ─── Snapshots ─────────────────────────────────────────────────
function SnapshotsCard({ kpi, canEnter, canManage }) {
  const [showEntry, setShowEntry] = useState(false);
  const [showBackfill, setShowBackfill] = useState(false);

  return (
    <Card className="bg-card border-border">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold">Snapshots</h2>
          {canEnter && (
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {kpi.source !== "manual" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowBackfill((v) => !v)}
                  className="w-full sm:w-auto"
                >
                  <RefreshCw className="h-3 w-3" />
                  {showBackfill ? "Cancel" : "Compute"}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={() => setShowEntry((v) => !v)}
                className="w-full sm:w-auto"
              >
                <Plus className="h-3 w-3" />
                {showEntry ? "Cancel" : "Record actual"}
              </Button>
            </div>
          )}
        </div>

        {showBackfill && <ComputeForPeriodForm kpi={kpi} />}
        {showEntry && <RecordSnapshotForm kpi={kpi} />}

        {kpi.snapshots.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No snapshots yet.</p>
        ) : (
          <>
            {/* Desktop / tablet: dense table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3">Period</th>
                    <th className="py-2 pr-3 text-right">Actual</th>
                    <th className="py-2 pr-3 text-right">Target</th>
                    <th className="py-2 pr-3 text-right">vs Target</th>
                    <th className="py-2 pr-3 text-right">vs Prior</th>
                    <th className="py-2 pr-3 text-right">YoY</th>
                    <th className="py-2 pr-3">Source</th>
                    <th className="py-2 pr-3">Notes</th>
                    {canManage && <th className="py-2 text-right"></th>}
                  </tr>
                </thead>
                <tbody>
                  {kpi.snapshots.map((s) => (
                    <SnapshotRow key={s._id} s={s} kpi={kpi} canManage={canManage} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: stacked cards */}
            <ul className="md:hidden divide-y divide-border">
              {kpi.snapshots.map((s) => (
                <SnapshotMobileCard key={s._id} s={s} kpi={kpi} canManage={canManage} />
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Desktop snapshot row ──────────────────────────────────────
function SnapshotRow({ s, kpi, canManage }) {
  const st = kpiStatus(s.actualValue, s.targetAtTime, kpi.targetDirection, kpi.customThresholds);
  const pct = percentVsTarget(s.actualValue, s.targetAtTime);
  const pctClass =
    st === "on_target"
      ? "text-emerald-600 dark:text-emerald-400"
      : st === "near_target"
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400";
  return (
    <tr className="border-t border-border">
      <td className="py-2 pr-3 font-medium">
        {shortPeriodLabel(s.periodYear, s.periodMonth, s.periodicity || kpi.periodicity)}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{formatKpiValue(s.actualValue, kpi.unit)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{formatKpiValue(s.targetAtTime, kpi.unit)}</td>
      <td className={`py-2 pr-3 text-right tabular-nums ${pctClass}`}>{pct != null ? `${pct.toFixed(0)}%` : "—"}</td>
      <td className={`py-2 pr-3 text-right tabular-nums ${deltaClass(s.priorDeltaPct, kpi.targetDirection)}`}>
        {formatDelta(s.priorDeltaPct)}
      </td>
      <td className={`py-2 pr-3 text-right tabular-nums ${deltaClass(s.yoyDeltaPct, kpi.targetDirection)}`}>
        {formatDelta(s.yoyDeltaPct)}
      </td>
      <td className="py-2 pr-3 text-xs text-muted-foreground capitalize">{s.source}</td>
      <td className="py-2 pr-3 text-xs text-muted-foreground">{s.notes || "—"}</td>
      {canManage && (
        <td className="py-2 text-right">
          <DeleteSnapshotButton snapshotId={s._id} kpiId={kpi._id} />
        </td>
      )}
    </tr>
  );
}

// ─── Mobile snapshot card ──────────────────────────────────────
// Stacked layout: period + actual on top, target + vs-target underneath,
// deltas in a row, source/notes/delete at the bottom.
function SnapshotMobileCard({ s, kpi, canManage }) {
  const st = kpiStatus(s.actualValue, s.targetAtTime, kpi.targetDirection, kpi.customThresholds);
  const pct = percentVsTarget(s.actualValue, s.targetAtTime);
  const pctClass =
    st === "on_target"
      ? "text-emerald-600 dark:text-emerald-400"
      : st === "near_target"
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400";
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {shortPeriodLabel(s.periodYear, s.periodMonth, s.periodicity || kpi.periodicity)}
            <span className="ml-1.5 normal-case">· {s.source === "auto" ? "Auto" : "Manual"}</span>
          </p>
          <p className="text-lg font-semibold tabular-nums text-foreground">
            {formatKpiValue(s.actualValue, kpi.unit)}
          </p>
        </div>
        {canManage && <DeleteSnapshotButton snapshotId={s._id} kpiId={kpi._id} />}
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Target</dt>
          <dd className="tabular-nums text-foreground">{formatKpiValue(s.targetAtTime, kpi.unit)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">vs Target</dt>
          <dd className={`tabular-nums font-medium ${pctClass}`}>{pct != null ? `${pct.toFixed(0)}%` : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">vs Prior</dt>
          <dd className={`tabular-nums font-medium ${deltaClass(s.priorDeltaPct, kpi.targetDirection)}`}>
            {formatDelta(s.priorDeltaPct)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">YoY</dt>
          <dd className={`tabular-nums font-medium ${deltaClass(s.yoyDeltaPct, kpi.targetDirection)}`}>
            {formatDelta(s.yoyDeltaPct)}
          </dd>
        </div>
      </dl>

      {s.notes && (
        <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{s.notes}</p>
      )}
    </li>
  );
}

// ─── Compute For Period ────────────────────────────────────────
// Lets the user backfill any past period in one click. The period picker
// adapts to the KPI's periodicity: month list for monthly, quarter list
// for quarterly, year-only for yearly.
function ComputeForPeriodForm({ kpi }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [error, setError] = useState(null);
  const [isComputing, start] = useTransition();

  function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    start(async () => {
      // Action server-redirects on success; only failures return here.
      const res = await computeKpiSnapshot(kpi._id, Number(year), Number(month));
      if (res && !res.success) setError(res.error || "Could not compute snapshot");
    });
  }

  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i);

  return (
    <form onSubmit={handleSubmit} className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
      <p className="text-xs text-muted-foreground">
        Recompute the actual value for a past period. Existing snapshot for the period will be overwritten.
      </p>
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:text-red-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Year</label>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        {kpi.periodicity === "monthly" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Month</label>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {new Date(2000, m - 1).toLocaleString("en", { month: "long" })}
                </option>
              ))}
            </select>
          </div>
        )}

        {kpi.periodicity === "quarterly" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Quarter</label>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value={3}>Q1 (Jan–Mar)</option>
              <option value={6}>Q2 (Apr–Jun)</option>
              <option value={9}>Q3 (Jul–Sep)</option>
              <option value={12}>Q4 (Oct–Dec)</option>
            </select>
          </div>
        )}

        <div className="col-span-2 flex items-end sm:col-span-1 sm:col-start-4">
          <Button type="submit" size="sm" disabled={isComputing} className="w-full">
            {isComputing && <Loader2 className="h-3 w-3 animate-spin" />}
            Compute
          </Button>
        </div>
      </div>
    </form>
  );
}

// ─── Record Snapshot Form ──────────────────────────────────────
// Success path: the action server-redirects to the KPI detail page, so
// the table below re-renders with the new row. No client-side success
// signal needed. Failure path returns state.error which renders inline.
function RecordSnapshotForm({ kpi }) {
  const now = new Date();
  const recordAction = recordKpiSnapshot.bind(null, kpi._id);
  const [state, formAction, isPending] = useActionState(recordAction, { success: false, error: null });

  return (
    <form action={formAction} className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
      {state.error && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:text-red-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {state.error}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <FormField label="Year" name="periodYear" type="number" defaultValue={now.getFullYear()} error={state.fieldErrors?.periodYear} />
        <FormField label="Month" name="periodMonth" type="number" min="1" max="12" defaultValue={now.getMonth() + 1} error={state.fieldErrors?.periodMonth} />
        <FormField label="Actual value" name="actualValue" type="number" step="any" required error={state.fieldErrors?.actualValue} />
        <div className="flex items-end">
          <Button type="submit" size="sm" disabled={isPending} className="w-full">
            {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
      <FormField label="Notes (optional)" name="notes" placeholder="Anything noteworthy about this period?" />
    </form>
  );
}

function FormField({ label, name, error, ...rest }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-foreground">{label}</label>
      <input
        name={name}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        {...rest}
      />
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

// ─── Delete Snapshot ───────────────────────────────────────────
function DeleteSnapshotButton({ snapshotId, kpiId }) {
  const [isPending, start] = useTransition();
  const [error, setError] = useState(null);

  function handleDelete() {
    if (!confirm("Delete this snapshot? This cannot be undone.")) return;
    setError(null);
    start(async () => {
      // Action server-redirects on success; only the failure path returns.
      const res = await deleteKpiSnapshot(snapshotId);
      if (res && !res.success) setError(res.error || "Could not delete snapshot");
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleDelete}
        disabled={isPending}
        className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-red-600"
        title="Delete snapshot"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </button>
      {error && (
        <p className="mt-0.5 text-[10px] text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
