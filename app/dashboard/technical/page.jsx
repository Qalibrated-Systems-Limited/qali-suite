import Link from "next/link";
import { Suspense } from "react";
import { getWorkspaceContext } from "../projects/lib/workspace";
import AccessDenied from "../projects/components/AccessDenied";
import NoProjectsCard from "../projects/components/NoProjectsCard";
import ProjectSwitcher from "../projects/components/ProjectSwitcher";
import RegistryBrowser from "./components/RegistryBrowser";
import { getWorkflowReports } from "@/app/db/actions/workflow-report-actions";
import { Plus } from "lucide-react";

export const metadata = {
  title: "Report registry | Technical",
  description: "QSL field-service reports raised against a project",
};

export default async function TechnicalRegistryPage({ searchParams }) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(sp);
  if (ctx.denied) return <AccessDenied />;

  const { projects, project } = ctx;
  const reports = project ? await getWorkflowReports(project.id) : [];

  return (
    <>
      <div className="tech-bar">
        <span className="tech-bar-title">
          Report registry
          <span className="count">
            {reports.length} report{reports.length === 1 ? "" : "s"}
            {project ? ` · ${project.name}` : ""}
          </span>
        </span>
        <span className="tech-bar-spacer" />
        <Suspense fallback={null}>
          <ProjectSwitcher projects={projects} selectedId={project?.id} />
        </Suspense>
        <Link
          href={`/dashboard/technical/new${project ? `?project=${project.id}` : ""}`}
          className="tech-btn-gold"
        >
          <Plus size={14} strokeWidth={3} />
          New report
        </Link>
      </div>

      <div className="tech-wrap">
        {!project && <NoProjectsCard />}
        {project && <RegistryBrowser reports={reports} projectId={project.id} />}
      </div>
    </>
  );
}
