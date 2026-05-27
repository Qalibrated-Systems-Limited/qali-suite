import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Calendar, User, Clock, FileText, CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import { getLeaveRequestById } from "@/app/mongodb/queries/hr-queries";
import { LeaveDetailActions } from "@/app/dashboard/hr/components/LeaveDetailActions";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const { leaveRequest } = await getLeaveRequestById(id);
  return { title: `${leaveRequest?.leaveNumber || "Leave Request"} | HR` };
}

const HR_ROLES = ["SuperAdmin", "Admin", "Manager", "HR", "Employee"];

function StatusBadge({ status }) {
  const map = {
    draft: "bg-muted text-muted-foreground",
    submitted: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    rejected: "bg-red-500/15 text-red-700 dark:text-red-400",
    recalled: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    completed: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    cancelled: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-sm font-medium capitalize ${map[status] || "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

function LeaveTypeBadge({ type }) {
  const map = {
    annual: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    sick: "bg-red-500/15 text-red-700 dark:text-red-400",
    maternity: "bg-pink-500/15 text-pink-700 dark:text-pink-400",
    paternity: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
    compassionate: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    study: "bg-teal-500/15 text-teal-700 dark:text-teal-400",
    unpaid: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${map[type] || "bg-muted text-muted-foreground"}`}>
      {type}
    </span>
  );
}

function InfoRow({ label, children }) {
  return (
    <div className="flex items-start justify-between py-3 border-b border-border last:border-0">
      <dt className="text-sm text-muted-foreground w-40 shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-foreground text-right flex-1">{children}</dd>
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
}

function TimelineEvent({ icon: Icon, iconClass, title, date, note }) {
  return (
    <div className="flex gap-3">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconClass}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 pt-0.5">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {date && <p className="text-xs text-muted-foreground">{formatDate(date)}</p>}
        {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      </div>
    </div>
  );
}

export default async function LeaveDetailPage({ params }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!HR_ROLES.includes(session.user.role)) redirect("/dashboard");

  const { leaveRequest: leave, error } = await getLeaveRequestById(id);
  if (!leave || error) notFound();

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-4xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/leave" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Leave
        </Link>
        <span>/</span>
        <span className="text-foreground font-mono">{leave.leaveNumber}</span>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-foreground sm:text-2xl">{leave.leaveNumber}</h1>
            <StatusBadge status={leave.status} />
            <LeaveTypeBadge type={leave.leaveType} />
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {leave.employee?.name}
            {leave.employee?.department ? <span className="hidden sm:inline"> · {leave.employee.department}</span> : null}
          </p>
        </div>
        <LeaveDetailActions leave={leave} userRole={session.user.role} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Left: Details ── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Leave dates */}
          <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Calendar className="h-4 w-4 text-muted-foreground" /> Leave Period
            </h2>
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              <div className="rounded-lg bg-muted/50 p-3 sm:p-4 text-center">
                <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide">From</p>
                <p className="mt-1 text-sm sm:text-base font-bold text-foreground">{formatDate(leave.dates?.from)}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 sm:p-4 text-center">
                <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide">To</p>
                <p className="mt-1 text-sm sm:text-base font-bold text-foreground">{formatDate(leave.dates?.to)}</p>
              </div>
              <div className="rounded-lg bg-primary/5 p-3 sm:p-4 text-center">
                <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide">Duration</p>
                <p className="mt-1 text-base sm:text-lg font-bold text-primary">
                  {leave.dates?.totalDays} {leave.dates?.totalDays === 1 ? "day" : "days"}
                </p>
                {leave.dates?.halfDay && <p className="text-xs text-muted-foreground">half day</p>}
              </div>
            </div>
          </div>

          {/* Reason */}
          {leave.reason && (
            <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <FileText className="h-4 w-4 text-muted-foreground" /> Reason
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{leave.reason}</p>
            </div>
          )}

          {/* Rejection reason */}
          {leave.status === "rejected" && leave.rejectionReason && (
            <div className="rounded-lg border border-red-200 bg-red-500/5 p-5 dark:border-red-900">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-400">
                <XCircle className="h-4 w-4" /> Rejection Reason
              </h2>
              <p className="text-sm text-red-700 dark:text-red-400 leading-relaxed">{leave.rejectionReason}</p>
            </div>
          )}

          {/* Balance snapshot */}
          {leave.balanceSnapshot && (() => {
            const entitled = leave.balanceSnapshot.entitledDays;
            const usedBefore = leave.balanceSnapshot.usedDaysBefore ?? leave.balanceSnapshot.usedDays;
            const balanceBefore = leave.balanceSnapshot.balanceBefore ?? leave.balanceSnapshot.balanceDays;
            const totalDays = leave.dates?.totalDays || 0;
            const usedAfter = usedBefore != null ? usedBefore + totalDays : null;
            const balanceAfter = balanceBefore != null ? balanceBefore - totalDays : null;

            return (
              <div className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-4">
                {/* Before */}
                <div>
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Balance before this leave
                  </h2>
                  <div className="grid grid-cols-3 gap-2 sm:gap-4 text-center text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Entitled</p>
                      <p className="mt-1 text-lg font-bold text-foreground">{entitled ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Used</p>
                      <p className="mt-1 text-lg font-bold text-foreground">{usedBefore ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Remaining</p>
                      <p className="mt-1 text-lg font-bold text-foreground">{balanceBefore ?? "—"}</p>
                    </div>
                  </div>
                </div>

                {/* Divider with leave days */}
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs font-medium text-primary bg-primary/10 px-2.5 py-0.5 rounded-full">
                    −{totalDays} day{totalDays !== 1 ? "s" : ""}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>

                {/* After */}
                <div>
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Balance after this leave
                  </h2>
                  <div className="grid grid-cols-3 gap-2 sm:gap-4 text-center text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Entitled</p>
                      <p className="mt-1 text-lg font-bold text-foreground">{entitled ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Used</p>
                      <p className="mt-1 text-lg font-bold text-foreground">{usedAfter ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Remaining</p>
                      <p className={`mt-1 text-lg font-bold ${balanceAfter != null && balanceAfter <= 3 ? "text-amber-600 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                        {balanceAfter ?? "—"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* ── Right: Employee + Timeline ── */}
        <div className="space-y-6">
          {/* Employee card */}
          <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
              <User className="h-4 w-4 text-muted-foreground" /> Employee
            </h2>
            <dl>
              <InfoRow label="Name">{leave.employee?.name || "—"}</InfoRow>
              <InfoRow label="Employee No.">
                <span className="font-mono text-xs">{leave.employee?.employeeNumber || "—"}</span>
              </InfoRow>
              <InfoRow label="Department">{leave.employee?.department || "—"}</InfoRow>
            </dl>
            {leave.employee?.profileId && (
              <Link
                href={`/dashboard/hr/employees/${leave.employee.profileId}`}
                className="mt-3 block text-center text-xs text-primary hover:underline"
              >
                View employee profile →
              </Link>
            )}
          </div>

          {/* Timeline */}
          <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Clock className="h-4 w-4 text-muted-foreground" /> Timeline
            </h2>
            <div className="space-y-4">
              <TimelineEvent
                icon={FileText}
                iconClass="bg-muted text-muted-foreground"
                title="Created"
                date={leave.createdAt}
              />
              {leave.submittedAt && (
                <TimelineEvent
                  icon={CheckCircle2}
                  iconClass="bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  title="Submitted for approval"
                  date={leave.submittedAt}
                />
              )}
              {leave.status === "approved" && leave.approvedAt && (
                <TimelineEvent
                  icon={CheckCircle2}
                  iconClass="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  title="Approved"
                  date={leave.approvedAt}
                />
              )}
              {leave.status === "rejected" && leave.rejectedAt && (
                <TimelineEvent
                  icon={XCircle}
                  iconClass="bg-red-500/15 text-red-600 dark:text-red-400"
                  title="Rejected"
                  date={leave.rejectedAt}
                  note={leave.rejectionReason}
                />
              )}
              {leave.status === "recalled" && (
                <TimelineEvent
                  icon={RotateCcw}
                  iconClass="bg-orange-500/15 text-orange-600 dark:text-orange-400"
                  title="Recalled"
                  date={leave.updatedAt}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
