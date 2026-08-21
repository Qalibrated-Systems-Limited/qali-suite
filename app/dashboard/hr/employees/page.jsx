import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  listEmployeesForPage,
  listUsersWithoutEmployeeRecord,
} from "@/app/db/actions/hr-employee-actions";
import { listActiveDepartments } from "@/app/db/actions/hr-department-actions";
import { HR_VIEW_ROLES } from "@/lib/utils/role-gates";
import { roleAllowed } from "@/lib/permissions";
import { UserPlus, Search, Upload, AlertTriangle } from "lucide-react";

export const metadata = { title: "Employees | HR" };

function StatusBadge({ status }) {
  const map = {
    active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    probation: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    on_leave: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    suspended: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    terminated: "bg-red-500/15 text-red-700 dark:text-red-400",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${map[status] || "bg-muted text-muted-foreground"}`}>
      {status?.replace("_", " ")}
    </span>
  );
}

function Avatar({ emp }) {
  const initials = (emp.firstName?.[0] || "") + (emp.lastName?.[0] || "");
  return emp.photoUrl ? (
    <img src={emp.photoUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
  ) : (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
      {initials}
    </div>
  );
}

async function EmployeeList({ searchParams }) {
  const params = await searchParams;
  const page = parseInt(params.page || "1");
  const search = params.search || "";
  const status = params.status || "";
  const departmentId = params.departmentId || "";

  const { employees, pagination } = await listEmployeesForPage({
    page,
    limit: 20,
    search,
    status,
    departmentId,
  });

  const pageHref = (n) => {
    const q = new URLSearchParams({ page: String(n) });
    if (search) q.set("search", search);
    if (status) q.set("status", status);
    if (departmentId) q.set("departmentId", departmentId);
    return `?${q}`;
  };

  if (!employees.length) {
    return (
      <div className="rounded-lg border border-border bg-card p-12 text-center shadow-sm">
        <p className="text-muted-foreground">
          {search ? `No employees found for "${search}"` : "No employees yet."}
        </p>
        <Link
          href="/dashboard/hr/employees/create"
          className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          <UserPlus className="h-4 w-4" />
          Add First Employee
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      {/* ── Desktop table ── */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3">Employee</th>
              <th className="px-4 py-3">Number</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Designation</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Gross (KES)</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {employees.map((emp) => (
              <tr key={emp.id} className="hover:bg-muted/50 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar emp={emp} />
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{emp.fullName}</p>
                      {emp.email && (
                        <p className="truncate text-xs text-muted-foreground">{emp.email}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{emp.employeeNumber || "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{emp.department || "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{emp.designation || "—"}</td>
                <td className="px-4 py-3 text-muted-foreground capitalize">
                  {emp.employmentType?.replace("_", " ") || "—"}
                </td>
                <td className="px-4 py-3"><StatusBadge status={emp.status} /></td>
                <td className="px-4 py-3 text-right text-foreground">
                  {emp.grossSalary ? emp.grossSalary.toLocaleString() : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/dashboard/hr/employees/${emp.id}`} className="text-xs text-primary hover:underline">
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Mobile cards ── */}
      <div className="divide-y divide-border md:hidden">
        {employees.map((emp) => (
          <Link
            key={emp.id}
            href={`/dashboard/hr/employees/${emp.id}`}
            className="flex items-start gap-3 p-4 hover:bg-muted/50 transition-colors"
          >
            <Avatar emp={emp} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-foreground truncate">{emp.fullName}</p>
                <StatusBadge status={emp.status} />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {emp.designation || emp.department || "—"}
              </p>
              {emp.employeeNumber && (
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">{emp.employeeNumber}</p>
              )}
            </div>
          </Link>
        ))}
      </div>

      {/* Pagination. Every filter is carried through — the Mongo version
          dropped departmentId on page 2, so paging silently widened the list. */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
          <p className="text-muted-foreground">
            {(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
          </p>
          <div className="flex gap-2">
            {pagination.page > 1 && (
              <Link href={pageHref(pagination.page - 1)} className="rounded border border-border px-3 py-1 text-sm hover:bg-accent hover:text-accent-foreground">
                Previous
              </Link>
            )}
            {pagination.page < pagination.totalPages && (
              <Link href={pageHref(pagination.page + 1)} className="rounded border border-border px-3 py-1 text-sm hover:bg-accent hover:text-accent-foreground">
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

async function UnlinkedUsersAlert() {
  const users = await listUsersWithoutEmployeeRecord();
  if (!users.length) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-500/5 p-4 dark:border-amber-900">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
            {users.length} user{users.length > 1 ? "s" : ""} without an employee profile
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            These accounts can log in but can't access leave, payslips, or attendance. Create an employee profile for each one.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {users.map((u) => (
              <Link
                key={u.id}
                href={`/dashboard/hr/employees/create?userId=${u.id}&email=${encodeURIComponent(u.email)}&name=${encodeURIComponent(u.name)}&role=${encodeURIComponent(u.role)}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent transition-colors dark:border-amber-900"
              >
                <UserPlus className="h-3 w-3" />
                {u.name}
                <span className="text-muted-foreground">({u.role})</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

async function DepartmentFilter({ selected }) {
  const departments = await listActiveDepartments();
  if (!departments.length) return null;
  return (
    <select
      name="departmentId"
      defaultValue={selected}
      className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
    >
      <option value="">All departments</option>
      {departments.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  );
}

export default async function EmployeesPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!roleAllowed(session.user.role, HR_VIEW_ROLES)) redirect("/dashboard");

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <Suspense fallback={null}>
        <UnlinkedUsersAlert />
      </Suspense>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Employees</h1>
          <p className="hidden sm:block text-sm text-muted-foreground">Manage your workforce</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/hr/employees/import"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
          >
            <Upload className="h-4 w-4" />
            <span className="hidden sm:inline">Import CSV</span>
          </Link>
          <Link
            href="/dashboard/hr/employees/create"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            <UserPlus className="h-4 w-4" />
            <span className="hidden sm:inline">Add Employee</span>
            <span className="sm:hidden">Add</span>
          </Link>
        </div>
      </div>

      <form className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            name="search"
            type="text"
            placeholder="Search employees..."
            defaultValue={(await searchParams).search || ""}
            className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <select
          name="status"
          defaultValue={(await searchParams).status || ""}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="probation">Probation</option>
          <option value="on_leave">On Leave</option>
          <option value="suspended">Suspended</option>
          <option value="terminated">Terminated</option>
        </select>
        {/* The list query has always accepted a department, and the page has
            never offered a way to set one. */}
        <DepartmentFilter selected={(await searchParams).departmentId || ""} />
        <button type="submit" className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground">
          Filter
        </button>
      </form>

      <Suspense
        fallback={
          <div className="rounded-lg border border-border bg-card p-8 shadow-sm">
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded bg-muted" />
              ))}
            </div>
          </div>
        }
      >
        <EmployeeList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
