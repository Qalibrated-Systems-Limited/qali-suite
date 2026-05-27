import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getEmployeeById, getDepartments } from "@/app/mongodb/queries/hr-queries";
import EmployeeEditForm from "../../../components/EmployeeEditForm";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const { employee } = await getEmployeeById(id);
  if (!employee) return { title: "Employee Not Found" };
  return { title: `Edit ${employee.personalInfo?.firstName} ${employee.personalInfo?.lastName} | HR` };
}

const EDIT_ROLES = ["SuperAdmin", "Admin", "Manager", "HR"];

async function EditFormLoader({ id }) {
  const [{ employee, error }, { departments }] = await Promise.all([
    getEmployeeById(id),
    getDepartments({ limit: 100 }),
  ]);
  if (error || !employee) notFound();
  return <EmployeeEditForm employee={employee} departments={departments} />;
}

function FormSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-48 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

export default async function EmployeeEditPage({ params }) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!EDIT_ROLES.includes(session.user.role)) redirect(`/dashboard/hr/employees/${id}`);

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
        <span className="text-foreground">Edit</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Edit Employee</h1>
      </div>

      <Suspense fallback={<FormSkeleton />}>
        <EditFormLoader id={id} />
      </Suspense>
    </div>
  );
}
