import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Users, Settings2 } from "lucide-react";
import {
  getAttendanceForPage,
  getMyAttendanceToday,
} from "@/app/db/actions/hr-attendance-actions";
import { listActiveDepartments } from "@/app/db/actions/hr-department-actions";
import { HR_VIEW_ROLES } from "@/lib/utils/role-gates";
import { roleAllowed } from "@/lib/permissions";
import ClockInWidget from "./ClockInWidget";
import MarkAbsenteesButton from "./MarkAbsenteesButton";

export const metadata = { title: "Attendance | HR" };

function StatusBadge({ status }) {
  const map = {
    present: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    late: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    absent: "bg-red-500/15 text-red-700 dark:text-red-400",
    half_day: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    on_leave: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
    holiday: "bg-muted text-muted-foreground",
  };
  if (!status) {
    return (
      <span
        className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
        title="Nobody has marked this day for them yet — which is not the same as absent"
      >
        not marked
      </span>
    );
  }
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${map[status] || "bg-muted text-muted-foreground"}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

const fmtTime = (iso, tz) =>
  iso
    ? new Date(iso).toLocaleTimeString("en-KE", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: tz,
      })
    : "—";

async function Roster({ searchParams }) {
  const params = await searchParams;
  const { workDate, timezone, roster, stats } = await getAttendanceForPage({
    workDate: params.date,
    departmentId: params.departmentId,
    search: params.search,
  });

  const departments = await listActiveDepartments();

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Headcount", stats.headcount, "text-foreground"],
          ["Present", stats.present, "text-emerald-600 dark:text-emerald-400"],
          ["Late", stats.late, "text-amber-600 dark:text-amber-400"],
          ["Absent", stats.absent, "text-red-600 dark:text-red-400"],
          ["On leave", stats.onLeave, "text-purple-600 dark:text-purple-400"],
          ["Still in", stats.stillClockedIn, "text-blue-600 dark:text-blue-400"],
        ].map(([label, value, colour]) => (
          <div key={label} className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`mt-1 text-2xl font-bold ${colour}`}>{value}</p>
          </div>
        ))}
      </div>

      <form className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Day</label>
          <input
            name="date"
            type="date"
            defaultValue={workDate}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        {departments.length > 0 && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Department
            </label>
            <select
              name="departmentId"
              defaultValue={params.departmentId || ""}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">All</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="min-w-40 flex-1">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Search</label>
          <input
            name="search"
            type="text"
            placeholder="Name or number"
            defaultValue={params.search || ""}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <button
          type="submit"
          className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
        >
          Show
        </button>
        <MarkAbsenteesButton workDate={workDate} />
      </form>

      <div className="rounded-lg border border-border bg-card shadow-sm">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">In</th>
                <th className="px-4 py-3">Out</th>
                <th className="px-4 py-3 text-right">Hours</th>
                <th className="px-4 py-3 text-right">Overtime</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {roster.map((r) => (
                <tr key={r.employeeId} className="transition-colors hover:bg-muted/50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{r.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {r.employeeNumber}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{r.department || "—"}</td>
                  <td className="px-4 py-3 text-foreground">{fmtTime(r.checkIn, timezone)}</td>
                  <td className="px-4 py-3 text-foreground">
                    {fmtTime(r.checkOut, timezone)}
                    {r.autoClosedOut && (
                      <span
                        className="ml-1 text-xs text-amber-600"
                        title="Closed automatically at the shift end"
                      >
                        auto
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-foreground">
                    {r.hoursWorked == null ? "—" : `${r.hoursWorked.toFixed(1)}h`}
                  </td>
                  <td className="px-4 py-3 text-right text-blue-600 dark:text-blue-400">
                    {r.overtimeHours ? `${r.overtimeHours.toFixed(1)}h` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/dashboard/hr/employees/${r.employeeId}/attendance`}
                      className="text-xs text-primary hover:underline"
                    >
                      History
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-border md:hidden">
          {roster.map((r) => (
            <div key={r.employeeId} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium text-foreground">{r.name}</p>
                <p className="text-xs text-muted-foreground">
                  {fmtTime(r.checkIn, timezone)} – {fmtTime(r.checkOut, timezone)}
                </p>
              </div>
              <StatusBadge status={r.status} />
            </div>
          ))}
        </div>

        {roster.length === 0 && (
          <p className="p-10 text-center text-muted-foreground">
            No employees match that filter.
          </p>
        )}
      </div>
    </div>
  );
}

async function MyClock() {
  const initial = await getMyAttendanceToday();
  return <ClockInWidget initial={initial} />;
}

export default async function AttendancePage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!roleAllowed(session.user.role, HR_VIEW_ROLES)) {
    redirect("/dashboard/hr/my-attendance");
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground sm:text-2xl">
            <Users className="h-5 w-5" /> Attendance
          </h1>
          <p className="hidden text-sm text-muted-foreground sm:block">
            Who is in today, and who is not
          </p>
        </div>
        <Link
          href="/dashboard/settings/attendance-config"
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
        >
          <Settings2 className="h-4 w-4" />
          <span className="hidden sm:inline">Policy</span>
        </Link>
      </div>

      <Suspense fallback={<div className="h-24 animate-pulse rounded-lg bg-muted" />}>
        <MyClock />
      </Suspense>

      <Suspense
        fallback={
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        }
      >
        <Roster searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
