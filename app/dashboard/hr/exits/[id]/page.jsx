import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, FileText, ScrollText } from "lucide-react";
import { getExitForPage, listExitPostingAccounts } from "@/app/db/actions/hr-exit-actions";
import { can } from "@/lib/capabilities";
import { ExitStatusBadge } from "../components/ExitStatusBadge";
import ExitForm from "../components/ExitForm";
import ExitClearance from "../components/ExitClearance";
import DuesStatement from "../components/DuesStatement";
import ExitActions from "../components/ExitActions";

export const metadata = { title: "Exit | HR" };

const formatDate = (d) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" }) : "—";

function Fact({ label, children }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{children}</dd>
    </div>
  );
}

export default async function ExitPage({ params }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.role;
  if (!(can(role, "exit.manage") || can(role, "exit.approve") || can(role, "exit.pay"))) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const data = await getExitForPage(id);
  if (!data) notFound();

  const { exit, employee, clearance, dues, can: allowed } = data;
  const editable = exit.status === "draft" && allowed.manage;
  const accounts = editable ? await listExitPostingAccounts() : [];
  const clearanceOpen = clearance.filter((c) => c.status === "pending").length;
  const settled = exit.status === "approved" || exit.status === "paid";

  return (
    <div className="max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/exits" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Exits
        </Link>
        <span>/</span>
        <span className="font-mono text-foreground">{exit.exitNumber}</span>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-bold text-foreground sm:text-2xl">{employee?.fullName}</h1>
            <ExitStatusBadge status={exit.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href={`/dashboard/hr/employees/${employee?.id}`} className="hover:underline">
              {employee?.employeeNumber}
            </Link>
            {employee?.designation ? ` · ${employee.designation}` : ""}
            {employee?.department ? ` · ${employee.department}` : ""}
          </p>
        </div>
        <ExitActions exit={exit} can={allowed} netPay={dues.totals.net} clearanceOpen={clearanceOpen} />
      </div>

      {exit.status === "draft" && !allowed.approve && clearanceOpen === 0 && (
        <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          The clearance is complete. Finance approves the final dues, which posts them and ends the employment.
        </p>
      )}

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Fact label="Exit type">{exit.exitTypeLabel}</Fact>
          <Fact label="Hired">{formatDate(employee?.hireDate)}</Fact>
          <Fact label="Notice given">{formatDate(exit.noticeDate)}</Fact>
          <Fact label="Last working day">{formatDate(exit.lastWorkingDate)}</Fact>
          <Fact label="Notice period">{exit.noticePeriodDays} days</Fact>
          {dues.live && (
            <Fact label="Notice served">
              {dues.noticeServedDays} day(s){dues.noticeShortfallDays ? `, ${dues.noticeShortfallDays} short` : ""}
            </Fact>
          )}
          {dues.live && <Fact label="Untaken leave">{dues.untakenLeaveDays} day(s)</Fact>}
          <Fact label="Monthly gross">
            KES {(employee?.monthlyGross || 0).toLocaleString("en-KE", { minimumFractionDigits: 2 })}
          </Fact>
        </dl>
        {exit.reason && (
          <p className="mt-4 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Reason (internal):</span> {exit.reason}
          </p>
        )}
        {exit.exitInterviewNotes && (
          <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Exit interview:</span> {exit.exitInterviewNotes}
          </p>
        )}
        {exit.status === "cancelled" && (
          <p className="mt-4 text-sm text-muted-foreground">
            Cancelled by {exit.cancelledByName}: {exit.cancellationReason}
          </p>
        )}
        {settled && (
          <p className="mt-4 text-xs text-muted-foreground">
            Approved by {exit.approvedByName} on {new Date(exit.approvedAt).toLocaleDateString("en-KE")}
            {exit.status === "paid" && exit.paidAt
              ? ` · paid ${new Date(exit.paidAt).toLocaleDateString("en-KE")}${exit.paymentReference ? ` (${exit.paymentReference})` : ""}`
              : ""}
          </p>
        )}
      </section>

      {settled && (
        <section className="flex flex-wrap gap-2">
          <a
            href={`/api/hr/exits/${exit.id}/statement`}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent"
          >
            <FileText className="h-4 w-4" /> Final dues statement (PDF)
          </a>
          <a
            href={`/api/hr/employees/${employee?.id}/certificate-of-service`}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent"
          >
            <ScrollText className="h-4 w-4" /> Certificate of service (PDF)
          </a>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <ExitClearance exitId={exit.id} items={clearance} editable={editable} />
        <DuesStatement exitId={exit.id} dues={dues} editable={editable} accounts={accounts} />
      </div>

      {editable && (
        <details className="rounded-lg border border-border bg-card shadow-sm">
          <summary className="cursor-pointer px-4 py-3 font-semibold text-foreground">Edit exit details</summary>
          <div className="border-t border-border p-4">
            <ExitForm exit={exit} />
          </div>
        </details>
      )}
    </div>
  );
}
