"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Clock, Loader2, XCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { approveApproval, rejectApproval } from "@/app/db/actions/approval-actions";
import DocumentsPanel from "@/components/inventory/DocumentsPanel";

/**
 * A stock change passing its approval chain.
 *
 * The timeline shows every step, who signed it and when. Below it, the lines
 * the change will make — each with a checkbox. The approver of the current
 * step ticks every line to confirm the quantities before Approve is enabled;
 * the server checks the same thing.
 */

const qty = (n) => Number(n ?? 0).toLocaleString("en-KE", { maximumFractionDigits: 2 });
const kes = (n) => `KES ${Number(n ?? 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
const when = (d) =>
  d ? new Date(d).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

export function StepTimeline({ approval, compact = false }) {
  const chain = approval.chain;
  if (!chain) return null;
  return (
    <ol className={`flex flex-col gap-2 sm:flex-row sm:items-stretch ${compact ? "text-[11px]" : "text-xs"}`}>
      {chain.steps.map((s) => {
        const done = Boolean(s.decision);
        const current = approval.status === "submitted" && s.stepNo === approval.currentStep;
        const rejected = approval.status === "rejected" && s.stepNo === approval.currentStep;
        const Icon = done ? CheckCircle2 : rejected ? XCircle : current ? Clock : Circle;
        const tone = done
          ? "border-emerald-500/40 bg-emerald-500/5"
          : rejected
            ? "border-red-500/40 bg-red-500/5"
            : current
              ? "border-amber-500/50 bg-amber-500/5"
              : "border-border bg-muted/20";
        const iconTone = done
          ? "text-emerald-600 dark:text-emerald-400"
          : rejected
            ? "text-red-600 dark:text-red-400"
            : current
              ? "text-amber-600 dark:text-amber-400"
              : "text-muted-foreground";
        return (
          <li key={s.stepNo} className={`flex-1 rounded-md border px-3 py-2 ${tone}`}>
            <div className="flex items-center gap-1.5 font-semibold">
              <Icon className={`h-3.5 w-3.5 shrink-0 ${iconTone}`} />
              <span>
                {s.stepNo}. {s.label}
              </span>
            </div>
            {done ? (
              <p className="mt-0.5 text-muted-foreground">
                {s.decision.decidedByName}
                {s.decision.decidedByRole ? ` (${s.decision.decidedByRole})` : ""} · {when(s.decision.decidedAt)}
                {s.decision.confirmedLines?.length ? ` · ${s.decision.confirmedLines.length} line(s) confirmed` : ""}
              </p>
            ) : rejected ? (
              <p className="mt-0.5 text-muted-foreground">Rejected by {approval.decision?.by?.name}</p>
            ) : (
              <p className="mt-0.5 text-muted-foreground">{(s.roles || []).join(", ") || "—"}</p>
            )}
            {done && s.decision.note && !compact && (
              <p className="mt-0.5 italic text-muted-foreground">“{s.decision.note}”</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const initial = { success: false, error: null };

export default function StepApprovalPanel({ approval }) {
  const router = useRouter();
  const chain = approval.chain;
  const lines = chain?.lines ?? [];
  const [ticked, setTicked] = useState(() => new Set());
  const [note, setNote] = useState("");
  const all = ticked.size === lines.length;

  const [aState, approveAction, aPending] = useActionState(approveApproval.bind(null, approval._id), initial);
  const [rState, rejectAction, rPending] = useActionState(rejectApproval.bind(null, approval._id), initial);
  const pending = aPending || rPending;

  useEffect(() => {
    if (aState.success) {
      toast.success(aState.message || "Approved");
      router.refresh();
    } else if (aState.error) toast.error(aState.error);
  }, [aState, router]);
  useEffect(() => {
    if (rState.success) {
      toast.success("Rejected");
      router.refresh();
    } else if (rState.error) toast.error(rState.error);
  }, [rState, router]);

  const totals = useMemo(() => {
    let up = 0;
    let down = 0;
    for (const l of lines) (l.change >= 0 ? (up += l.value) : (down += l.value));
    return { up, down };
  }, [lines]);

  const toggle = (id) =>
    setTicked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const confirmed = JSON.stringify([...ticked]);
  const signing = chain?.canSign;

  return (
    <div className="space-y-3">
      <StepTimeline approval={approval} />

      {lines.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs">
            <span className="font-semibold">
              {signing ? "Confirm each line" : "Lines in this change"} · {lines.length}
            </span>
            <span className="text-muted-foreground">
              Added {kes(totals.up)} · Removed {kes(totals.down)}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs">
              <thead className="bg-muted/20 text-left text-muted-foreground">
                <tr>
                  {signing && (
                    <th className="w-10 px-3 py-1.5">
                      <input
                        type="checkbox"
                        aria-label="Confirm all lines"
                        checked={all && lines.length > 0}
                        onChange={(e) => setTicked(e.target.checked ? new Set(lines.map((l) => l.id)) : new Set())}
                        className="h-4 w-4 accent-emerald-600"
                      />
                    </th>
                  )}
                  <th className="px-3 py-1.5">Item</th>
                  <th className="px-3 py-1.5 text-right">Book</th>
                  <th className="px-3 py-1.5 text-right">New</th>
                  <th className="px-3 py-1.5 text-right">Change</th>
                  <th className="px-3 py-1.5 text-right">Value</th>
                  <th className="px-3 py-1.5">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((l) => {
                  const on = ticked.has(l.id);
                  return (
                    <tr
                      key={l.id}
                      onClick={signing ? () => toggle(l.id) : undefined}
                      className={`${signing ? "cursor-pointer" : ""} ${on ? "bg-emerald-500/5" : ""}`}
                    >
                      {signing && (
                        <td className="px-3 py-1.5">
                          <input
                            type="checkbox"
                            aria-label={`Confirm ${l.name}`}
                            checked={on}
                            onChange={() => toggle(l.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="h-4 w-4 accent-emerald-600"
                          />
                        </td>
                      )}
                      <td className="px-3 py-1.5">
                        <p className="font-medium">{l.name}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">{l.sku}</p>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{qty(l.systemQuantity)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{qty(l.physicalQuantity)}</td>
                      <td
                        className={`px-3 py-1.5 text-right font-semibold tabular-nums ${
                          l.change < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        {l.change > 0 ? "+" : ""}
                        {qty(l.change)} {l.unit}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{kes(l.value)}</td>
                      <td className="max-w-[220px] px-3 py-1.5 text-muted-foreground">{l.reason}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {approval.targetRef?.kind === "InventoryAdjustment" && approval.targetRef?.id && (
        <DocumentsPanel entityType="stock_adjustment" entityId={approval.targetRef.id} readOnly compact title="Evidence attached" />
      )}

      {approval.status === "submitted" && !signing && chain?.blockedBecause && (
        <p className="flex items-center gap-1.5 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> {chain.blockedBecause}
        </p>
      )}

      {signing && (
        <div className="space-y-2 rounded-md border border-border bg-card p-3">
          <label htmlFor={`note-${approval._id}`} className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Note for step {approval.currentStep} · {approval.currentStepLabel} (required to reject)
          </label>
          <textarea
            id={`note-${approval._id}`}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={pending}
            placeholder="What you checked, or what is wrong…"
            className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            {lines.length > 0 && (
              <span className={`text-xs sm:mr-auto ${all ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                {ticked.size} of {lines.length} line{lines.length === 1 ? "" : "s"} confirmed
              </span>
            )}
            <form action={rejectAction}>
              <input type="hidden" name="note" value={note} />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={pending || !note.trim()}
                className="w-full border-destructive/40 text-destructive hover:bg-destructive/5 sm:w-auto"
              >
                {rPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                Reject
              </Button>
            </form>
            <form action={approveAction}>
              <input type="hidden" name="note" value={note} />
              <input type="hidden" name="confirmedLines" value={confirmed} />
              <Button type="submit" size="sm" disabled={pending || !all} className="w-full sm:w-auto">
                {aPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                {approval.currentStep < approval.totalSteps
                  ? `Approve step ${approval.currentStep} of ${approval.totalSteps}`
                  : "Final approval — apply to stock"}
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
