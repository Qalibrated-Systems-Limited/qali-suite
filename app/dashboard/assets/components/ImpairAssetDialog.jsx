"use client";

import { useActionState, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { impairAsset } from "@/app/mongodb/actions/asset-actions";

const initialState = {
  success: false,
  error: null,
  fieldErrors: null,
  assetId: null,
};

function formatCurrency(amount) {
  return (amount || 0).toLocaleString("en-KE", { minimumFractionDigits: 0 });
}

export default function ImpairAssetDialog({ asset, expenseAccounts = [] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(
    impairAsset,
    initialState,
  );

  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState("");

  const bookValue = asset.bookValue || 0;
  const salvage = asset.salvageValue || 0;
  const ceiling = Math.max(0, bookValue - salvage);
  const enteredAmount = parseFloat(amount) || 0;
  const newBV = bookValue - enteredAmount;

  useEffect(() => {
    if (state.success) {
      toast.success("Impairment recorded");
      setOpen(false);
      router.refresh();
    }
  }, [state.success, router]);

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        size="sm"
        variant="outline"
        className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-500/10 dark:border-amber-900 dark:text-amber-400"
      >
        <TrendingDown className="h-4 w-4" />
        <span className="hidden sm:inline">Impair</span>
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl">
        <h3 className="text-base font-semibold text-foreground">
          Impair Asset
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Write down {asset.name} ({asset.assetNumber}) to a lower carrying
          value. Posts a journal entry and revises the remaining depreciation
          schedule.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2 rounded-md bg-muted/50 p-3 text-xs">
          <div>
            <span className="text-muted-foreground">Current Book Value:</span>
            <p className="font-semibold">KES {formatCurrency(bookValue)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Max Impairment:</span>
            <p className="font-semibold">KES {formatCurrency(ceiling)}</p>
          </div>
        </div>

        <form action={formAction} className="mt-4 space-y-4">
          <input type="hidden" name="assetId" value={asset._id} />

          {state.error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-500/5 p-3 text-sm text-red-700 dark:border-red-900 dark:text-red-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {state.error}
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Impairment Date <span className="text-destructive">*</span>
            </label>
            <input
              type="date"
              name="impairedAt"
              defaultValue={today}
              required
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Impairment Amount (KES){" "}
              <span className="text-destructive">*</span>
            </label>
            <input
              type="number"
              name="amount"
              required
              min="0"
              max={ceiling}
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {enteredAmount > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                New book value will be:{" "}
                <strong className="text-foreground">
                  KES {formatCurrency(Math.max(salvage, newBV))}
                </strong>
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Impairment Loss Account{" "}
              <span className="text-destructive">*</span>
            </label>
            <select
              name="impairmentLossAccountId"
              required
              defaultValue=""
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="" disabled>
                Select expense account...
              </option>
              {expenseAccounts.map((a) => (
                <option key={a._id} value={a._id}>
                  {a.accountCode} — {a.accountName}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Will be debited. Accumulated Depreciation will be credited.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Reason <span className="text-destructive">*</span>
            </label>
            <textarea
              name="reason"
              required
              rows={2}
              maxLength={500}
              placeholder="e.g. Vehicle in major accident — fair value reduced by KES 200,000"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isPending}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || enteredAmount <= 0 || enteredAmount > ceiling}
              className="flex-1"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Posting...
                </>
              ) : (
                "Record Impairment"
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
