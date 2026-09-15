"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Flag, Plus, Check, Undo2, X, Loader2, Trash2 } from "lucide-react";
import {
  createProjectMilestone,
  setProjectMilestoneStatus,
  deleteProjectMilestone,
} from "@/app/db/actions/project-actions";
import { toast } from "sonner";

/**
 * The milestone schedule — 0093.
 *
 * A road contract values by REMEASURING a priced bill. An installation
 * contract has no bill to remeasure: it has stages, each worth an agreed part
 * of the sum, and until this table the only way to certify one was to type the
 * figure and mark the certificate `manual`.
 *
 * UNALLOCATED IS THE FIGURE THAT MATTERS while a schedule is being built — the
 * contract sum less what the stages come to. It is legitimately positive, and
 * the database refuses only the other direction, so this shows it rather than
 * treating it as an error.
 *
 * ACHIEVING TAKES A DATE, and the date is not today by default. A certificate
 * values what was achieved by ITS valuation date, so the date decides which
 * certificate picks the stage up — and most sign-offs are recorded late.
 */

const STATUS_STYLES = {
  pending: "bg-muted text-muted-foreground",
  achieved: "bg-emerald-500/10 text-emerald-600",
  cancelled: "bg-muted text-muted-foreground line-through",
};

const money = (n) =>
  new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(Number(n) || 0);

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function MilestoneRegister({
  projectId,
  contract,
  milestones = [],
  summary,
  canManage = false,
  readOnly = false,
}) {
  const [isPending, startTransition] = useTransition();
  const [showNew, setShowNew] = useState(false);
  const [achieving, setAchieving] = useState(null);
  const [achievedOn, setAchievedOn] = useState(today);
  const [form, setForm] = useState({
    name: "",
    value: "",
    dueDate: "",
    retentionReleasePercent: "",
  });

  if (!contract) return null;

  function reset() {
    setForm({ name: "", value: "", dueDate: "", retentionReleasePercent: "" });
    setShowNew(false);
  }

  function add() {
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("contractId", contract.id);
    fd.set("sequence", String(milestones.length + 1));
    Object.entries(form).forEach(([k, v]) => fd.set(k, v ?? ""));
    startTransition(async () => {
      const res = await createProjectMilestone(null, fd);
      if (res?.success) {
        toast.success(res.message);
        reset();
      } else {
        toast.error(Object.values(res?.errors ?? {}).flat()[0] || "Could not add it");
      }
    });
  }

  function achieve(id) {
    startTransition(async () => {
      const res = await setProjectMilestoneStatus(id, projectId, "achieved", achievedOn);
      if (res?.success) {
        toast.success(res.message);
        setAchieving(null);
      } else {
        toast.error(res?.error || "Could not record it");
      }
    });
  }

  function move(id, status) {
    startTransition(async () => {
      const res = await setProjectMilestoneStatus(id, projectId, status);
      if (res?.success) toast.success(res.message);
      else toast.error(res?.error || "Could not update it");
    });
  }

  function remove(id) {
    startTransition(async () => {
      const res = await deleteProjectMilestone(id, projectId);
      if (res?.success) toast.success(res.message);
      else toast.error(res?.error || "Could not remove it");
    });
  }

  return (
    <Card className="p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Flag className="h-5 w-5 text-muted-foreground shrink-0" />
          <div>
            <h3 className="font-semibold">Stages</h3>
            <p className="text-xs text-muted-foreground">
              What the contract is billed against, and what has been reached
            </p>
          </div>
        </div>
        {canManage && !readOnly && !showNew && (
          <Button size="sm" variant="outline" onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add a stage
          </Button>
        )}
      </div>

      {summary?.count > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Achieved</p>
            <p className="text-sm font-semibold tabular-nums">{money(summary.achieved)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Still to come</p>
            <p className="text-sm font-semibold tabular-nums">{money(summary.pending)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Scheduled</p>
            <p className="text-sm font-semibold tabular-nums">{money(summary.total)}</p>
          </div>
          {/* The one worth watching while a schedule is being built. */}
          <div
            className={`rounded-lg border p-3 ${
              summary.unallocated > 0 ? "border-amber-300/60 dark:border-amber-900/60" : ""
            }`}
          >
            <p className="text-xs text-muted-foreground">Unallocated</p>
            <p
              className={`text-sm font-semibold tabular-nums ${
                summary.unallocated > 0 ? "text-amber-600" : ""
              }`}
            >
              {summary.unallocated > 0 ? money(summary.unallocated) : "—"}
            </p>
          </div>
        </div>
      )}

      {canManage && showNew && (
        <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
          <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_1fr] gap-2">
            <Input
              placeholder="Stage — e.g. Equipment delivered to site"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <div className="space-y-1">
              <Input
                type="number"
                step="0.01"
                placeholder="Value"
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              />
              <p className="text-[11px] leading-tight text-muted-foreground/80">
                {summary?.unallocated > 0
                  ? `${money(summary.unallocated)} unallocated`
                  : "Of the contract sum"}
              </p>
            </div>
            <div className="space-y-1">
              <Input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
              />
              <p className="text-[11px] leading-tight text-muted-foreground/80">Due</p>
            </div>
            <div className="space-y-1">
              <Input
                type="number"
                step="0.01"
                placeholder="0"
                value={form.retentionReleasePercent}
                onChange={(e) =>
                  setForm((f) => ({ ...f, retentionReleasePercent: e.target.value }))
                }
              />
              <p className="text-[11px] leading-tight text-muted-foreground/80">
                % of retention released
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={reset} disabled={isPending}>
              Cancel
            </Button>
            <Button size="sm" onClick={add} disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Add
            </Button>
          </div>
        </div>
      )}

      {milestones.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No stages yet. On a job billed by stage rather than by remeasurement,
          this is what a certificate values.
        </p>
      ) : (
        <ul className="divide-y">
          {milestones.map((m) => (
            <li key={m._id} className="py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{m.name}</span>
                    <Badge
                      variant="secondary"
                      className={`text-xs ${STATUS_STYLES[m.status] ?? ""}`}
                    >
                      {m.status}
                    </Badge>
                    {m.retentionReleasePercent > 0 && (
                      <span className="text-xs text-muted-foreground">
                        releases {m.retentionReleasePercent}% of retention
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {m.achievedOn
                      ? `Achieved ${m.achievedOn}${m.achievedByName ? ` · ${m.achievedByName}` : ""}`
                      : m.dueDate
                        ? `Due ${m.dueDate}`
                        : "No date set"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm tabular-nums">{money(m.value)}</span>
                  {canManage && !readOnly && (
                    <div className="flex items-center gap-1">
                      {m.status === "pending" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            setAchieving(m._id);
                            setAchievedOn(today());
                          }}
                          disabled={isPending}
                        >
                          Achieve
                        </Button>
                      )}
                      {m.status === "achieved" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => move(m._id, "pending")}
                          disabled={isPending}
                          aria-label={`Take back ${m.name}`}
                        >
                          <Undo2 className="h-4 w-4" />
                        </Button>
                      )}
                      {m.status !== "achieved" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => remove(m._id)}
                          disabled={isPending}
                          aria-label={`Remove ${m.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/*
                Achieving asks for the date rather than assuming today, because
                the date decides which certificate values the stage and a
                sign-off is usually recorded after the fact.
              */}
              {achieving === m._id && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border bg-background p-2">
                  <span className="text-xs text-muted-foreground">Achieved on</span>
                  <Input
                    type="date"
                    className="h-8 w-40"
                    value={achievedOn}
                    onChange={(e) => setAchievedOn(e.target.value)}
                  />
                  <Button size="sm" onClick={() => achieve(m._id)} disabled={isPending}>
                    {isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => setAchieving(null)}
                    disabled={isPending}
                    aria-label="Cancel"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
