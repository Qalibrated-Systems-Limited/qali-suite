import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Calendar, Plus, Clock, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getMyEmployeeProfile,
  getLeaveRequests,
} from "@/app/mongodb/queries/hr-queries";

export const metadata = { title: "My Leave | HR" };

const TYPE_LABELS = {
  annual: "Annual Leave",
  sick: "Sick Leave",
  maternity: "Maternity Leave",
  paternity: "Paternity Leave",
  compassionate: "Compassionate Leave",
  study: "Study Leave",
  unpaid: "Unpaid Leave",
};

const TYPE_COLORS = {
  annual:        { bg: "bg-blue-500",   light: "bg-blue-500/15",   text: "text-blue-700 dark:text-blue-400" },
  sick:          { bg: "bg-amber-500",  light: "bg-amber-500/15",  text: "text-amber-700 dark:text-amber-400" },
  maternity:     { bg: "bg-pink-500",   light: "bg-pink-500/15",   text: "text-pink-700 dark:text-pink-400" },
  paternity:     { bg: "bg-indigo-500", light: "bg-indigo-500/15", text: "text-indigo-700 dark:text-indigo-400" },
  compassionate: { bg: "bg-purple-500", light: "bg-purple-500/15", text: "text-purple-700 dark:text-purple-400" },
  study:         { bg: "bg-teal-500",   light: "bg-teal-500/15",   text: "text-teal-700 dark:text-teal-400" },
  unpaid:        { bg: "bg-gray-500",   light: "bg-gray-500/15",   text: "text-gray-700 dark:text-gray-400" },
};

const STATUS_STYLES = {
  draft:     "bg-muted text-muted-foreground",
  submitted: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  approved:  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  rejected:  "bg-red-500/15 text-red-700 dark:text-red-400",
  recalled:  "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  completed: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  cancelled: "bg-muted text-muted-foreground",
};

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status] || "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

