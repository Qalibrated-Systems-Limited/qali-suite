"use client";

import { useState, useTransition } from "react";
import { Sparkles, Loader2, AlertCircle, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { KPI_TEMPLATES } from "../lib/kpi-templates";
import { seedStarterKpis } from "@/app/mongodb/actions/kpi-actions";

// ============================================
// KPI TEMPLATES DIALOG
// ============================================
// Lets a user create the curated starter set in one click. Checklist UI
// so they can deselect any that don't apply. All are checked by default.
//
// `triggerLabel` and `variant` let the same dialog be used from the empty
// state ("Use starter templates") and from a populated list ("Add from
// templates") with different button styling.
// ============================================

const CATEGORY_LABEL = {
  financial: "Financial",
  operational: "Operational",
  hr: "HR",
  customer: "Customer",
  compliance: "Compliance",
};

export default function KpiTemplatesDialog({
  triggerLabel = "Use starter templates",
  triggerVariant = "outline",
  triggerSize = "sm",
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(() => new Set(KPI_TEMPLATES.map((t) => t.key)));
  const [error, setError] = useState(null);
  const [isPending, start] = useTransition();

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setError(null);
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === KPI_TEMPLATES.length ? new Set() : new Set(KPI_TEMPLATES.map((t) => t.key))
    );
    setError(null);
  }

  // On success the seed action server-side-redirects to /dashboard/kpis
  // — the page re-renders and the dialog unmounts. Only the failure path
  // returns; we surface that inline rather than via a client toast.
  function handleSeed() {
    setError(null);
    start(async () => {
      const res = await seedStarterKpis([...selected]);
      if (res && !res.success) {
        setError(res.error || "Could not create KPIs");
      }
    });
  }

  const allSelected = selected.size === KPI_TEMPLATES.length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={triggerVariant} size={triggerSize}>
          <Sparkles className="h-3.5 w-3.5 mr-1.5" />
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Start with curated KPIs</DialogTitle>
          <DialogDescription>
            Eight high-signal metrics for a Kenyan SMB. Default targets are placeholders — edit each KPI after creating to fit your business. Any name that already exists will be skipped.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        <div className="-mx-1 max-h-[55vh] overflow-y-auto px-1">
          <div className="flex items-center justify-between py-2 border-b border-border">
            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="h-4 w-4 accent-primary cursor-pointer"
              />
              {allSelected ? "Deselect all" : "Select all"}
            </label>
            <span className="text-xs text-muted-foreground">
              {selected.size} of {KPI_TEMPLATES.length} selected
            </span>
          </div>

          <ul className="divide-y divide-border">
            {KPI_TEMPLATES.map((t) => (
              <li key={t.key} className="py-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(t.key)}
                    onChange={() => toggle(t.key)}
                    className="mt-1 h-4 w-4 accent-primary cursor-pointer shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{t.name}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {CATEGORY_LABEL[t.category]}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t.source === "manual" ? "Manual" : "Auto"}
                      </span>
                      {t.targetDirection === "lower_is_better" ? (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                          <ArrowDownRight className="h-3 w-3" /> lower is better
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                          <ArrowUpRight className="h-3 w-3" /> higher is better
                        </span>
                      )}
                    </div>
                    {t.description && (
                      <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
                    )}
                    {t.why && (
                      <p className="mt-1 text-xs italic text-muted-foreground/80">
                        Why it matters: {t.why}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Default target: <span className="font-medium text-foreground">{formatTarget(t)}</span>
                      {t.targetIsPlaceholder && (
                        <span className="ml-2 text-amber-600 dark:text-amber-400">— adjust after creating</span>
                      )}
                    </p>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSeed} disabled={isPending || selected.size === 0}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create {selected.size} KPI{selected.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatTarget(t) {
  if (t.unit === "currency") {
    return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(t.target);
  }
  if (t.unit === "percentage") return `${t.target}%`;
  if (t.unit === "days") return `${t.target} d`;
  return String(t.target);
}
