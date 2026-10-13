import {
  getProjectCertificates,
  getProjectVariations,
  getVariationItems,
} from "@/app/db/actions/project-actions";
import { getProjectInstructions } from "@/app/db/actions/project-log-actions";
import { getWorkspaceContext } from "../lib/workspace";
import WorkspaceHeader from "../components/WorkspaceHeader";
import NoProjectsCard from "../components/NoProjectsCard";
import AccessDenied from "../components/AccessDenied";
import VariationRegister from "../components/VariationRegister";
import { hasRole, PROJECT_MANAGE_ROLES, FINANCE_WRITE_ROLES } from "@/lib/utils/role-gates";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Variations & claims | Projects" };

/**
 * Variations & claims — the "Money in" screen. A variation changes what the
 * client owes you; this is where the contract sum moves. Reuses the variation
 * register that also appears on the certificates screen, on its own page to
 * match the template's navigation.
 */
export default async function VariationsPage({ searchParams }) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(sp, { detail: true, section: "certificates" });
  if (ctx.denied) return <AccessDenied />;

  const { projects, project, user } = ctx;

  const [data, variationData, instructions, variationItems] = project
    ? await Promise.all([
        getProjectCertificates(project.id),
        getProjectVariations(project.id),
        getProjectInstructions(project.id),
        getVariationItems(project.id),
      ])
    : [null, null, [], {}];

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:p-6">
      <WorkspaceHeader
        title="Variations & claims"
        description="A variation changes what the client owes you. Original contract, what has been approved, the revised total and anything pending a decision."
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

      {project && data?.contract && (
        <VariationRegister
          projectId={project.id}
          contract={data.contract}
          variations={variationData?.variations ?? []}
          summary={variationData?.summary ?? null}
          instructions={instructions ?? []}
          items={variationItems ?? {}}
          boqItems={data?.boq?.items ?? []}
          canManage={hasRole(user, PROJECT_MANAGE_ROLES)}
          canDecide={hasRole(user, FINANCE_WRITE_ROLES)}
          readOnly={project.status === "closed"}
        />
      )}

      {project && !data?.contract && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Enter the contract terms on the Certificates &amp; retention screen
          before raising variations — a variation is measured against the
          contract sum.
        </Card>
      )}
    </div>
  );
}
