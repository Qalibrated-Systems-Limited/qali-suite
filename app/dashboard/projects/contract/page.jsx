import Link from "next/link";
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
          {/* Technicians, vehicles and test equipment for the contract are
              requested from the technical manager, who approves them. */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm">
            <span className="text-muted-foreground">
              Need a technician, a vehicle or test equipment for this contract? The technical manager approves it.
            </span>
            <Link
              className="font-semibold text-primary hover:underline"
              href={`/dashboard/technical/resources?source=contract&sourceId=${project.id}&ref=${encodeURIComponent(project.projectNumber || "")}&title=${encodeURIComponent(`Contract — ${project.name || ""}`)}`}
            >
              Request resources →
            </Link>
          </div>
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
