"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { GitBranch, Plus, Check, X, Loader2, Send, Trash2 } from "lucide-react";
import {
  createProjectVariation,
  setProjectVariationStatus,
  deleteProjectVariation,
} from "@/app/db/actions/project-actions";
import { toast } from "sonner";

/**
 * The variation register — 0091.
 *
 * The contract sum was typed once and had nothing that could ever move it, so
 * from the first variation both it and "% of contract certified" — the figure
 * on the page above this one, in front of whoever certifies — were wrong.
 *
 * WHAT IS SHOWN IS THREE FIGURES, NOT ONE. The sum as let, what the approved
 * variations have added, and what is claimed and not yet agreed. A contracts
 * manager wants the third most and it is the one no system shows by default:
 * the exposure, if everything currently in dispute goes against you.
 *
 * APPROVING IS FINANCE'S. A project manager raises and submits; approving is
 * what moves the contract, so it sits with whoever certifies.
 */

const STATUS_STYLES = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-amber-500/10 text-amber-600",
  approved: "bg-emerald-500/10 text-emerald-600",
  rejected: "bg-rose-500/10 text-rose-600",
};

function money(n) {
  const v = Number(n) || 0;
  const s = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(
    Math.abs(v),
  );
  return v < 0 ? `(${s})` : s;
}

function days(n) {
  const v = Number(n) || 0;
  if (v === 0) return "—";
  return `${v > 0 ? "+" : ""}${v} day${Math.abs(v) === 1 ? "" : "s"}`;
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function VariationRegister({
  projectId,
  contract,
  variations = [],
  summary,
  instructions = [],
  canManage = false,
  canDecide = false,
  readOnly = false,
}) {
  const [isPending, startTransition] = useTransition();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    costEffect: "",
    timeEffectDays: "",
    issuedDate: today(),
    reference: "",
    instructionId: "",
  });

  if (!contract) return null;

  const originalSum = Number(contract.originalSum ?? contract.contractSum ?? 0);
  const currentSum = Number(contract.contractSum ?? 0);

  function reset() {
    setForm({
      title: "",
      description: "",
      costEffect: "",
      timeEffectDays: "",
      issuedDate: today(),
      reference: "",
      instructionId: "",
    });
    setShowNew(false);
  }

  function raise() {
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("contractId", contract.id);
    Object.entries(form).forEach(([k, v]) => fd.set(k, v ?? ""));
    startTransition(async () => {
      const res = await createProjectVariation(null, fd);
      if (res?.success) {
        toast.success(res.message);
        reset();
      } else {
        toast.error(
          Object.values(res?.errors ?? {}).flat()[0] || "Could not raise it",
        );
      }
    });
  }

  function move(id, status) {
    startTransition(async () => {
      const res = await setProjectVariationStatus(id, projectId, status);
      if (res?.success) toast.success(res.message);
      else toast.error(res?.error || "Could not update it");
    });
  }

  function remove(id) {
    startTransition(async () => {
      const res = await deleteProjectVariation(id, projectId);
      if (res?.success) toast.success(res.message);
      else toast.error(res?.error || "Could not remove it");
    });
  }

  return (
    <Card className="p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-muted-foreground shrink-0" />
          <div>
            <h3 className="font-semibold">Variations</h3>
            <p className="text-xs text-muted-foreground">
              What has been instructed, and what it did to the contract
            </p>
          </div>
        </div>
        {canManage && !readOnly && !showNew && (
          <Button size="sm" variant="outline" onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Raise a variation
          </Button>
        )}
      </div>

      {/* The three figures, and the third is the one nobody shows. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Sum as let</p>
          <p className="text-sm font-semibold tabular-nums">{money(originalSum)}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Approved variations</p>
          <p className="text-sm font-semibold tabular-nums">
            {summary?.approvedCost ? money(summary.approvedCost) : "—"}
            {summary?.approvedDays ? (
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                {days(summary.approvedDays)}
              </span>
            ) : null}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Current contract sum</p>
          <p className="text-sm font-semibold tabular-nums">{money(currentSum)}</p>
        </div>
        <div className="rounded-lg border p-3 border-amber-300/60 dark:border-amber-900/60">
          <p className="text-xs text-muted-foreground">Claimed, not agreed</p>
          <p className="text-sm font-semibold tabular-nums text-amber-600">
            {summary?.pendingCost ? money(summary.pendingCost) : "—"}
            {summary?.pendingDays ? (
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                {days(summary.pendingDays)}
              </span>
            ) : null}
          </p>
        </div>
      </div>

      {canManage && showNew && (
        <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input
              placeholder="What was instructed"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={form.instructionId}
              onChange={(e) =>
                setForm((f) => ({ ...f, instructionId: e.target.value }))
              }
            >
              <option value="">No engineer&apos;s instruction</option>
              {instructions.map((i) => (
                <option key={i._id} value={i._id}>
                  {i.instructionNumber} — {i.description?.slice(0, 60)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Cost effect
              </label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={form.costEffect}
                onChange={(e) =>
                  setForm((f) => ({ ...f, costEffect: e.target.value }))
                }
              />
              <p className="text-[11px] leading-tight text-muted-foreground/80">
                Negative for an omission
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Time effect
              </label>
              <Input
                type="number"
                step="1"
                placeholder="0"
                value={form.timeEffectDays}
                onChange={(e) =>
                  setForm((f) => ({ ...f, timeEffectDays: e.target.value }))
                }
              />
              <p className="text-[11px] leading-tight text-muted-foreground/80">
                Days added to completion
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Issued
              </label>
              <Input
                type="date"
                value={form.issuedDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, issuedDate: e.target.value }))
                }
              />
            </div>
          </div>
          <Input
            placeholder="Detail (optional)"
            value={form.description}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={reset} disabled={isPending}>
              Cancel
            </Button>
            <Button size="sm" onClick={raise} disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Raise
            </Button>
          </div>
        </div>
      )}

      {variations.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Nothing has been instructed on this contract yet.
        </p>
      ) : (
        <ul className="divide-y">
          {variations.map((v) => (
            <li key={v._id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-muted-foreground">
                    {v.variationNumber}
                  </span>
                  <span className="text-sm font-medium truncate">{v.title}</span>
                  <Badge
                    variant="secondary"
                    className={`text-xs ${STATUS_STYLES[v.status] ?? ""}`}
                  >
                    {v.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {v.issuedDate}
                  {v.decidedByName ? ` · ${v.status} by ${v.decidedByName}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <p className="text-sm tabular-nums">{money(v.costEffect)}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {days(v.timeEffectDays)}
                  </p>
                </div>
                {!readOnly && (
                  <div className="flex items-center gap-1">
                    {canManage && v.status === "draft" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => move(v._id, "submitted")}
                        disabled={isPending}
                        aria-label={`Submit ${v.variationNumber}`}
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    )}
                    {canDecide && v.status === "submitted" && (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => move(v._id, "approved")}
                          disabled={isPending}
                          aria-label={`Approve ${v.variationNumber}`}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => move(v._id, "rejected")}
                          disabled={isPending}
                          aria-label={`Reject ${v.variationNumber}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    {/* An approved variation is rejected, never deleted — its
                        money is in the sum and in every certificate since. */}
                    {canManage && (v.status === "draft" || v.status === "rejected") && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => remove(v._id)}
                        disabled={isPending}
                        aria-label={`Remove ${v.variationNumber}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
