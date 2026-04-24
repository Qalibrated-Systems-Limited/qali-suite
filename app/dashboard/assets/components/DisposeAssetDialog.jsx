"use client";

import { useActionState, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, Ban } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { disposeAsset } from "@/app/mongodb/actions/asset-actions";

const DISPOSAL_METHODS = [
  { value: "sold", label: "Sold" },
  { value: "scrapped", label: "Scrapped" },
  { value: "donated", label: "Donated" },
  { value: "lost", label: "Lost" },
  { value: "stolen", label: "Stolen" },
];

const initialState = {
  success: false,
  error: null,
  fieldErrors: null,
  assetId: null,
  gainOrLoss: 0,
};

function formatCurrency(amount) {
  const n = amount || 0;
  return n.toLocaleString("en-KE", { minimumFractionDigits: 0 });
}

export default function DisposeAssetDialog({
  asset,
  bankAccounts = [],
  gainLossAccounts = [],
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(
    disposeAsset,
    initialState
  );

  const today = new Date().toISOString().slice(0, 10);
  const [disposalMethod, setDisposalMethod] = useState("sold");
  const [disposalAmount, setDisposalAmount] = useState("");

  const bookValue = asset.bookValue || 0;
  const amount = parseFloat(disposalAmount) || 0;
  const gainOrLoss = amount - bookValue;

  useEffect(() => {
    if (state.success) {
      toast.success("Asset disposed successfully");
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
        className="border-destructive/30 text-destructive hover:bg-destructive/5"
      >
        <Ban className="h-4 w-4" />
        <span className="hidden sm:inline">Dispose Asset</span>
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl">
        <h3 className="text-base font-semibold text-foreground">
          Dispose Asset
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Dispose of {asset.name} ({asset.assetNumber})
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Current book value: KES {formatCurrency(bookValue)}
        </p>

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
              Disposal Date <span className="text-destructive">*</span>
            </label>
            <input
              type="date"
              name="disposalDate"
              required
              defaultValue={today}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Disposal Method <span className="text-destructive">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {DISPOSAL_METHODS.map((m) => (
                <label
                  key={m.value}
                  className={`flex cursor-pointer items-center justify-center rounded-md border px-2 py-2 text-xs font-medium transition-colors ${
                    disposalMethod === m.value
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  <input
                    type="radio"
                    name="disposalMethod"
                    value={m.value}
                    checked={disposalMethod === m.value}
                    onChange={() => setDisposalMethod(m.value)}
                    className="sr-only"
                  />
                  {m.label}
                </label>
              ))}
            </div>
          </div>

          {disposalMethod === "sold" && (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Disposal Amount (KES){" "}
                  <span className="text-destructive">*</span>
                </label>
                <input
                  type="number"
                  name="disposalAmount"
                  min="0"
                  step="1"
                  required
                  value={disposalAmount}
                  onChange={(e) => setDisposalAmount(e.target.value)}
                  placeholder="Sale proceeds"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Bank/Cash Account{" "}
                  <span className="text-destructive">*</span>
                </label>
                <select
                  name="bankAccountId"
                  required
                  defaultValue=""
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">— Select account —</option>
                  {bankAccounts.map((a) => (
                    <option key={a._id} value={a._id}>
                      {a.accountCode} — {a.accountName}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {disposalMethod !== "sold" && (
            <input type="hidden" name="disposalAmount" value="0" />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Gain Account
              </label>
              <select
                name="gainAccountId"
                defaultValue=""
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">— Use company default —</option>
                {gainLossAccounts.map((a) => (
                  <option key={a._id} value={a._id}>
                    {a.accountCode} — {a.accountName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Loss Account
              </label>
              <select
                name="lossAccountId"
                defaultValue=""
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">— Use company default —</option>
                {gainLossAccounts.map((a) => (
                  <option key={a._id} value={a._id}>
                    {a.accountCode} — {a.accountName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Notes
            </label>
            <textarea
              name="notes"
              rows={2}
              maxLength={1000}
              placeholder="Reason for disposal..."
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Live preview */}
          {disposalMethod === "sold" && amount > 0 && (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Book Value</span>
                <span className="font-medium">
                  KES {formatCurrency(bookValue)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Disposal Amount</span>
                <span className="font-medium">
                  KES {formatCurrency(amount)}
                </span>
              </div>
              <div className="mt-2 flex justify-between border-t border-border pt-2">
                <span className="text-muted-foreground">Gain / (Loss)</span>
                <span
                  className={`font-bold ${
                    gainOrLoss > 0
                      ? "text-emerald-700 dark:text-emerald-400"
                      : gainOrLoss < 0
                        ? "text-red-700 dark:text-red-400"
                        : "text-foreground"
                  }`}
                >
                  KES {formatCurrency(gainOrLoss)}
                </span>
              </div>
            </div>
          )}

          {disposalMethod !== "sold" && (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Loss on Disposal (Book Value written off)
                </span>
                <span className="font-bold text-red-700 dark:text-red-400">
                  KES {formatCurrency(bookValue)}
                </span>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              disabled={isPending}
            >
              {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              Dispose Asset
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
