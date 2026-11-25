"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Play,
  Loader2,
  Download,
  Printer,
  Save,
  Trash2,
  Plus,
  X,
  ArrowUpDown,
  Columns3,
  Filter,
  Layers,
  BookmarkCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FILTER_OPS } from "@/lib/reports/catalog";
import {
  getDatasetColumns,
  runCustomReport,
  saveReport,
  deleteSavedReport,
} from "@/app/db/actions/report-builder-actions";

/**
 * Build a report on a module's activity: dataset → columns → filters → dates
 * → group and totals → sort. Run it, export CSV, print, or save it to run
 * again later. The server checks every column name against the dataset.
 */

const field =
  "rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";

function fmt(value, type) {
  if (value === null || value === undefined || value === "") return "—";
  if (type === "number") return Number(value).toLocaleString("en-KE", { maximumFractionDigits: 2 });
  if (type === "boolean") return value ? "Yes" : "No";
  if (type === "date") {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const hasTime = /T\d{2}:\d{2}/.test(String(value)) && !/T00:00:00(\.000)?Z$/.test(String(value));
    return d.toLocaleString("en-KE", hasTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" });
  }
  const s = String(value);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s.replace(/_/g, " ");
}

function csvOf(columns, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => esc(c.label)).join(","), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(","))].join("\n");
}

const DEFAULT_COLS = 8;

