import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Edit, Users } from "lucide-react";
import { getDepartmentForPage } from "@/app/db/actions/hr-department-actions";
import { listEmployeesForPage } from "@/app/db/actions/hr-employee-actions";
import { HR_VIEW_ROLES } from "@/lib/utils/role-gates";
import { roleAllowed } from "@/lib/permissions";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const department = await getDepartmentForPage(id);
  return { title: `${department?.name || "Department"} | HR` };
}

const money = (n) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(n || 0);

const statusColors = {
  active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  probation: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  on_leave: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  suspended: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

export default async function DepartmentDetailPage({ params }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!roleAllowed(session.user.role, HR_VIEW_ROLES)) redirect("/dashboard/hr");

  const department = await getDepartmentForPage(id);
  if (!department) notFound();

  const { employees } = await listEmployeesForPage({
    departmentId: id,
    limit: 200,
  });

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href="/dashboard/hr/departments"
          className="flex items-center gap-1 hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Departments
        </Link>
        <span>/</span>
        <span className="text-foreground">{department.name}</span>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
              {department.name?.slice(0, 3).toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{department.name}</h1>
              <p className="text-muted-foreground">{department.code}</p>
            </div>
          </div>
          {department.description && (
            <p className="mt-3 max-w-lg text-sm text-muted-foreground">
              {department.description}
            </p>
          )}
          {department.parentName && (
            <p className="mt-2 text-xs text-muted-foreground">
              Part of {department.parentName}
            </p>
          )}
        </div>
        <Link
          href={`/dashboard/hr/departments/${id}/edit`}
          className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <Edit className="h-4 w-4" /> Edit
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <p className="text-sm text-muted-foreground">Department head</p>
          <p className="mt-1 font-semibold text-foreground">
            {department.headName || "Not assigned"}
          </p>
          {department.headEmployeeNumber && (
            <p className="text-xs text-muted-foreground">
              {department.headEmployeeNumber}
            </p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <p className="text-sm text-muted-foreground">Cost centre</p>
          <p className="mt-1 font-semibold text-foreground">
            {department.costCenterCode || "Not linked"}
          </p>
          {department.costCenterName && (
            <p className="text-xs text-muted-foreground">{department.costCenterName}</p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <p className="text-sm text-muted-foreground">Headcount</p>
          <p className="mt-1 text-2xl font-bold text-foreground">
            {department.employeeCount}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <p className="text-sm text-muted-foreground">Monthly wage bill</p>
          <p className="mt-1 text-2xl font-bold text-foreground">
            {money(department.payrollCost)}
          </p>
        </div>
      </div>

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold text-foreground">
            <Users className="h-4 w-4" /> Employees
          </h2>
          <Link
            href="/dashboard/hr/employees/create"
            className="text-sm text-primary hover:underline"
          >
            Add Employee
          </Link>
        </div>

        {employees.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No employees in this department yet.
          </p>
        ) : (
          <div className="rounded-lg border border-border bg-card shadow-sm">
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase text-muted-foreground">
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-4 py-3">Number</th>
                    <th className="px-4 py-3">Designation</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {employees.map((emp) => (
                    <tr key={emp.id} className="transition-colors hover:bg-muted/50">
                      <td className="px-4 py-3 font-medium text-foreground">
                        {emp.fullName}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {emp.employeeNumber}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {emp.designation || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusColors[emp.status] || "bg-muted text-muted-foreground"}`}
                        >
                          {emp.status?.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/dashboard/hr/employees/${emp.id}`}
                          className="text-xs text-primary hover:underline"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-border md:hidden">
              {employees.map((emp) => (
                <Link
                  key={emp.id}
                  href={`/dashboard/hr/employees/${emp.id}`}
                  className="flex items-center justify-between p-4 transition-colors hover:bg-muted/50"
                >
                  <div>
                    <p className="font-medium text-foreground">{emp.fullName}</p>
                    <p className="text-xs text-muted-foreground">
                      {emp.designation || emp.employeeNumber || "—"}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusColors[emp.status] || "bg-muted text-muted-foreground"}`}
                  >
                    {emp.status?.replace("_", " ")}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
