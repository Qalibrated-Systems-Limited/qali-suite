import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { auth } from "@/auth";
import { can } from "@/lib/capabilities";
import { listHrCases } from "@/app/db/actions/hr-records-actions";
import { CASE_TYPE_LABELS, CASE_CATEGORY_LABELS, CASE_STATUS_LABELS, CASE_OUTCOME_LABELS, fmtDay } from "@/lib/hr/record-labels";
import { PageHeader, Badge, Empty } from "../components/records-ui";

export const metadata = { title: "Disciplinary & grievances | HR" };

const tone = (s) => (s === "closed" ? "gray" : s === "hearing_scheduled" ? "blue" : "amber");

export default async function CasesPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user, "hr.discipline")) redirect("/dashboard/hr");
  const sp = await searchParams;
  const status = sp?.status ?? "open";
  const type = sp?.type || "";
  const cases = await listHrCases({ status: status === "all" ? "" : status, type });
  const chip = (label, href, on) => (
    <Link href={href} className={`rounded-full border px-3 py-1 text-xs ${on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent"}`}>
      {label}
    </Link>
  );
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        title="Disciplinary & grievances"
        sub="Each case keeps the steps the Employment Act (s.41) requires: the reason in writing, the employee's reply, a hearing with a companion of their choice, and the outcome."
        actions={
          <Link href="/dashboard/hr/cases/new" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" /> Open a case
          </Link>
        }
      />
      <div className="flex flex-wrap gap-2">
        {chip("Open", `?status=open&type=${type}`, status === "open")}
        {chip("Closed", `?status=closed&type=${type}`, status === "closed")}
        {chip("All", `?status=all&type=${type}`, status === "all")}
        <span className="mx-1 text-muted-foreground">·</span>
        {chip("All types", `?status=${status}`, !type)}
        {chip("Disciplinary", `?status=${status}&type=disciplinary`, type === "disciplinary")}
        {chip("Grievance", `?status=${status}&type=grievance`, type === "grievance")}
      </div>
      {cases.length === 0 ? (
        <Empty>No cases here.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Case</th>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Incident</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {cases.map((c) => (
                <tr key={c.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link href={`/dashboard/hr/cases/${c.id}`} className="text-primary hover:underline">{c.case_number}</Link>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{c.employee_name}</p>
                    <p className="text-xs text-muted-foreground">{c.employee_number}{c.department ? ` · ${c.department}` : ""}</p>
                  </td>
                  <td className="px-4 py-3">
                    {CASE_TYPE_LABELS[c.case_type]}
                    <p className="text-xs text-muted-foreground">{CASE_CATEGORY_LABELS[c.category]}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtDay(c.incident_date)}</td>
                  <td className="px-4 py-3"><Badge tone={tone(c.status)}>{CASE_STATUS_LABELS[c.status]}</Badge></td>
                  <td className="px-4 py-3 text-xs">{c.outcome ? CASE_OUTCOME_LABELS[c.outcome] : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
