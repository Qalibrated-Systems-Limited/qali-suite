import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { can } from "@/lib/capabilities";
import { listHrTraining, getRecordsFormData } from "@/app/db/actions/hr-records-actions";
import { TRAINING_KIND_LABELS, TRAINING_STATUS_LABELS, fmtDay } from "@/lib/hr/record-labels";
import { PageHeader, Badge, Empty, Card } from "../components/records-ui";
import { inputClass } from "../components/records-styles";
import { AddTraining, TrainingRowActions } from "./TrainingForm";

export const metadata = { title: "Training & certificates | HR" };

function Expiry({ days, date }) {
  if (days == null) return <span className="text-muted-foreground">—</span>;
  const n = Number(days);
  const tone = n < 0 ? "red" : n <= 30 ? "amber" : "gray";
  return (
    <span className="flex flex-col">
      <span>{fmtDay(date)}</span>
      <Badge tone={tone}>{n < 0 ? `Expired ${-n}d ago` : `${n}d left`}</Badge>
    </span>
  );
}

export default async function TrainingPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user, "hr.training")) redirect("/dashboard/hr");
  const sp = await searchParams;
  const [expiring, records, { employees }] = await Promise.all([
    listHrTraining({ expiringWithin: 60 }),
    listHrTraining({ search: sp?.q || "", employeeId: sp?.employee || "" }),
    getRecordsFormData(),
  ]);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        title="Training & certificates"
        sub="Courses attended and certificates or licences held, with their expiry — the staff competence record ISO/IEC 17025 §6.2 asks for."
      />
      <AddTraining employees={employees} defaultEmployeeId={sp?.employee || ""} />

      {expiring.length > 0 && (
        <Card title={`Expiring within 60 days or expired · ${expiring.length}`} className="border-amber-300 dark:border-amber-800">
          <div className="divide-y divide-border">
            {expiring.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <b>{r.employee_name}</b> — {r.title}
                  {r.certificate_number ? <span className="text-muted-foreground"> · {r.certificate_number}</span> : null}
                </span>
                <Expiry days={r.days_to_expiry} date={r.expires_on} />
              </div>
            ))}
          </div>
        </Card>
      )}

      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={sp?.q || ""} placeholder="Search course, provider or employee…" className={`${inputClass()} max-w-sm`} />
        <button className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent">Search</button>
      </form>

      {records.length === 0 ? (
        <Empty>No training recorded yet.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Training</th>
                <th className="px-4 py-3">Completed</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {records.map((r) => (
                <tr key={r.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3">
                    <p className="font-medium">{r.employee_name}</p>
                    <p className="text-xs text-muted-foreground">{r.employee_number}{r.department ? ` · ${r.department}` : ""}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p>{r.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {TRAINING_KIND_LABELS[r.kind]}
                      {r.provider ? ` · ${r.provider}` : ""}
                      {r.certificate_number ? ` · ${r.certificate_number}` : ""}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtDay(r.completed_on)}</td>
                  <td className="px-4 py-3"><Expiry days={r.days_to_expiry} date={r.expires_on} /></td>
                  <td className="px-4 py-3"><Badge tone={r.status === "completed" ? "green" : r.status === "cancelled" ? "gray" : "blue"}>{TRAINING_STATUS_LABELS[r.status]}</Badge></td>
                  <td className="px-4 py-3"><TrainingRowActions record={r} employees={employees} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
