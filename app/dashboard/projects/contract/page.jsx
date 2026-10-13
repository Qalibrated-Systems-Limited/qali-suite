import { getWorkspaceContext } from "../lib/workspace";
import WorkspaceHeader from "../components/WorkspaceHeader";
import NoProjectsCard from "../components/NoProjectsCard";
import AccessDenied from "../components/AccessDenied";
import ContractDataForm from "../components/ContractDataForm";
import InstructionsLog from "../components/InstructionsLog";
import { getProjectInstructions } from "@/app/db/actions/project-log-actions";
import {
  hasRole,
  PROJECT_MANAGE_ROLES,
  PROJECT_LOG_SIGNOFF_ROLES,
} from "@/lib/utils/role-gates";

export const metadata = { title: "Contract administration | Projects" };

/**
 * Contract administration — the contract data taken from the particular
 * conditions of contract, and the register of notices, claims and instructions
 * with the clock each one started.
 */
export default async function ContractPage({ searchParams }) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(sp, { detail: true });
  if (ctx.denied) return <AccessDenied />;

  const { projects, project, user } = ctx;
  const instructions = project ? await getProjectInstructions(project.id) : [];

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:p-6">
      <WorkspaceHeader
        title="Contract administration"
        description="Your conditions of contract, and every notice, claim and instruction with the clock it started."
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
        <>
          <ContractDataForm
            project={project}
            canManage={hasRole(user, PROJECT_MANAGE_ROLES) && project.status !== "closed"}
          />
          <InstructionsLog
            projectId={project.id}
            instructions={instructions ?? []}
            canManage={hasRole(user, PROJECT_MANAGE_ROLES) && project.status !== "closed"}
            canSignOff={hasRole(user, PROJECT_LOG_SIGNOFF_ROLES)}
          />
        </>
      )}
    </div>
  );
}
