import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Users,
  Calendar,
  Clock,
  UserPlus,
  Building2,
  Banknote,
  AlertTriangle,
  CheckCircle,
  XCircle,
  UserCheck,
  ChevronRight,
  TrendingUp,
  FileText,
} from "lucide-react";

import MyHRStrip from "./MyHRStrip";
import { HRAlertsStrip, HRAlertsStripSkeleton } from "./HRAlertsStrip";
import {
  getHRStats,
  getExpiringContracts,
  getTodayAttendanceStats,
  getLeaveRequests,
} from "@/app/mongodb/queries/hr-queries";

// ============================================
// HR DASHBOARD PAGE
// ============================================
export default async function HRDashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { user } = session;
  const firstName = (user as any).name?.split(" ")[0] || "there";
  const greeting = getGreeting();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-xs font-medium text-muted-foreground">{formatDate(new Date())}</p>
        <h1 className="mt-0.5 text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
          {greeting}, {firstName}
        </h1>
      </div>

      {/* HR alerts strip — what needs attention */}
      <Suspense fallback={<HRAlertsStripSkeleton />}>
        <HRAlertsStrip />
      </Suspense>

      {/* Personal HR strip */}
      <section>
        <SectionHeading>My HR</SectionHeading>
        <MyHRStrip />
      </section>

      {/* HR Metrics */}
      <section>
        <SectionHeading>Workforce Overview</SectionHeading>
        <Suspense fallback={<MetricsSkeleton />}>
          <HRMetrics />
        </Suspense>
      </section>

      {/* Main content grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left — takes 2 columns */}
        <div className="lg:col-span-2 space-y-6">
          <Suspense fallback={<CardSkeleton rows={5} />}>
            <PendingLeaveCard />
          </Suspense>
          <Suspense fallback={null}>
            <ContractAlerts />
          </Suspense>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <Suspense fallback={<CardSkeleton rows={4} />}>
            <AttendanceCard />
          </Suspense>
          <QuickActions />
        </div>
      </div>
    </div>
  );
}

// ============================================
// SHARED: SECTION HEADING
// ============================================
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
      {children}
    </h2>
  );
}

