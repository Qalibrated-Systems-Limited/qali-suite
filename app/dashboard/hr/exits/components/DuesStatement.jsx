"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { addExitLine, removeExitLine } from "@/app/db/actions/hr-exit-actions";

const kes = (n) =>
  (n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function RemoveLine({ exitId, lineId }) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      aria-label="Remove line"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const res = await removeExitLine(exitId, lineId);
          if (!res.success) toast.error(res.error);
        })
      }
      className="rounded p-1 text-muted-foreground hover:text-destructive"
    >
      {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </button>
  );
}

function AddLine({ exitId, accounts }) {
  const [state, formAction, isPending] = useActionState(addExitLine, { success: false });
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("earning");
  useEffect(() => {
    if (state.success) setOpen(false);
    else if (state.error) toast.error(state.error);
  }, [state]);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
        <Plus className="h-4 w-4" /> Add a line
      </button>
    );
  }
  const field = "rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground";
  return (
    <form action={formAction} className="space-y-2 rounded-md border border-border p-3">
      <input type="hidden" name="exitId" value={exitId} />
      <div className="grid gap-2 sm:grid-cols-[8rem_1fr_9rem]">
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={field}>
          <option value="earning">Earning</option>
          <option value="deduction">Deduction</option>
        </select>
        <input
          name="description"
          placeholder={kind === "earning" ? "e.g. Gratuity, agreed ex gratia" : "e.g. Phone not returned"}
          className={field}
        />
        <input name="amount" type="number" step="0.01" min="0" placeholder="Amount" className={field} />
      </div>
      {kind === "deduction" ? (
        <select name="accountId" defaultValue="" className={`${field} w-full`}>
          <option value="" disabled>
            Credit to account…
          </option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} — {a.name}
            </option>
          ))}
        </select>
      ) : (
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="notTaxable" className="h-3.5 w-3.5" /> Not subject to PAYE
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="notPensionable" className="h-3.5 w-3.5" /> Not subject to NSSF, SHIF or the levy
          </label>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground">
          Cancel
        </button>
        <button type="submit" disabled={isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
          {isPending ? "Adding…" : "Add"}
        </button>
      </div>
    </form>
  );
}

function Row({ label, sub, amount, negative, strong, action }) {
  return (
    <tr className={strong ? "font-semibold" : ""}>
      <td className="py-2 pr-3 align-top">
        <span className="text-foreground">{label}</span>
        {sub && <span className="block text-xs font-normal text-muted-foreground">{sub}</span>}
      </td>
      <td className="w-36 py-2 text-right align-top tabular-nums text-foreground">
        {negative && amount ? "(" : ""}
        {kes(amount)}
        {negative && amount ? ")" : ""}
      </td>
      <td className="w-8 py-2 text-right align-top">{action}</td>
    </tr>
  );
}

export default function DuesStatement({ exitId, dues, editable, accounts = [] }) {
  const earnings = dues.lines.filter((l) => l.kind === "earning");
  const deductions = dues.lines.filter((l) => l.kind === "deduction");
  const t = dues.totals;
  const sub = (l) =>
    l.quantity != null && l.rate != null ? `${l.quantity} × ${kes(l.rate)}` : l.isManual ? "Added manually" : null;
  const lineAction = (l) => (editable && l.isManual && l.id ? <RemoveLine exitId={exitId} lineId={l.id} /> : null);

  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="font-semibold text-foreground">Final dues</h2>
        <span className="text-xs text-muted-foreground">
          {dues.live
            ? `Live estimate · daily rate KES ${kes(dues.dailyRate)} (${dues.dailyRateBasis})`
            : "As approved"}
        </span>
      </div>

      {dues.warnings?.length > 0 && (
        <ul className="space-y-1 border-b border-border bg-amber-500/5 px-4 py-3">
          {dues.warnings.map((w) => (
            <li key={w} className="flex gap-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
            </li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto px-4 py-2">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border">
            <tr>
              <td colSpan={3} className="pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Earnings
              </td>
            </tr>
            {earnings.length === 0 && (
              <tr>
                <td colSpan={3} className="py-2 text-muted-foreground">Nothing is owed as earnings.</td>
              </tr>
            )}
            {earnings.map((l, i) => (
              <Row key={l.id ?? `e${i}`} label={l.description} sub={sub(l)} amount={l.amount} action={lineAction(l)} />
            ))}
            {deductions
              .filter((l) => l.taxable)
              .map((l, i) => (
                <Row key={l.id ?? `p${i}`} label={l.description} sub={sub(l)} amount={l.amount} negative action={lineAction(l)} />
              ))}
            <Row label="Gross final dues" amount={t.grossEarnings} strong />

            <tr>
              <td colSpan={3} className="pb-1 pt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Deductions
              </td>
            </tr>
            <Row label="PAYE" amount={t.paye} negative />
            <Row label="NSSF" amount={t.nssf} negative />
            <Row label="SHIF" amount={t.shif} negative />
            <Row label="Affordable Housing Levy" amount={t.housingLevy} negative />
            {deductions
              .filter((l) => !l.taxable)
              .map((l, i) => (
                <Row key={l.id ?? `d${i}`} label={l.description} sub={sub(l)} amount={l.amount} negative action={lineAction(l)} />
              ))}
            <Row label="Net final dues payable" amount={t.net} strong />
          </tbody>
        </table>
        <p className="py-2 text-xs text-muted-foreground">
          Employer contributions on top: NSSF KES {kes(t.employerNssf)} · Housing levy KES {kes(t.employerHousingLevy)}.
        </p>
      </div>

      {editable && (
        <div className="border-t border-border px-4 py-3">
          <AddLine exitId={exitId} accounts={accounts} />
        </div>
      )}
    </section>
  );
}
