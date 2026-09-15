import { Suspense } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpRight } from "lucide-react";
import ProjectSwitcher from "./ProjectSwitcher";

// Same status vocabulary as app/dashboard/projects/[id]/page.jsx's
// STATUS_CONFIG, kept in sync so a project reads the same way everywhere.
const STATUS_CONFIG = {
  planning: { label: "Planning", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  active: { label: "Active", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  on_hold: { label: "On Hold", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  completed: { label: "Completed", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  closed: { label: "Closed", color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" },
};

/**
 * Header shared by every project-scoped section under the Projects module:
 * section title + description on the left, project switcher + a link to the
 * full project record on the right. The switcher is a client component that
 * reads `useSearchParams`, so it's wrapped in Suspense here to keep this
 * header itself a plain server component.
 */
export default function WorkspaceHeader({ title, description, project, projects }) {
  const statusCfg = project ? STATUS_CONFIG[project.status] || STATUS_CONFIG.planning : null;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1 min-w-0">
        <h1 className="text-xl sm:text-2xl font-semibold text-foreground">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground max-w-2xl">{description}</p>
        )}
      </div>

      {/*
        THE PROJECT IS NAMED ONCE.

        A block here used to print the number, the name and the status — and
        the switcher to its right prints the number and the name too, because
        a combobox has to show its own selection. On a phone the header stacks,
        so you got:

            PRJ-00003
            KTDA Unmanned Weighbridge Installation
            Planning
            PRJ-00003
            KTDA Unmanned Weighbridge Installation
            Full project

        — six lines to say one job, above every section in the module. The
        switcher already names it, so what was missing beside it was the one
        thing the switcher does not show: the status. That moves here and the
        duplicate goes.
      */}
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <Suspense fallback={<div className="h-10 w-full sm:w-72 rounded-md border bg-muted/40 animate-pulse" />}>
          <ProjectSwitcher projects={projects} selectedId={project?.id} />
        </Suspense>
        {statusCfg && (
          <Badge className={`${statusCfg.color} shrink-0`}>{statusCfg.label}</Badge>
        )}
        {project && (
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link href={`/dashboard/projects/${project.id}`}>
              Full project
              <ArrowUpRight className="h-4 w-4 ml-1" />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
