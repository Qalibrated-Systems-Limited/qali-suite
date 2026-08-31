import { getWorkspaceContext } from "../lib/workspace";
import WorkspaceHeader from "../components/WorkspaceHeader";
import NoProjectsCard from "../components/NoProjectsCard";
import AccessDenied from "../components/AccessDenied";
import SectionNotForType from "../components/SectionNotForType";
import InstructionsLog from "../components/InstructionsLog";
import FormsReference from "../components/FormsReference";
import {
  getProjectInstructions,
  getInstructionsSummary,
} from "@/app/db/actions/project-log-actions";
import { hasRole, PROJECT_MANAGE_ROLES, PROJECT_LOG_SIGNOFF_ROLES } from "@/lib/utils/role-gates";

export const metadata = {
  title: "Engineer's Instructions | Projects",
  description: "Instructions and non-conformances issued by the supervising engineer",
};

export default async function InstructionsPage({ searchParams }) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(sp, { section: "instructions" });
  if (ctx.denied) return <AccessDenied />;
  if (ctx.hidden) {
    return (
      <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <SectionNotForType
          section="Engineer's Instructions"
          project={ctx.project}
          typeName={ctx.typeName}
        />
      </div>
    );
  }

  const { projects, project, user } = ctx;

  const [instructions, summary] = project
    ? await Promise.all([
        getProjectInstructions(project.id),
        getInstructionsSummary(project.id),
      ])
    : [[], null];

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <WorkspaceHeader
        title="Engineer's Instructions"
        description="Instructions and non-conformances issued by the supervising engineer or client representative, and the contractor's compliance status."
        project={project}
        projects={projects}
      />

      {!project && <NoProjectsCard notFound={ctx.notFound} requestedId={sp?.project} />}

      {project && (
        <InstructionsLog
          projectId={project.id}
          instructions={instructions}
          summary={summary}
          canManage={hasRole(user, PROJECT_MANAGE_ROLES)}
          canSignOff={hasRole(user, PROJECT_LOG_SIGNOFF_ROLES)}
        />
      )}

      {/* The Forms Register, which used to be its own nav entry. It reads
          beside the register rather than instead of it — four of the sixteen
          forms below are what `project_instructions` holds. §10.3. */}
      <FormsReference />
    </div>
  );
}