export default function ReportBuilder({ module, saved, initialSavedId = "" }) {
  const router = useRouter();
  const [dataset, setDataset] = useState(module.datasets[0].id);
  const [available, setAvailable] = useState([]);
  const [columns, setColumns] = useState([]);
  const [filters, setFilters] = useState([]);
  const [dateColumn, setDateColumn] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [groupBy, setGroupBy] = useState("");
  const [sort, setSort] = useState({ column: "", dir: "desc" });
  const [limit, setLimit] = useState(1000);
  const [result, setResult] = useState(null);
  const [savedId, setSavedId] = useState("");
  const [saveName, setSaveName] = useState("");
  const [shared, setShared] = useState(true);
  const [loadingCols, startCols] = useTransition();
  const [running, startRun] = useTransition();
  const [saving, startSave] = useTransition();
  const [pendingDef, setPendingDef] = useState(null);

  const dsLabel = module.datasets.find((d) => d.id === dataset)?.label ?? dataset;
  const dateCols = available.filter((c) => c.type === "date");

  // Load the dataset's columns; apply a saved definition once they arrive.
  useEffect(() => {
    startCols(async () => {
      const cols = await getDatasetColumns(module.id, dataset);
      setAvailable(cols);
      if (pendingDef && pendingDef.dataset === dataset) {
        const keys = new Set(cols.map((c) => c.key));
        setColumns((pendingDef.columns ?? []).filter((k) => keys.has(k)));
        setFilters(pendingDef.filters ?? []);
        setDateColumn(pendingDef.dateColumn ?? "");
        setFrom(pendingDef.from ?? "");
        setTo(pendingDef.to ?? "");
        setGroupBy(pendingDef.groupBy ?? "");
        setSort(pendingDef.sort ?? { column: "", dir: "desc" });
        setLimit(pendingDef.limit ?? 1000);
        setPendingDef(null);
      } else {
        const preferred = cols.filter((c) => !/(^id$|_id$)/.test(c.key)).slice(0, DEFAULT_COLS).map((c) => c.key);
        setColumns(preferred);
        setFilters([]);
        setGroupBy("");
        setSort({ column: "", dir: "desc" });
        setDateColumn(cols.find((c) => c.key === "created_at")?.key ?? cols.find((c) => c.type === "date")?.key ?? "");
      }
      setResult(null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, module.id]);

  const definition = () => ({
    module: module.id,
    dataset,
    columns,
    filters: filters.filter((f) => f.column),
    dateColumn: dateColumn || null,
    from: from || null,
    to: to || null,
    groupBy: groupBy || null,
    sort: sort.column ? sort : null,
    limit,
  });

  const run = () =>
    startRun(async () => {
      const res = await runCustomReport(definition());
      if (!res.success) return toast.error(res.error);
      setResult(res);
    });

  const loadSaved = (id) => {
    const s = saved.find((r) => r.id === id);
    setSavedId(id);
    if (!s) return;
    setSaveName(s.name);
    setShared(Boolean(s.shared));
    const def = s.definition;
    if (def.dataset === dataset) {
      setPendingDef(null);
      const keys = new Set(available.map((c) => c.key));
      setColumns((def.columns ?? []).filter((k) => keys.has(k)));
      setFilters(def.filters ?? []);
      setDateColumn(def.dateColumn ?? "");
      setFrom(def.from ?? "");
      setTo(def.to ?? "");
      setGroupBy(def.groupBy ?? "");
      setSort(def.sort ?? { column: "", dir: "desc" });
      setLimit(def.limit ?? 1000);
    } else {
      setPendingDef(def);
      setDataset(def.dataset);
    }
  };

  useEffect(() => {
    if (initialSavedId) loadSaved(initialSavedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleColumn = (key) =>
    setColumns((cs) => (cs.includes(key) ? cs.filter((k) => k !== key) : [...cs, key]));

  const totals = useMemo(() => {
    if (!result || result.grouped) return null;
    const t = {};
    for (const c of result.columns) {
      if (c.type === "number" && !/(_id$|^id$|number$|_no$|year|rate|percent)/i.test(c.key)) {
        t[c.key] = result.rows.reduce((a, r) => a + (Number(r[c.key]) || 0), 0);
      }
    }
    return Object.keys(t).length ? t : null;
  }, [result]);

  const exportCsv = () => {
    if (!result) return;
    const blob = new Blob([csvOf(result.columns, result.rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${module.id}-${dataset}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      {/* Saved reports */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3 print:hidden">
        <BookmarkCheck className="h-4 w-4 text-muted-foreground" />
        <select aria-label="Saved reports" value={savedId} onChange={(e) => loadSaved(e.target.value)} className={`${field} min-w-[12rem]`}>
          <option value="">{saved.length ? "Open a saved report…" : "No saved reports yet"}</option>
          {saved.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.shared ? "" : " (only me)"} — {s.createdByName}
            </option>
          ))}
        </select>
        <input aria-label="Report name" value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Name to save as" className={`${field} min-w-0 flex-1`} />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Share with colleagues
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={saving || !saveName.trim()}
          onClick={() =>
            startSave(async () => {
              const existing = saved.find((s) => s.id === savedId && s.name === saveName.trim());
              const r = await saveReport(saveName, definition(), shared, existing ? savedId : null);
              if (!r.success) return toast.error(r.error);
              toast.success(r.message);
              setSavedId(r.id);
              router.refresh();
            })
          }
        >
          {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />} Save
        </Button>
        {savedId && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={saving}
            onClick={() =>
              startSave(async () => {
                const r = await deleteSavedReport(savedId);
                if (!r.success) return toast.error(r.error);
                toast.success(r.message);
                setSavedId("");
                setSaveName("");
                router.refresh();
              })
            }
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        {/* Builder panel */}
        <aside className="space-y-4 rounded-xl border border-border bg-card p-4 print:hidden">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="rb-dataset">
              Data
            </label>
            <select id="rb-dataset" value={dataset} onChange={(e) => setDataset(e.target.value)} className={`${field} w-full`}>
              {module.datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dates</p>
            <select aria-label="Date column" value={dateColumn} onChange={(e) => setDateColumn(e.target.value)} className={`${field} w-full`}>
              {dateCols.length === 0 && <option value="">No date columns</option>}
              {dateCols.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
              <input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className={field} />
            </div>
            <div className="flex flex-wrap gap-1">
              {[
                ["Today", 0],
                ["7 days", 7],
                ["30 days", 30],
                ["This year", "year"],
                ["All", null],
              ].map(([l, d]) => (
                <button
                  type="button"
                  key={l}
                  onClick={() => {
                    const now = new Date();
                    const day = (x) => x.toISOString().slice(0, 10);
                    if (d === null) {
                      setFrom("");
                      setTo("");
                    } else if (d === "year") {
                      setFrom(`${now.getFullYear()}-01-01`);
                      setTo(day(now));
                    } else {
                      const f = new Date(now);
                      f.setDate(f.getDate() - d);
                      setFrom(day(f));
                      setTo(day(now));
                    }
                  }}
                  className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Filter className="h-3 w-3" /> Filters
              </p>
              <button
                type="button"
                onClick={() => setFilters((f) => [...f, { column: available[0]?.key ?? "", op: "contains", value: "" }])}
                className="flex items-center gap-0.5 text-xs text-primary hover:underline"
              >
                <Plus className="h-3 w-3" /> Add
              </button>
            </div>
            {filters.map((f, i) => (
              <div key={i} className="space-y-1 rounded-md border border-border p-2">
                <div className="flex gap-1">
                  <select
                    aria-label="Filter column"
                    value={f.column}
                    onChange={(e) => setFilters((all) => all.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)))}
                    className={`${field} min-w-0 flex-1`}
                  >
                    {available.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <button type="button" aria-label="Remove filter" onClick={() => setFilters((all) => all.filter((_, j) => j !== i))} className="rounded p-1 text-muted-foreground hover:bg-muted">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex gap-1">
                  <select
                    aria-label="Condition"
                    value={f.op}
                    onChange={(e) => setFilters((all) => all.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)))}
                    className={field}
                  >
                    {FILTER_OPS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {!["empty", "not_empty"].includes(f.op) && (
                    <input
                      aria-label="Value"
                      value={f.value ?? ""}
                      onChange={(e) => setFilters((all) => all.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                      className={`${field} min-w-0 flex-1`}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Layers className="h-3 w-3" /> Group and total
            </p>
            <select aria-label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className={`${field} w-full`}>
              <option value="">No grouping — list every row</option>
              {available.map((c) => (
                <option key={c.key} value={c.key}>
                  By {c.label.toLowerCase()}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">Grouped: a count per group, and totals of the number columns you picked.</p>
          </div>

          {!groupBy && (
            <div className="space-y-1.5">
              <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <ArrowUpDown className="h-3 w-3" /> Sort
              </p>
              <div className="flex gap-1">
                <select aria-label="Sort by" value={sort.column} onChange={(e) => setSort((s) => ({ ...s, column: e.target.value }))} className={`${field} min-w-0 flex-1`}>
                  <option value="">Newest first</option>
                  {available.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <select aria-label="Direction" value={sort.dir} onChange={(e) => setSort((s) => ({ ...s, dir: e.target.value }))} className={field}>
                  <option value="desc">↓</option>
                  <option value="asc">↑</option>
                </select>
              </div>
              <select aria-label="Row limit" value={limit} onChange={(e) => setLimit(Number(e.target.value))} className={`${field} w-full`}>
                {[100, 500, 1000, 5000].map((n) => (
                  <option key={n} value={n}>
                    Up to {n.toLocaleString()} rows
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Columns3 className="h-3 w-3" /> Columns · {columns.length}
              </p>
              <span className="flex gap-2 text-xs">
                <button type="button" className="text-primary hover:underline" onClick={() => setColumns(available.map((c) => c.key))}>
                  All
                </button>
                <button type="button" className="text-primary hover:underline" onClick={() => setColumns([])}>
                  None
                </button>
              </span>
            </div>
            {loadingCols ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Reading the columns…
              </p>
            ) : (
              <div className="flex max-h-64 flex-wrap gap-1 overflow-y-auto">
                {available.map((c) => {
                  const on = columns.includes(c.key);
                  return (
                    <button
                      type="button"
                      key={c.key}
                      onClick={() => toggleColumn(c.key)}
                      aria-pressed={on}
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${
                        on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <Button className="w-full" onClick={run} disabled={running || loadingCols}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />} Run report
          </Button>
        </aside>

        {/* Result */}
        <section className="min-w-0 rounded-xl border border-border bg-card">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">
                {saveName || `${module.label}: ${dsLabel}`}
                {groupBy && result?.grouped ? ` by ${available.find((c) => c.key === groupBy)?.label.toLowerCase()}` : ""}
              </h2>
              <p className="text-xs text-muted-foreground">
                {result
                  ? `${result.rows.length.toLocaleString()} ${result.grouped ? "groups" : "rows"}${result.truncated ? " (limit reached — narrow the filters)" : ""}${from || to ? ` · ${from || "start"} to ${to || "today"}` : ""}`
                  : "Choose what you want, then run the report."}
              </p>
            </div>
            {result && (
              <div className="flex gap-2 print:hidden">
                <Button size="sm" variant="outline" onClick={exportCsv}>
                  <Download className="mr-1.5 h-3.5 w-3.5" /> CSV
                </Button>
                <Button size="sm" variant="outline" onClick={() => window.print()}>
                  <Printer className="mr-1.5 h-3.5 w-3.5" /> Print
                </Button>
              </div>
            )}
          </header>
          {result && result.rows.length === 0 && (
            <p className="p-8 text-center text-sm text-muted-foreground">Nothing matches. Widen the dates or remove a filter.</p>
          )}
          {result && result.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/60 text-left">
                  <tr>
                    {result.columns.map((c) => (
                      <th key={c.key} className={`whitespace-nowrap px-3 py-2 font-semibold ${c.type === "number" ? "text-right" : ""}`}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.rows.map((r, i) => (
                    <tr key={i} className="hover:bg-muted/30">
                      {result.columns.map((c) => (
                        <td key={c.key} className={`px-3 py-1.5 ${c.type === "number" ? "text-right tabular-nums" : ""} ${c.type === "text" ? "max-w-[18rem] truncate" : "whitespace-nowrap"}`}>
                          {fmt(r[c.key], c.type)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {totals && (
                  <tfoot className="border-t-2 border-border bg-muted/40 font-semibold">
                    <tr>
                      {result.columns.map((c, i) => (
                        <td key={c.key} className={`px-3 py-2 ${c.type === "number" ? "text-right tabular-nums" : ""}`}>
                          {c.key in totals ? fmt(totals[c.key], "number") : i === 0 ? "Total" : ""}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
