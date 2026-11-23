import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/auth";
import { can } from "@/lib/capabilities";
import { getHrCase } from "@/app/db/actions/hr-records-actions";
import { CASE_TYPE_LABELS, CASE_CATEGORY_LABELS, CASE_STATUS_LABELS, CASE_OUTCOME_LABELS, fmtDay } from "@/lib/hr/record-labels";
import { Badge, Card } from "../../components/records-ui";
import CaseSteps from "./CaseSteps";

export const metadata = { title: "Case | HR" };

function Row({ k, v }) {
  if (!v) return null;
  return (
    <div className="grid grid-cols-3 gap-2 border-b border-border py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="col-span-2 whitespace-pre-wrap">{v}</span>
    </div>
  );
}

export default async function CasePage({ params }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user, "hr.discipline")) redirect("/dashboard/hr");
  const { id } = await params;
  const c = await getHrCase(id);
  if (!c) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <Link href="/dashboard/hr/cases" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Disciplinary & grievances
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{c.case_number}</p>
          <h1 className="text-2xl font-bold">
            {CASE_TYPE_LABELS[c.case_type]}: {CASE_CATEGORY_LABELS[c.category]}
          </h1>
          <p className="text-sm text-muted-foreground">
            <Link href={`/dashboard/hr/employees/${c.employee_id}`} className="hover:underline">{c.employee_name}</Link> · {c.employee_number}
            {c.designation ? ` · ${c.designation}` : ""}
          </p>
        </div>
        <Badge tone={c.status === "closed" ? "gray" : "amber"}>{CASE_STATUS_LABELS[c.status]}</Badge>
      </div>

      <Card title="Record">
        <Row k="Incident date" v={fmtDay(c.incident_date)} />
        <Row k="What happened" v={c.description} />
        <Row k="Show-cause issued" v={c.show_cause_issued_on ? `${fmtDay(c.show_cause_issued_on)} — reply due ${fmtDay(c.response_due_on)}` : null} />
        <Row k="Employee's response" v={c.employee_response} />
        <Row k="Hearing" v={c.hearing_date ? `${fmtDay(c.hearing_date)}${c.hearing_panel ? ` — panel: ${c.hearing_panel}` : ""}${c.accompanied_by ? ` — accompanied by ${c.accompanied_by}` : ""}` : null} />
        <Row k="Minutes" v={c.hearing_notes} />
        <Row k="Outcome" v={c.outcome ? `${CASE_OUTCOME_LABELS[c.outcome]}${c.suspension_days ? ` — ${c.suspension_days} days` : ""}` : null} />
        <Row k="Reasons" v={c.outcome_notes} />
        <Row k="Warning live until" v={c.warning_expires_on ? fmtDay(c.warning_expires_on) : null} />
        <Row k="Appeal" v={c.appeal_notes} />
        <Row k="Closed" v={c.closed_on ? `${fmtDay(c.closed_on)} by ${c.closed_by_name || "—"}` : null} />
        <Row k="Opened by" v={c.created_by_name} />
      </Card>

      {c.status !== "closed" && <CaseSteps c={c} />}
    </div>
  );
}
