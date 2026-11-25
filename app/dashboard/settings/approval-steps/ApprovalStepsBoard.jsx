"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, RotateCcw, Save, Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveApprovalStepPolicy, resetApprovalStepPolicy } from "@/app/db/actions/approval-step-actions";

const TITLES = {
  stock_adjustment: ["Stock adjustments", "Stock added or removed, and stock-count variances"],
  stock_writeoff: ["Write-offs and high-risk changes", "Damage, theft, expiry, and changes over the value threshold"],
  stock_valuation: ["Stock needing a cost", "Stock admitted for an item that has no cost yet"],
};

function Chain({ policy, roles }) {
  const router = useRouter();
  const [stepsDraft, setSteps] = useState(policy.steps.map((s) => ({ label: s.label, roles: [...s.roles] })));
  const [busy, start] = useTransition();
  const [title, blurb] = TITLES[policy.type] ?? [policy.type, ""];

  const update = (i, patch) => setSteps((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const toggleRole = (i, r) =>
    update(i, { roles: stepsDraft[i].roles.includes(r) ? stepsDraft[i].roles.filter((x) => x !== r) : [...stepsDraft[i].roles, r] });

  const save = () =>
    start(async () => {
      const res = await saveApprovalStepPolicy(policy.type, stepsDraft);
      res?.error ? toast.error(res.error) : (toast.success(res.message), router.refresh());
    });
  const reset = () =>
    start(async () => {
      const res = await resetApprovalStepPolicy(policy.type);
      res?.error ? toast.error(res.error) : (toast.success(res.message), router.refresh());
    });

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border bg-muted/30 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">
            {blurb} · {policy.custom ? `customised${policy.updatedByName ? ` by ${policy.updatedByName}` : ""}` : "default steps"}
          </p>
        </div>
        <div className="flex gap-2">
          {policy.custom && (
            <Button variant="outline" size="sm" onClick={reset} disabled={busy}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Defaults
            </Button>
          )}
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />} Save
          </Button>
        </div>
      </header>
      <ol className="grid gap-3 p-4 md:grid-cols-3">
        {stepsDraft.map((s, i) => (
          <li key={i} className="relative rounded-lg border border-border p-3">
            {i < stepsDraft.length - 1 && (
              <ChevronRight className="absolute -right-3 top-1/2 hidden h-5 w-5 -translate-y-1/2 text-muted-foreground md:block" />
            )}
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                {i + 1}
              </span>
              <input
                value={s.label}
                onChange={(e) => update(i, { label: e.target.value })}
                aria-label={`Step ${i + 1} name`}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm font-medium"
              />
              {stepsDraft.length > 1 && (
                <button
                  type="button"
                  onClick={() => setSteps((all) => all.filter((_, j) => j !== i))}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                  aria-label={`Remove step ${i + 1}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {roles.map((r) => {
                const on = s.roles.includes(r);
                return (
                  <button
                    type="button"
                    key={r}
                    onClick={() => toggleRole(i, r)}
                    aria-pressed={on}
                    className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                      on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
        {stepsDraft.length < 5 && (
          <li>
            <button
              type="button"
              onClick={() => setSteps((all) => [...all, { label: `Step ${all.length + 1}`, roles: [] }])}
              className="flex h-full min-h-[96px] w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:bg-muted/40"
            >
              <Plus className="h-4 w-4" /> Add a step
            </button>
          </li>
        )}
      </ol>
    </section>
  );
}

export default function ApprovalStepsBoard({ data }) {
  return (
    <div className="space-y-4">
      {data.policies.map((p) => (
        <Chain key={`${p.type}-${p.custom}-${p.steps.map((s) => s.label + s.roles.join()).join("|")}`} policy={p} roles={data.roles} />
      ))}
    </div>
  );
}
