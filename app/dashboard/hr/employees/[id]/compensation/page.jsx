import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getEmployeeById } from "@/app/mongodb/queries/hr-queries";
import CompensationEditForm from "../../../components/CompensationEditForm";

const COMP_ROLES = ["SuperAdmin", "Admin", "HR"];

export async function generateMetadata({ params }) {
  const { id } = await params;
  const { employee } = await getEmployeeById(id);
  if (!employee) return { title: "Employee Not Found" };
  const name = `${employee.personalInfo?.firstName} ${employee.personalInfo?.lastName}`;
  return { title: `Compensation — ${name} | HR` };
}

async function CompensationLoader({ id }) {
  const { employee, error } = await getEmployeeById(id);
  if (error || !employee) notFound();
  return <CompensationEditForm employee={employee} />;
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
  if (!COMP_ROLES.includes(session.user.role)) redirect(`/dashboard/hr/employees/${id}`);

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
        <p className="mt-1 hidden text-sm text-muted-foreground sm:block">Visible to Admin and HR only</p>
      </div>

      <Suspense fallback={<FormSkeleton />}>
        <CompensationLoader id={id} />
      </Suspense>
    </div>
  );
}
