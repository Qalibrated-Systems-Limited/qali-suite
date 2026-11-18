import Link from "next/link";
import { getWorkspaceContext } from "../projects/lib/workspace";
import AccessDenied from "../projects/components/AccessDenied";
import Registry from "./components/Registry";
import { getAllWorkflowReports } from "@/app/db/actions/workflow-report-actions";
import { Plus } from "lucide-react";

export const metadata = {
  title: "Report registry | Technical",
  description: "Every QSL field-service report, searchable across projects",
};

/**
 * The registry is the whole company's reports, every project, so a search
 * finds a report without first knowing which project it was filed against.
 * Arriving with ?project= (from a project page or the old links) starts
 * filtered to that project.
 */
export default async function TechnicalRegistryPage({ searchParams }) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(sp);
  if (ctx.denied) return <AccessDenied />;

  const { projects, project, user } = ctx;
  const reports = await getAllWorkflowReports();

  return (
    <>
      <div className="tech-bar">
        <span className="tech-bar-spacer" />
        <Link href={`/dashboard/technical/new${project ? `?project=${project.id}` : ""}`} className="tech-btn-gold">
          <Plus size={14} strokeWidth={3} />
          New report
        </Link>
      </div>

      <div className="app-content wide">
        <Registry
          reports={reports}
          projects={projects}
          initialProjectId={sp?.project ? project?.id || "" : ""}
          role={user?.role || ""}
        />
      </div>
    </>
  );
}
