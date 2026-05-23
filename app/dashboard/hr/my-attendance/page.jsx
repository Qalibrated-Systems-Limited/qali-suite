import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { getMyTodayAttendance } from "@/app/mongodb/actions/hr-attendance-actions";
import { getMyEmployeeProfile, getAttendanceByEmployee } from "@/app/mongodb/queries/hr-queries";
import ClockInWidget from "../attendance/ClockInWidget";

export const metadata = { title: "My Attendance | HR" };

function StatusBadge({ status }) {
  const map = {
    present:    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    late:       "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    absent:     "bg-red-500/15 text-red-700 dark:text-red-400",
    "half-day": "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    "on-leave": "bg-purple-500/15 text-purple-700 dark:text-purple-400",
    holiday:    "bg-muted text-muted-foreground",
  };
  const label = {
    present:    "Present",
    late:       "Late",
    absent:     "Absent",
    "half-day": "Half Day",
    "on-leave": "On Leave",
    holiday:    "Holiday",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${map[status] || "bg-muted text-muted-foreground"}`}>
      {label[status] || status}
    </span>
  );
}

// Server-side TZ pin — see same fix in hr/attendance/page.jsx.
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
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: TZ,
  });
}

async function AttendanceHistory({ profileId, searchParams }) {
  const params = await searchParams;
  const now = new Date();
  const month = parseInt(params.month || String(now.getMonth() + 1));
  const year  = parseInt(params.year  || String(now.getFullYear()));

  const { records } = await getAttendanceByEmployee({
    profileId,
    page: 1,
    limit: 31,
    month,
    year,
  });

  const summary = {
    present:    records.filter((r) => r.status === "present" || r.status === "late").length,
    late:       records.filter((r) => r.status === "late").length,
    absent:     records.filter((r) => r.status === "absent").length,
    totalHours: records.reduce((sum, r) => sum + (r.hoursWorked || 0), 0),
  };

  // Build prev/next month links
  const prevDate = new Date(year, month - 2, 1);
  const nextDate = new Date(year, month, 1);
  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("en-KE", { month: "long", year: "numeric" });

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-foreground">Attendance History</h2>
        <div className="flex items-center gap-2">
          <Link
            href={`?month=${prevDate.getMonth() + 1}&year=${prevDate.getFullYear()}`}
            className="rounded-md border border-border bg-card p-1.5 hover:bg-accent transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <span className="min-w-36 text-center text-sm font-medium text-foreground">{monthLabel}</span>
          <Link
            href={`?month=${nextDate.getMonth() + 1}&year=${nextDate.getFullYear()}`}
            className={`rounded-md border border-border bg-card p-1.5 hover:bg-accent transition-colors ${isCurrentMonth ? "opacity-40 pointer-events-none" : ""}`}
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Summary strip */}
      {records.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Present", value: summary.present, color: "text-emerald-600" },
            { label: "Late",    value: summary.late,    color: "text-amber-600" },
            { label: "Absent",  value: summary.absent,  color: "text-red-600" },
            { label: "Hours",   value: `${summary.totalHours?.toFixed(1) || 0}h`, color: "text-foreground" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-lg border border-border bg-card p-3 shadow-sm">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={`text-xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* History table */}
      {records.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center shadow-sm">
          <Clock className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No attendance records for {monthLabel}.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card shadow-sm">
          {/* Desktop */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Check In</th>
                  <th className="px-4 py-3">Check Out</th>
                  <th className="px-4 py-3 text-right">Hours</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {records.map((r) => (
                  <tr key={r._id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-foreground">{fmtDate(r.date)}</td>
                    <td className="px-4 py-3 text-foreground">{fmtTime(r.checkIn)}</td>
                    <td className="px-4 py-3 text-foreground">{fmtTime(r.checkOut)}</td>
                    <td className="px-4 py-3 text-right text-foreground">
                      {r.hoursWorked > 0 ? `${r.hoursWorked.toFixed(1)}h` : "—"}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="divide-y divide-border md:hidden">
            {records.map((r) => (
              <div key={r._id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium text-foreground text-sm">{fmtDate(r.date)}</p>
                  <div className="mt-0.5 flex gap-3 text-xs text-muted-foreground">
                    {r.checkIn  && <span>In: {fmtTime(r.checkIn)}</span>}
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
    </div>
  );
}

export default async function MyAttendancePage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Load profile to get profileId — if no profile, show a friendly message
  const [myAttendance, profile] = await Promise.all([
    getMyTodayAttendance(),
    getMyEmployeeProfile(),
  ]);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Dashboard
        </Link>
        <span>/</span>
        <span className="text-foreground">My Attendance</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">My Attendance</h1>
        <p className="mt-1 text-sm text-muted-foreground">Clock in and out, and view your attendance history</p>
      </div>

      {/* No profile warning */}
      {myAttendance.noProfile ? (
        <div className="rounded-lg border border-amber-200 bg-amber-500/5 p-5 text-sm text-amber-700 dark:border-amber-900 dark:text-amber-400">
          <p className="font-semibold">No employee profile linked</p>
          <p className="mt-1">Clock-in requires an employee profile. Contact HR to set this up.</p>
        </div>
      ) : (
        <ClockInWidget initial={myAttendance} />
      )}

      {/* History */}
      {profile && (
        <Suspense
          fallback={
            <div className="space-y-3">
              <div className="h-32 animate-pulse rounded-lg bg-muted" />
              <div className="h-48 animate-pulse rounded-lg bg-muted" />
            </div>
          }
        >
          <AttendanceHistory profileId={profile._id.toString()} searchParams={searchParams} />
        </Suspense>
      )}
    </div>
  );
}