// ============================================
// BALANCES SECTION
// ============================================
function LeaveBalances({ balances, gender }) {
  const filtered = balances.filter((b) => {
    if (b.leaveType === "maternity" && gender === "male") return false;
    if (b.leaveType === "paternity" && gender === "female") return false;
    return true;
  });

  if (filtered.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center">
        <Calendar className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No leave balances configured. Contact HR.</p>
      </div>
    );
  }

  const totalEntitled  = filtered.reduce((s, b) => s + (b.entitledDays || 0), 0);
  const totalUsed      = filtered.reduce((s, b) => s + (b.usedDays || 0), 0);
  const totalPending   = filtered.reduce((s, b) => s + (b.pendingDays || 0), 0);
  const totalRemaining = filtered.reduce((s, b) => s + (b.balanceDays || 0), 0);

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {[
          { label: "Entitled", value: totalEntitled, color: "text-foreground" },
          { label: "Used", value: totalUsed, color: "text-foreground" },
          { label: "Pending", value: totalPending, color: "text-amber-600 dark:text-amber-400" },
          { label: "Available", value: totalRemaining, color: "text-emerald-600 dark:text-emerald-400" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-card p-3 text-center">
            <p className="text-[11px] text-muted-foreground">{s.label}</p>
            <p className={`text-xl sm:text-2xl font-bold mt-0.5 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Per-type cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {filtered.map((b) => {
          const colors = TYPE_COLORS[b.leaveType] || TYPE_COLORS.annual;
          const label = b.label || TYPE_LABELS[b.leaveType] || b.leaveType;
          const entitled = b.entitledDays || 0;
          const used = b.usedDays || 0;
          const pending = b.pendingDays || 0;
          const remaining = b.balanceDays || 0;
          const usedPct = entitled > 0 ? Math.min(100, Math.round((used / entitled) * 100)) : 0;
          const pendingPct = entitled > 0 ? Math.min(100 - usedPct, Math.round((pending / entitled) * 100)) : 0;

          return (
            <div key={b.leaveType} className="rounded-lg border border-border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${colors.bg}`} />
                  <span className="text-sm font-semibold text-foreground">{label}</span>
                </div>
                <span className={`text-sm font-bold tabular-nums ${remaining <= 3 && entitled > 0 ? "text-amber-600 dark:text-amber-400" : colors.text}`}>
                  {remaining}<span className="text-xs font-normal text-muted-foreground">/{entitled}</span>
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden flex">
                {used > 0 && <div className={`h-full ${colors.bg}`} style={{ width: `${usedPct}%` }} />}
                {pending > 0 && <div className={`h-full ${colors.bg} opacity-40`} style={{ width: `${pendingPct}%` }} />}
              </div>

              {/* Detail row */}
              <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                <span>Used: <span className="font-medium text-foreground">{used}</span></span>
                {pending > 0 && <span>Pending: <span className="font-medium text-amber-600 dark:text-amber-400">{pending}</span></span>}
                {(b.carryOver || 0) > 0 && <span>Carry-over: <span className="font-medium text-foreground">{b.carryOver}</span></span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================
// REQUEST HISTORY SECTION
// ============================================
async function LeaveRequestHistory({ partyId, searchParams }) {
  const params = await searchParams;
  const status = params?.status || "";
  const currentYear = new Date().getFullYear();
  const year = params?.year || String(currentYear);
  const page = parseInt(params?.page || "1");

  const { leaveRequests, pagination } = await getLeaveRequests({
    page,
    limit: 10,
    status,
    partyId,
    year,
  });

  // Year options: current year and 2 previous
  const yearOptions = [currentYear, currentYear - 1, currentYear - 2];

  return (
    <div className="space-y-3">
      {/* Filters row */}
      <div className="flex flex-col sm:flex-row gap-2">
        {/* Status filter */}
        <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1 shadow-sm flex-1">
          {[
            { value: "", label: "All" },
            { value: "submitted", label: "Pending" },
            { value: "approved", label: "Approved" },
            { value: "rejected", label: "Rejected" },
          ].map((tab) => (
            <Link
              key={tab.value}
              href={`?status=${tab.value}&year=${year}`}
              className={`shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors ${
                status === tab.value || (!status && tab.value === "")
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>

        {/* Year filter */}
        <div className="flex gap-1 rounded-lg border border-border bg-card p-1 shadow-sm shrink-0">
          {yearOptions.map((y) => (
            <Link
              key={y}
              href={`?status=${status}&year=${y}`}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                year === String(y)
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {y}
            </Link>
          ))}
        </div>
      </div>

      {leaveRequests.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <Clock className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            {status ? `No ${status} leave requests` : "No leave requests yet"}
          </p>
          <Link href="/dashboard/hr/leave/create" className="text-sm text-primary hover:underline mt-2 inline-block">
            Request your first leave →
          </Link>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card shadow-sm divide-y divide-border">
          {leaveRequests.map((leave) => {
            const typeColors = TYPE_COLORS[leave.leaveType] || TYPE_COLORS.annual;
            return (
              <Link
                key={leave._id}
                href={`/dashboard/hr/leave/${leave._id}`}
                className="flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors"
              >
                {/* Type indicator */}
                <div className={`w-9 h-9 rounded-lg ${typeColors.light} flex items-center justify-center shrink-0`}>
                  <Calendar className={`h-4 w-4 ${typeColors.text}`} />
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground capitalize">{leave.leaveType}</span>
                    <StatusBadge status={leave.status} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatDate(leave.dates?.from)} – {formatDate(leave.dates?.to)}
                    <span className="mx-1.5">·</span>
                    {leave.dates?.totalDays} {leave.dates?.totalDays === 1 ? "day" : "days"}
                  </p>
                </div>

                {/* Arrow */}
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </Link>
            );
          })}

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 text-sm">
              <p className="text-xs text-muted-foreground">{pagination.total} requests</p>
              <div className="flex gap-2">
                {pagination.page > 1 && (
                  <Link href={`?page=${pagination.page - 1}&status=${status}&year=${year}`} className="rounded border border-border px-3 py-1 text-xs hover:bg-accent">
                    Previous
                  </Link>
                )}
                {pagination.page < pagination.totalPages && (
                  <Link href={`?page=${pagination.page + 1}&status=${status}&year=${year}`} className="rounded border border-border px-3 py-1 text-xs hover:bg-accent">
                    Next
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// MAIN PAGE
// ============================================
async function MyLeaveContent({ searchParams }) {
  const profile = await getMyEmployeeProfile();

  if (!profile) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
        <Calendar className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <p className="font-medium text-foreground">No employee profile found</p>
        <p className="text-sm text-muted-foreground mt-1">Contact HR to set up your employee profile.</p>
      </div>
    );
  }

  const balances = Array.isArray(profile.leaveBalances) ? profile.leaveBalances : [];

  return (
    <div className="space-y-8">
      {/* Balances */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Balances</h2>
        <LeaveBalances balances={balances} gender={profile.gender} />
      </section>

      {/* Request history */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">My Requests</h2>
        <LeaveRequestHistory partyId={profile.partyId} searchParams={searchParams} />
      </section>
    </div>
  );
}

export default async function MyLeavePage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">My Leave</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Your balances and leave history</p>
        </div>
        <Button size="sm" asChild>
          <Link href="/dashboard/hr/leave/create">
            <Plus className="h-4 w-4 mr-1" />
            <span className="hidden sm:inline">Request Leave</span>
            <span className="sm:hidden">New</span>
          </Link>
        </Button>
      </div>

      <Suspense
        fallback={
          <div className="space-y-6">
            <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 4].map((i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />)}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />)}
            </div>
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />)}
            </div>
          </div>
        }
      >
        <MyLeaveContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
