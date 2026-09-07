import { getWorkspaceContext } from "../lib/workspace";
import WorkspaceHeader from "../components/WorkspaceHeader";
import NoProjectsCard from "../components/NoProjectsCard";
import AccessDenied from "../components/AccessDenied";
import SectionNotForType from "../components/SectionNotForType";
import BoqRegister from "../components/BoqRegister";
import {
  getProjectBoq,
  getCostCodes,
  getProjectTasks,
} from "@/app/db/actions/project-actions";
import {
  hasRole,
  PROJECT_MANAGE_ROLES,
  FINANCE_WRITE_ROLES,
} from "@/lib/utils/role-gates";

export const metadata = {
  title: "Bill of Quantities | Projects",
  description: "The priced bill a project's work is measured against",
};

/**
 * The bill of quantities — 0080.
 *
 * `detail` — this page reads `project.contractValue`, which the switcher row
 * does not carry: for a remeasured contract the priced bill total IS the
 * contract sum, and a difference between the two is worth surfacing.
 *
 * AWARDING IS FINANCE'S, editing is the project manager's. Same split as the
 * budget, and for the same reason — awarding fixes the contract sum and
 * freezes every rate in the bill.
 */
export default async function BoqPage({ searchParams }) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(sp, { detail: true, section: "boq" });
  if (ctx.denied) return <AccessDenied />;
  if (ctx.hidden) {
    return (
      <div className="flex flex-col gap-4 p-4 sm:p-5 lg:p-6">
        <SectionNotForType
          section="Bill of Quantities"
          project={ctx.project}
          typeName={ctx.typeName}
        />
      </div>
    );
  }

  const { projects, project, user } = ctx;

  const [boqData, costCodes, tasks] = project
    ? await Promise.all([
        getProjectBoq(project.id),
        getCostCodes(project.id),
        getProjectTasks(project.id),
      ])
    : [null, [], []];

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:p-6">
      <WorkspaceHeader
        title="Bill of Quantities"
        description="The priced bill this project's work is measured against — and where progress stops being a typed percentage."
        project={project}
        projects={projects}
      />

      {!project && (
        <NoProjectsCard
          notFound={ctx.notFound}
          unselected={ctx.unselected}
          requestedId={sp?.project}
        />
      )}

      {project && (
        <BoqRegister
          projectId={project.id}
          boq={boqData?.boq ?? null}
          items={boqData?.items ?? []}
          summary={boqData?.summary ?? null}
          versions={boqData?.versions ?? []}
          contractValue={project.contractValue ?? null}
          costCodes={costCodes}
          tasks={tasks}
          canManage={hasRole(user, PROJECT_MANAGE_ROLES)}
          canAward={hasRole(user, FINANCE_WRITE_ROLES)}
        />
      )}
    </div>
  );
}
