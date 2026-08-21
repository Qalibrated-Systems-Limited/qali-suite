import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Calendar, Plus, ChevronRight } from "lucide-react";
import { getMyLeave } from "@/app/db/actions/hr-leave-actions";

export const metadata = { title: "My leave | HR" };

const day = (d) =>
  d
    ? new Date(`${d}T00:00:00`).toLocaleDateString("en-KE", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

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
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${map[status] || "bg-muted text-muted-foreground"}`}
    >
      {status}
    </span>
  );
}

async function MyLeave() {
  const { employee, requests, balances } = await getMyLeave();

  if (!employee) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-500/5 p-8 text-center shadow-sm dark:border-amber-900">
        <Calendar className="mx-auto mb-3 h-10 w-10 text-amber-500" />
        <p className="font-medium text-amber-700 dark:text-amber-400">
          You do not have an employee record yet
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask HR to create one. Leave, payslips and attendance all hang off it.
        </p>
      </div>
    );
  }

  const consuming = balances.filter((b) => b.affectsBalance);
  const pendingCount = requests.filter((r) => r.status === "submitted").length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {consuming.map((b) => (
          <div key={b.leaveTypeId} className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <p className="text-sm text-muted-foreground">{b.name}</p>
            <p
              className={`mt-1 text-3xl font-bold ${
                b.availableDays <= 0
                  ? "text-red-600 dark:text-red-400"
                  : "text-foreground"
              }`}
            >
              {b.availableDays}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              days available
              {b.pendingDays > 0 && ` · ${b.pendingDays} awaiting a decision`}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {b.entitledDays + b.carryOverDays} granted · {b.takenDays} taken
            </p>
          </div>
        ))}
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-foreground">My requests</h2>
          {pendingCount > 0 && (
            <p className="text-sm text-muted-foreground">
              {pendingCount} awaiting a decision
            </p>
          )}
        </div>

        {requests.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-10 text-center shadow-sm">
            <Calendar className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">You have not requested any leave yet.</p>
            <Link
              href="/dashboard/hr/leave/create"
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> Request leave
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border bg-card shadow-sm">
            {requests.map((r) => (
              <Link
                key={r.id}
                href={`/dashboard/hr/leave/${r.id}`}
                className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">{r.leaveTypeName}</p>
                    <StatusBadge status={r.status} />
                    {!r.isPaid && (
                      <span className="text-xs text-muted-foreground">unpaid</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {day(r.fromDate)} – {day(r.toDate)} · {r.totalDays}{" "}
                    {r.totalDays === 1 ? "day" : "days"}
                  </p>
                  {r.status === "rejected" && r.rejectionReason && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                      {r.rejectionReason}
                    </p>
                  )}
                  {r.status === "draft" && (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                      Not sent yet — open it to submit for approval.
                    </p>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default async function MyLeavePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">My leave</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">
            What you have left, and what you have asked for
          </p>
        </div>
        <Link
          href="/dashboard/hr/leave/create"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Request leave</span>
          <span className="sm:hidden">Request</span>
        </Link>
      </div>

      <Suspense
        fallback={
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
            <div className="h-64 animate-pulse rounded-lg bg-muted" />
          </div>
        }
      >
        <MyLeave />
      </Suspense>
    </div>
  );
}
