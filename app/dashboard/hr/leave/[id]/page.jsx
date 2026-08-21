import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, CalendarDays, User } from "lucide-react";
import { getLeaveRequestForPage } from "@/app/db/actions/hr-leave-actions";
import { LeaveDetailActions } from "../../components/LeaveDetailActions";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const data = await getLeaveRequestForPage(id);
  return { title: data ? `${data.request.leaveNumber} | Leave` : "Leave request" };
}

const day = (d) =>
  d
    ? new Date(`${d}T00:00:00`).toLocaleDateString("en-KE", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

const stamp = (iso) =>
  iso ? new Date(iso).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—";

function StatusBadge({ status }) {
  const map = {
    draft: "bg-muted text-muted-foreground",
    submitted: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    rejected: "bg-red-500/15 text-red-700 dark:text-red-400",
    completed: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    cancelled: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize ${map[status] || "bg-muted text-muted-foreground"}`}
    >
      {status}
    </span>
  );
}

function InfoRow({ label, children }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{children}</span>
    </div>
  );
}

function Step({ label, who, date, note }) {
  return (
    <li className="border-l-2 border-border pl-4">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className="text-xs text-muted-foreground">
        {stamp(date)}
        {who ? ` · ${who}` : ""}
      </p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </li>
  );
}

export default async function LeaveDetailPage({ params }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const data = await getLeaveRequestForPage(id);
  if (!data) notFound();

  const { request: leave, balances, canApprove } = data;
  const balance = balances.find((b) => b.leaveTypeId === leave.leaveTypeId);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/leave" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Leave
        </Link>
        <span>/</span>
        <span className="font-mono text-foreground">{leave.leaveNumber}</span>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-foreground sm:text-2xl">
              {leave.leaveNumber}
            </h1>
            <StatusBadge status={leave.status} />
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {leave.leaveTypeName}
            </span>
            {!leave.isPaid && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                unpaid — deducted from pay
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {leave.employeeName}
            {leave.department && <span className="hidden sm:inline"> · {leave.department}</span>}
          </p>
        </div>

        <LeaveDetailActions
          leave={leave}
          userRole={session.user.role}
          canApprove={canApprove}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
              <CalendarDays className="h-4 w-4 text-muted-foreground" /> The dates
            </h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">From</p>
                <p className="mt-1 text-sm font-bold text-foreground sm:text-base">
                  {day(leave.fromDate)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">To</p>
                <p className="mt-1 text-sm font-bold text-foreground sm:text-base">
                  {day(leave.toDate)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Working days</p>
                <p className="mt-1 text-sm font-bold text-foreground sm:text-base">
                  {leave.totalDays} {leave.totalDays === 1 ? "day" : "days"}
                </p>
                {leave.isHalfDay && (
                  <p className="text-xs text-muted-foreground">
                    half day, {leave.halfDayPeriod}
                  </p>
                )}
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Weekends and public holidays are already excluded, and this is the
              count that was agreed — adding a holiday later does not change it.
            </p>
          </div>

          {leave.reason && (
            <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-2 font-semibold text-foreground">Reason</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{leave.reason}</p>
            </div>
          )}

          {leave.handoverName && (
            <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-2 font-semibold text-foreground">Handover</h2>
              <p className="text-sm text-foreground">{leave.handoverName}</p>
              {leave.handoverNotes && (
                <p className="mt-1 text-sm text-muted-foreground">{leave.handoverNotes}</p>
              )}
            </div>
          )}

          {leave.status === "rejected" && leave.rejectionReason && (
            <div className="rounded-lg border border-red-200 bg-red-500/5 p-5 dark:border-red-900">
              <h2 className="mb-2 font-semibold text-red-700 dark:text-red-400">
                Why it was rejected
              </h2>
              <p className="text-sm leading-relaxed text-red-700 dark:text-red-400">
                {leave.rejectionReason}
              </p>
            </div>
          )}

          {leave.status === "cancelled" && (
            <div className="rounded-lg border border-border bg-muted/30 p-5">
              <h2 className="mb-2 font-semibold text-foreground">Cancelled</h2>
              <p className="text-sm text-muted-foreground">
                {leave.cancellationReason || "No reason recorded."}
                {leave.cancelledByName && ` — ${leave.cancelledByName}`}
              </p>
            </div>
          )}

          {balance && leave.affectsBalance && (
            <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-3 font-semibold text-foreground">
                {leave.leaveTypeName} balance, right now
              </h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  ["Entitled", balance.entitledDays + balance.carryOverDays],
                  ["Taken", balance.takenDays],
                  ["Awaiting a decision", balance.pendingDays],
                  ["Available", balance.availableDays],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 text-lg font-bold text-foreground">{value}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Counted from the leave requests themselves, so it is what it says
                — including this one while it waits.
              </p>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-foreground">
              <User className="h-4 w-4 text-muted-foreground" /> Employee
            </h2>
            <InfoRow label="Name">{leave.employeeName}</InfoRow>
            <InfoRow label="Number">
              <span className="font-mono text-xs">{leave.employeeNumber}</span>
            </InfoRow>
            <InfoRow label="Department">{leave.department || "—"}</InfoRow>
            <InfoRow label="Designation">{leave.designation || "—"}</InfoRow>
            <Link
              href={`/dashboard/hr/employees/${leave.employeeId}`}
              className="mt-3 inline-block text-sm text-primary hover:underline"
            >
              Open their record
            </Link>
          </div>

          <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-foreground">What happened</h2>
            <ol className="space-y-3">
              <Step label="Raised" who={leave.createdByName} date={leave.createdAt} />
              {leave.recalledAt && (
                <Step
                  label="Recalled to draft"
                  date={leave.recalledAt}
                  note="Pulled back for editing before a decision."
                />
              )}
              {leave.submittedAt && (
                <Step label="Submitted" who={leave.submittedByName} date={leave.submittedAt} />
              )}
              {leave.approvedAt && (
                <Step label="Approved" who={leave.approvedByName} date={leave.approvedAt} />
              )}
              {leave.rejectedAt && (
                <Step
                  label="Rejected"
                  who={leave.rejectedByName}
                  date={leave.rejectedAt}
                  note={leave.rejectionReason}
                />
              )}
              {leave.completedAt && (
                <Step
                  label="Completed"
                  date={leave.completedAt}
                  note="The leave period has ended."
                />
              )}
              {leave.cancelledAt && (
                <Step
                  label="Cancelled"
                  who={leave.cancelledByName}
                  date={leave.cancelledAt}
                  note={leave.cancellationReason}
                />
              )}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
