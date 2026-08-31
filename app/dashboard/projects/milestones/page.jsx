import {
  getProjectTasks,
  getProjectProgress,
} from "@/app/db/actions/project-actions";
import { getWorkspaceContext } from "../lib/workspace";
import WorkspaceHeader from "../components/WorkspaceHeader";
import NoProjectsCard from "../components/NoProjectsCard";
import AccessDenied from "../components/AccessDenied";
import { Card } from "@/components/ui/card";
import Link from "next/link";
import {
  CheckCircle2,
  CircleDot,
  Circle,
  AlertTriangle,
  XCircle,
  ArrowUpRight,
} from "lucide-react";

export const metadata = {
  title: "Milestone Tracker | Projects",
  description: "Track a project's work breakdown and milestone progress",
};

// Same task-status vocabulary as project_task_status in app/db/schema/enums.ts.
const STATUS_CONFIG = {
  todo: { label: "Not started", icon: Circle, color: "text-muted-foreground", bar: "bg-muted-foreground/40" },
  in_progress: { label: "In progress", icon: CircleDot, color: "text-yellow-600 dark:text-yellow-400", bar: "bg-yellow-500" },
  blocked: { label: "Blocked", icon: AlertTriangle, color: "text-red-600 dark:text-red-400", bar: "bg-red-500" },
  done: { label: "Done", icon: CheckCircle2, color: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500" },
  cancelled: { label: "Cancelled", icon: XCircle, color: "text-muted-foreground", bar: "bg-muted-foreground/30" },
};

function formatDate(date) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-KE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function StatCard({ label, value, sub, tone }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone || "text-foreground"}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export default async function MilestonesPage({ searchParams }) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(sp);
  if (ctx.denied) return <AccessDenied />;

  const { projects, project } = ctx;

  if (!project) {
    return (
      <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <WorkspaceHeader
          title="Milestone Tracker"
          description="The work breakdown and progress for a single project."
          project={null}
          projects={projects}
        />
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

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <WorkspaceHeader
        title="Milestone Tracker"
        description="The work breakdown and progress for a single project."
        project={project}
        projects={projects}
      />

      {/* Overall progress */}
      <Card className="p-5 sm:p-6">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-muted-foreground">
            Overall progress
            {progress?.source === "tasks" && (
              <span className="ml-1.5">
                — earned from {progress.taskCount} task{progress.taskCount === 1 ? "" : "s"}
              </span>
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

      {/* Status breakdown */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatCard label="Total items" value={tasks.length} />
        <StatCard label="Not started" value={counts.todo} />
        <StatCard label="In progress" value={counts.in_progress} tone="text-yellow-600 dark:text-yellow-400" />
        <StatCard label="Blocked" value={counts.blocked} tone="text-red-600 dark:text-red-400" />
        <StatCard label="Done" value={counts.done} tone="text-emerald-600 dark:text-emerald-400" />
      </div>

      {/* Work breakdown / milestone list */}
      <Card className="p-5 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg">Work breakdown &amp; milestones</h2>
          <Link
            href={`/dashboard/projects/${project.id}`}
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            Manage tasks
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">
            No tasks or milestones logged for this project yet.{" "}
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
    </div>
  );
}