// ============================================
// HR METRICS
// ============================================
async function HRMetrics() {
  const stats = await getHRStats();

  const metrics = [
    {
      label: "Total Staff",
      value: stats.totalHeadcount,
      icon: Users,
      color: "text-violet-600 dark:text-violet-400",
      bg: "bg-violet-500/10",
      border: "border-violet-200 dark:border-violet-900/50",
      href: "/dashboard/hr/employees",
    },
    {
      label: "Active",
      value: stats.totalActive,
      icon: UserCheck,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-500/10",
      border: "border-emerald-200 dark:border-emerald-900/50",
      href: "/dashboard/hr/employees?status=active",
    },
    {
      label: "On Leave",
      value: stats.totalOnLeave,
      icon: Calendar,
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-500/10",
      border: "border-amber-200 dark:border-amber-900/50",
      href: "/dashboard/hr/employees?status=on_leave",
    },
    {
      label: "Probation",
      value: stats.totalProbation,
      icon: Clock,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-500/10",
      border: "border-blue-200 dark:border-blue-900/50",
      href: "/dashboard/hr/employees?status=probation",
    },
    {
      label: "Pending Leaves",
      value: stats.pendingLeaveApprovals,
      icon: AlertTriangle,
      color: "text-red-600 dark:text-red-400",
      bg: "bg-red-500/10",
      border: stats.pendingLeaveApprovals > 0 ? "border-red-300 dark:border-red-800" : "border-red-100 dark:border-red-900/30",
      href: "/dashboard/hr/leave?status=submitted",
      alert: stats.pendingLeaveApprovals > 0,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {metrics.map((m) => (
        <Link
          key={m.label}
          href={m.href}
          className={`group rounded-xl border ${m.border} bg-card p-4 shadow-sm hover:shadow-md transition-all`}
        >
          <div className={`mb-3 inline-flex rounded-lg p-2.5 ${m.bg}`}>
            <m.icon className={`h-4 w-4 ${m.color}`} />
          </div>
          <p className={`text-2xl font-bold tabular-nums ${m.alert ? "text-red-600 dark:text-red-400" : "text-foreground"}`}>
            {m.value}
          </p>
          <p className="mt-1 text-xs text-muted-foreground leading-tight">{m.label}</p>
        </Link>
      ))}
    </div>
  );
}

// ============================================
// PENDING LEAVE APPROVALS
// ============================================
async function PendingLeaveCard() {
  const { leaveRequests: requests } = await getLeaveRequests({ status: "submitted", limit: 8 });

  const TYPE_COLOR: Record<string, string> = {
    annual:        "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    sick:          "bg-red-500/10 text-red-700 dark:text-red-300",
    maternity:     "bg-pink-500/10 text-pink-700 dark:text-pink-300",
    paternity:     "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    compassionate: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
    unpaid:        "bg-gray-500/10 text-gray-700 dark:text-gray-300",
  };

  const TYPE_LABEL: Record<string, string> = {
    annual: "Annual", sick: "Sick", maternity: "Maternity",
    paternity: "Paternity", compassionate: "Compassionate", unpaid: "Unpaid",
  };

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-amber-500/10">
            <FileText className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <h3 className="font-semibold text-foreground text-sm">Pending Leave Approvals</h3>
          {requests.length > 0 && (
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-amber-500 text-white text-xs font-bold">
              {requests.length}
            </span>
          )}
        </div>
        <Link
          href="/dashboard/hr/leave?status=submitted"
          className="flex items-center gap-0.5 text-xs text-primary hover:underline"
        >
          View all <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      {requests.length === 0 ? (
        <div className="flex items-center gap-3 px-5 py-8 text-sm text-muted-foreground">
          <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />
          All caught up — no pending leave requests.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {requests.map((req: any) => {
            const days = req.duration?.workingDays ?? req.duration?.calendarDays ?? "?";
            const start = req.startDate ? new Date(req.startDate).toLocaleDateString("en-KE", { month: "short", day: "numeric" }) : "";
            const end   = req.endDate   ? new Date(req.endDate).toLocaleDateString("en-KE",   { month: "short", day: "numeric" }) : "";
            const typeKey = req.leaveType as string;

            return (
              <Link
                key={req._id}
                href={`/dashboard/hr/leave/${req._id}`}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/40 transition-colors"
              >
                {/* Avatar initials */}
                <div className="h-8 w-8 shrink-0 rounded-full bg-violet-500/10 flex items-center justify-center text-xs font-bold text-violet-700 dark:text-violet-300 uppercase">
                  {(req.employee?.name || "?").split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{req.employee?.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {start}{end && start !== end ? ` – ${end}` : ""} · {days} day{days !== 1 ? "s" : ""}
                  </p>
                </div>

                <span className={`shrink-0 text-xs rounded-full px-2.5 py-0.5 font-medium ${TYPE_COLOR[typeKey] || "bg-muted text-muted-foreground"}`}>
                  {TYPE_LABEL[typeKey] || typeKey}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================
// TODAY'S ATTENDANCE CARD
// ============================================
async function AttendanceCard() {
  const stats = await getTodayAttendanceStats();

  const dateStr = new Date().toLocaleDateString("en-KE", {
    weekday: "short", month: "short", day: "numeric",
  });

  if (stats.totalActive === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <div className="p-1.5 rounded-lg bg-teal-500/10">
            <TrendingUp className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          </div>
          <h3 className="font-semibold text-sm text-foreground">Today&apos;s Attendance</h3>
        </div>
        <p className="text-sm text-muted-foreground">No active employees yet.</p>
      </div>
    );
  }

  const presentPct = Math.round((stats.present / stats.totalActive) * 100);
  const absentPct  = Math.round((stats.absent  / stats.totalActive) * 100);
  const leavePct   = Math.round((stats.onLeave / stats.totalActive) * 100);

  return (
    <Link
      href="/dashboard/hr/attendance"
      className="block rounded-xl border border-border bg-card p-5 shadow-sm hover:shadow-md transition-all"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-teal-500/10">
            <TrendingUp className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          </div>
          <h3 className="font-semibold text-sm text-foreground">Today&apos;s Attendance</h3>
        </div>
        <span className="text-xs text-muted-foreground">{dateStr}</span>
      </div>

      {/* Stacked progress bar */}
      <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-muted mb-4 gap-px">
        <div className="bg-emerald-500 rounded-l-full transition-all" style={{ width: `${presentPct}%` }} />
        <div className="bg-purple-500 transition-all"                  style={{ width: `${leavePct}%` }} />
        <div className="bg-red-400 rounded-r-full transition-all"      style={{ width: `${absentPct}%` }} />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-emerald-500/10 py-2.5 px-1">
          <p className="text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{stats.present}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Present</p>
        </div>
        <div className="rounded-lg bg-purple-500/10 py-2.5 px-1">
          <p className="text-xl font-bold tabular-nums text-purple-600 dark:text-purple-400">{stats.onLeave}</p>
          <p className="text-xs text-muted-foreground mt-0.5">On Leave</p>
        </div>
        <div className="rounded-lg bg-red-500/10 py-2.5 px-1">
          <p className="text-xl font-bold tabular-nums text-red-600 dark:text-red-400">{stats.absent}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Absent</p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-center mt-3">
        {presentPct}% present out of {stats.totalActive} active employees
      </p>
    </Link>
  );
}

// ============================================
// CONTRACT EXPIRY ALERTS
// ============================================
async function ContractAlerts() {
  const expiring = await getExpiringContracts(30);
  if (!expiring.length) return null;

  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-500/5 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-amber-200 dark:border-amber-900/60 bg-amber-500/10">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          {expiring.length} contract{expiring.length > 1 ? "s" : ""} expiring within 30 days
        </p>
      </div>
      <div className="divide-y divide-amber-100 dark:divide-amber-900/30">
        {expiring.map((e: any) => (
          <Link
            key={e._id}
            href={`/dashboard/hr/employees/${e._id}`}
            className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-amber-500/10 transition-colors"
          >
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">{e.name}</span>
              {e.department && (
                <span className="ml-2 text-xs text-muted-foreground">{e.department}</span>
              )}
            </div>
            <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${
              e.daysRemaining <= 7
                ? "bg-red-500/10 text-red-600 dark:text-red-400"
                : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
            }`}>
              {e.daysRemaining}d left
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ============================================
// QUICK ACTIONS
// ============================================
function QuickActions() {
  const actions = [
    { label: "Add Employee",  href: "/dashboard/hr/employees/create",       icon: UserPlus,   color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/10" },
    { label: "Approve Leave", href: "/dashboard/hr/leave?status=submitted", icon: CheckCircle, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10" },
    { label: "Departments",   href: "/dashboard/hr/departments",            icon: Building2,  color: "text-blue-600 dark:text-blue-400",    bg: "bg-blue-500/10" },
    { label: "Run Payroll",   href: "/dashboard/hr/payroll/create",         icon: Banknote,   color: "text-amber-600 dark:text-amber-400",  bg: "bg-amber-500/10" },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <h3 className="font-semibold text-sm text-foreground mb-3">Quick Actions</h3>
      <div className="grid grid-cols-2 gap-2">
        {actions.map((a) => (
          <Link
            key={a.label}
            href={a.href}
            className="flex flex-col items-center gap-2.5 rounded-lg border border-border bg-muted/30 p-3.5 text-center hover:bg-accent hover:border-accent-foreground/20 transition-all group"
          >
            <div className={`p-2 rounded-lg ${a.bg} group-hover:scale-110 transition-transform`}>
              <a.icon className={`h-4 w-4 ${a.color}`} />
            </div>
            <span className="text-xs font-medium text-foreground leading-tight">{a.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ============================================
// SKELETONS
// ============================================
function MetricsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 h-9 w-9 animate-pulse rounded-lg bg-muted" />
          <div className="h-7 w-10 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-3 w-16 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border bg-muted/30 flex items-center gap-3">
        <div className="h-7 w-7 animate-pulse rounded-lg bg-muted" />
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4">
            <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-32 animate-pulse rounded bg-muted" />
              <div className="h-3 w-24 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// HELPERS
// ============================================
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function formatDate(d: Date) {
  return d.toLocaleDateString("en-KE", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}
