import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Edit, Users } from "lucide-react";
import { getDepartmentById } from "@/app/mongodb/queries/hr-queries";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import EmployeeProfile from "@/app/models/employeeProfile";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const { department } = await getDepartmentById(id);
  return { title: `${department?.name || "Department"} | HR` };
}

const HR_ROLES = ["SuperAdmin", "Admin", "Manager", "HR"];

export default async function DepartmentDetailPage({ params }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!HR_ROLES.includes(session.user.role)) redirect("/dashboard/hr");

  const { department } = await getDepartmentById(id);
  if (!department) notFound();

  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const employees = await EmployeeProfile.find(
    withTenantScope(
      { "employment.departmentId": id, "employment.status": { $ne: "terminated" } },
      companyId, isSuperAdmin
    )
  )
    .select("employeeNumber personalInfo.firstName personalInfo.lastName employment.designation employment.status")
    .sort({ "personalInfo.lastName": 1 })
    .lean();

  const statusColors = {
    active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    probation: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    on_leave: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/departments" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Departments
        </Link>
        <span>/</span>
        <span className="text-foreground">{department.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
              {department.code?.slice(0, 3)}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{department.name}</h1>
              <p className="text-muted-foreground">{department.code}</p>
            </div>
          </div>
          {department.description && (
            <p className="mt-3 max-w-lg text-sm text-muted-foreground">{department.description}</p>
          )}
        </div>
        <Link
          href={`/dashboard/hr/departments/${id}/edit`}
          className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <Edit className="h-4 w-4" /> Edit
        </Link>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <p className="text-sm text-muted-foreground">Department Head</p>
          <p className="mt-1 font-semibold text-foreground">{department.head?.name || "Not assigned"}</p>
          {department.head?.employeeNumber && (
            <p className="text-xs text-muted-foreground">{department.head.employeeNumber}</p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <p className="text-sm text-muted-foreground">Cost Center</p>
          <p className="mt-1 font-semibold text-foreground">{department.costCenter?.accountCode || "Not linked"}</p>
          {department.costCenter?.accountName && (
            <p className="text-xs text-muted-foreground">{department.costCenter.accountName}</p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <p className="text-sm text-muted-foreground">Headcount</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{employees.length}</p>
        </div>
      </div>

      {/* Employees */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold text-foreground">
            <Users className="h-4 w-4" /> Employees
          </h2>
          <Link href="/dashboard/hr/employees/create" className="text-sm text-primary hover:underline">
            Add Employee
          </Link>
        </div>

        {employees.length === 0 ? (
          <p className="text-sm text-muted-foreground">No employees in this department yet.</p>
        ) : (
          <div className="rounded-lg border border-border bg-card shadow-sm">
            {/* Desktop table */}
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
                    <tr key={emp._id.toString()} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">
                        {emp.personalInfo?.firstName} {emp.personalInfo?.lastName}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{emp.employeeNumber}</td>
                      <td className="px-4 py-3 text-muted-foreground">{emp.employment?.designation || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusColors[emp.employment?.status] || "bg-muted text-muted-foreground"}`}>
                          {emp.employment?.status?.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/dashboard/hr/employees/${emp._id}`} className="text-xs text-primary hover:underline">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="divide-y divide-border md:hidden">
              {employees.map((emp) => (
                <Link
                  key={emp._id.toString()}
                  href={`/dashboard/hr/employees/${emp._id}`}
                  className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
                >
                  <div>
                    <p className="font-medium text-foreground">
                      {emp.personalInfo?.firstName} {emp.personalInfo?.lastName}
                    </p>
                    <p className="text-xs text-muted-foreground">{emp.employment?.designation || emp.employeeNumber || "—"}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusColors[emp.employment?.status] || "bg-muted text-muted-foreground"}`}>
                    {emp.employment?.status?.replace("_", " ")}
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
