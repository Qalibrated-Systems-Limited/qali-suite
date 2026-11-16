"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { openHrCase } from "@/app/db/actions/hr-records-actions";
import { CASE_CATEGORY_LABELS, DISCIPLINARY_CATEGORIES, GRIEVANCE_CATEGORIES } from "@/lib/hr/record-labels";
import { Field, inputClass, EmployeePicker, Button } from "../../components/records-ui";

export default function CaseForm({ employees, defaultEmployeeId = "" }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(openHrCase, { success: false });
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId);
  const [caseType, setCaseType] = useState("disciplinary");
  useEffect(() => {
    if (state.success && state.id) {
      toast.success(state.message);
      router.push(`/dashboard/hr/cases/${state.id}`);
    } else if (state.error) toast.error(state.error);
  }, [state, router]);
  const cats = caseType === "grievance" ? GRIEVANCE_CATEGORIES : DISCIPLINARY_CATEGORIES;
  return (
    <form action={action} className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={caseType === "grievance" ? "Employee raising the grievance" : "Employee"}>
          <EmployeePicker employees={employees} value={employeeId} onChange={setEmployeeId} />
        </Field>
        <Field label="Type">
          <select name="caseType" className={inputClass()} value={caseType} onChange={(e) => setCaseType(e.target.value)}>
            <option value="disciplinary">Disciplinary — the company raises a matter</option>
            <option value="grievance">Grievance — the employee raises a complaint</option>
          </select>
        </Field>
        <Field label="Category">
          <select name="category" className={inputClass()} key={caseType}>
            {cats.map((c) => (
              <option key={c} value={c}>{CASE_CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </Field>
        <Field label="Date of the incident">
          <input type="date" name="incidentDate" className={inputClass()} max={new Date().toISOString().slice(0, 10)} required />
        </Field>
      </div>
      <Field label="What happened" hint="Facts only: when, where, what, and who saw it.">
        <textarea name="description" rows={6} className={inputClass()} required />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" pending={pending}>Open the case</Button>
      </div>
    </form>
  );
}
