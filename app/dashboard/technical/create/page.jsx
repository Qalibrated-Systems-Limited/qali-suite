import Link from "next/link";
import { getWorkspaceContext } from "../../projects/lib/workspace";
import AccessDenied from "../../projects/components/AccessDenied";
import NoProjectsCard from "../../projects/components/NoProjectsCard";
import TechnicalReportForm from "../components/TechnicalReportForm";
import { listReportSignoffUsers } from "@/app/db/actions/workflow-report-actions";
import { hasRole, WORKFLOW_REPORT_WRITE_ROLES } from "@/lib/utils/role-gates";
import { templateByCode } from "../lib/templates";
import { WAIT } from "../components/ui";

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
  const signoffUsers = canManage ? await listReportSignoffUsers().catch(() => []) : [];

  const backHref = `/dashboard/technical/new?work=${encodeURIComponent(template.category || "")}${project ? `&project=${project.id}` : ""}`;

  return (
    <div className="app-content">
      <Link href={backHref} style={{ color: WAIT, fontWeight: 700, fontSize: 13, textDecoration: "none", display: "inline-block", margin: "12px 0 8px" }}>
        ← Choose a different sheet
      </Link>
      {!project && <NoProjectsCard />}
      {project && !canManage && <AccessDenied />}
      {project && canManage && (
        <TechnicalReportForm
          sheet={template}
          projects={projects}
          defaultProjectId={project.id}
          defaultAuthorName={user?.name || ""}
          signoffUsers={signoffUsers}
          currentUserId={user?.id || null}
        />
      )}
    </div>
  );
}
