"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { startReview } from "@/app/db/actions/hr-records-actions";
import { Field, inputClass, EmployeePicker, Button } from "../components/records-ui";

const year = new Date().getFullYear();

/** HR starts a review: who, which cycle, who reviews, and the weighted objectives. */
export default function StartReview({ employees, reviewers }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(startReview, { success: false });
  const [employeeId, setEmployeeId] = useState("");
  const [objectives, setObjectives] = useState([
    { objective: "", weight: 50 },
    { objective: "", weight: 50 },
  ]);
  useEffect(() => {
    if (state.success && state.id) {
      toast.success(state.message);
      router.push(`/dashboard/hr/reviews/${state.id}`);
    } else if (state.error) toast.error(state.error);
  }, [state, router]);
  const total = objectives.reduce((n, o) => n + Number(o.weight || 0), 0);
  if (!open) return <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Start a review</Button>;
  return (
    <form action={action} className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm">
      <input type="hidden" name="objectives" value={JSON.stringify(objectives)} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Employee" className="lg:col-span-2"><EmployeePicker employees={employees} value={employeeId} onChange={setEmployeeId} /></Field>
        <Field label="Cycle"><input name="cycle" className={inputClass()} defaultValue={`${year} annual`} required /></Field>
        <Field label="Reviewer">
          <select name="reviewerUserId" className={inputClass()} defaultValue="">
            <option value="">— HR or any manager —</option>
            {reviewers.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.role}</option>)}
          </select>
        </Field>
        <Field label="Period from"><input type="date" name="periodStart" className={inputClass()} defaultValue={`${year}-01-01`} required /></Field>
        <Field label="Period to"><input type="date" name="periodEnd" className={inputClass()} defaultValue={`${year}-12-31`} required /></Field>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">Objectives <span className={`text-xs ${total === 100 ? "text-emerald-600" : "text-destructive"}`}>· weights total {total}% (must be 100)</span></p>
        <div className="space-y-2">
          {objectives.map((o, i) => (
            <div key={i} className="flex gap-2">
              <input
                className={inputClass()}
                placeholder={`Objective ${i + 1}, e.g. Complete 40 calibrations on time`}
                value={o.objective}
                onChange={(e) => setObjectives((l) => l.map((x, j) => (j === i ? { ...x, objective: e.target.value } : x)))}
              />
              <input
                type="number"
                min="1"
                max="100"
                className={`${inputClass()} w-24`}
                value={o.weight}
                onChange={(e) => setObjectives((l) => l.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))}
              />
              <button type="button" className="rounded p-2 text-destructive hover:bg-destructive/10" onClick={() => setObjectives((l) => l.filter((_, j) => j !== i))} aria-label="Remove objective">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="mt-2 text-sm text-primary hover:underline" onClick={() => setObjectives((l) => [...l, { objective: "", weight: 0 }])}>+ Add objective</button>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
        <Button type="submit" pending={pending}>Create review</Button>
      </div>
    </form>
  );
}
