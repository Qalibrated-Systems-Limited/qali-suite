import Link from "next/link";
import { getWorkspaceContext } from "../lib/workspace";
import WorkspaceHeader from "../components/WorkspaceHeader";
import NoProjectsCard from "../components/NoProjectsCard";
import AccessDenied from "../components/AccessDenied";
import SectionNotForType from "../components/SectionNotForType";
import MethodologyBoard from "./MethodologyBoard";
import { getMethodologyData } from "@/app/db/actions/methodology-actions";
import {
  getProjectBoq,
  getProjectMilestones,
  getProjectTasks,
} from "@/app/db/actions/project-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";
import { hasRole, PROJECT_MANAGE_ROLES } from "@/lib/utils/role-gates";

export const metadata = {
  title: "Methodology | Projects",
  description: "The implementation method statement, created once the budget is approved",
};

/**
 * The implementation methodology — created once the project's budget is
 * APPROVED. Finance creates the project, the department manager creates the
 * budget and gets it approved, and only then is there something to write a
 * method statement against. Gated on the approved budget; the sections sit
 * alongside the Bill of Quantities, Milestones and Programme they plan for.
 */
export default async function MethodologyPage({ searchParams }) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(sp, { section: "methodology" });
  if (ctx.denied) return <AccessDenied />;
  if (ctx.hidden) {
    return (
      <div className="flex flex-col gap-4 p-4 sm:p-5 lg:p-6">
        <SectionNotForType section="Methodology" project={ctx.project} typeName={ctx.typeName} />
      </div>
    );
  }

  const { projects, project, user } = ctx;

  const [data, boqData, milestoneData, tasks] = project
    ? await Promise.all([
        getMethodologyData(project.id),
        getProjectBoq(project.id),
        getProjectMilestones(project.id),
        getProjectTasks(project.id),
      ])
    : [null, null, null, []];

  const links = {
    boqTotal: boqData?.summary?.billed ?? 0,
    boqItems: boqData?.summary?.itemCount ?? 0,
    milestoneCount: (milestoneData?.milestones ?? []).length,
    milestoneValue: (milestoneData?.milestones ?? []).reduce((s, m) => s + Number(m.value || 0), 0),
    taskCount: (tasks ?? []).length,
  };

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:p-6">
      <WorkspaceHeader
        title="Methodology"
        description="How the works will be delivered — the implementation method statement, alongside the bill, milestones and programme it plans for."
        project={project}
        projects={projects}
      />

      {!project && (
        <NoProjectsCard notFound={ctx.notFound} unselected={ctx.unselected} requestedId={sp?.project} />
      )}

      {/*
        Gated on an approved budget: the methodology is the implementation plan
        for a budget that has been signed off, so there is nothing to write one
        against until the department manager's budget is approved.
      */}
      {project && !data?.budgetApproved && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>
              The methodology is created once the project's budget is approved.
              Create the budget and get it approved first.
            </span>
            <Button asChild size="sm" variant="outline" className="shrink-0">
              <Link href={`/dashboard/projects/${project.id}`}>Go to budget</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {project && data?.budgetApproved && (
        <MethodologyBoard
          projectId={project.id}
          methodology={data.methodology}
          links={links}
          canManage={hasRole(user, PROJECT_MANAGE_ROLES)}
          readOnly={project.status === "closed"}
        />
      )}
    </div>
  );
}
