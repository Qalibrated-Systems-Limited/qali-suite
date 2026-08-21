import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getEmployeeFormData } from "@/app/db/actions/hr-employee-actions";
import { HR_WRITE_ROLES } from "@/lib/utils/role-gates";
import { roleAllowed } from "@/lib/permissions";
import EmployeeForm from "../../components/EmployeeForm";

export const metadata = { title: "Add Employee | HR" };

async function FormWrapper({ defaults }) {
  const { departments, managers } = await getEmployeeFormData();
  return <EmployeeForm departments={departments} managers={managers} defaults={defaults} />;
}

// ============================================
// PAGE
// ============================================
export default async function CreateEmployeePage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!roleAllowed(session.user.role, HR_WRITE_ROLES)) redirect("/dashboard/hr");

  const params = await searchParams;
  const linkedUserId = params.userId || null;
  const defaults = linkedUserId
    ? {
        linkedUserId,
        email: params.email || "",
        firstName: params.name ? params.name.split(" ")[0] : "",
        lastName: params.name ? params.name.split(" ").slice(1).join(" ") : "",
      }
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/employees" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
          Employees
        </Link>
        <span>/</span>
        <span className="text-foreground">Add Employee</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold">Add Employee</h1>
        <p className="text-muted-foreground">
          {defaults ? `Creating profile for ${params.email}` : "Create a new employee record"}
        </p>
      </div>

      <Suspense
        fallback={
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-48 animate-pulse rounded-lg bg-gray-100" />
            ))}
          </div>
        }
      >
        <FormWrapper defaults={defaults} />
      </Suspense>
    </div>
  );
}
