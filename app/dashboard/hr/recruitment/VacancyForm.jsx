"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createVacancy } from "@/app/db/actions/hr-records-actions";
import { EMPLOYMENT_TYPE_LABELS } from "@/lib/hr/record-labels";
import { Field, inputClass, Button } from "../components/records-ui";

export default function VacancyForm({ departments }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createVacancy, { success: false });
  useEffect(() => {
    if (state.success && state.id) {
      toast.success(state.message);
      router.push(`/dashboard/hr/recruitment/${state.id}`);
    } else if (state.error) toast.error(state.error);
  }, [state, router]);
  if (!open) return <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New vacancy</Button>;
  return (
    <form action={action} className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Job title" className="sm:col-span-2"><input name="title" className={inputClass()} required /></Field>
        <Field label="Department">
          <select name="departmentId" className={inputClass()} defaultValue="">
            <option value="">—</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Employment type">
          <select name="employmentType" className={inputClass()} defaultValue="full_time">
            {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Positions"><input type="number" min="1" name="positions" defaultValue="1" className={inputClass()} /></Field>
        <Field label="Closing date"><input type="date" name="closingDate" className={inputClass()} /></Field>
      </div>
      <Field label="Description"><textarea name="description" rows={3} className={inputClass()} /></Field>
      <Field label="Requirements"><textarea name="requirements" rows={3} className={inputClass()} /></Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
        <Button type="submit" pending={pending}>Create vacancy</Button>
      </div>
    </form>
  );
}
