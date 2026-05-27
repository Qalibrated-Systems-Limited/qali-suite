import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Building2, Users } from "lucide-react";
import { getDepartments } from "@/app/mongodb/queries/hr-queries";

export const metadata = { title: "Departments | HR" };

const HR_ROLES = ["SuperAdmin", "Admin", "Manager", "HR"];

async function DepartmentList({ searchParams }) {
  const params = await searchParams;
  const { departments } = await getDepartments({
    page: parseInt(params.page || "1"),
    search: params.search || "",
    isActive: params.isActive || "",
  });

  if (!departments.length) {
    return (
      <div className="rounded-lg border border-border bg-card p-12 text-center shadow-sm">
        <Building2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">No departments yet.</p>
        <Link
          href="/dashboard/hr/departments/create"
          className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          Create First Department
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {departments.map((dept) => (
        <Link
          key={dept._id}
          href={`/dashboard/hr/departments/${dept._id}`}
          className="rounded-lg border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
                {dept.code?.slice(0, 2)}
              </div>
              <div>
                <p className="font-semibold text-foreground">{dept.name}</p>
                <p className="text-xs text-muted-foreground">{dept.code}</p>
              </div>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${dept.isActive ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
              {dept.isActive ? "Active" : "Inactive"}
            </span>
          </div>
          {dept.head?.name && (
            <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="h-3 w-3" />
              Head: {dept.head.name}
            </p>
          )}
          {dept.costCenter?.accountCode && (
            <p className="mt-1 text-xs text-muted-foreground">
              Cost Center: {dept.costCenter.accountCode}
            </p>
          )}
        </Link>
      ))}
    </div>
  );
}

export default async function DepartmentsPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!HR_ROLES.includes(session.user.role)) redirect("/dashboard/hr");

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Departments</h1>
          <p className="hidden sm:block text-sm text-muted-foreground">Manage departments and cost centers</p>
        </div>
        <Link
          href="/dashboard/hr/departments/create"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Add Department</span>
          <span className="sm:hidden">Add</span>
        </Link>
      </div>

      <Suspense fallback={
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      }>
        <DepartmentList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
