import { getProjectCertificates } from "@/app/db/actions/project-actions";
import { getWorkspaceContext } from "../lib/workspace";
import WorkspaceHeader from "../components/WorkspaceHeader";
import NoProjectsCard from "../components/NoProjectsCard";
import AccessDenied from "../components/AccessDenied";
import SectionNotForType from "../components/SectionNotForType";
import CertificateRegister from "../components/CertificateRegister";
import {
  hasRole,
  PROJECT_MANAGE_ROLES,
  FINANCE_WRITE_ROLES,
} from "@/lib/utils/role-gates";

export const metadata = {
  title: "IPC & Payments | Projects",
  description: "Interim payment certificates issued against a project's contract",
};

/**
 * Interim payment certificates — 0081, and this page's third shape.
 *
 * It was a view over the invoices and bills tagged to a project, opening with a
 * banner admitting formal certificates were not a module yet. They are now: the
 * contract carries the terms, the certificate carries the valuation, and
 * certifying raises a DRAFT invoice.
 *
 * CASH REQUISITIONS IS STILL A SEPARATE SECTION, and that is deliberate. The
 * two used to run the identical pair of queries, and the temptation was to
 * collapse them — but an IPC is EXTERNAL (contractor → engineer → employer) and
 * a valuation, while a cash requisition is INTERNAL (site → head office) and
 * usually a forecast. They are different documents for different readers. See
 * PROJECTS-QALITRACK-PLAN.md §7 open question 1 and §9.5.
 *
 * WHO MAY DO WHAT. A project manager prepares a certificate; FINANCE certifies
 * it and raises the invoice — the same split as drafting versus approving a
 * budget, and awarding a bill of quantities.
 */
export default async function IpcPaymentsPage({ searchParams }) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(sp, { detail: true, section: "certificates" });
  if (ctx.denied) return <AccessDenied />;
  if (ctx.hidden) {
    return (
      <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <SectionNotForType
          section="IPC & Payments"
          project={ctx.project}
          typeName={ctx.typeName}
        />
      </div>
    );
  }

  const { projects, project, user } = ctx;

  const data = project ? await getProjectCertificates(project.id) : null;

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <WorkspaceHeader
        title="IPC & Payments"
        description="What has been certified against this project's contract, and what is still held."
        project={project}
        projects={projects}
      />

      {!project && (
        <NoProjectsCard notFound={ctx.notFound} requestedId={sp?.project} />
      )}

      {project && (
        <CertificateRegister
          projectId={project.id}
          contract={data?.contract ?? null}
          certificates={data?.certificates ?? []}
          position={data?.position ?? null}
          basis={data?.basis ?? null}
          boq={data?.boq ?? null}
          canManage={hasRole(user, PROJECT_MANAGE_ROLES)}
          canCertify={hasRole(user, FINANCE_WRITE_ROLES)}
        />
      )}
    </div>
  );
}
