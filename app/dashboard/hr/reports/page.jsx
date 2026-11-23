import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { can } from "@/lib/capabilities";
import { getHrReport } from "@/app/db/actions/hr-records-actions";
import { TRAINING_KIND_LABELS, CASE_TYPE_LABELS, CASE_CATEGORY_LABELS } from "@/lib/hr/record-labels";
import { PageHeader, Card } from "../components/records-ui";

export const metadata = { title: "HR reports | HR" };

const kes = (n) => `KES ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
const monthName = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-KE", { month: "short" });

function Table({ cols, rows, empty = "Nothing to show." }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            {cols.map((c) => <th key={c.label} className={`py-2 pr-3 ${c.right ? "text-right" : ""}`}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => <td key={c.label} className={`py-2 pr-3 ${c.right ? "text-right tabular-nums" : ""}`}>{c.value(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Headcount and movement, leave, payroll cost, attendance, training and cases for one year. */
export default async function HrReportsPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user, "hr.reports")) redirect("/dashboard/hr");
  const sp = await searchParams;
  const thisYear = new Date().getFullYear();
  const year = Number(sp?.year) || thisYear;
  const r = await getHrReport(year);

  const headcount = r.headcountByDept.reduce((n, d) => n + d.headcount, 0);
  const leavers = r.movement.reduce((n, m) => n + m.leavers, 0);
  const joiners = r.movement.reduce((n, m) => n + m.joiners, 0);
  const avg = r.movement.length ? r.movement.reduce((n, m) => n + m.closing, 0) / r.movement.length : 0;
  const turnover = avg ? (leavers / avg) * 100 : 0;
  const payrollGross = r.payroll.reduce((n, p) => n + Number(p.gross), 0);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        title="HR reports"
        sub={`People, movement, leave, pay and attendance for ${year}.`}
        actions={
          <div className="flex gap-1">
            {[thisYear - 2, thisYear - 1, thisYear].map((y) => (
              <Link key={y} href={`?year=${y}`} className={`rounded-md border px-3 py-1.5 text-sm ${y === year ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent"}`}>{y}</Link>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ["Headcount now", headcount],
          ["Joiners", joiners],
          ["Leavers", leavers],
          ["Staff turnover", `${turnover.toFixed(1)}%`],
          ["Payroll (gross)", kes(payrollGross)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{k}</p>
            <p className="mt-1 text-2xl font-bold">{v}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Headcount by department">
          <Table
            rows={r.headcountByDept}
            cols={[
              { label: "Department", value: (d) => d.department },
              { label: "Staff", right: true, value: (d) => d.headcount },
              { label: "On probation", right: true, value: (d) => d.probation },
              { label: "Female", right: true, value: (d) => d.female },
              { label: "Male", right: true, value: (d) => d.male },
            ]}
          />
        </Card>
        <Card title="Joiners and leavers by month">
          <Table
            rows={r.movement}
            cols={[
              { label: "Month", value: (m) => monthName(m.month) },
              { label: "Joiners", right: true, value: (m) => m.joiners },
              { label: "Leavers", right: true, value: (m) => m.leavers },
              { label: "Headcount at month end", right: true, value: (m) => m.closing },
            ]}
          />
        </Card>
        <Card title="Payroll cost by month">
          <Table
            rows={r.payroll}
            empty="No approved payroll this year."
            cols={[
              { label: "Month", value: (p) => monthName(p.month) },
              { label: "Payslips", right: true, value: (p) => p.payslips },
              { label: "Gross", right: true, value: (p) => kes(p.gross) },
              { label: "Employer NSSF + levy", right: true, value: (p) => kes(p.employer_cost) },
              { label: "Net pay", right: true, value: (p) => kes(p.net) },
            ]}
          />
        </Card>
        <Card title="Leave taken">
          <Table
            rows={r.leave}
            empty="No approved leave this year."
            cols={[
              { label: "Leave type", value: (l) => l.leave_type },
              { label: "Requests", right: true, value: (l) => l.requests },
              { label: "Days", right: true, value: (l) => Number(l.days).toLocaleString("en-KE") },
            ]}
          />
        </Card>
        <Card title="Attendance this month">
          <Table
            rows={r.attendance}
            empty="No attendance recorded this month."
            cols={[
              { label: "Employee", value: (a) => a.name },
              { label: "Present", right: true, value: (a) => a.days_present },
              { label: "Late", right: true, value: (a) => a.days_late },
              { label: "Absent", right: true, value: (a) => a.days_absent },
              { label: "Overtime (h)", right: true, value: (a) => Number(a.overtime_hours) },
            ]}
          />
        </Card>
        <div className="space-y-4">
          <Card title="Training">
            <Table
              rows={r.training}
              empty="No training recorded this year."
              cols={[
                { label: "Kind", value: (t) => TRAINING_KIND_LABELS[t.kind] || t.kind },
                { label: "Records", right: true, value: (t) => t.records },
                { label: "Cost", right: true, value: (t) => kes(t.cost) },
              ]}
            />
          </Card>
          <Card title="Disciplinary and grievance cases">
            <Table
              rows={r.cases}
              empty="No cases this year."
              cols={[
                { label: "Type", value: (c) => CASE_TYPE_LABELS[c.case_type] },
                { label: "Category", value: (c) => CASE_CATEGORY_LABELS[c.category] },
                { label: "Cases", right: true, value: (c) => c.cases },
              ]}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
