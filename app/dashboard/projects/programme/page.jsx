import {
  getProjectTasks,
  getProjectProgress,
} from "@/app/db/actions/project-actions";
import { getWorkspaceContext } from "../lib/workspace";
import WorkspaceHeader from "../components/WorkspaceHeader";
import NoProjectsCard from "../components/NoProjectsCard";
import AccessDenied from "../components/AccessDenied";
import SectionNotForType from "../components/SectionNotForType";
import { Card } from "@/components/ui/card";
import Link from "next/link";
import {
  ArrowUpRight,
  CheckCircle2,
  CircleDot,
  Circle,
  AlertTriangle,
  XCircle,
} from "lucide-react";

export const metadata = {
  title: "Programme | Projects",
  description: "The work breakdown and schedule for a project",
};

/**
 * The programme — ONE section over `project_tasks`, with two views.
 *
 * WHAT THIS ABSORBED. There were two pages: "Milestone Tracker" and
 * "Programme", both reading the same table, neither introducing a record type,
 * beside the Work breakdown card on the project detail page — so one table had
 * three doors and a person adding a task had three places it might appear.
 *
 * And the Milestone Tracker DID NOT SHOW MILESTONES. There is no milestone
 * table in this schema; it showed tasks. A section named after a thing the
 * database does not have is the same defect as a figure read from a key that
 * does not exist — it looks right, nothing errors, and it is wrong. So the
 * views are named for what they are: the work breakdown, and the schedule.
 *
 * `/dashboard/projects/milestones` redirects here, so no saved link breaks.
 * See PROJECTS-QALITRACK-PLAN.md §10.3.
 */

