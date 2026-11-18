import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/auth";
import { can } from "@/lib/capabilities";
import { getVacancy } from "@/app/db/actions/hr-records-actions";
import { EMPLOYMENT_TYPE_LABELS, fmtDay } from "@/lib/hr/record-labels";
import Pipeline from "./Pipeline";

export const metadata = { title: "Vacancy | HR" };

export default async function VacancyPage({ params }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "hr.recruit")) redirect("/dashboard/hr");
  const { id } = await params;
  const v = await getVacancy(id);
  if (!v) notFound();
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <Link href="/dashboard/hr/recruitment" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Recruitment
      </Link>
      <div>
        <p className="font-mono text-xs text-muted-foreground">{v.vacancy_number}</p>
        <h1 className="text-2xl font-bold">{v.title}</h1>
        <p className="text-sm text-muted-foreground">
          {v.department || "No department"} · {EMPLOYMENT_TYPE_LABELS[v.employment_type] || v.employment_type} · {v.positions} position{v.positions > 1 ? "s" : ""}
          {v.closing_date ? ` · closes ${fmtDay(v.closing_date)}` : ""}
        </p>
        {(v.description || v.requirements) && (
          <div className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
            {v.description && <p className="whitespace-pre-wrap"><b>Description.</b> {v.description}</p>}
            {v.requirements && <p className="whitespace-pre-wrap"><b>Requirements.</b> {v.requirements}</p>}
          </div>
        )}
      </div>
      <Pipeline v={v} />
    </div>
  );
}
