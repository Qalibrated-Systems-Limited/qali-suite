import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Users, Clock, UserX, Plane } from "lucide-react";
import { getAttendanceByDate } from "@/app/mongodb/queries/hr-queries";
import { getMyTodayAttendance } from "@/app/mongodb/actions/hr-attendance-actions";
import ClockInWidget from "./ClockInWidget";

export const metadata = { title: "Attendance | HR" };

const HR_ROLES = ["SuperAdmin", "Admin", "HR", "Manager"];

function StatusBadge({ status }) {
  const map = {
    present:   "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    late:      "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    absent:    "bg-red-500/15 text-red-700 dark:text-red-400",
    "half-day":"bg-blue-500/15 text-blue-700 dark:text-blue-400",
    "on-leave":"bg-purple-500/15 text-purple-700 dark:text-purple-400",
    holiday:   "bg-muted text-muted-foreground",
  };
  const label = {
    present: "Present",
    late: "Late",
    absent: "Absent",
    "half-day": "Half Day",
    "on-leave": "On Leave",
    holiday: "Holiday",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${map[status] || "bg-muted text-muted-foreground"}`}>
      {label[status] || status}
    </span>
  );
}

// Server-rendered times need an explicit timeZone — without it the
// formatter uses the server's local TZ (UTC on Vercel/Docker), so a
// 09:00 Africa/Nairobi check-in displays as 06:00. Pin to Nairobi.
const TZ = "Africa/Nairobi";

function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-KE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  });
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-KE", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: TZ,
  });
}

function SummaryCard({ label, value, icon: Icon, color }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}

async function RosterLoader({ dateStr }) {
  const { roster, summary, date } = await getAttendanceByDate(dateStr);

  return (
    <>
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Total Employees" value={summary.total} icon={Users} color="text-muted-foreground" />
        <SummaryCard label="Present" value={summary.present} icon={Clock} color="text-emerald-500" />
        <SummaryCard label="Absent" value={summary.absent} icon={UserX} color="text-red-500" />
        <SummaryCard label="On Leave" value={summary.onLeave} icon={Plane} color="text-purple-500" />
      </div>

      {roster.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center shadow-sm">
          <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-muted-foreground">No active employees found.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card shadow-sm">
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Check In</th>
                  <th className="px-4 py-3">Check Out</th>
                  <th className="px-4 py-3 text-right">Hours</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {roster.map((r, idx) => (
                  <tr key={r.profileId || idx} className="hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{r.employeeName}</p>
                      <p className="text-xs text-muted-foreground font-mono">{r.employeeNumber}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.department || "—"}</td>
                    <td className="px-4 py-3 text-foreground">{fmtTime(r.checkIn)}</td>
                    <td className="px-4 py-3 text-foreground">{fmtTime(r.checkOut)}</td>
                    <td className="px-4 py-3 text-right text-foreground">
                      {r.hoursWorked > 0 ? `${r.hoursWorked.toFixed(1)}h` : "—"}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/dashboard/hr/employees/${r.profileId}/attendance`}
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

          {/* Mobile cards */}
          <div className="divide-y divide-border md:hidden">
            {roster.map((r, idx) => (
              <div key={r.profileId || idx} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{r.employeeName}</p>
                  <p className="text-xs text-muted-foreground">{r.department}</p>
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                    {r.checkIn && <span>In: {fmtTime(r.checkIn)}</span>}
                    {r.checkOut && <span>Out: {fmtTime(r.checkOut)}</span>}
                    {r.hoursWorked > 0 && <span>{r.hoursWorked.toFixed(1)}h</span>}
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export default async function AttendancePage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!HR_ROLES.includes(session.user.role)) redirect("/dashboard/hr");

  const params = await searchParams;
  // Load current user's own attendance record for the widget
  const myAttendance = await getMyTodayAttendance();

  // Default to today
  const today = new Date().toISOString().slice(0, 10);
  const dateStr = params.date || today;
  const dateObj = new Date(dateStr);

  // Prev/next day navigation
  const prevDay = new Date(dateObj);
  prevDay.setDate(prevDay.getDate() - 1);
  const nextDay = new Date(dateObj);
  nextDay.setDate(nextDay.getDate() + 1);

  const isToday = dateStr === today;
  const isFuture = dateStr > today;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Attendance</h1>
          <p className="hidden sm:block text-sm text-muted-foreground">Daily roster and time tracking</p>
        </div>

        {/* Date navigation */}
        <div className="flex items-center gap-2">
          <Link
            href={`?date=${prevDay.toISOString().slice(0, 10)}`}
            className="rounded-md border border-border bg-card p-2 hover:bg-accent transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-45 text-center">
            <p className="text-sm font-medium text-foreground">
              {isToday ? "Today" : new Date(dateStr).toLocaleDateString("en-KE", { weekday: "short", month: "short", day: "numeric" })}
            </p>
            <p className="text-xs text-muted-foreground">{dateStr}</p>
          </div>
          <Link
            href={`?date=${nextDay.toISOString().slice(0, 10)}`}
            className={`rounded-md border border-border bg-card p-2 hover:bg-accent transition-colors ${isFuture ? "opacity-40 pointer-events-none" : ""}`}
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
          {!isToday && (
            <Link
              href="?"
              className="rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground hover:bg-accent transition-colors"
            >
              Today
            </Link>
          )}
        </div>
      </div>

      {/* Clock-in widget — shows for the logged-in user's own attendance */}
      {!myAttendance.noProfile && (
        <ClockInWidget initial={myAttendance} />
      )}

      <Suspense
        fallback={
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
            <div className="h-64 animate-pulse rounded-lg bg-muted" />
          </div>
        }
      >
        <RosterLoader dateStr={dateStr} />
      </Suspense>
    </div>
  );
}
