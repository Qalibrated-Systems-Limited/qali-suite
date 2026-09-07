"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { MetricBar } from "@/components/metric-bar";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Ruler,
  Plus,
  Loader2,
  Trash2,
  Gavel,
  AlertTriangle,
  X,
} from "lucide-react";
import {
  createProjectBoq,
  createProjectBoqItem,
  deleteProjectBoqItem,
  awardProjectBoq,
  recordProjectBoqMeasurement,
} from "@/app/db/actions/project-actions";
import { toast } from "sonner";
import ImportBoq from "./ImportBoq";

/**
 * The bill of quantities — 0080, and the screen where progress stops being an
 * opinion.
 *
 * TWO MODES, and the bill's status decides which. A DRAFT is edited: lines are
 * added, priced and removed. An AWARDED bill is MEASURED: the rates are frozen
 * and the only thing anyone can write is a remeasure. Showing both sets of
 * controls at once would offer edits the database is going to refuse.
 *
 * A NEGATIVE MEASUREMENT IS OFFERED, NOT HIDDEN. It is how a certified
 * over-measure is corrected without editing what was certified, and a QS who
 * cannot find it will delete the original instead — which is the one thing that
 * loses the audit trail.
 */

const STATUS_BADGE = {
  draft: "bg-amber-500/10 text-amber-600",
  awarded: "bg-emerald-500/10 text-emerald-600",
  superseded: "bg-muted text-muted-foreground",
};

/**
 * Offered, never enforced. The method of measurement decides the real list and
 * it belongs to the tenant's contract — see 0080 decision 7 — so this is a
 * convenience on a free-text field.
 */
const UNITS = ["m", "m2", "m3", "kg", "t", "no", "sum", "item", "hr", "day", "%"];

const MOM = ["CESMM4", "SMM7", "POMI", "NRM2", "Contract-specific"];

const EMPTY_ITEM = {
  itemCode: "",
  description: "",
  isHeading: false,
  unit: "",
  quantity: "",
  rate: "",
  parentItemId: "",
  costCodeId: "",
  taskId: "",
  sortOrder: "",
};

function money(n) {
  return new Intl.NumberFormat("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

function qty(n) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-KE", { maximumFractionDigits: 3 }).format(
    Number(n) || 0,
  );
}

