import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import {
  getMyAttendanceToday,
  getMyAttendanceHistory,
  getAttendancePolicy,
} from "@/app/db/actions/hr-attendance-actions";
import ClockInWidget from "../attendance/ClockInWidget";

export const metadata = { title: "My attendance | HR" };

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
      {status?.replace("_", " ")}
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
    day: "numeric",
    month: "short",
  });

async function MyClock() {
  const initial = await getMyAttendanceToday();
  if (!initial.employee) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-500/5 p-8 text-center dark:border-amber-900">
        <Clock className="mx-auto mb-3 h-10 w-10 text-amber-500" />
        <p className="font-medium text-amber-700 dark:text-amber-400">
          You do not have an employee record yet
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask HR to create one before you can clock in.
        </p>
      </div>
    );
  }
  return <ClockInWidget initial={initial} />;
}

async function History({ month, year }) {
  const [{ employee, records, summary }, policy] = await Promise.all([
    getMyAttendanceHistory(month, year),
    getAttendancePolicy().catch(() => ({ timezone: "Africa/Nairobi" })),
  ]);
  if (!employee) return null;

  const tz = policy.timezone;
  const prev = month === 1 ? { m: 12, y: year - 1 } : { m: month - 1, y: year };
  const next = month === 12 ? { m: 1, y: year + 1 } : { m: month + 1, y: year };
  const label = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00`)
    .toLocaleDateString("en-KE", { month: "long", year: "numeric" });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link
          href={`?month=${prev.m}&year=${prev.y}`}
          className="rounded-md border border-border p-2 text-foreground hover:bg-accent"
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <p className="font-semibold text-foreground">{label}</p>
        <Link
          href={`?month=${next.m}&year=${next.y}`}
          className="rounded-md border border-border p-2 text-foreground hover:bg-accent"
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Present", summary.daysPresent, "text-emerald-600 dark:text-emerald-400"],
            ["Late", summary.daysLate, "text-amber-600 dark:text-amber-400"],
            ["Absent", summary.daysAbsent, "text-red-600 dark:text-red-400"],
            ["Hours", `${summary.totalHours.toFixed(1)}h`, "text-foreground"],
          ].map(([l, v, c]) => (
            <div key={l} className="rounded-lg border border-border bg-card p-4 shadow-sm">
              <p className="text-xs text-muted-foreground">{l}</p>
              <p className={`mt-1 text-xl font-bold ${c}`}>{v}</p>
            </div>
          ))}
        </div>
      )}

      {records.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center shadow-sm">
          <p className="text-muted-foreground">Nothing recorded for {label}.</p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-card shadow-sm">
          {records.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium text-foreground">{fmtDay(r.workDate)}</p>
                <p className="text-xs text-muted-foreground">
                  {fmtTime(r.checkIn, tz)} – {fmtTime(r.checkOut, tz)}
                  {r.hoursWorked != null && ` · ${r.hoursWorked.toFixed(1)}h`}
                  {r.overtimeHours ? ` · ${r.overtimeHours.toFixed(1)}h overtime` : ""}
                </p>
                {r.autoClosedOut && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Closed automatically at your shift end — you did not clock out.
                  </p>
                )}
              </div>
              <StatusBadge status={r.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default async function MyAttendancePage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const sp = await searchParams;
  const now = new Date();
  const month = Number(sp?.month) || now.getMonth() + 1;
  const year = Number(sp?.year) || now.getFullYear();

  return (
    <div className="max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-foreground sm:text-2xl">
          <Clock className="h-5 w-5" /> My attendance
        </h1>
        <p className="text-sm text-muted-foreground">Clock in and out, and your record</p>
      </div>

      <Suspense fallback={<div className="h-24 animate-pulse rounded-lg bg-muted" />}>
        <MyClock />
      </Suspense>

      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-muted" />}>
        <History month={month} year={year} />
      </Suspense>
    </div>
  );
}
