import { getProjectTasks } from "@/app/db/actions/project-actions";
import { getWorkspaceContext } from "../lib/workspace";
import WorkspaceHeader from "../components/WorkspaceHeader";
import NoProjectsCard from "../components/NoProjectsCard";
import AccessDenied from "../components/AccessDenied";
import ImportProgramme from "../components/ImportProgramme";
import { Card } from "@/components/ui/card";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, Flag, Target, ListChecks } from "lucide-react";

export const metadata = {
  title: "Programme | Projects",
  description: "Gantt schedule of a project's programme of works",
};

// One colour per section, cycled — the QaliTrack phase-colour look.
const SECTION_COLORS = ["#2e6fb0", "#c8960c", "#1f6b45", "#7c5cbf", "#c05621", "#0e7490", "#b03a5b"];

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}
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
function fmtMonthYear(d) {
  return d.toLocaleDateString("en-KE", { month: "short", year: "2-digit" });
}
function fmtLong(d) {
  return d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";
}

export default async function ProgrammePage({ searchParams }) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(sp);
  if (ctx.denied) return <AccessDenied />;

  const { projects, project } = ctx;

  if (!project) {
    return (
      <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <WorkspaceHeader title="Programme" description="Gantt schedule of a project's programme of works." project={null} projects={projects} />
        <NoProjectsCard />
      </div>
    );
  }

  const tasks = await getProjectTasks(project.id);

  // ── Group into sections (top-level tasks) and their dated activities ──────
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const rootOf = (t) => {
    let c = t;
    let guard = 0;
    while (c.parentTaskId && byId.get(c.parentTaskId) && guard++ < 30) c = byId.get(c.parentTaskId);
    return c;
  };
  const topLevel = tasks
    .filter((t) => !t.parentTaskId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const actsByRoot = new Map();
  for (const t of tasks) {
    if (t.plannedStart && t.plannedEnd) {
      const r = rootOf(t);
      if (!actsByRoot.has(r.id)) actsByRoot.set(r.id, []);
      actsByRoot.get(r.id).push(t);
    }
  }
  const sortActs = (arr) =>
    [...arr].sort(
      (a, b) =>
        (a.plannedStart || "").localeCompare(b.plannedStart || "") ||
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );

  // Build the render list of { section, color, activities[] }
  const groups = [];
  topLevel.forEach((section, i) => {
    const color = SECTION_COLORS[i % SECTION_COLORS.length];
    const dated = sortActs((actsByRoot.get(section.id) || []).filter((a) => a.id !== section.id));
    if (dated.length > 0) {
      groups.push({ section, color, activities: dated, selfBar: null });
    } else if (section.plannedStart && section.plannedEnd) {
      groups.push({ section, color, activities: [], selfBar: section });
    } else {
      groups.push({ section, color, activities: [], selfBar: null });
    }
  });

  const allDated = tasks.filter((t) => t.plannedStart && t.plannedEnd);
  const starts = allDated.map((t) => new Date(t.plannedStart));
  const ends = allDated.map((t) => new Date(t.plannedEnd));
  const rangeStart = project.startDate ? new Date(project.startDate) : starts.length ? new Date(Math.min(...starts)) : null;
  const rangeEnd = project.endDate ? new Date(project.endDate) : ends.length ? new Date(Math.max(...ends)) : null;
  const hasRange = rangeStart && rangeEnd && rangeEnd > rangeStart;
  const months = hasRange ? monthLabels(rangeStart, rangeEnd) : [];
  const totalMonths = months.length || 1;
  const durationMonths = hasRange
    ? Math.max(1, Math.round((rangeEnd - rangeStart) / (30.44 * 86400000)))
    : 0;

  function Bar({ task, color }) {
    const start = new Date(task.plannedStart);
    const end = new Date(task.plannedEnd);
    const left = Math.max((monthIndex(start, rangeStart) / totalMonths) * 100, 0);
    const rawWidth = ((monthIndex(end, rangeStart) - monthIndex(start, rangeStart)) / totalMonths) * 100;
    const width = Math.min(Math.max(rawWidth, 1.2), 100 - left);
    const pct = Math.max(0, Math.min(100, task.progressPercent ?? 0));
    return (
      <div
        className="absolute top-1/2 -translate-y-1/2 h-5 rounded-[5px] overflow-hidden"
        style={{ left: `${Math.min(left, 99)}%`, width: `${width}%`, background: `${color}44`, border: `1px solid ${color}` }}
        title={`${task.title}: ${task.plannedStart} → ${task.plannedEnd} · ${pct}%`}
      >
        <div className="h-full rounded-[4px]" style={{ width: `${pct}%`, background: color }} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <WorkspaceHeader
        title="Programme"
        description="The programme of works as a Gantt — sections and their activities across the schedule."
        project={project}
        projects={projects}
      />

      {/* Header strip: start / target / duration / activities + import */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <Meta icon={Flag} label="Start" value={fmtLong(rangeStart)} />
          <Meta icon={Target} label="Target end" value={fmtLong(rangeEnd)} tone="text-yellow-600" />
          <Meta icon={CalendarDays} label="Duration" value={durationMonths ? `${durationMonths} months` : "—"} />
          <Meta icon={ListChecks} label="Activities" value={String(allDated.length)} />
          <div className="ml-auto flex items-center gap-2">
            <ImportProgramme projectId={project.id} />
            <Link href={`/dashboard/projects/${project.id}`} className="text-sm text-primary hover:underline inline-flex items-center gap-1">
              Manage tasks <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        {!hasRange || groups.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No programme yet.{" "}
            <span className="text-foreground font-medium">Import a programme</span> (a .csv or .xlsx of
            Section / Activity / Start / End / %), or set planned dates on tasks, to see the Gantt here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div style={{ minWidth: `${Math.max(totalMonths * 66 + 224, 640)}px` }}>
              {/* Month header */}
              <div className="flex bg-muted/50 border-b border-border sticky top-0 z-20">
                <div className="w-56 shrink-0 px-3 py-2.5 text-xs font-semibold text-muted-foreground border-r border-border sticky left-0 bg-muted/50 z-10">
                  Activity
                </div>
                <div className="flex flex-1">
                  {months.map((m, i) => (
                    <div key={i} className="flex-1 text-center py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground border-r border-border last:border-r-0">
                      {fmtMonthYear(m)}
                    </div>
                  ))}
                </div>
              </div>

              {/* Groups */}
              {groups.map(({ section, color, activities, selfBar }) => (
                <div key={section.id}>
                  {/* Section header row */}
                  <div className="flex border-b border-border bg-muted/30">
                    <div className="w-56 shrink-0 px-3 py-2 border-r border-border sticky left-0 bg-muted/30 z-10 flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: color }} />
                      <span className="text-[11px] font-bold uppercase tracking-wider truncate" style={{ color }}>
                        {section.title}
                      </span>
                    </div>
                    <div className="flex-1 relative py-2">
                      {selfBar && <Bar task={selfBar} color={color} />}
                    </div>
                  </div>

                  {/* Activity rows */}
                  {activities.map((a) => (
                    <div key={a.id} className="flex border-b border-border last:border-0 hover:bg-muted/20">
                      <div className="w-56 shrink-0 px-3 py-2 text-[13px] border-r border-border sticky left-0 bg-card z-10 flex items-center truncate" title={a.title}>
                        <span className="truncate">{a.title}</span>
                        {a.progressPercent > 0 && (
                          <span className="ml-auto pl-2 text-[10px] tabular-nums text-muted-foreground shrink-0">{a.progressPercent}%</span>
                        )}
                      </div>
                      <div className="flex-1 relative py-2.5">
                        <Bar task={a} color={color} />
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Meta({ icon: Icon, label, value, tone }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={`h-4 w-4 ${tone || "text-muted-foreground"}`} />
      <div className="leading-tight">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`text-sm font-semibold ${tone || "text-foreground"}`}>{value}</div>
      </div>
    </div>
  );
}