export default function BoqRegister({
  projectId,
  boq,
  items = [],
  summary,
  versions = [],
  contractValue = null,
  costCodes = [],
  tasks = [],
  canManage = false,
  canAward = false,
}) {
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_ITEM);
  const [measuringId, setMeasuringId] = useState(null);
  const [measurement, setMeasurement] = useState({
    quantity: "",
    measuredOn: new Date().toISOString().slice(0, 10),
    reference: "",
  });

  const isDraft = boq?.status === "draft";
  const isAwarded = boq?.status === "awarded";

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function startBill() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("projectId", projectId);
      const res = await createProjectBoq(null, fd);
      if (res?.success) toast.success(res.message);
      else toast.error(Object.values(res?.errors ?? {}).flat()[0] || "Failed");
    });
  }

  function saveItem() {
    if (!form.description.trim()) {
      toast.error("A bill item needs a description");
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("boqId", boq.id);
      fd.set("projectId", projectId);
      Object.entries(form).forEach(([k, v]) => {
        fd.set(k, k === "isHeading" ? (v ? "true" : "") : (v ?? ""));
      });
      const res = await createProjectBoqItem(null, fd);
      if (res?.success) {
        toast.success(res.message);
        // The code, unit and parent are kept: a bill is typed in runs, and
        // re-picking the section for every line is the fastest way to make
        // somebody give up on the form.
        setForm((f) => ({ ...EMPTY_ITEM, unit: f.unit, parentItemId: f.parentItemId }));
      } else {
        toast.error(Object.values(res?.errors ?? {}).flat()[0] || "Failed to save");
      }
    });
  }

  function removeItem(item) {
    startTransition(async () => {
      const res = await deleteProjectBoqItem(item.id, projectId);
      if (res.success) toast.success(res.message);
      else toast.error(res.error);
    });
  }

  function award() {
    startTransition(async () => {
      const res = await awardProjectBoq(boq.id);
      if (res.success) toast.success(res.message);
      else toast.error(res.error);
    });
  }

  function saveMeasurement(item) {
    if (!measurement.quantity.trim()) {
      toast.error("A measurement needs a quantity");
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("boqItemId", item.id);
      fd.set("projectId", projectId);
      fd.set("quantity", measurement.quantity);
      fd.set("measuredOn", measurement.measuredOn);
      fd.set("reference", measurement.reference);
      const res = await recordProjectBoqMeasurement(null, fd);
      if (res?.success) {
        toast.success(res.message);
        setMeasuringId(null);
        setMeasurement({
          quantity: "",
          measuredOn: new Date().toISOString().slice(0, 10),
          reference: "",
        });
      } else {
        toast.error(Object.values(res?.errors ?? {}).flat()[0] || "Failed to save");
      }
    });
  }

  // ── No bill at all ─────────────────────────────────────────────────────────
  if (!boq) {
    return (
      <Card className="p-5 sm:p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Ruler className="h-6 w-6 text-primary" />
        </div>
        <h2 className="font-semibold text-lg mb-1">No bill of quantities</h2>
        <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
          A priced bill makes this project&apos;s progress a measurement rather
          than a typed percentage — and it is what a certificate values work
          against. A lump-sum or supply job legitimately has none.
        </p>
        {canManage && (
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {/* Importing comes first: a real bill arrives as a spreadsheet, and
                typing one in is the reason a project ends up without one. */}
            <ImportBoq projectId={projectId} />
            <Button size="sm" variant="outline" onClick={startBill} disabled={isPending}>
              {isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-1.5" />
              )}
              Start an empty bill
            </Button>
          </div>
        )}
      </Card>
    );
  }

  const overBilled =
    contractValue > 0 && Math.abs(summary.billed - contractValue) >= 1;

  const sections = items.filter((i) => i.isHeading || i.childCount > 0);

  return (
    <div className="space-y-4">
      {/* ── The bill's own facts ───────────────────────────────────────────── */}
      <Card className="p-4 sm:p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Ruler className="h-5 w-5 text-muted-foreground shrink-0" />
            <h3 className="font-semibold">Bill of Quantities</h3>
            <Badge variant="outline" className="text-xs">v{boq.version}</Badge>
            <Badge className={`text-xs capitalize ${STATUS_BADGE[boq.status]}`}>
              {boq.status}
            </Badge>
            {boq.methodOfMeasurement && (
              <span className="text-xs text-muted-foreground">
                {boq.methodOfMeasurement}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isDraft && canManage && <ImportBoq projectId={projectId} />}
            {isDraft && canManage && !showForm && (
              <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
                <Plus className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Add item</span>
              </Button>
            )}
            {isDraft && canAward && summary.pricedCount > 0 && (
              <Button size="sm" onClick={award} disabled={isPending}>
                {isPending ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Gavel className="h-4 w-4 mr-1.5" />
                )}
                Award
              </Button>
            )}
          </div>
        </div>

        <MetricBar
          items={[
            { label: "Bill total", value: `KES ${money(summary.billed)}` },
            {
              label: "Measured",
              value: `KES ${money(summary.measured)}`,
              tone: "success",
            },
            {
              label: "Complete",
              value: `${summary.percent}%`,
              tone: summary.percent > 100 ? "warn" : "default",
            },
            { label: "Items priced", value: summary.pricedCount },
            {
              label: "Over-measured",
              value: summary.overMeasured,
              tone: summary.overMeasured > 0 ? "warn" : "muted",
            },
          ]}
        />

        {/*
          WARNED, NEVER BLOCKED — the same rule as the budget at 90% and a
          milestone schedule that does not sum to the contract. For a remeasured
          contract the priced bill IS the contract sum, so a difference is worth
          surfacing; it is not a reason to refuse anybody's work.
        */}
        {overBilled && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-amber-800 dark:text-amber-300">
              The bill totals KES {money(summary.billed)} and the contract value
              on this project is KES {money(contractValue)} — a difference of KES{" "}
              {money(Math.abs(summary.billed - contractValue))}. On a remeasured
              contract these are the same figure.
            </p>
          </div>
        )}

        {isDraft && (
          <p className="text-xs text-muted-foreground">
            This bill is a draft: nothing can be measured against it yet, and
            awarding it freezes every quantity and rate in it.
          </p>
        )}
        {isAwarded && (
          <p className="text-xs text-muted-foreground">
            Awarded {boq.awardedAt ? new Date(boq.awardedAt).toLocaleDateString("en-KE") : ""}
            {boq.awardedByName ? ` by ${boq.awardedByName}` : ""}. Rates are
            frozen — a change of scope is a variation, not an edit.
          </p>
        )}
      </Card>

      {/* ── Adding a line ──────────────────────────────────────────────────── */}
      {showForm && isDraft && canManage && (
        <Card className="p-4 sm:p-5 space-y-3 bg-muted/30">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">New bill item</h4>
            <Button size="icon" variant="ghost" onClick={() => setShowForm(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="isHeading"
              checked={form.isHeading}
              onCheckedChange={(v) => set("isHeading", Boolean(v))}
            />
            <label htmlFor="isHeading" className="text-sm">
              A section heading — carries no quantity of its own
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Item code</label>
              <Input
                placeholder="B.2.14"
                className="h-9"
                value={form.itemCode}
                onChange={(e) => set("itemCode", e.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-3">
              <label className="text-xs font-medium text-muted-foreground">Description *</label>
              <Input
                placeholder="Excavate to reduce level, not exceeding 2m deep"
                className="h-9"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </div>
          </div>

          {!form.isHeading && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Unit</label>
                <Select value={form.unit || undefined} onValueChange={(v) => set("unit", v)}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="m3" /></SelectTrigger>
                  <SelectContent>
                    {UNITS.map((u) => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Quantity</label>
                <Input
                  type="number"
                  step="0.0001"
                  className="h-9"
                  value={form.quantity}
                  onChange={(e) => set("quantity", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Rate (KES)</label>
                <Input
                  type="number"
                  step="0.0001"
                  className="h-9"
                  value={form.rate}
                  onChange={(e) => set("rate", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Amount</label>
                <div className="h-9 flex items-center px-3 rounded-md border bg-background text-sm tabular-nums text-muted-foreground">
                  {money(Number(form.quantity || 0) * Number(form.rate || 0))}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Under section</label>
              <Select
                value={form.parentItemId || "none"}
                onValueChange={(v) => set("parentItemId", v === "none" ? "" : v)}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Top level</SelectItem>
                  {sections.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.itemCode ? `${s.itemCode} — ` : ""}
                      {s.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!form.isHeading && costCodes.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Cost code</label>
                <Select
                  value={form.costCodeId || "none"}
                  onValueChange={(v) => set("costCodeId", v === "none" ? "" : v)}
                >
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {costCodes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {!form.isHeading && tasks.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Programme activity
                </label>
                <Select
                  value={form.taskId || "none"}
                  onValueChange={(v) => set("taskId", v === "none" ? "" : v)}
                >
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {tasks.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={saveItem} disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Add item
            </Button>
          </div>
        </Card>
      )}

      {/* ── The bill ───────────────────────────────────────────────────────── */}
      <Card className="p-0 overflow-hidden">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12 px-4">
            Nothing in this bill yet. Add a section, then the items priced under
            it.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="border-b bg-muted/40 text-left">
                  <th className="px-3 py-2 font-medium text-muted-foreground">Item</th>
                  <th className="px-2 py-2 font-medium text-muted-foreground w-16">Unit</th>
                  <th className="px-2 py-2 font-medium text-muted-foreground text-right w-24">Qty</th>
                  <th className="px-2 py-2 font-medium text-muted-foreground text-right w-24">Rate</th>
                  <th className="px-2 py-2 font-medium text-muted-foreground text-right w-28">Amount</th>
                  <th className="px-2 py-2 font-medium text-muted-foreground text-right w-24">Measured</th>
                  <th className="px-2 py-2 font-medium text-muted-foreground text-right w-16">%</th>
                  <th className="px-2 py-2 w-24" />
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const isSection = it.isHeading || it.childCount > 0;
                  const pct =
                    it.billedAmount > 0
                      ? Math.round((it.measuredAmount / it.billedAmount) * 100)
                      : null;
                  const over = it.quantity != null && it.measuredQuantity > it.quantity;
                  return (
                    <tr
                      key={it.id}
                      className={`border-b last:border-0 ${isSection ? "bg-muted/20 font-medium" : ""}`}
                    >
                      <td className="px-3 py-2">
                        <div style={{ paddingLeft: `${Math.min(it.depth, 5) * 16}px` }}>
                          <span className="font-mono text-xs text-muted-foreground mr-2">
                            {it.itemCode || ""}
                          </span>
                          {it.description}
                          {it.costCode && (
                            <span className="ml-2 text-[10px] text-muted-foreground">
                              {it.costCode}
                            </span>
                          )}
                          {it.taskTitle && (
                            <Badge variant="outline" className="ml-2 text-[10px] font-normal">
                              {it.taskTitle}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">{it.unit || ""}</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {it.quantity == null ? "" : qty(it.quantity)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {it.rate == null ? "" : money(it.rate)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {money(it.billedAmount)}
                      </td>
                      <td
                        className={`px-2 py-2 text-right tabular-nums ${over ? "text-amber-600" : ""}`}
                        title={over ? "Measured beyond the billed quantity" : undefined}
                      >
                        {it.quantity == null ? money(it.measuredAmount) : qty(it.measuredQuantity)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                        {pct === null ? "" : `${pct}%`}
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        {isAwarded && canManage && it.quantity != null && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() =>
                              setMeasuringId(measuringId === it.id ? null : it.id)
                            }
                          >
                            Measure
                          </Button>
                        )}
                        {isDraft && canManage && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => removeItem(it)}
                            disabled={isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Recording a remeasure ──────────────────────────────────────────── */}
      {measuringId && (
        <Card className="p-4 sm:p-5 space-y-3 bg-muted/30">
          <h4 className="text-sm font-medium">
            Measure — {items.find((i) => i.id === measuringId)?.description}
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Quantity this measure *
              </label>
              <Input
                type="number"
                step="0.0001"
                className="h-9"
                value={measurement.quantity}
                onChange={(e) =>
                  setMeasurement((m) => ({ ...m, quantity: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Measured on</label>
              <Input
                type="date"
                className="h-9"
                value={measurement.measuredOn}
                onChange={(e) =>
                  setMeasurement((m) => ({ ...m, measuredOn: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Reference — chainage, sheet, level
              </label>
              <Input
                placeholder="CH 0+000 – 0+060"
                className="h-9"
                value={measurement.reference}
                onChange={(e) =>
                  setMeasurement((m) => ({ ...m, reference: e.target.value }))
                }
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            This ADDS to what has been measured so far. To correct an
            over-measure already certified, enter a negative quantity — both
            rows stay in the log, which is what makes the remeasure checkable
            later.
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setMeasuringId(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => saveMeasurement(items.find((i) => i.id === measuringId))}
              disabled={isPending}
            >
              {isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Record
            </Button>
          </div>
        </Card>
      )}

      {versions.length > 1 && (
        <p className="text-xs text-muted-foreground px-1">
          {versions.length} versions of this bill.{" "}
          {versions
            .map((v) => `v${v.version} (${v.status})`)
            .join(", ")}
        </p>
      )}
    </div>
  );
}
