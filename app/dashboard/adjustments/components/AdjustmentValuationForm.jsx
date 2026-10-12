"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coins, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { valueStockAdjustmentPg } from "@/app/db/actions/adjustment-actions";

/**
 * The missing number, supplied by the people who may decide it.
 *
 * WHY THIS SCREEN EXISTS. A count that finds stock the company has never
 * valued cannot be admitted: posting it would raise the quantity on the shelf
 * while the balance sheet stayed still, and leave units with no cost to charge
 * to COGS when they sell. The adjustment is held in `pending_valuation` until
 * somebody says what the goods were worth, and this is where they say it.
 *
 * WHAT IT DELIBERATELY DOES NOT SHOW is an editable quantity. The count is a
 * statement about what is physically on the shelf, made by the person who was
 * standing in front of it; this form says what those goods cost, and nothing
 * else. The repository refuses anything else regardless — the form simply does
 * not offer what it would refuse.
 *
 * It does not approve, either. Valuing returns the adjustment to draft and it
 * takes the ordinary approval path from there, so the count keeps its second
 * signature.
 */
export default function AdjustmentValuationForm({
  adjustmentId,
  lines = [],
  canValue,
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [costs, setCosts] = useState({});

  if (!lines.length) return null;

  if (!canValue) {
    return (
      <Card className="border-amber-500/30 bg-amber-500/5 p-4 sm:p-5">
        <p className="text-sm font-medium text-amber-700 dark:text-amber-500">
          Awaiting a unit cost
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {lines.length === 1 ? "One line admits" : `${lines.length} lines admit`}{" "}
          stock with no cost on record. Finance or procurement has to establish
          what it was worth before this adjustment can be approved.
        </p>
      </Card>
    );
  }

  const total = lines.reduce(
    (sum, line) => sum + Number(costs[line.id] || 0) * Number(line.quantity || 0),
    0,
  );
  // Every line, or none: a partly valued adjustment is in exactly the state it
  // started in, and the action refuses it rather than saving half.
  const complete = lines.every((line) => Number(costs[line.id]) > 0);

  const submit = () =>
    startTransition(async () => {
      const res = await valueStockAdjustmentPg(
        adjustmentId,
        lines.map((line) => ({
          lineId: line.id,
          unitCost: String(costs[line.id]),
        })),
      );
      if (res?.success) {
        toast.success(res.message ?? "Valued");
        router.refresh();
      } else {
        toast.error(res?.message ?? "Could not value this adjustment");
      }
    });

  return (
    <Card className="border-amber-500/30 bg-amber-500/5 p-4 sm:p-5">
      <div className="flex items-start gap-2">
        <Coins className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-500">
            Establish a unit cost
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            These products carry no cost, so the stock being admitted has no
            value. Enter what it was worth — the quantities counted are not
            changed.
          </p>
        </div>
      </div>

      {/*
        One block per line, stacked. Site staff read this on a phone, and a
        four-column table with an input in the last cell is unusable there;
        the label sits above its field at every width.
      */}
      <div className="mt-4 flex flex-col gap-3">
        {lines.map((line) => {
          const unitCost = Number(costs[line.id] || 0);
          const value = unitCost * Number(line.quantity || 0);
          return (
            <div
              key={line.id}
              className="rounded-md border bg-card p-3 sm:flex sm:items-end sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{line.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {line.sku} · admitting {Number(line.quantity)} {line.unit}
                </p>
              </div>
              <div className="mt-3 sm:mt-0 sm:w-40">
                <label
                  htmlFor={`cost-${line.id}`}
                  className="text-[11px] uppercase tracking-wide text-muted-foreground"
                >
                  Unit cost (KES)
                </label>
                <Input
                  id={`cost-${line.id}`}
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  className="mt-1 h-10"
                  value={costs[line.id] ?? ""}
                  onChange={(e) =>
                    setCosts((prev) => ({ ...prev, [line.id]: e.target.value }))
                  }
                  disabled={isPending}
                />
              </div>
              <div className="mt-2 sm:mt-0 sm:w-32 sm:text-right">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Value
                </p>
                <p className="text-sm font-semibold tabular-nums">
                  {value > 0
                    ? `KES ${value.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`
                    : "—"}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Inventory increase:{" "}
          <span className="font-semibold text-foreground tabular-nums">
            KES {total.toLocaleString("en-KE", { maximumFractionDigits: 2 })}
          </span>
        </p>
        <Button
          className="h-10 sm:h-9"
          disabled={!complete || isPending}
          onClick={submit}
        >
          {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Save valuation
        </Button>
      </div>
    </Card>
  );
}
