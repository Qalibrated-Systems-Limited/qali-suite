"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Wand2 } from "lucide-react";
import { issueHrLetter, draftHrLetter } from "@/app/db/actions/hr-records-actions";
import { LETTER_KIND_LABELS } from "@/lib/hr/letters";
import { Field, inputClass, EmployeePicker, Button } from "../components/records-ui";

const initial = { success: false, error: null };

/** Which extra details each kind of letter asks for before drafting. */
const DETAILS = {
  offer: ["effectiveDate", "newDesignation", "newSalary"],
  appointment: ["reportingTo"],
  probation_confirmation: ["effectiveDate"],
  probation_extension: ["effectiveDate", "extensionMonths", "reason"],
  promotion: ["effectiveDate", "newDesignation", "newDepartment", "newSalary"],
  salary_review: ["effectiveDate", "newSalary"],
  transfer: ["effectiveDate", "newDepartment", "newDesignation"],
  show_cause: ["reason", "responseDays"],
  warning: ["reason"],
  commendation: ["reason"],
  reference: ["reason"],
  general: [],
};
const DETAIL_LABELS = {
  effectiveDate: ["Effective date", "date"],
  newDesignation: ["Position", "text"],
  newSalary: ["Gross monthly salary (KES)", "number"],
  newDepartment: ["Department / station", "text"],
  reportingTo: ["Reports to", "text"],
  extensionMonths: ["Extension (months)", "number"],
  responseDays: ["Days to reply", "number"],
  reason: ["Details / reason", "text"],
};

export default function LetterForm({ employees, defaultEmployeeId = "", defaultKind = "appointment", signatory = {} }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(issueHrLetter, initial);
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId);
  const [kind, setKind] = useState(defaultKind);
  const [details, setDetails] = useState({});
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [drafting, startDraft] = useTransition();

  useEffect(() => {
    if (state.success && state.id) {
      toast.success(state.message);
      router.push(`/dashboard/hr/letters/${state.id}`);
    } else if (state.error) toast.error(state.error);
  }, [state, router]);

  const draft = () => {
    if (!employeeId) return toast.error("Choose the employee first.");
    startDraft(async () => {
      const res = await draftHrLetter(employeeId, kind, details);
      if (res?.success) {
        setSubject(res.subject);
        setBody(res.body);
      } else toast.error(res?.error || "Could not draft the letter");
    });
  };

  return (
    <form action={action} className="space-y-5 rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Employee">
          <EmployeePicker employees={employees} value={employeeId} onChange={setEmployeeId} />
        </Field>
        <Field label="Kind of letter">
          <select name="kind" className={inputClass()} value={kind} onChange={(e) => { setKind(e.target.value); setDetails({}); }}>
            {Object.entries(LETTER_KIND_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </Field>
      </div>

      {DETAILS[kind]?.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {DETAILS[kind].map((k) => (
            <Field key={k} label={DETAIL_LABELS[k][0]} className={k === "reason" ? "sm:col-span-2" : ""}>
              <input
                type={DETAIL_LABELS[k][1]}
                className={inputClass()}
                value={details[k] ?? ""}
                onChange={(e) => setDetails((d) => ({ ...d, [k]: e.target.value }))}
              />
            </Field>
          ))}
        </div>
      )}

      <div>
        <Button type="button" variant="secondary" pending={drafting} onClick={draft}>
          <Wand2 className="h-4 w-4" /> Draft the standard wording
        </Button>
        <p className="mt-1 text-xs text-muted-foreground">
          Fills the subject and body from the employee&apos;s record. Edit the text before issuing — what you issue is what is kept and printed.
        </p>
      </div>

      <Field label="Subject">
        <input name="subject" className={inputClass()} value={subject} onChange={(e) => setSubject(e.target.value)} required />
      </Field>
      <Field label="Letter">
        <textarea name="body" rows={14} className={inputClass()} value={body} onChange={(e) => setBody(e.target.value)} required />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Date of the letter">
          <input type="date" name="issuedOn" className={inputClass()} defaultValue={new Date().toISOString().slice(0, 10)} />
        </Field>
        <Field label="Effective date (optional)">
          <input type="date" name="effectiveDate" className={inputClass()} value={details.effectiveDate ?? ""} onChange={(e) => setDetails((d) => ({ ...d, effectiveDate: e.target.value }))} />
        </Field>
        <Field label="Signed by">
          <input name="signatoryName" className={inputClass()} defaultValue={signatory.name || ""} />
        </Field>
        <Field label="Title">
          <input name="signatoryTitle" className={inputClass()} defaultValue={signatory.title || "Human Resources"} />
        </Field>
      </div>

      <div className="flex justify-end">
        <Button type="submit" pending={pending}>Issue letter</Button>
      </div>
    </form>
  );
}
