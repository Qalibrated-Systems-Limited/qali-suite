import { Suspense } from "react";
import Link from "next/link";
import { Calendar, Clock, Receipt, UserPlus } from "lucide-react";
import {
  getMyEmployeeProfile,
  getMyPayslips,
  getMyTodayAttendanceSummary,
} from "@/app/mongodb/queries/hr-queries";

// ============================================
// MY HR STRIP
// Personal HR widgets shown to any user who may also be an employee.
// Admin/HR/Manager see this alongside their management dashboards.
// Employee role sees it in their own dashboard.
// Renders nothing if the user has no EmployeeProfile.
// ============================================

const ATTENDANCE_LABEL: Record<string, string> = {
  present:          "Present",
  late:             "Late",
  absent:           "Absent",
  "half-day":       "Half Day",
  "on-leave":       "On Leave",
  holiday:          "Holiday",
  "not-clocked-in": "Not clocked in",
};

const ATTENDANCE_COLOR: Record<string, string> = {
  present:          "text-emerald-600 dark:text-emerald-400",
  late:             "text-amber-600 dark:text-amber-400",
  absent:           "text-red-600 dark:text-red-400",
  "on-leave":       "text-purple-600 dark:text-purple-400",
  "not-clocked-in": "text-muted-foreground",
};

// This widget renders server-side, where `Date#toLocaleTimeString`
// without an explicit `timeZone` uses the server's local TZ — usually
// UTC on Vercel/Docker. That's why a 09:00 Africa/Nairobi check-in was
// rendering as 06:00. Pin the formatter to Africa/Nairobi so the
// displayed time matches the operator's wall clock regardless of where
// the server runs.
const TIME_ZONE = "Africa/Nairobi";

function formatTime(input: string | Date | null | undefined): string {
  if (!input) return "";
  return new Date(input).toLocaleTimeString("en-KE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: TIME_ZONE,
  });
}

async function HRStripContent() {
  const [profile, { payslips }, attendance] = await Promise.all([
    getMyEmployeeProfile(),
    getMyPayslips({ page: 1, limit: 1 }),
    getMyTodayAttendanceSummary(),
  ]);

  // No employee profile — show a prompt instead of silently disappearing
  if (!profile) {
    return (
      <Link
        href="/dashboard/hr/employees"
        className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-card p-4 text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
      >
        <div className="rounded-lg bg-muted p-2 shrink-0">
          <UserPlus className="h-4 w-4" />
        </div>
        <div>
          <p className="font-medium text-foreground">Employee profile not linked</p>
          <p className="text-xs mt-0.5">Ask HR to create your employee profile to enable leave, payslips and attendance tracking.</p>
        </div>
      </Link>
    );
  }

  const leaveBalances: any[] = Array.isArray(profile.leaveBalances)
    ? profile.leaveBalances
    : [];
  const annualLeave = leaveBalances.find((b: any) => b.leaveType === "annual");
  const sickLeave   = leaveBalances.find((b: any) => b.leaveType === "sick");
  const latestPayslip = payslips[0] || null;
  const todayStatus = attendance?.status || "not-clocked-in";

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {/* Today's Attendance */}
      <Link
        href="/dashboard/hr/my-attendance"
        className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-sm hover:bg-muted/40 transition-colors"
      >
        <div className="rounded-lg bg-teal-500/10 p-2 shrink-0">
          <Clock className="h-4 w-4 text-teal-500" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Today</p>
          <p className={`text-sm font-semibold truncate ${ATTENDANCE_COLOR[todayStatus] || "text-muted-foreground"}`}>
            {ATTENDANCE_LABEL[todayStatus] || todayStatus}
          </p>
          {attendance?.checkIn && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatTime(attendance.checkIn)}
              {attendance.checkOut && (
                <> → {formatTime(attendance.checkOut)}</>
              )}
            </p>
          )}
          {!attendance?.checkIn && (
            <p className="text-xs text-primary mt-0.5">Clock in →</p>
          )}
        </div>
      </Link>

      {/* Leave Balance */}
      <Link
        href="/dashboard/hr/my-leave"
        className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-sm hover:bg-muted/40 transition-colors"
      >
        <div className="rounded-lg bg-blue-500/10 p-2 shrink-0">
          <Calendar className="h-4 w-4 text-blue-500" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Leave Balance</p>
          {leaveBalances.length === 0 ? (
            <p className="text-sm text-muted-foreground">Not configured</p>
          ) : (
            <div className="space-y-0.5 mt-0.5">
              {annualLeave && (
                <p className="text-sm text-foreground">
                  <span className="font-semibold">{annualLeave.balanceDays}</span>
                  <span className="text-muted-foreground text-xs"> / {annualLeave.entitledDays}d annual</span>
                </p>
              )}
              {sickLeave && (
                <p className="text-sm text-foreground">
                  <span className="font-semibold">{sickLeave.balanceDays}</span>
                  <span className="text-muted-foreground text-xs"> / {sickLeave.entitledDays}d sick</span>
                </p>
              )}
              {!annualLeave && !sickLeave && leaveBalances[0] && (
                <p className="text-sm font-semibold text-foreground">{leaveBalances[0].balanceDays} days</p>
              )}
              <p className="text-xs text-primary mt-1">View all balances →</p>
            </div>
          )}
        </div>
      </Link>

      {/* Latest Payslip */}
      <Link
        href="/dashboard/hr/my-payslips"
        className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-sm hover:bg-muted/40 transition-colors"
      >
        <div className="rounded-lg bg-emerald-500/10 p-2 shrink-0">
          <Receipt className="h-4 w-4 text-emerald-500" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Latest Payslip</p>
          {latestPayslip ? (
            <>
              <p className="text-sm font-semibold text-foreground">{latestPayslip.period.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Net <span className="font-mono font-medium text-foreground">
                  {latestPayslip.currency} {new Intl.NumberFormat("en-KE").format(latestPayslip.netPay)}
                </span>
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No payslips yet</p>
          )}
        </div>
      </Link>
    </div>
  );
}

export default function MyHRStrip() {
  return (
    <Suspense fallback={
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    }>
      <HRStripContent />
    </Suspense>
  );
}
