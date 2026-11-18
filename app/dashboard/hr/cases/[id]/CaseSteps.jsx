"use client";

import { useState } from "react";
import Link from "next/link";
import { advanceHrCase } from "@/app/db/actions/hr-records-actions";
import { CASE_OUTCOME_LABELS, DISCIPLINARY_OUTCOMES, GRIEVANCE_OUTCOMES } from "@/lib/hr/record-labels";
import { Field, inputClass, Button, Card, useRunAction } from "../../components/records-ui";

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

/**
 * The next steps on an open case, in the order the law sets them. Each form
 * records one step; the case page shows the record of each step taken.
 */
export default function CaseSteps({ c }) {
  const [pending, run] = useRunAction();
  const [f, setF] = useState({
    issuedOn: today(),
    responseDueOn: plusDays(3),
    employeeResponse: "",
    hearingDate: plusDays(5),
    hearingPanel: "",
    accompaniedBy: "",
    hearingNotes: "",
    outcome: c.case_type === "grievance" ? "resolved" : "no_case",
    outcomeNotes: "",
    suspensionDays: "",
    appealNotes: "",
  });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const step = (payload) => run(() => advanceHrCase(c.id, payload));
  const disciplinary = c.case_type === "disciplinary";
  const outcomes = disciplinary ? DISCIPLINARY_OUTCOMES : GRIEVANCE_OUTCOMES;

  return (
    <div className="space-y-4">
      {disciplinary && !c.show_cause_issued_on && (
        <Card title="1. Issue the notice to show cause" actions={
          <Link href={`/dashboard/hr/letters/new?employee=${c.employee_id}&kind=show_cause`} className="text-xs text-primary hover:underline">Draft the letter →</Link>
        }>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Issued on"><input type="date" className={inputClass()} value={f.issuedOn} onChange={set("issuedOn")} /></Field>
            <Field label="Reply due by"><input type="date" className={inputClass()} value={f.responseDueOn} onChange={set("responseDueOn")} /></Field>
            <div className="flex items-end"><Button pending={pending} onClick={() => step({ kind: "show_cause", issuedOn: f.issuedOn, responseDueOn: f.responseDueOn })}>Record notice</Button></div>
          </div>
        </Card>
      )}

      <Card title={`${disciplinary ? "2" : "1"}. ${disciplinary ? "The employee's reply" : "The employee's account"}`}>
        <Field label="Response" hint="Paste or summarise what the employee said in writing.">
          <textarea rows={4} className={inputClass()} value={f.employeeResponse || ""} onChange={set("employeeResponse")} placeholder={c.employee_response || ""} />
        </Field>
        <div className="mt-2 flex justify-end">
          <Button variant="secondary" pending={pending} disabled={!f.employeeResponse.trim()} onClick={() => step({ kind: "response", employeeResponse: f.employeeResponse })}>Save response</Button>
        </div>
      </Card>

      <Card title={`${disciplinary ? "3" : "2"}. Hearing`}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Hearing date"><input type="date" className={inputClass()} value={f.hearingDate} onChange={set("hearingDate")} /></Field>
          <Field label="Panel"><input className={inputClass()} value={f.hearingPanel} onChange={set("hearingPanel")} placeholder="e.g. HR Manager, Head of Department" /></Field>
          <Field label="Accompanied by" hint="A colleague or shop-floor representative of their choice (s.41)."><input className={inputClass()} value={f.accompaniedBy} onChange={set("accompaniedBy")} /></Field>
        </div>
        <div className="mt-2 flex justify-end">
          <Button variant="secondary" pending={pending} onClick={() => step({ kind: "hearing", hearingDate: f.hearingDate, hearingPanel: f.hearingPanel, accompaniedBy: f.accompaniedBy })}>
            {c.hearing_date ? "Update hearing" : "Schedule hearing"}
          </Button>
        </div>
        {c.hearing_date && (
          <div className="mt-3">
            <Field label="Minutes of the hearing">
              <textarea rows={4} className={inputClass()} value={f.hearingNotes} onChange={set("hearingNotes")} />
            </Field>
            <div className="mt-2 flex justify-end">
              <Button variant="secondary" pending={pending} disabled={!f.hearingNotes.trim()} onClick={() => step({ kind: "hearing_notes", hearingNotes: f.hearingNotes })}>Save minutes</Button>
            </div>
          </div>
        )}
      </Card>

      <Card title={`${disciplinary ? "4" : "3"}. Outcome — closes the case`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Outcome">
            <select className={inputClass()} value={f.outcome} onChange={set("outcome")}>
              {outcomes.map((o) => <option key={o} value={o}>{CASE_OUTCOME_LABELS[o]}</option>)}
            </select>
          </Field>
          {f.outcome === "suspension" && (
            <Field label="Suspension days"><input type="number" min="1" max="90" className={inputClass()} value={f.suspensionDays} onChange={set("suspensionDays")} /></Field>
          )}
        </div>
        <Field label="Reasons for the decision" className="mt-3">
          <textarea rows={3} className={inputClass()} value={f.outcomeNotes} onChange={set("outcomeNotes")} />
        </Field>
        <Field label="Appeal (if any)" className="mt-3">
          <textarea rows={2} className={inputClass()} value={f.appealNotes} onChange={set("appealNotes")} />
        </Field>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
          {["verbal_warning", "written_warning", "final_warning"].includes(f.outcome) && (
            <span className="text-xs text-muted-foreground">Issue the warning letter afterwards from Letters.</span>
          )}
          <Button
            pending={pending}
            onClick={() =>
              step({
                kind: "close",
                outcome: f.outcome,
                outcomeNotes: f.outcomeNotes,
                suspensionDays: f.suspensionDays ? Number(f.suspensionDays) : null,
                appealNotes: f.appealNotes,
              })
            }
          >
            Close the case
          </Button>
        </div>
      </Card>
    </div>
  );
}
