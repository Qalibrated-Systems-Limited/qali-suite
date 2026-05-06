"use client";

import { useActionState, useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  AlertCircle,
  Tag,
  X,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateProductPricing } from "@/app/mongodb/actions/stock-actions";

const initialState = { success: false, error: null, fieldErrors: null };

function formatCurrency(n) {
  return (Number(n) || 0).toLocaleString("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function computeSelling(cost, markupPct) {
  const c = Number(cost) || 0;
  const m = Number(markupPct) || 0;
  if (c <= 0) return 0;
  return Math.round(c * (1 + m / 100) * 100) / 100;
}

function computeMarginPct(selling, cost) {
  const s = Number(selling) || 0;
  const c = Number(cost) || 0;
  if (s <= 0) return 0;
  return ((s - c) / s) * 100;
}

function computeMarkupPct(selling, cost) {
  const s = Number(selling) || 0;
  const c = Number(cost) || 0;
  if (c <= 0) return 0;
  return ((s - c) / c) * 100;
}

export default function PricingDialog({ product }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const action = updateProductPricing.bind(null, product._id);
  const [state, formAction, isPending] = useActionState(action, initialState);

  const cost = Number(product?.costing?.costPrice) || 0;
  const initialMode = product?.pricing?.priceMode || "manual";
  const initialMarkup = Number(product?.pricing?.markupPercentage) || 0;
  const initialSelling = Number(product?.pricing?.sellingPrice) || 0;
  const initialMin = Number(product?.pricing?.minimumPrice) || 0;

  const [mode, setMode] = useState(initialMode);
  const [markupInput, setMarkupInput] = useState(String(initialMarkup));
  const [sellingInput, setSellingInput] = useState(String(initialSelling));
  const [minimumInput, setMinimumInput] = useState(String(initialMin));

  // Reset to current values when dialog opens
  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setMarkupInput(String(initialMarkup));
      setSellingInput(String(initialSelling));
      setMinimumInput(String(initialMin));
    }
  }, [open, initialMode, initialMarkup, initialSelling, initialMin]);

  // Live computed preview values
  const preview = useMemo(() => {
    const selling =
      mode === "markup"
        ? computeSelling(cost, markupInput)
        : Number(sellingInput) || 0;
    const margin = computeMarginPct(selling, cost);
    const markup = computeMarkupPct(selling, cost);
    const profit = selling - cost;
    return { selling, margin, markup, profit };
  }, [mode, markupInput, sellingInput, cost]);

  const minVal = Number(minimumInput) || 0;
  const belowFloor = minVal > 0 && preview.selling < minVal;
  const belowCost = cost > 0 && preview.selling < cost;

  useEffect(() => {
    if (state.success) {
      if (state.requiresApproval) {
        toast.success(
          `Submitted for approval (${state.approval?.requestNumber || ""})`.trim(),
          { description: "A finance approver has been notified." },
        );
      } else {
        toast.success("Pricing updated");
      }
      setOpen(false);
      router.refresh();
    }
  }, [state.success, state.requiresApproval, state.approval, router]);

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        <Tag className="h-4 w-4" />
        <span className="hidden sm:inline">Manage pricing</span>
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
      <div className="w-full max-w-lg rounded-t-2xl border border-border bg-card shadow-xl sm:rounded-lg">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Manage pricing</h3>
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
          {/* Product header */}
          <div className="rounded-md bg-muted/40 p-3 text-xs">
            <p className="font-medium text-foreground">{product.name}</p>
            <p className="mt-0.5 font-mono text-muted-foreground">
              {product.SKU}
            </p>
            <div className="mt-2 flex items-center gap-3">
              <span className="text-muted-foreground">Cost</span>
              <span className="font-semibold tabular-nums text-foreground">
                KES {formatCurrency(cost)}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                derived from posted bills
              </span>
            </div>
          </div>

          {state.error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{state.error}</p>
            </div>
          )}

          {/* Pricing mode toggle */}
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Pricing mode
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <label
                className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm ${
                  mode === "markup"
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:bg-muted/40"
                }`}
              >
                <input
                  type="radio"
                  name="priceMode"
                  value="markup"
                  checked={mode === "markup"}
                  onChange={() => setMode("markup")}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <p className="font-medium">Markup</p>
                  <p className="text-[11px] text-muted-foreground">
                    selling = cost × (1 + markup%)
                  </p>
                </div>
              </label>
              <label
                className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm ${
                  mode === "manual"
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:bg-muted/40"
                }`}
              >
                <input
                  type="radio"
                  name="priceMode"
                  value="manual"
                  checked={mode === "manual"}
                  onChange={() => setMode("manual")}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <p className="font-medium">Manual</p>
                  <p className="text-[11px] text-muted-foreground">
                    pin a specific selling price
                  </p>
                </div>
              </label>
            </div>
          </fieldset>

          {/* Driver input */}
          {mode === "markup" ? (
            <div className="space-y-1">
              <label
                htmlFor="markupPercent"
                className="text-xs font-medium text-muted-foreground"
              >
                Markup % <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <input
                  id="markupPercent"
                  name="markupPercent"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={markupInput}
                  onChange={(e) => setMarkupInput(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 pr-8 text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40 sm:text-sm"
                  required
                  autoFocus
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  %
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Try common values: 25% (light retail), 35% (standard), 50%+
                (specialty).
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <label
                htmlFor="sellingPrice"
                className="text-xs font-medium text-muted-foreground"
              >
                Selling price <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  KES
                </span>
                <input
                  id="sellingPrice"
                  name="sellingPrice"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={sellingInput}
                  onChange={(e) => setSellingInput(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-background pl-12 pr-3 text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40 sm:text-sm"
                  required
                  autoFocus
                />
              </div>
            </div>
          )}

          {/* Live preview */}
          <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Selling
              </p>
              <p
                className={`mt-0.5 font-semibold tabular-nums ${
                  belowCost
                    ? "text-red-600 dark:text-red-400"
                    : belowFloor
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-foreground"
                }`}
              >
                KES {formatCurrency(preview.selling)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Margin
              </p>
              <p className="mt-0.5 inline-flex items-center gap-1 font-semibold tabular-nums">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                {preview.margin.toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Markup
              </p>
              <p className="mt-0.5 inline-flex items-center gap-1 font-semibold tabular-nums">
                <TrendingDown className="h-3.5 w-3.5 text-blue-500" />
                {preview.markup.toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Profit / unit
              </p>
              <p
                className={`mt-0.5 font-semibold tabular-nums ${
                  preview.profit < 0
                    ? "text-red-600 dark:text-red-400"
                    : "text-foreground"
                }`}
              >
                KES {formatCurrency(preview.profit)}
              </p>
            </div>
          </div>

          {(belowCost || belowFloor) && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                {belowCost && (
                  <>Selling price is below cost — would post a negative margin.</>
                )}
                {belowCost && belowFloor && <br />}
                {belowFloor && (
                  <>
                    Selling price is below the minimum price floor (KES{" "}
                    {formatCurrency(minVal)}).
                  </>
                )}{" "}
                This change will be submitted for finance approval (Admin / CFO
                can override directly).
              </p>
            </div>
          )}

          {/* Optional minimum-price floor */}
          <div className="space-y-1">
            <label
              htmlFor="minimumPrice"
              className="text-xs font-medium text-muted-foreground"
            >
              Minimum price floor (optional)
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                KES
              </span>
              <input
                id="minimumPrice"
                name="minimumPrice"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={minimumInput}
                onChange={(e) => setMinimumInput(e.target.value)}
                className="h-10 w-full rounded-md border border-border bg-background pl-12 pr-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Sales below this price will be blocked unless overridden by
              Admin or CFO.
            </p>
          </div>

          {/* Reason */}
          <div className="space-y-1">
            <label
              htmlFor="reason"
              className="text-xs font-medium text-muted-foreground"
            >
              Reason for change
            </label>
            <textarea
              id="reason"
              name="reason"
              rows={2}
              placeholder="e.g. supplier increased cost; quarterly review; competitor adjustment"
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
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Tag className="mr-2 h-4 w-4" />
              )}
              Save pricing
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
}
