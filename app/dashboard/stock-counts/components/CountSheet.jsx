"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  recordCountPg,
  generateCountSheetPg,
  submitCountForReviewPg,
  postStockCountPg,
  cancelStockCountPg,
} from "@/app/db/actions/stock-count-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Check, EyeOff, Info, Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils/erp-utils";

/**
 * The count sheet.
 *
 * WHAT THE COUNTER SEES depends on `isBlind`. While the sheet is being counted
 * and the count is blind, the expected quantity is not rendered at all — not
 * greyed out, not behind a toggle, absent. A number on the screen is a number
 * the counter can drift towards, and the whole point of a blind count is that
 * they write down what is on the shelf.
 *
 * The reviewer sees everything, because by then the counting is done and the
 * question has changed from "what is there" to "why do these disagree".
 */
export function CountSheet({ count }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [savingLine, setSavingLine] = useState(null);
  const [drafts, setDrafts] = useState({});

  const status = count.status;
  const isCounting = status === "counting";
  const isReview = status === "review";
  const hideExpected = count.isBlind && isCounting;

  const run = (fn, onDone) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (result && result.success === false) {
        setError(result.message);
        return;
      }
      onDone?.(result);
      router.refresh();
    });

  const saveLine = (line) => {
    const raw = drafts[line.id];
    if (raw === undefined || raw === "") return;
    setSavingLine(line.id);
    startTransition(async () => {
      setError(null);
      const result = await recordCountPg(count.id, line.id, String(raw));
      setSavingLine(null);
      if (result?.success === false) {
        setError(result.message);
        return;
      }
      setDrafts((d) => {
        const next = { ...d };
        delete next[line.id];
        return next;
      });
      router.refresh();
    });
  };

  // ── the sheet has not been generated yet ─────────────────────────────────
  if (status === "draft") {
    return (
      <div className="space-y-4">
        {error && (
          <Alert className="bg-destructive/10 border-destructive/20">
            <Info className="h-4 w-4 text-destructive" />
            <AlertDescription className="text-destructive text-sm">
              {error}
            </AlertDescription>
          </Alert>
        )}
        <Card className="bg-card border-border">
          <CardContent className="py-10 text-center space-y-4">
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Generating the sheet records what the book says right now against
              every product in scope. That figure is frozen — it is what the
              variance is measured against, and it does not move afterwards
              even as stock keeps being sold and received.
            </p>
            <Button
              disabled={pending}
              onClick={() => run(() => generateCountSheetPg(count.id))}
            >
              {pending ? "Generating…" : "Generate sheet & freeze"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const counted = count.lines.filter((l) => l.countedQuantity !== null).length;
  const remaining = count.lines.length - counted;

  return (
    <div className="space-y-4">
      {error && (
        <Alert className="bg-destructive/10 border-destructive/20">
          <Info className="h-4 w-4 text-destructive" />
          <AlertDescription className="text-destructive text-sm">
            {error}
          </AlertDescription>
        </Alert>
      )}

      {hideExpected && (
        <Alert className="bg-blue-500/10 border-blue-500/20">
          <EyeOff className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-600 text-xs sm:text-sm">
            Blind count — the expected quantity is hidden until this sheet goes
            to review. Enter what is physically on the shelf.
          </AlertDescription>
        </Alert>
      )}

      <Card className="bg-card border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left p-3 text-xs font-medium text-muted-foreground">
                  Product
                </th>
                {!hideExpected && (
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground">
                    Expected
                  </th>
                )}
                <th className="text-right p-3 text-xs font-medium text-muted-foreground">
                  Counted
                </th>
                {!hideExpected && (
                  <>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground">
                      Variance
                    </th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground">
                      Value
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {count.lines.map((line) => {
                const isCounted = line.countedQuantity !== null;
                const variance = Number(line.varianceQuantity ?? 0);
                return (
                  <tr
                    key={line.id}
                    className="border-b border-border hover:bg-muted/20 transition-colors"
                  >
                    <td className="p-3">
                      <p className="text-sm font-medium text-foreground">
                        {line.productNameAtCount}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {line.productSkuAtCount} · {line.productUnitAtCount}
                      </p>
                    </td>

                    {!hideExpected && (
                      <td className="p-3 text-right text-sm text-muted-foreground tabular-nums">
                        {Number(line.systemQuantity)}
                      </td>
                    )}

                    <td className="p-3 text-right">
                      {isCounting || isReview ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            inputMode="decimal"
                            className="h-8 w-24 text-right tabular-nums"
                            placeholder={isCounted ? undefined : "—"}
                            value={
                              drafts[line.id] ??
                              (isCounted ? String(Number(line.countedQuantity)) : "")
                            }
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [line.id]: e.target.value }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                saveLine(line);
                              }
                            }}
                            onBlur={() => saveLine(line)}
                          />
                          {savingLine === line.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          ) : isCounted ? (
                            <Check className="h-3.5 w-3.5 text-green-600" />
                          ) : (
                            <span className="w-3.5" />
                          )}
                        </div>
                      ) : (
                        <span className="text-sm tabular-nums">
                          {isCounted ? Number(line.countedQuantity) : "—"}
                        </span>
                      )}
                    </td>

                    {!hideExpected && (
                      <>
                        <td className="p-3 text-right text-sm tabular-nums">
                          {!isCounted ? (
                            <span className="text-muted-foreground">—</span>
                          ) : variance === 0 ? (
                            <span className="text-green-600">0</span>
                          ) : (
                            <span
                              className={
                                variance > 0 ? "text-blue-600" : "text-red-600"
                              }
                            >
                              {variance > 0 ? "+" : ""}
                              {variance}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right text-sm tabular-nums text-muted-foreground">
                          {!isCounted || variance === 0
                            ? "—"
                            : formatCurrency(Number(line.varianceValue))}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── what can be done next ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        {isCounting && (
          <>
            <Button
              disabled={pending || remaining > 0}
              onClick={() => run(() => submitCountForReviewPg(count.id))}
            >
              {pending ? "Submitting…" : "Submit for review"}
            </Button>
            {remaining > 0 && (
              <span className="text-xs text-muted-foreground">
                {remaining} line{remaining === 1 ? "" : "s"} still to count
              </span>
            )}
          </>
        )}

        {isReview && (
          <>
            <Button
              disabled={pending}
              onClick={() => run(() => postStockCountPg(count.id))}
            >
              {pending ? "Posting…" : "Post count"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {count.varianceLines > 0
                ? `Raises one adjustment for ${count.varianceLines} product${count.varianceLines === 1 ? "" : "s"}`
                : "Every line agreed — posting raises no adjustment"}
            </span>
          </>
        )}

        {(status === "counting" || status === "review") && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              const reason = window.prompt("Why is this count being cancelled?");
              if (!reason) return;
              run(() => cancelStockCountPg(count.id, reason), () =>
                router.push("/dashboard/stock-counts"),
              );
            }}
          >
            Cancel count
          </Button>
        )}

        {status === "posted" && (
          <Badge
            variant="outline"
            className="bg-green-500/10 text-green-600 border-green-500/20"
          >
            Posted{count.adjustmentId ? "" : " — no adjustment was needed"}
          </Badge>
        )}
      </div>
    </div>
  );
}
