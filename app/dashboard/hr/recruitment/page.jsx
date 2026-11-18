import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { can } from "@/lib/capabilities";
import { listVacancies } from "@/app/db/actions/hr-records-actions";
import { getEmployeeFormData } from "@/app/db/actions/hr-employee-actions";
import { VACANCY_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS, fmtDay } from "@/lib/hr/record-labels";
import { PageHeader, Badge, Empty } from "../components/records-ui";
import VacancyForm from "./VacancyForm";

export const metadata = { title: "Recruitment | HR" };

const tone = (s) => (s === "open" ? "green" : s === "filled" ? "blue" : s === "on_hold" ? "amber" : "gray");

export default async function RecruitmentPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "hr.recruit")) redirect("/dashboard/hr");
  const [vacancies, { departments }] = await Promise.all([listVacancies(), getEmployeeFormData()]);
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader title="Recruitment" sub="Vacancies and their candidates, from application to hire. A hired candidate becomes an employee record." />
      <VacancyForm departments={departments} />
      {vacancies.length === 0 ? (
        <Empty>No vacancies yet.</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {vacancies.map((v) => (
            <Link key={v.id} href={`/dashboard/hr/recruitment/${v.id}`} className="rounded-lg border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted/50">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">{v.vacancy_number}</p>
                  <p className="font-semibold">{v.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {v.department || "No department"} · {EMPLOYMENT_TYPE_LABELS[v.employment_type] || v.employment_type} · {v.positions} position{v.positions > 1 ? "s" : ""}
                  </p>
                </div>
                <Badge tone={tone(v.status)}>{VACANCY_STATUS_LABELS[v.status]}</Badge>
              </div>
              <p className="mt-3 text-sm">
                <b>{v.candidates}</b> candidate{v.candidates === 1 ? "" : "s"} · {v.in_progress} in progress · {v.hired} hired
              </p>
              {v.closing_date && <p className="text-xs text-muted-foreground">Closes {fmtDay(v.closing_date)}</p>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
