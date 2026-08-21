import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getEmployeeAttendanceForPage } from "@/app/db/actions/hr-attendance-actions";
import { getAttendancePolicy } from "@/app/db/actions/hr-attendance-actions";
import { HR_VIEW_ROLES } from "@/lib/utils/role-gates";
import { roleAllowed } from "@/lib/permissions";
import AttendanceManualEntryForm from "./AttendanceManualEntryForm";

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
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${map[status] || "bg-muted text-muted-foreground"}`}
    >
      {status?.replace("_", " ") || "—"}
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

const fmtDay = (d) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-KE", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

async function HistoryLoader({ id, month, year }) {
  const [{ employee, records, summary }, policy] = await Promise.all([
    getEmployeeAttendanceForPage({ employeeId: id, month, year }),
    getAttendancePolicy(),
  ]);
  if (!employee) notFound();

  const tz = policy.timezone;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">
          {employee.fullName} — attendance
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00`).toLocaleDateString(
            "en-KE",
            { month: "long", year: "numeric" },
          )}{" "}
          · times shown in {tz}
        </p>
      </div>

      <MonthPicker month={month} year={year} />

      <AttendanceManualEntryForm employeeId={id} timezone={tz} />

      <div className="flex flex-wrap gap-3">
        {[
          { label: "Present", value: summary.daysPresent, color: "text-emerald-600 dark:text-emerald-400" },
          { label: "Absent", value: summary.daysAbsent, color: "text-red-600 dark:text-red-400" },
          { label: "Late", value: summary.daysLate, color: "text-amber-600 dark:text-amber-400" },
          { label: "On leave", value: summary.daysOnLeave, color: "text-purple-600 dark:text-purple-400" },
          { label: "Hours", value: `${summary.totalHours.toFixed(1)}h`, color: "text-foreground" },
          { label: "Overtime", value: `${summary.totalOvertime.toFixed(1)}h`, color: "text-blue-600 dark:text-blue-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-lg font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {records.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center shadow-sm">
          <p className="text-muted-foreground">No attendance recorded for this month.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card shadow-sm">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">In</th>
                  <th className="px-4 py-3">Out</th>
                  <th className="px-4 py-3 text-right">Hours</th>
                  <th className="px-4 py-3 text-right">Overtime</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">How</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {records.map((r) => (
                  <tr
                    key={r.id}
                    className={`transition-colors hover:bg-muted/50 ${r.overriddenByName ? "bg-amber-500/5" : ""}`}
                  >
                    <td className="px-4 py-3 text-foreground">{fmtDay(r.workDate)}</td>
                    <td className="px-4 py-3 text-foreground">{fmtTime(r.checkIn, tz)}</td>
                    <td className="px-4 py-3 text-foreground">
                      {fmtTime(r.checkOut, tz)}
                      {r.autoClosedOut && (
                        <span
                          className="ml-1 text-xs text-amber-600"
                          title="Closed automatically at the shift end — nobody clocked out"
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
                    <td className="px-4 py-3 text-xs capitalize text-muted-foreground">
                      {r.method}
                      {r.overriddenByName && (
                        <span className="ml-1 text-amber-600">· {r.overriddenByName}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-border md:hidden">
            {records.map((r) => (
              <div key={r.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium text-foreground">{fmtDay(r.workDate)}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtTime(r.checkIn, tz)} – {fmtTime(r.checkOut, tz)}
                    {r.hoursWorked != null && ` · ${r.hoursWorked.toFixed(1)}h`}
                  </p>
                </div>
                <StatusBadge status={r.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MonthPicker({ month, year }) {
  const prev = month === 1 ? { m: 12, y: year - 1 } : { m: month - 1, y: year };
  const next = month === 12 ? { m: 1, y: year + 1 } : { m: month + 1, y: year };
  return (
    <div className="flex items-center gap-2 text-sm">
      <Link
        href={`?month=${prev.m}&year=${prev.y}`}
        className="rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-accent"
      >
        ← Previous
      </Link>
      <Link
        href={`?month=${next.m}&year=${next.y}`}
        className="rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-accent"
      >
        Next →
      </Link>
    </div>
  );
}

export default async function EmployeeAttendancePage({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;

  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!roleAllowed(session.user.role, HR_VIEW_ROLES)) {
    redirect(`/dashboard/hr/employees/${id}`);
  }

  const now = new Date();
  const month = Number(sp?.month) || now.getMonth() + 1;
  const year = Number(sp?.year) || now.getFullYear();

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/employees" className="hover:text-foreground">
          Employees
        </Link>
        <span>/</span>
        <Link
          href={`/dashboard/hr/employees/${id}`}
          className="flex items-center gap-1 hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Employee
        </Link>
        <span>/</span>
        <span className="text-foreground">Attendance</span>
      </div>

      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-muted" />}>
        <HistoryLoader id={id} month={month} year={year} />
      </Suspense>
    </div>
  );
}
