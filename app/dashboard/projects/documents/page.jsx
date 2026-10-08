import { getWorkspaceContext } from "../lib/workspace";
import WorkspaceHeader from "../components/WorkspaceHeader";
import NoProjectsCard from "../components/NoProjectsCard";
import AccessDenied from "../components/AccessDenied";
import ProjectDocuments from "../components/ProjectDocuments";
import { getProjectDocuments } from "@/app/db/actions/project-document-actions";
import { hasRole, PROJECT_MANAGE_ROLES } from "@/lib/utils/role-gates";

export const metadata = { title: "Documents | Projects" };

/**
 * Every file the project carries — contract, BOQ, budget, drawings,
 * certificates, correspondence — uploaded and listed in one place.
 */
export default async function ProjectDocumentsPage({ searchParams }) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(sp, { detail: true });
  if (ctx.denied) return <AccessDenied />;

  const { projects, project, user } = ctx;
  const documents = project ? await getProjectDocuments(project.id) : [];

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:p-6">
      <WorkspaceHeader
        title="Documents"
        description="The contract, the BOQ, the budget, drawings and correspondence — every file this project carries, in one place."
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
        <ProjectDocuments
          projectId={project.id}
          documents={documents ?? []}
          canManage={
            hasRole(user, PROJECT_MANAGE_ROLES) && project.status !== "closed"
          }
        />
      )}
    </div>
  );
}
