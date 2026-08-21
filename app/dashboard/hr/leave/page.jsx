import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Calendar, Plus, Settings2, User } from "lucide-react";
import { listLeaveForPage } from "@/app/db/actions/hr-leave-actions";
import { HR_VIEW_ROLES } from "@/lib/utils/role-gates";
import { roleAllowed } from "@/lib/permissions";

export const metadata = { title: "Leave | HR" };

const day = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-KE") : "—");

function StatusBadge({ status }) {
  const map = {
    draft: "bg-muted text-muted-foreground",
    submitted: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    rejected: "bg-red-500/15 text-red-700 dark:text-red-400",
    completed: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    cancelled: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${map[status] || "bg-muted text-muted-foreground"}`}
    >
      {status}
    </span>
  );
}

function LeaveTypeBadge({ code, name, isPaid }) {
  const map = {
    annual: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    sick: "bg-red-500/15 text-red-700 dark:text-red-400",
    maternity: "bg-pink-500/15 text-pink-700 dark:text-pink-400",
    paternity: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
    compassionate: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    unpaid: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${map[code] || "bg-teal-500/15 text-teal-700 dark:text-teal-400"}`}
      title={isPaid ? "Paid leave" : "Unpaid — deducted from the payslip"}
    >
      {name}
    </span>
  );
}

async function LeaveRequestList({ searchParams }) {
  const params = await searchParams;
  const status = params.status || "";
  const search = params.search || "";

  const { requests, pagination } = await listLeaveForPage({
    page: parseInt(params.page || "1"),
    limit: 20,
    status,
    search,
  });

  const href = (page) => {
    const q = new URLSearchParams({ page: String(page) });
    if (status) q.set("status", status);
    if (search) q.set("search", search);
    return `?${q}`;
  };

  if (!requests.length) {
    return (
      <div className="rounded-lg border border-border bg-card p-12 text-center shadow-sm">
        <Calendar className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">
          {status ? `No ${status} leave requests.` : "No leave requests yet."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3">Leave #</th>
              <th className="px-4 py-3">Employee</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">From</th>
              <th className="px-4 py-3">To</th>
              <th className="px-4 py-3 text-right">Days</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {requests.map((r) => (
              <tr key={r.id} className="transition-colors hover:bg-muted/50">
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {r.leaveNumber}
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-foreground">{r.employeeName}</p>
                  <p className="text-xs text-muted-foreground">{r.department || "—"}</p>
                </td>
                <td className="px-4 py-3">
                  <LeaveTypeBadge code={r.leaveTypeCode} name={r.leaveTypeName} isPaid={r.isPaid} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">{day(r.fromDate)}</td>
                <td className="px-4 py-3 text-muted-foreground">{day(r.toDate)}</td>
                <td className="px-4 py-3 text-right font-medium text-foreground">
                  {r.totalDays}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/dashboard/hr/leave/${r.id}`}
                    className="text-xs text-primary hover:underline"
                  >
                    {r.status === "submitted" ? "Review" : "View"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-border md:hidden">
        {requests.map((r) => (
          <Link
            key={r.id}
            href={`/dashboard/hr/leave/${r.id}`}
            className="block p-4 transition-colors hover:bg-muted/50"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium text-foreground">{r.employeeName}</p>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {r.leaveNumber}
                </p>
              </div>
              <StatusBadge status={r.status} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <LeaveTypeBadge code={r.leaveTypeCode} name={r.leaveTypeName} isPaid={r.isPaid} />
              <span className="text-xs text-muted-foreground">
                {r.totalDays} {r.totalDays === 1 ? "day" : "days"}
              </span>
              <span className="text-xs text-muted-foreground">
                {day(r.fromDate)} – {day(r.toDate)}
              </span>
            </div>
          </Link>
        ))}
      </div>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
          <p className="text-muted-foreground">{pagination.total} requests</p>
          <div className="flex gap-2">
            {pagination.page > 1 && (
              <Link
                href={href(pagination.page - 1)}
                className="rounded border border-border px-3 py-1 hover:bg-accent hover:text-accent-foreground"
              >
                Previous
              </Link>
            )}
            {pagination.page < pagination.totalPages && (
              <Link
                href={href(pagination.page + 1)}
                className="rounded border border-border px-3 py-1 hover:bg-accent hover:text-accent-foreground"
              >
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
  // Somebody without an HR role has their OWN leave page. The source served
  // both from here and filtered by the caller's party — which meant an
  // employee with no HR record saw an empty approvals list instead of their
  // own requests.
  if (!roleAllowed(session.user.role, HR_VIEW_ROLES)) {
    redirect("/dashboard/hr/my-leave");
  }

  const params = await searchParams;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Leave</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">
            Track and approve employee leave
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/hr/my-leave"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
          >
            <User className="h-4 w-4" />
            <span className="hidden sm:inline">My leave</span>
          </Link>
          <Link
            href="/dashboard/hr/leave/calendar"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
          >
            <Calendar className="h-4 w-4" />
            <span className="hidden sm:inline">Calendar</span>
          </Link>
          <Link
            href="/dashboard/hr/leave/admin"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
          >
            <Settings2 className="h-4 w-4" />
            <span className="hidden sm:inline">Year end</span>
          </Link>
          <Link
            href="/dashboard/hr/leave/create"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New request</span>
            <span className="sm:hidden">New</span>
          </Link>
        </div>
      </div>

      <form className="flex flex-wrap gap-2">
        <input
          name="search"
          type="text"
          placeholder="Search by name or leave number…"
          defaultValue={params.search || ""}
          className="min-w-40 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <input type="hidden" name="status" value={params.status || ""} />
        <button
          type="submit"
          className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
        >
          Search
        </button>
      </form>

      <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1 shadow-sm">
        {["", "submitted", "approved", "rejected", "completed", "cancelled"].map((s) => (
          <Link
            key={s}
            href={`?status=${s}${params.search ? `&search=${encodeURIComponent(params.search)}` : ""}`}
            className={`shrink-0 rounded-md px-4 py-1.5 text-sm capitalize transition-colors ${
              (params.status || "") === s
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {s === "" ? "All" : s}
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
        <LeaveRequestList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
