"use client";

import { useActionState, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, Gauge, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { recordUsageReading } from "@/app/mongodb/actions/asset-actions";

const initialState = { success: false, error: null, fieldErrors: null };

const UNIT_OPTIONS = [
  { value: "km", label: "Kilometers" },
  { value: "miles", label: "Miles" },
  { value: "hours", label: "Hours" },
];

const SOURCE_OPTIONS = [
  { value: "manual", label: "Manual entry" },
  { value: "fuel", label: "Fuel-up" },
  { value: "service", label: "Service / maintenance" },
  { value: "transfer", label: "Transfer / handover" },
  { value: "other", label: "Other" },
];

export default function LogUsageDialog({ asset, variant = "outline" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const action = recordUsageReading.bind(null, asset._id);
  const [state, formAction, isPending] = useActionState(action, initialState);

  const today = new Date().toISOString().slice(0, 10);
  const [reading, setReading] = useState("");
  const defaultUnit = asset.usageUnit || "km";

  const currentUsage = Number(asset.currentUsage) || 0;
  const numericReading = parseFloat(reading);
  const showRollbackWarn =
    Number.isFinite(numericReading) &&
    currentUsage > 0 &&
    numericReading < currentUsage;

  useEffect(() => {
    if (state.success) {
      toast.success("Reading logged");
      setOpen(false);
      setReading("");
      router.refresh();
    }
  }, [state.success, router]);

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant={variant}
        onClick={() => setOpen(true)}
      >
        <Gauge className="h-4 w-4" />
        <span className="hidden sm:inline">Log reading</span>
      </Button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPending) setOpen(false);
      }}
    >
      <div className="w-full max-w-md rounded-t-2xl border border-border bg-card shadow-xl sm:rounded-lg">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Log usage reading</h3>
          </div>
          <button
            type="button"
            onClick={() => !isPending && setOpen(false)}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
            disabled={isPending}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form action={formAction} className="space-y-4 p-4">
          <div className="rounded-md bg-muted/40 p-3 text-xs">
            <p className="font-medium text-foreground">{asset.name}</p>
            <p className="mt-0.5 font-mono text-muted-foreground">
              {asset.assetNumber}
            </p>
            {currentUsage > 0 && (
              <p className="mt-1 text-muted-foreground">
                Last reading:{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {currentUsage.toLocaleString()} {defaultUnit}
                </span>
              </p>
            )}
          </div>

          {state.error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{state.error}</p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
            <div className="space-y-1">
              <label
                htmlFor="reading"
                className="text-xs font-medium text-muted-foreground"
              >
                Current reading <span className="text-destructive">*</span>
              </label>
              <input
                id="reading"
                name="reading"
                type="number"
                step="any"
                min="0"
                inputMode="decimal"
                value={reading}
                onChange={(e) => setReading(e.target.value)}
                placeholder="e.g. 124,580"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40 sm:text-sm"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="unit"
                className="text-xs font-medium text-muted-foreground"
              >
                Unit
              </label>
              <select
                id="unit"
                name="unit"
                defaultValue={defaultUnit}
                className="h-10 w-full rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {UNIT_OPTIONS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {showRollbackWarn && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                This reading is lower than the last logged value (
                {currentUsage.toLocaleString()}). Continue only if the meter
                rolled over or you're correcting a typo.
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label
                htmlFor="recordedAt"
                className="text-xs font-medium text-muted-foreground"
              >
                Date
              </label>
              <input
                id="recordedAt"
                name="recordedAt"
                type="date"
                defaultValue={today}
                max={today}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="source"
                className="text-xs font-medium text-muted-foreground"
              >
                Source
              </label>
              <select
                id="source"
                name="source"
                defaultValue="manual"
                className="h-10 w-full rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {SOURCE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="notes"
              className="text-xs font-medium text-muted-foreground"
            >
              Notes
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              placeholder="Optional context (e.g. fuel-up at Shell Westlands)"
              className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          <footer className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !reading}>
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Gauge className="mr-2 h-4 w-4" />
              )}
              Save reading
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
}
