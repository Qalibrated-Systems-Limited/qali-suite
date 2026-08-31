import {
  getProjectTasks,
} from "@/app/db/actions/project-actions";
import { getWorkspaceContext } from "../lib/workspace";
import WorkspaceHeader from "../components/WorkspaceHeader";
import NoProjectsCard from "../components/NoProjectsCard";
import AccessDenied from "../components/AccessDenied";
import { Card } from "@/components/ui/card";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export const metadata = {
  title: "Programme | Projects",
  description: "Schedule view of a project's planned tasks and milestones",
};

const BAR_COLOR = {
  todo: "bg-muted-foreground/40",
  in_progress: "bg-yellow-500",
  blocked: "bg-red-500",
  done: "bg-emerald-500",
  cancelled: "bg-muted-foreground/25",
};

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

export default async function ProgrammePage({ searchParams }) {
  const sp = await searchParams;
  // `detail` — the timeline range comes from `project.startDate` /
  // `project.endDate`, which the switcher row does not carry.
  const ctx = await getWorkspaceContext(sp, { detail: true });
  if (ctx.denied) return <AccessDenied />;

  const { projects, project } = ctx;

  if (!project) {
    return (
      <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <WorkspaceHeader
          title="Programme"
          description="Schedule view of a project's planned tasks and milestones."
          project={null}
          projects={projects}
        />
        <NoProjectsCard notFound={ctx.notFound} requestedId={sp?.project} />
      </div>
    );
  }

  const tasks = await getProjectTasks(project.id);
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
      <WorkspaceHeader
        title="Programme"
        description="Schedule view of a project's planned tasks and milestones."
        project={project}
        projects={projects}
      />

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
          <Link
            href={`/dashboard/projects/${project.id}`}
            className="text-sm text-primary hover:underline inline-flex items-center gap-1 shrink-0"
          >
            Manage tasks
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
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
    </div>
  );
}
