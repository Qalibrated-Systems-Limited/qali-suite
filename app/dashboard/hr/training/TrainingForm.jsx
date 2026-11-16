"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { saveTraining, deleteTraining } from "@/app/db/actions/hr-records-actions";
import { TRAINING_KIND_LABELS, TRAINING_STATUS_LABELS } from "@/lib/hr/record-labels";
import { Field, inputClass, EmployeePicker, Button, useRunAction } from "../components/records-ui";

/** Add a training record, or edit one (pass `record`). */
export function TrainingForm({ employees, record = null, defaultEmployeeId = "", onDone }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveTraining, { success: false });
  const [employeeId, setEmployeeId] = useState(record?.employee_id || defaultEmployeeId);
  const [status, setStatus] = useState(record?.status || "completed");
  useEffect(() => {
    if (state.success) {
      toast.success(state.message);
      onDone?.();
      router.refresh();
    } else if (state.error) toast.error(state.error);
  }, [state, router, onDone]);
  const d = (k) => (record?.[k] ? String(record[k]).slice(0, 10) : "");
  return (
    <form action={action} className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-sm">
      {record && <input type="hidden" name="id" value={record.id} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Employee">
          {record ? (
            <>
              <input type="hidden" name="employeeId" value={record.employee_id} />
              <p className="py-2 text-sm">{record.employee_name}</p>
            </>
          ) : (
            <EmployeePicker employees={employees} value={employeeId} onChange={setEmployeeId} />
          )}
        </Field>
        <Field label="Kind">
          <select name="kind" className={inputClass()} defaultValue={record?.kind || "course"}>
            {Object.entries(TRAINING_KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select name="status" className={inputClass()} value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(TRAINING_STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Course / certificate" className="sm:col-span-2">
          <input name="title" className={inputClass()} defaultValue={record?.title || ""} placeholder="e.g. ISO/IEC 17025 internal auditor" required />
        </Field>
        <Field label="Provider">
          <input name="provider" className={inputClass()} defaultValue={record?.provider || ""} placeholder="e.g. KEBS, KENAS" />
        </Field>
        <Field label="Start date"><input type="date" name="startDate" className={inputClass()} defaultValue={d("start_date")} /></Field>
        <Field label={status === "completed" ? "Completed on" : "Completed on (when done)"}>
          <input type="date" name="completedOn" className={inputClass()} defaultValue={d("completed_on")} required={status === "completed"} />
        </Field>
        <Field label="Expires on" hint="For certificates and licences that must be renewed.">
          <input type="date" name="expiresOn" className={inputClass()} defaultValue={d("expires_on")} />
        </Field>
        <Field label="Certificate no."><input name="certificateNumber" className={inputClass()} defaultValue={record?.certificate_number || ""} /></Field>
        <Field label="Cost (KES)"><input type="number" min="0" step="0.01" name="cost" className={inputClass()} defaultValue={record?.cost ?? ""} /></Field>
        <Field label="Notes"><input name="notes" className={inputClass()} defaultValue={record?.notes || ""} /></Field>
      </div>
      <div className="flex justify-end gap-2">
        {onDone && <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>}
        <Button type="submit" pending={pending}>{record ? "Save changes" : "Record training"}</Button>
      </div>
    </form>
  );
}

export function AddTraining({ employees, defaultEmployeeId }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <TrainingForm employees={employees} defaultEmployeeId={defaultEmployeeId} onDone={() => setOpen(false)} />
  ) : (
    <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Record training</Button>
  );
}

export function TrainingRowActions({ record, employees }) {
  const [editing, setEditing] = useState(false);
  const [pending, run] = useRunAction();
  if (editing) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(false)}>
        <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <div className="mb-2 flex justify-end">
            <button className="rounded bg-card p-1" onClick={() => setEditing(false)} aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
          <TrainingForm employees={employees} record={record} onDone={() => setEditing(false)} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-end gap-1">
      <button className="rounded p-1 hover:bg-accent" title="Edit" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /></button>
      <button
        className="rounded p-1 text-destructive hover:bg-destructive/10"
        title="Delete"
        disabled={pending}
        onClick={() => confirm(`Delete "${record.title}" for ${record.employee_name}?`) && run(() => deleteTraining(record.id))}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
