import { getWorkspaceContext } from "../lib/workspace";
import WorkspaceHeader from "../components/WorkspaceHeader";
import NoProjectsCard from "../components/NoProjectsCard";
import AccessDenied from "../components/AccessDenied";
import SectionNotForType from "../components/SectionNotForType";
import DiaryLog from "../components/DiaryLog";
import { getProjectDiaryEntries } from "@/app/db/actions/project-log-actions";
import { hasRole, PROJECT_MANAGE_ROLES, PROJECT_LOG_SIGNOFF_ROLES } from "@/lib/utils/role-gates";

export const metadata = {
  title: "Site Diary | Projects",
  description: "Daily site diary entries for a project",
};

export default async function SiteDiaryPage({ searchParams }) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(sp, { section: "diary" });
  if (ctx.denied) return <AccessDenied />;
  if (ctx.hidden) {
    return (
      <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <SectionNotForType
          section="The site diary"
          project={ctx.project}
          typeName={ctx.typeName}
        />
      </div>
    );
  }

  const { projects, project, user } = ctx;

  const entries = project ? await getProjectDiaryEntries(project.id) : [];

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <WorkspaceHeader
        title="Site Diary"
        description="The contractor's daily record of weather, activities, plant, manpower and incidents on site."
        project={project}
        projects={projects}
      />

      {!project && <NoProjectsCard notFound={ctx.notFound} requestedId={sp?.project} />}

      {project && (
        <DiaryLog
          projectId={project.id}
          entries={entries}
          canManage={hasRole(user, PROJECT_MANAGE_ROLES)}
          canSignOff={hasRole(user, PROJECT_LOG_SIGNOFF_ROLES)}
        />
      )}
    </div>
  );
}
