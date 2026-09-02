import Link from "next/link";
import { getWorkspaceContext } from "../../projects/lib/workspace";
import AccessDenied from "../../projects/components/AccessDenied";
import NoProjectsCard from "../../projects/components/NoProjectsCard";
import TechnicalReportForm from "../components/TechnicalReportForm";
import { hasRole, WORKFLOW_REPORT_WRITE_ROLES } from "@/lib/utils/role-gates";
import { templateByCode } from "../lib/templates";
import { ArrowLeft } from "lucide-react";

export const metadata = {
  title: "New report | Technical",
};

export default async function CreateReportPage({ searchParams }) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(sp);
  if (ctx.denied) return <AccessDenied />;

  const { projects, project, user } = ctx;
  const canManage = hasRole(user, WORKFLOW_REPORT_WRITE_ROLES);
  const template = templateByCode(sp?.sheet) || templateByCode("TR01");

  const backHref = `/dashboard/technical/new${project ? `?project=${project.id}` : ""}`;

  return (
    <>
      <div className="tech-bar">
        <Link href={backHref} className="tech-btn-ghost">
          <ArrowLeft size={14} />
          Choose sheet
        </Link>
        <span className="tech-bar-title" style={{ marginLeft: 4 }}>
          {template.name}
          <span className="count">{template.code}</span>
        </span>
      </div>

      <div className="tech-wrap">
        {!project && <NoProjectsCard />}
        {project && !canManage && <AccessDenied />}
        {project && canManage && (
          <>
            <p className="tech-lead">
              {template.desc} Filled by: <strong>{template.who}</strong>.
            </p>
            <TechnicalReportForm
              sheet={template}
              projects={projects}
              defaultProjectId={project.id}
              defaultAuthorName={user?.name || ""}
            />
          </>
        )}
      </div>
    </>
  );
}
