import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getEmployeeById, getAttendanceByEmployee } from "@/app/mongodb/queries/hr-queries";
import AttendanceManualEntryForm from "./AttendanceManualEntryForm";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const { employee } = await getEmployeeById(id);
  const name = employee ? `${employee.personalInfo?.firstName} ${employee.personalInfo?.lastName}` : "Employee";
  return { title: `${name} — Attendance | HR` };
}

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
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${map[status] || "bg-muted text-muted-foreground"}`}>
      {status?.replace("-", " ") || "—"}
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
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-KE", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: TZ,
  });
}

async function HistoryLoader({ profileId, page, month, year }) {
  const { records, pagination } = await getAttendanceByEmployee({
    profileId,
    page: parseInt(page || "1"),
    limit: 30,
    month,
    year,
  });

  if (!records.length) {
    return (
      <div className="rounded-lg border border-border bg-card p-10 text-center shadow-sm">
        <p className="text-muted-foreground">No attendance records for this period.</p>
      </div>
    );
  }

  // Monthly summary
  const present = records.filter((r) => r.status === "present" || r.status === "late").length;
  const absent  = records.filter((r) => r.status === "absent").length;
  const late    = records.filter((r) => r.status === "late").length;
  const totalHours = records.reduce((s, r) => s + (r.hoursWorked || 0), 0);
  const totalOT    = records.reduce((s, r) => s + (r.overtime || 0), 0);

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="flex flex-wrap gap-3">
        {[
          { label: "Present", value: present, color: "text-emerald-600 dark:text-emerald-400" },
          { label: "Absent",  value: absent,  color: "text-red-600 dark:text-red-400" },
          { label: "Late",    value: late,    color: "text-amber-600 dark:text-amber-400" },
          { label: "Hours",   value: `${totalHours.toFixed(1)}h`, color: "text-foreground" },
          { label: "OT",      value: `${totalOT.toFixed(1)}h`,    color: "text-blue-600 dark:text-blue-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-lg font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Records table */}
      <div className="rounded-lg border border-border bg-card shadow-sm">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Shift</th>
                <th className="px-4 py-3">Check In</th>
                <th className="px-4 py-3">Check Out</th>
                <th className="px-4 py-3 text-right">Hours</th>
                <th className="px-4 py-3 text-right">OT</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Method</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {records.map((r, idx) => (
                <tr key={r._id || idx} className={`hover:bg-muted/50 transition-colors ${r.overriddenBy ? "bg-amber-500/5" : ""}`}>
                  <td className="px-4 py-3 text-foreground">{fmtDate(r.date)}</td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{r.shift}</td>
                  <td className="px-4 py-3 text-foreground">{fmtTime(r.checkIn)}</td>
                  <td className="px-4 py-3 text-foreground">{fmtTime(r.checkOut)}</td>
                  <td className="px-4 py-3 text-right text-foreground">
                    {r.hoursWorked > 0 ? `${r.hoursWorked.toFixed(1)}h` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-blue-600 dark:text-blue-400">
                    {r.overtime > 0 ? `${r.overtime.toFixed(1)}h` : "—"}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 capitalize text-xs text-muted-foreground">
                    {r.method || "—"}
                    {r.overriddenBy && <span className="ml-1 text-amber-600">(override)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile list */}
        <div className="divide-y divide-border md:hidden">
          {records.map((r, idx) => (
            <div key={r._id || idx} className="flex items-center justify-between gap-2 p-4">
              <div>
                <p className="text-sm font-medium text-foreground">{fmtDate(r.date)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {r.checkIn ? `In: ${fmtTime(r.checkIn)}` : "No clock-in"}
                  {r.checkOut ? ` · Out: ${fmtTime(r.checkOut)}` : ""}
                  {r.hoursWorked > 0 ? ` · ${r.hoursWorked.toFixed(1)}h` : ""}
                </p>
              </div>
              <StatusBadge status={r.status} />
            </div>
          ))}
        </div>

        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
            <p className="text-muted-foreground">{pagination.total} records</p>
            <div className="flex gap-2">
              {pagination.page > 1 && (
                <Link href={`?page=${pagination.page - 1}`} className="rounded border border-border px-3 py-1 hover:bg-accent">Previous</Link>
              )}
              {pagination.page < pagination.totalPages && (
                <Link href={`?page=${pagination.page + 1}`} className="rounded border border-border px-3 py-1 hover:bg-accent">Next</Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default async function EmployeeAttendancePage({ params, searchParams }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!HR_ROLES.includes(session.user.role)) redirect("/dashboard/hr");

  const { employee, error } = await getEmployeeById(id);
  if (!employee || error) notFound();

  const sp = await searchParams;
  const now = new Date();
  const month = sp.month || String(now.getMonth() + 1);
  const year  = sp.year  || String(now.getFullYear());

  const fullName = `${employee.personalInfo?.firstName || ""} ${employee.personalInfo?.lastName || ""}`.trim();
  const canEdit = ["SuperAdmin", "Admin", "HR"].includes(session.user.role);

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const currentYear = now.getFullYear();

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/dashboard/hr/employees/${id}`} className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> {fullName}
        </Link>
        <span>/</span>
        <span className="text-foreground">Attendance</span>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">{fullName} — Attendance</h1>
          <p className="text-sm text-muted-foreground">{employee.employeeNumber} · {employee.employment?.department}</p>
        </div>

        {/* Month/Year filter */}
        <div className="flex items-center gap-2">
          <Link
            href={`?month=${month}&year=${parseInt(year) - 1}`}
            className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
          >
            {parseInt(year) - 1}
          </Link>
          <div className="flex gap-1 overflow-x-auto">
            {MONTHS.map((m, i) => (
              <Link
                key={m}
                href={`?month=${i + 1}&year=${year}`}
                className={`shrink-0 rounded px-2 py-1 text-xs transition-colors ${
                  parseInt(month) === i + 1 ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m}
              </Link>
            ))}
          </div>
          <Link
            href={`?month=${month}&year=${parseInt(year) + 1}`}
            className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
          >
            {parseInt(year) + 1}
          </Link>
        </div>
      </div>

      {/* Manual entry form (HR/Admin only) */}
      {canEdit && (
        <AttendanceManualEntryForm profileId={id} />
      )}

      <Suspense
        fallback={
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        }
      >
        <HistoryLoader profileId={id} page={sp.page} month={month} year={year} />
      </Suspense>
    </div>
  );
}