// Same task-status vocabulary as project_task_status in app/db/schema/enums.ts.
const STATUS_CONFIG = {
  todo: { label: "Not started", icon: Circle, color: "text-muted-foreground", bar: "bg-muted-foreground/40" },
  in_progress: { label: "In progress", icon: CircleDot, color: "text-yellow-600 dark:text-yellow-400", bar: "bg-yellow-500" },
  blocked: { label: "Blocked", icon: AlertTriangle, color: "text-red-600 dark:text-red-400", bar: "bg-red-500" },
  done: { label: "Done", icon: CheckCircle2, color: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500" },
  cancelled: { label: "Cancelled", icon: XCircle, color: "text-muted-foreground", bar: "bg-muted-foreground/30" },
};

const BAR_COLOR = {
  todo: "bg-muted-foreground/40",
  in_progress: "bg-yellow-500",
  blocked: "bg-red-500",
  done: "bg-emerald-500",
  cancelled: "bg-muted-foreground/25",
};

function formatDate(date) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-KE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

// Fractional "months since the range start" — used for BOTH the month
// header ticks and the task bars, so a bar always lines up under the month
// it actually falls in even though the header ticks are drawn evenly
// spaced rather than strictly proportional to days-in-month.
function monthIndex(date, rangeStart) {
  return (
    (date.getFullYear() - rangeStart.getFullYear()) * 12 +
    (date.getMonth() - rangeStart.getMonth()) +
    (date.getDate() - 1) / daysInMonth(date)
  );
}

function monthLabels(rangeStart, rangeEnd) {
  const labels = [];
  let cur = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  const last = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1);
  while (cur <= last) {
    labels.push(new Date(cur));
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return labels;
}

function StatCard({ label, value, tone }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone || "text-foreground"}`}>{value}</p>
    </div>
  );
}

/** The two views, as links rather than client state — each is a real URL. */
function ViewTabs({ view, projectId }) {
  const base = "/dashboard/projects/programme";
  const q = (v) =>
    projectId ? `${base}?project=${projectId}&view=${v}` : `${base}?view=${v}`;
  const tab = (v, label) => (
    <Link
      key={v}
      href={q(v)}
      className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
        view === v
          ? "bg-background shadow-sm font-medium text-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
      {tab("list", "Work breakdown")}
      {tab("gantt", "Schedule")}
    </div>
  );
}

export default async function ProgrammePage({ searchParams }) {
  const sp = await searchParams;
  // `detail` — the schedule's range comes from `project.startDate` /
  // `project.endDate`, which the switcher row does not carry.
  const ctx = await getWorkspaceContext(sp, { detail: true, section: "programme" });
  if (ctx.denied) return <AccessDenied />;
  if (ctx.hidden) {
    return (
      <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <SectionNotForType
          section="The programme"
          project={ctx.project}
          typeName={ctx.typeName}
        />
      </div>
    );
  }

  const { projects, project } = ctx;
  const view = sp?.view === "gantt" ? "gantt" : "list";

  const header = (
    <WorkspaceHeader
      title="Programme"
      description="The work breakdown and schedule for a single project."
      project={project}
      projects={projects}
    />
  );

  if (!project) {
    return (
      <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
        {header}
        <NoProjectsCard notFound={ctx.notFound} requestedId={sp?.project} />
      </div>
    );
  }

  const [tasks, progress] = await Promise.all([
    getProjectTasks(project.id),
    getProjectProgress(project.id),
  ]);

  const counts = tasks.reduce(
    (acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      return acc;
    },
    { todo: 0, in_progress: 0, blocked: 0, done: 0, cancelled: 0 },
  );

  const scheduled = tasks.filter((t) => t.plannedStart && t.plannedEnd);
  const starts = scheduled.map((t) => new Date(t.plannedStart));
  const ends = scheduled.map((t) => new Date(t.plannedEnd));

  /**
   * The range spans the CONTRACT dates AND the programme, rather than
   * whichever of the two was written first.
   *
   * Taking `project.startDate` as the left edge whenever it exists clipped
   * every task planned outside the contract dates — and an overrun past the
   * end date is exactly what a programme is read for. Those bars were pinned
   * to the right edge by the `Math.min(width, 100 - left)` clamp below, so a
   * task running three months late drew the same bar as one finishing on
   * time. The clamps stay as the guard they are; nothing should now reach
   * them.
   */
  const bounds = [
    ...starts,
    ...ends,
    ...(project.startDate ? [new Date(project.startDate)] : []),
    ...(project.endDate ? [new Date(project.endDate)] : []),
  ].filter((d) => !Number.isNaN(d.getTime()));

  const rangeStart = bounds.length ? new Date(Math.min(...bounds)) : null;
  const rangeEnd = bounds.length ? new Date(Math.max(...bounds)) : null;

  // `>=`, not `>`: a programme of one single-day task is a programme, and it
  // was told there was "nothing to schedule".
  const hasRange = rangeStart && rangeEnd && rangeEnd >= rangeStart;
  const months = hasRange ? monthLabels(rangeStart, rangeEnd) : [];
  const totalMonths = months.length || 1;

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      {header}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <ViewTabs view={view} projectId={project.id} />
        <Link
          href={`/dashboard/projects/${project.id}`}
          className="text-sm text-primary hover:underline inline-flex items-center gap-1 shrink-0"
        >
          Manage tasks
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Overall progress — on both views, because it is the answer the page
          exists to give and it does not change with the arrangement. */}
      <Card className="p-5 sm:p-6">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-muted-foreground">
            Overall progress
            {progress?.source === "tasks" && (
              <span className="ml-1.5">
                — earned from {progress.taskCount} task{progress.taskCount === 1 ? "" : "s"}
              </span>
            )}
            {progress?.source === "measured" && (
              <span className="ml-1.5">— measured against the bill of quantities</span>
            )}
          </span>
          <span className="font-semibold text-foreground">{progress?.percent ?? 0}%</span>
        </div>
        <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-yellow-500 transition-all"
            style={{ width: `${Math.min(progress?.percent ?? 0, 100)}%` }}
          />
        </div>
      </Card>

      {view === "list" ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatCard label="Total items" value={tasks.length} />
            <StatCard label="Not started" value={counts.todo} />
            <StatCard label="In progress" value={counts.in_progress} tone="text-yellow-600 dark:text-yellow-400" />
            <StatCard label="Blocked" value={counts.blocked} tone="text-red-600 dark:text-red-400" />
            <StatCard label="Done" value={counts.done} tone="text-emerald-600 dark:text-emerald-400" />
          </div>

          <Card className="p-5 sm:p-6">
            <h2 className="font-semibold text-lg mb-4">Work breakdown</h2>

            {tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">
                No tasks logged for this project yet.{" "}
                <Link href={`/dashboard/projects/${project.id}`} className="text-primary hover:underline">
                  Add the first one
                </Link>
                .
              </p>
            ) : (
              <div className="space-y-1">
                {tasks.map((t) => {
                  const cfg = STATUS_CONFIG[t.status] || STATUS_CONFIG.todo;
                  const StatusIcon = cfg.icon;
                  const isSummary = t.childCount > 0;
                  return (
                    <div
                      key={t.id}
                      className="flex items-center gap-3 py-2.5 border-b last:border-0"
                      style={{ paddingLeft: `${Math.min(t.depth, 4) * 20}px` }}
                    >
                      <StatusIcon className={`h-4 w-4 shrink-0 ${cfg.color}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm truncate ${isSummary ? "font-semibold" : "font-medium"}`}>
                            {t.title}
                          </span>
                          {t.assignedName && (
                            <span className="text-xs text-muted-foreground">— {t.assignedName}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                          <span>{cfg.label}</span>
                          {t.plannedEnd && <span>Target: {formatDate(t.plannedEnd)}</span>}
                        </div>
                      </div>
                      <div className="hidden sm:flex items-center gap-2 shrink-0 w-32">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${cfg.bar}`}
                            style={{ width: `${Math.min(t.rolledUpProgress ?? t.progressPercent ?? 0, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono text-muted-foreground w-9 text-right">
                          {Math.round(t.rolledUpProgress ?? t.progressPercent ?? 0)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      ) : (
        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-lg">Programme of works</h2>
              {hasRange && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {rangeStart.toLocaleDateString("en-KE", { month: "short", year: "numeric" })} –{" "}
                  {rangeEnd.toLocaleDateString("en-KE", { month: "short", year: "numeric" })}
                </p>
              )}
            </div>
          </div>

          {!hasRange || scheduled.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">
              No tasks with both a planned start and end date yet, so there is
              nothing to schedule.{" "}
              <Link href={`/dashboard/projects/${project.id}`} className="text-primary hover:underline">
                Set planned dates on a task
              </Link>{" "}
              to see it here.
            </p>
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <div style={{ minWidth: `${Math.max(totalMonths * 64, 480)}px` }}>
                {/* Month header */}
                <div className="flex bg-muted/40 border-b">
                  <div className="w-44 shrink-0 px-3 py-2 text-xs font-medium text-muted-foreground border-r">
                    Task
                  </div>
                  <div className="flex flex-1">
                    {months.map((m, i) => (
                      <div
                        key={i}
                        className="flex-1 text-center py-2 text-[10px] font-medium text-muted-foreground border-r last:border-r-0"
                      >
                        {m.toLocaleDateString("en-KE", { month: "short", year: "2-digit" })}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Rows */}
                {scheduled.map((t) => {
                  const start = new Date(t.plannedStart);
                  const end = new Date(t.plannedEnd);
                  const left = Math.max((monthIndex(start, rangeStart) / totalMonths) * 100, 0);
                  const rawWidth = ((monthIndex(end, rangeStart) - monthIndex(start, rangeStart)) / totalMonths) * 100;
                  const width = Math.max(rawWidth, 1.5);
                  const barColor = BAR_COLOR[t.status] || BAR_COLOR.todo;

                  return (
                    <div key={t.id} className="flex border-b last:border-0 min-h-10">
                      <div
                        className="w-44 shrink-0 px-3 py-2 text-xs border-r flex items-center truncate"
                        style={{ paddingLeft: `${12 + Math.min(t.depth, 4) * 10}px` }}
                        title={t.title}
                      >
                        {t.title}
                      </div>
                      <div className="flex-1 relative py-2">
                        <div
                          className={`absolute h-4 top-1/2 -translate-y-1/2 rounded ${barColor} opacity-90`}
                          style={{ left: `${Math.min(left, 99)}%`, width: `${Math.min(width, 100 - left)}%` }}
                          title={`${t.title}: ${t.plannedStart} → ${t.plannedEnd}`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
