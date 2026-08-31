import Link from "next/link";
import { Suspense } from "react";
import { getWorkspaceContext } from "../../projects/lib/workspace";
import AccessDenied from "../../projects/components/AccessDenied";
import NoProjectsCard from "../../projects/components/NoProjectsCard";
import ProjectSwitcher from "../../projects/components/ProjectSwitcher";
import { hasRole, WORKFLOW_REPORT_WRITE_ROLES } from "@/lib/utils/role-gates";
import { SHEETS } from "../lib/meta";

export const metadata = {
  title: "Choose the sheet | Technical",
  description: "Pick a QSL report sheet to start a new report",
};

export default async function ChooseSheetPage({ searchParams }) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(sp);
  if (ctx.denied) return <AccessDenied />;

  const { projects, project, user } = ctx;
  const canManage = hasRole(user, WORKFLOW_REPORT_WRITE_ROLES);
  const projectQ = project ? `&project=${project.id}` : "";

  return (
    <>
      <div className="tech-bar">
        <span className="tech-bar-title">
          Start a new report
          {project ? <span className="count">{project.name}</span> : null}
        </span>
        <span className="tech-bar-spacer" />
        <Suspense fallback={null}>
          <ProjectSwitcher projects={projects} selectedId={project?.id} />
        </Suspense>
      </div>

      <div className="tech-wrap">
        {!project && <NoProjectsCard />}

        {project && !canManage && <AccessDenied />}

        {project && canManage && (
          <>
            <p className="tech-section-label">Choose the sheet</p>
            <p className="tech-lead">Pick what you are doing today.</p>
            <div className="tech-sheets">
              {SHEETS.map((s) => (
                <Link
                  key={s.code}
                  href={`/dashboard/technical/create?sheet=${s.code}${projectQ}`}
                  className="tech-sheet"
                >
                  <div className="tech-sheet-head">
                    <span className="tech-sheet-name">{s.name}</span>
                    <span className="tech-sheet-code">{s.code}</span>
                  </div>
                  <p className="tech-sheet-blurb">{s.blurb}</p>
                  <span className="tech-sheet-by">Filled by: {s.filledBy}</span>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
