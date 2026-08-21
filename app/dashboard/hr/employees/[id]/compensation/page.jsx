import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getEmployeeForPage } from "@/app/db/actions/hr-employee-actions";
import { HR_COMPENSATION_ROLES } from "@/lib/utils/role-gates";
import { roleAllowed } from "@/lib/permissions";
import CompensationEditForm from "../../../components/CompensationEditForm";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const data = await getEmployeeForPage(id);
  if (!data) return { title: "Employee Not Found" };
  return { title: `Compensation — ${data.employee.fullName} | HR` };
}

async function CompensationLoader({ id }) {
  const data = await getEmployeeForPage(id);
  if (!data) notFound();
  // The pay history belongs beside the form that changes it — the source
  // writes SalaryHistory and shows it nowhere.
  return <CompensationEditForm employee={data.employee} history={data.salary} />;
}

function FormSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="h-48 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

export default async function CompensationPage({ params }) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!roleAllowed(session.user.role, HR_COMPENSATION_ROLES)) {
    redirect(`/dashboard/hr/employees/${id}`);
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/employees" className="hover:text-foreground">Employees</Link>
        <span>/</span>
        <Link href={`/dashboard/hr/employees/${id}`} className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
          Employee
        </Link>
        <span>/</span>
        <span className="text-foreground">Compensation</span>
      </div>

      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">Edit Compensation</h1>
        <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
          Visible to HR and finance leadership only. Every change is recorded.
        </p>
      </div>

      <Suspense fallback={<FormSkeleton />}>
        <CompensationLoader id={id} />
      </Suspense>
    </div>
  );
}
