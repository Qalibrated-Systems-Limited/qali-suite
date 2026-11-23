import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getHrOverview } from "@/app/db/actions/hr-employee-actions";
import { getHrRecordAlerts } from "@/app/db/actions/hr-records-actions";
import { getAttendanceForPage } from "@/app/db/actions/hr-attendance-actions";
import { listLeaveForPage } from "@/app/db/actions/hr-leave-actions";
import { can } from "@/lib/capabilities";
import {
  Users, Building2, Calendar, Banknote, Clock, UserCheck, AlertTriangle, Settings,
  FileText, Gavel, GraduationCap, Star, Briefcase, BarChart3, Network,
} from "lucide-react";

export const metadata = { title: "HR | Dashboard" };


async function HRStatsCards() {
  const [{ stats }, pending] = await Promise.all([
    getHrOverview(),
    listLeaveForPage({ status: "submitted", limit: 1 }),
  ]);

  const cards = [
    { label: "Total Employees", value: stats.headcount, icon: Users, href: "/dashboard/hr/employees", color: "text-primary", bg: "bg-primary/10" },
    { label: "Active", value: stats.active, icon: UserCheck, href: "/dashboard/hr/employees?status=active", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10" },
    { label: "On Leave", value: stats.onLeave, icon: Calendar, href: "/dashboard/hr/leave?status=approved", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10" },
    { label: "On Probation", value: stats.probation, icon: Clock, href: "/dashboard/hr/employees?status=probation", color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-500/10" },
    { label: "Pending Approvals", value: pending.pagination.total, icon: Calendar, href: "/dashboard/hr/leave?status=submitted", color: "text-red-600 dark:text-red-400", bg: "bg-red-500/10" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((card) => (
        <Link
          key={card.label}
          href={card.href}
          className="rounded-lg border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
        >
          <div className={`mb-3 inline-flex rounded-lg p-2 ${card.bg}`}>
            <card.icon className={`h-5 w-5 ${card.color}`} />
          </div>
          <p className="text-2xl font-bold text-foreground">{card.value}</p>
          <p className="mt-1 text-sm text-muted-foreground">{card.label}</p>
        </Link>
      ))}
    </div>
  );
}

async function HeadcountByDept() {
  const { stats } = await getHrOverview();

  return (
    <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <h3 className="mb-4 font-semibold text-foreground">Headcount by Department</h3>
      {!stats.byDepartment?.length ? (
        <p className="text-sm text-muted-foreground">No department data yet.</p>
      ) : (
        <div className="space-y-3">
          {stats.byDepartment.map((dept) => {
            const pct = stats.headcount > 0 ? (dept.count / stats.headcount) * 100 : 0;
            return (
              <div key={dept.departmentId || dept.department}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-foreground">{dept.department}</span>
                  <span className="font-medium text-foreground">{dept.count}</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function QuickActions({ role, user }) {
  const actions = [
    { label: "Add Employee", href: "/dashboard/hr/employees/create", icon: Users },
    { label: "Add Department", href: "/dashboard/hr/departments/create", icon: Building2 },
    { label: "Leave Requests", href: "/dashboard/hr/leave", icon: Calendar },
    { label: "Leave Types", href: "/dashboard/hr/leave-types", icon: Settings },
    { label: "Run Payroll", href: "/dashboard/hr/payroll/create", icon: Banknote },
    { label: "Issue a Letter", href: "/dashboard/hr/letters/new", icon: FileText, cap: "hr.letters" },
    { label: "Open a Case", href: "/dashboard/hr/cases/new", icon: Gavel, cap: "hr.discipline" },
    { label: "Record Training", href: "/dashboard/hr/training", icon: GraduationCap, cap: "hr.training" },
    { label: "Reviews", href: "/dashboard/hr/reviews", icon: Star, cap: "hr.reviews" },
    { label: "Recruitment", href: "/dashboard/hr/recruitment", icon: Briefcase, cap: "hr.recruit" },
    { label: "HR Reports", href: "/dashboard/hr/reports", icon: BarChart3, cap: "hr.reports" },
    { label: "Org Chart", href: "/dashboard/hr/org-chart", icon: Network, cap: "hr.view" },
  ].filter((a) => !a.cap || can(user || role, a.cap));

  return (
    <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <h3 className="mb-4 font-semibold text-foreground">Quick Actions</h3>
      <div className="grid grid-cols-2 gap-3">
        {actions.map((action) => (
          <Link
            key={action.label}
            href={action.href}
            className="flex items-center gap-2 rounded-md border border-border p-3 text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <action.icon className="h-4 w-4 text-muted-foreground" />
            {action.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

async function TodayAttendanceWidget() {
  const { stats } = await getAttendanceForPage();
  if (stats.headcount === 0) return null;

  const presentPct = stats.headcount > 0 ? Math.round((stats.present / stats.headcount) * 100) : 0;

  return (
    <Link
      href="/dashboard/hr/attendance"
      className="block rounded-lg border border-border bg-card p-4 shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Today&#39;s Attendance</h3>
        <span className="text-xs text-muted-foreground">{new Date().toLocaleDateString("en-KE", { weekday: "short", month: "short", day: "numeric" })}</span>
      </div>
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{presentPct}% present</span>
        <span className="text-xs text-muted-foreground">{stats.present} / {stats.headcount}</span>
      </div>
      <div className="mb-4 h-2 w-full rounded-full bg-muted">
        <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${presentPct}%` }} />
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{stats.present}</p>
          <p className="text-xs text-muted-foreground">Present</p>
        </div>
        <div>
          <p className="text-lg font-bold text-red-600 dark:text-red-400">{stats.absent}</p>
          <p className="text-xs text-muted-foreground">Absent</p>
        </div>
        <div>
          <p className="text-lg font-bold text-purple-600 dark:text-purple-400">{stats.onLeave}</p>
          <p className="text-xs text-muted-foreground">On Leave</p>
        </div>
      </div>
    </Link>
  );
}

async function ContractExpiryAlerts() {
  const { expiringContracts: expiring } = await getHrOverview();
  if (!expiring.length) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-500/5 p-4 dark:border-amber-800">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          {expiring.length} contract{expiring.length > 1 ? "s" : ""} expiring within 30 days
        </p>
      </div>
      <div className="space-y-2">
        {expiring.map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-2 text-sm">
            <div>
              <span className="font-medium text-foreground">{e.name}</span>
              {e.department && <span className="ml-1 text-muted-foreground">· {e.department}</span>}
            </div>
            <div className="shrink-0 text-right">
              <span className={`font-medium ${e.daysRemaining <= 7 ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
                {e.daysRemaining}d left
              </span>
              <span className="ml-2 text-xs text-muted-foreground">
                {new Date(e.contractEnd).toLocaleDateString("en-KE")}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * What needs HR's attention beyond contracts: probations ending, certificates
 * and licences expiring (or expired), open cases, reviews in progress and
 * open vacancies. Each links to where it is dealt with.
 */
async function RecordAlerts({ role, user }) {
  const a = await getHrRecordAlerts().catch(() => null);
  if (!a) return null;
  const items = [
    { n: a.probation_due, label: "probation ending within 30 days", href: "/dashboard/hr/employees?status=probation", cap: "hr.admin" },
    { n: a.certs_expiring, label: "certificates or licences expiring within 60 days", href: "/dashboard/hr/training", cap: "hr.training" },
    { n: a.open_cases, label: "open disciplinary or grievance cases", href: "/dashboard/hr/cases", cap: "hr.discipline" },
    { n: a.reviews_open, label: "performance reviews in progress", href: "/dashboard/hr/reviews", cap: "hr.reviews" },
    { n: a.open_vacancies, label: "open vacancies", href: "/dashboard/hr/recruitment", cap: "hr.recruit" },
  ].filter((i) => i.n > 0 && can(user || role, i.cap));
  if (!items.length && !a.probation.length) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-500/5 p-4 dark:border-amber-800">
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Needs attention</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((i) => (
          <Link key={i.label} href={i.href} className="rounded-full border border-amber-300 bg-card px-3 py-1 text-xs hover:bg-accent dark:border-amber-800">
            <b>{i.n}</b> {i.label}
          </Link>
        ))}
      </div>
      {a.probation.length > 0 && can(user || role, "hr.admin") && (
        <div className="mt-3 space-y-1">
          {a.probation.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
              <Link href={`/dashboard/hr/employees/${p.id}`} className="font-medium text-foreground hover:underline">
                {p.name}{p.department ? <span className="font-normal text-muted-foreground"> · {p.department}</span> : null}
              </Link>
              <span className={Number(p.days_remaining) < 0 ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}>
                probation {Number(p.days_remaining) < 0 ? `ended ${-p.days_remaining}d ago — confirm or extend` : `ends in ${p.days_remaining}d`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatsCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 h-9 w-9 animate-pulse rounded-lg bg-muted" />
          <div className="h-8 w-12 animate-pulse rounded bg-muted" />
          <div className="mt-1 h-4 w-24 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

export default async function HRPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user, "hr.write")) redirect("/dashboard");

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">Human Resources</h1>
        <p className="hidden sm:block text-sm text-muted-foreground">Manage employees, leave, and payroll</p>
      </div>

      <Suspense fallback={<StatsCardsSkeleton />}>
        <HRStatsCards />
      </Suspense>

      <Suspense fallback={null}>
        <ContractExpiryAlerts />
      </Suspense>

      <Suspense fallback={null}>
        <RecordAlerts role={session.user.role} user={session.user} />
      </Suspense>

      <div className="grid gap-6 lg:grid-cols-3">
        <Suspense fallback={<div className="h-48 animate-pulse rounded-lg bg-muted" />}>
          <HeadcountByDept />
        </Suspense>
        <Suspense fallback={<div className="h-48 animate-pulse rounded-lg bg-muted" />}>
          <TodayAttendanceWidget />
        </Suspense>
        <QuickActions role={session.user.role} user={session.user} />
      </div>
    </div>
  );
}
