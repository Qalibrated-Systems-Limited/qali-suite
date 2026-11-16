"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { addCandidate, moveCandidate, setVacancyStatus } from "@/app/db/actions/hr-records-actions";
import { CANDIDATE_STAGE_LABELS, VACANCY_STATUS_LABELS, fmtDay } from "@/lib/hr/record-labels";
import { Field, inputClass, Button, Badge, useRunAction } from "../../components/records-ui";

const ACTIVE = ["applied", "screening", "interview", "offer"];
const NEXT = { applied: "screening", screening: "interview", interview: "offer" };

function AddCandidate({ vacancyId }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(addCandidate, { success: false });
  useEffect(() => {
    if (state.success) {
      toast.success(state.message);
      router.refresh();
    } else if (state.error) toast.error(state.error);
  }, [state, router]);
  return (
    <form action={action} className="grid gap-3 rounded-lg border border-border bg-card p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-6">
      <input type="hidden" name="vacancyId" value={vacancyId} />
      <Field label="Full name" className="lg:col-span-2"><input name="fullName" className={inputClass()} required /></Field>
      <Field label="Email"><input type="email" name="email" className={inputClass()} /></Field>
      <Field label="Phone"><input name="phone" className={inputClass()} /></Field>
      <Field label="Source"><input name="source" className={inputClass()} placeholder="e.g. LinkedIn, referral" /></Field>
      <Field label="Expected salary"><input type="number" min="0" name="expectedSalary" className={inputClass()} /></Field>
      <Field label="Notes" className="sm:col-span-2 lg:col-span-5"><input name="notes" className={inputClass()} /></Field>
      <div className="flex items-end"><Button type="submit" pending={pending} className="w-full">Add candidate</Button></div>
    </form>
  );
}

function CandidateRow({ c, vacancyTitle }) {
  const [pending, run] = useRunAction();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(c.interviewDate || "");
  const active = ACTIVE.includes(c.stage);
  return (
    <tr className="align-top">
      <td className="px-3 py-3">
        <p className="font-medium">{c.fullName}</p>
        <p className="text-xs text-muted-foreground">{[c.email, c.phone, c.source].filter(Boolean).join(" · ") || "—"}</p>
        {c.notes && <p className="text-xs text-muted-foreground">{c.notes}</p>}
      </td>
      <td className="px-3 py-3">
        <Badge tone={c.stage === "hired" ? "green" : c.stage === "rejected" || c.stage === "withdrawn" ? "red" : "blue"}>{CANDIDATE_STAGE_LABELS[c.stage]}</Badge>
        {c.rejectionReason && <p className="mt-1 text-xs text-muted-foreground">{c.rejectionReason}</p>}
        {c.stage === "hired" && c.employeeId && (
          <Link href={`/dashboard/hr/employees/${c.employeeId}`} className="mt-1 block text-xs text-primary hover:underline">Employee record →</Link>
        )}
      </td>
      <td className="px-3 py-3">
        {active ? (
          <input type="date" className={`${inputClass()} w-40`} value={date || ""} onChange={(e) => setDate(e.target.value)} onBlur={() => date !== (c.interviewDate || "") && run(() => moveCandidate(c.id, { stage: c.stage, interviewDate: date }))} />
        ) : (
          fmtDay(c.interviewDate)
        )}
      </td>
      <td className="px-3 py-3">
        {active ? (
          <select className={`${inputClass()} w-20`} value={c.rating ?? ""} onChange={(e) => run(() => moveCandidate(c.id, { stage: c.stage, rating: e.target.value ? Number(e.target.value) : null }))}>
            <option value="">—</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        ) : (
          c.rating ?? "—"
        )}
      </td>
      <td className="px-3 py-3">
        {active && !rejecting && (
          <div className="flex flex-wrap gap-1">
            {NEXT[c.stage] && (
              <Button variant="secondary" className="px-2 py-1 text-xs" pending={pending} onClick={() => run(() => moveCandidate(c.id, { stage: NEXT[c.stage] }))}>
                → {CANDIDATE_STAGE_LABELS[NEXT[c.stage]]}
              </Button>
            )}
            {c.stage === "offer" && (
              <Link href={`/dashboard/hr/employees/create?candidate=${c.id}&title=${encodeURIComponent(vacancyTitle)}`} className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground">
                Hire
              </Link>
            )}
            <Button variant="danger" className="px-2 py-1 text-xs" onClick={() => setRejecting(true)}>Reject</Button>
            <Button variant="secondary" className="px-2 py-1 text-xs" pending={pending} onClick={() => run(() => moveCandidate(c.id, { stage: "withdrawn" }))}>Withdrawn</Button>
          </div>
        )}
        {rejecting && (
          <div className="flex flex-wrap gap-1">
            <input className={`${inputClass()} w-48`} placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button variant="danger" className="px-2 py-1 text-xs" pending={pending} disabled={!reason.trim()} onClick={() => run(() => moveCandidate(c.id, { stage: "rejected", rejectionReason: reason }))}>Reject</Button>
            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setRejecting(false)}>Cancel</Button>
          </div>
        )}
      </td>
    </tr>
  );
}

export default function Pipeline({ v }) {
  const [pending, run] = useRunAction();
  const open = !["filled", "closed"].includes(v.status);
  const counts = Object.fromEntries(Object.keys(CANDIDATE_STAGE_LABELS).map((k) => [k, v.candidates.filter((c) => c.stage === k).length]));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(CANDIDATE_STAGE_LABELS).map(([k, l]) => (
          <span key={k} className="rounded-full border border-border px-3 py-1 text-xs">{l}: <b>{counts[k]}</b></span>
        ))}
        <span className="flex-1" />
        <select className={`${inputClass()} w-40`} value={v.status} disabled={pending} onChange={(e) => run(() => setVacancyStatus(v.id, e.target.value))}>
          {Object.entries(VACANCY_STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      {open && <AddCandidate vacancyId={v.id} />}
      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-3">Candidate</th>
              <th className="px-3 py-3">Stage</th>
              <th className="px-3 py-3">Interview</th>
              <th className="px-3 py-3">Rating</th>
              <th className="px-3 py-3">Move</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {v.candidates.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No candidates yet.</td></tr>
            ) : (
              v.candidates.map((c) => <CandidateRow key={c.id} c={c} vacancyTitle={v.title} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
