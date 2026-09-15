import { Suspense } from "react";
import { getWorkspaceContext } from "../lib/workspace";
import WorkspaceHeader from "../components/WorkspaceHeader";
import NoProjectsCard from "../components/NoProjectsCard";
import AccessDenied from "../components/AccessDenied";
import MonthSelector from "../components/MonthSelector";
import ReportNotes from "../components/ReportNotes";
import { getProjectProgress, getProjectFinancialSummary } from "@/app/db/actions/project-actions";
import {
  getDiarySummaryForRange,
  getInstructionsSummary,
} from "@/app/db/actions/project-log-actions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FileSpreadsheet,
  TrendingUp,
  Wallet,
  BookOpen,
  FileEdit,
  AlertTriangle,
} from "lucide-react";

export const metadata = {
  title: "Monthly Report | Projects",
  description: "The monthly progress report for a project",
};

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0));
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

function fmt(n) {
  return new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(n || 0);
}

function Stat({ label, value, tone }) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-600"
      : tone === "negative"
      ? "text-red-600"
      : tone === "warning"
      ? "text-amber-600"
      : "text-foreground";
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

export default async function MonthlyReportPage({ searchParams }) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(sp);
  if (ctx.denied) return <AccessDenied />;

  const { projects, project } = ctx;
  const month = sp?.month || currentMonth();
  const { from, to } = monthRange(month);

  const [progress, financials, diary, instructions] = project
    ? await Promise.all([
        getProjectProgress(project.id),
        getProjectFinancialSummary(project.id),
        getDiarySummaryForRange(project.id, { from, to }),
        getInstructionsSummary(project.id),
      ])
    : [null, null, null, null];

  const monthLabel = new Date(from).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:p-6">
      <WorkspaceHeader
        title="Monthly Report"
        description="The consolidated monthly progress report, pulling together schedule, financial and site-record data for one reporting period."
        project={project}
        projects={projects}
      />

      {!project && <NoProjectsCard
          notFound={ctx.notFound}
          unselected={ctx.unselected}
          requestedId={sp?.project}
        />}

      {project && (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap print:hidden">
            <p className="text-sm text-muted-foreground">Reporting period</p>
            <Suspense fallback={<div className="h-10 w-56 rounded-md border bg-muted/40 animate-pulse" />}>
              <MonthSelector selected={month} />
            </Suspense>
          </div>

          <Card className="p-4 sm:p-5 space-y-1">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              <h2 className="font-semibold text-lg">
                Monthly Progress Report — {monthLabel}
              </h2>
            </div>
            <p className="text-sm text-muted-foreground">
              {project.projectNumber} · {project.name}
            </p>
          </Card>

          {/* Schedule progress — from the Milestone Tracker / Programme's task data */}
          <Card className="p-4 sm:p-5 space-y-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Schedule progress</h3>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-2.5 flex-1 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${progress?.percent === 100 ? "bg-emerald-500" : "bg-blue-500"}`}
                  style={{ width: `${progress?.percent ?? 0}%` }}
                />
              </div>
              <span className="text-sm font-medium tabular-nums w-12 text-right">
                {progress?.percent ?? 0}%
              </span>
            </div>
            {progress?.source === "measured" ? (
              <p className="text-xs text-muted-foreground">
                Measured against the bill of quantities — KES {fmt(progress.measuredValue)}{" "}
                of KES {fmt(progress.billedValue)} certified as done.
              </p>
            ) : progress?.source === "tasks" ? (
              <p className="text-xs text-muted-foreground">
                {progress.doneCount} of {progress.taskCount} programme tasks complete.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                No work breakdown tasks yet — this is the project&apos;s typed-in overall progress.
              </p>
            )}
          </Card>

          {/* Financial summary — from IPC & Payments */}
          <Card className="p-4 sm:p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Financial summary</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Stat label="Invoiced to date" value={`KES ${fmt(financials?.revenue)}`} tone="positive" />
              <Stat label="Billed by suppliers" value={`KES ${fmt(financials?.costs)}`} tone="negative" />
              <Stat label="Committed" value={`KES ${fmt(financials?.committed)}`} />
              <Stat
                label="Budget utilization"
                value={`${financials?.budgetUtilization ?? 0}%`}
                tone={financials?.budgetUtilization > 90 ? "warning" : undefined}
              />
            </div>
          </Card>

          {/* Site diary highlights — from Site Diary, this period only */}
          <Card className="p-4 sm:p-5 space-y-4">
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Site diary — this period</h3>
            </div>
            {diary?.entryCount > 0 ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <Stat label="Entries logged" value={diary.entryCount} />
                  <Stat label="Avg. manpower/day" value={diary.avgManpower} />
                  <Stat
                    label="Incidents"
                    value={diary.totalIncidents}
                    tone={diary.totalIncidents > 0 ? "negative" : undefined}
                  />
                  <Stat
                    label="Awaiting sign-off"
                    value={diary.unsignedCount}
                    tone={diary.unsignedCount > 0 ? "warning" : undefined}
                  />
                </div>
                {diary.incidentDays.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    {diary.incidentDays.map((d) => (
                      <div key={d.id} className="flex items-start gap-2 text-sm">
                        <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                        <span>
                          <span className="font-medium">{d.diaryDate}</span>
                          {d.incidentNotes ? ` — ${d.incidentNotes}` : ` — ${d.incidentCount} incident(s) logged`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No diary entries logged for this period.</p>
            )}
          </Card>

          {/* Instructions highlights — from Engineer's Instructions, all-time totals */}
          <Card className="p-4 sm:p-5 space-y-4">
            <div className="flex items-center gap-2">
              <FileEdit className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Engineer's instructions</h3>
            </div>
            {instructions?.total > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="Total logged" value={instructions.total} />
                <Stat label="Pending" value={instructions.pending} tone={instructions.pending > 0 ? "warning" : undefined} />
                <Stat label="Complied" value={instructions.complied} tone="positive" />
                <Stat label="Non-conformances" value={instructions.ncrs} tone={instructions.ncrs > 0 ? "negative" : undefined} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No instructions logged for this project yet.</p>
            )}
            {instructions?.pending > 0 && (
              <Badge variant="outline" className="text-xs">
                {instructions.pending} instruction{instructions.pending === 1 ? "" : "s"} still awaiting a compliance decision
              </Badge>
            )}
          </Card>

          <ReportNotes />
        </>
      )}
    </div>
  );
}
