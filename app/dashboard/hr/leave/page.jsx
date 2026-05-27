import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getLeaveRequests, getMyEmployeeProfile } from "@/app/mongodb/queries/hr-queries";
import { Calendar, Plus, Settings2, User } from "lucide-react";

export const metadata = { title: "Leave | HR" };

const HR_ROLES = ["SuperAdmin", "Admin", "Manager", "HR", "Accountant", "Store Manager", "Employee", "Technician", "User", "Viewer"];

function StatusBadge({ status }) {
  const map = {
    draft: "bg-muted text-muted-foreground",
    submitted: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    rejected: "bg-red-500/15 text-red-700 dark:text-red-400",
    recalled: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    completed: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    cancelled: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${map[status] || "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

function LeaveTypeBadge({ type }) {
  const map = {
    annual: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    sick: "bg-red-500/15 text-red-700 dark:text-red-400",
    maternity: "bg-pink-500/15 text-pink-700 dark:text-pink-400",
    paternity: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
    compassionate: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    study: "bg-teal-500/15 text-teal-700 dark:text-teal-400",
    unpaid: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${map[type] || "bg-muted text-muted-foreground"}`}>
      {type}
    </span>
  );
}

async function LeaveRequestList({ searchParams, isEmployee }) {
  const params = await searchParams;

  // Employees only see their own leave requests — must have an EmployeeProfile
  let ownPartyId = null;
  if (isEmployee) {
    const profile = await getMyEmployeeProfile();
    ownPartyId = profile?.partyId || null;

    // No profile linked yet — block query entirely to prevent data leak
    if (!ownPartyId) {
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-500/5 p-8 text-center shadow-sm dark:border-amber-900">
          <Calendar className="mx-auto mb-3 h-10 w-10 text-amber-500" />
          <p className="font-medium text-amber-700 dark:text-amber-400">Employee profile not linked</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Contact HR to set up your employee profile before requesting leave.
          </p>
        </div>
      );
    }
  }

  const { leaveRequests, pagination } = await getLeaveRequests({
    page: parseInt(params.page || "1"),
    limit: 20,
    status: params.status || "",
    leaveType: params.leaveType || "",
    partyId: ownPartyId || "",
  });

  if (!leaveRequests.length) {
    return (
      <div className="rounded-lg border border-border bg-card p-12 text-center shadow-sm">
        <Calendar className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">
          {params.status ? `No ${params.status} leave requests` : "No leave requests yet."}
        </p>
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
              <th className="px-4 py-3">Leave #</th>
              <th className="px-4 py-3">Employee</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">From</th>
              <th className="px-4 py-3">To</th>
              <th className="px-4 py-3">Days</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Submitted</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {leaveRequests.map((leave) => (
              <tr key={leave._id} className="hover:bg-muted/50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{leave.leaveNumber}</td>
                <td className="px-4 py-3">
                  <p className="font-medium text-foreground">{leave.employee?.name}</p>
                  <p className="text-xs text-muted-foreground">{leave.employee?.department}</p>
                </td>
                <td className="px-4 py-3"><LeaveTypeBadge type={leave.leaveType} /></td>
                <td className="px-4 py-3 text-muted-foreground">
                  {leave.dates?.from ? new Date(leave.dates.from).toLocaleDateString("en-KE") : "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {leave.dates?.to ? new Date(leave.dates.to).toLocaleDateString("en-KE") : "—"}
                </td>
                <td className="px-4 py-3 font-medium text-foreground">{leave.dates?.totalDays}</td>
                <td className="px-4 py-3"><StatusBadge status={leave.status} /></td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {leave.submittedAt ? new Date(leave.submittedAt).toLocaleDateString("en-KE") : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/dashboard/hr/leave/${leave._id}`} className="text-xs text-primary hover:underline">
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
        {leaveRequests.map((leave) => (
          <Link
            key={leave._id}
            href={`/dashboard/hr/leave/${leave._id}`}
            className="block p-4 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium text-foreground">{leave.employee?.name}</p>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">{leave.leaveNumber}</p>
              </div>
              <StatusBadge status={leave.status} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <LeaveTypeBadge type={leave.leaveType} />
              <span className="text-xs text-muted-foreground">
                {leave.dates?.totalDays} {leave.dates?.totalDays === 1 ? "day" : "days"}
              </span>
              {leave.dates?.from && (
                <span className="text-xs text-muted-foreground">
                  {new Date(leave.dates.from).toLocaleDateString("en-KE")} – {new Date(leave.dates.to).toLocaleDateString("en-KE")}
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
          <p className="text-muted-foreground">{pagination.total} requests</p>
          <div className="flex gap-2">
            {pagination.page > 1 && (
              <Link href={`?page=${pagination.page - 1}&status=${params.status || ""}`} className="rounded border border-border px-3 py-1 hover:bg-accent hover:text-accent-foreground">
                Previous
              </Link>
            )}
            {pagination.page < pagination.totalPages && (
              <Link href={`?page=${pagination.page + 1}&status=${params.status || ""}`} className="rounded border border-border px-3 py-1 hover:bg-accent hover:text-accent-foreground">
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default async function LeavePage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!HR_ROLES.includes(session.user.role)) redirect("/dashboard");

  const params = await searchParams;
  const isEmployee = !["SuperAdmin", "Admin", "Manager", "HR"].includes(session.user.role);
  const canAdmin = ["SuperAdmin", "Admin", "Manager", "HR"].includes(session.user.role);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">
            {isEmployee ? "My Leave" : "Leave"}
          </h1>
          <p className="hidden sm:block text-sm text-muted-foreground">
            {isEmployee ? "Your leave requests and balances" : "Track and approve employee leave"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canAdmin && (
            <Link
              href="/dashboard/hr/my-leave"
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
            >
              <User className="h-4 w-4" />
              <span className="hidden sm:inline">My Leave</span>
            </Link>
          )}
          {canAdmin && (
            <Link
              href="/dashboard/hr/leave/calendar"
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
            >
              <Calendar className="h-4 w-4" />
              <span className="hidden sm:inline">Calendar</span>
            </Link>
          )}
          {canAdmin && (
            <Link
              href="/dashboard/hr/leave/admin"
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
            >
              <Settings2 className="h-4 w-4" />
              <span className="hidden sm:inline">Admin</span>
            </Link>
          )}
          <Link
            href="/dashboard/hr/leave/create"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New Request</span>
            <span className="sm:hidden">New</span>
          </Link>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1 shadow-sm">
        {["", "submitted", "approved", "rejected"].map((s) => (
          <Link
            key={s}
            href={`?status=${s}`}
            className={`shrink-0 rounded-md px-4 py-1.5 text-sm transition-colors ${
              params.status === s || (!params.status && s === "")
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {s === "" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
          </Link>
        ))}
      </div>

      <Suspense
        fallback={
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        }
      >
        <LeaveRequestList searchParams={searchParams} isEmployee={isEmployee} />
      </Suspense>
    </div>
  );
}
