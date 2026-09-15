import {
  getProjectMilestones,
  getProjectMainContract,
} from "@/app/db/actions/project-actions";
import { getWorkspaceContext } from "../lib/workspace";
import WorkspaceHeader from "../components/WorkspaceHeader";
import NoProjectsCard from "../components/NoProjectsCard";
import AccessDenied from "../components/AccessDenied";
import SectionNotForType from "../components/SectionNotForType";
import MilestoneRegister from "../components/MilestoneRegister";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Info } from "lucide-react";
import { hasRole, PROJECT_MANAGE_ROLES } from "@/lib/utils/role-gates";

export const metadata = {
  title: "Milestones | Projects",
  description: "The stages this project is valued and paid against",
};

/**
 * The milestone schedule, with a section of its own again.
 *
 * ── Why it was folded away, and why that reason expired ────────────────────
 *
 * §10.3 cut "Milestone Tracker" from the navigation on a rule the module still
 * keeps — a nav entry must own records — and at the time it owned none: the
 * page was a second view of `project_tasks` and showed no milestones, because
 * there was no milestone table. **0093 built one.** The cut was right when it
 * was made and is wrong now, which is the only kind of decision worth
 * revisiting.
 *
 * It is also the MD's own view: `QaliTrack_PMS` lists "Milestone tracker"
 * second in its sidebar, and on an INSTALLATION contract it is the whole
 * valuation method — no bill to remeasure, just stages each worth an agreed
 * part of the sum.
 *
 * ── Two doors to one register, on purpose ──────────────────────────────────
 *
 * The same `MilestoneRegister` still renders on IPC & Payments, above the
 * variations, "in the order the money moves" — that is where you CONSULT the
 * schedule, with the certificate you are about to issue in front of you. This
 * is where you BUILD and maintain it. Same component, same records, same
 * revalidation; there is no second copy of anything to drift.
 *
 * ── Gated on `certificates`, and no migration for it ───────────────────────
 *
 * `project_types` has no `shows_milestones` column and does not need one: a
 * milestone exists to be valued and to release retention, both of which happen
 * on a certificate. A project type with nothing to certify has no stages to
 * bill, so the section follows the flag that already answers that question.
 */
export default async function MilestonesPage({ searchParams }) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(sp, { section: "milestones" });
  if (ctx.denied) return <AccessDenied />;
  if (ctx.hidden) {
    return (
      <div className="flex flex-col gap-4 p-4 sm:p-5 lg:p-6">
        <SectionNotForType
          section="Milestones"
          project={ctx.project}
          typeName={ctx.typeName}
        />
      </div>
    );
  }

  const { projects, project, user } = ctx;

  const [milestoneData, contract] = project
    ? await Promise.all([
        getProjectMilestones(project.id),
        getProjectMainContract(project.id),
      ])
    : [null, null];

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:p-6">
      <WorkspaceHeader
        title="Milestones"
        description="The stages this project is valued and paid against, and what each releases from retention."
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

      {/*
        A SCHEDULE NEEDS TERMS TO MEAN ANYTHING, and saying so beats rendering
        an empty register: a stage's value is checked against the contract sum
        and its release is a percentage OF the retention held, so without a
        contract there is nothing for either number to be a proportion of.
      */}
      {project && !contract && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>
              This project has no contract yet. Milestones are valued against
              the contract sum and release a share of the retention it holds, so
              enter the terms first.
            </span>
            <Button asChild size="sm" variant="outline" className="shrink-0">
              <Link href={`/dashboard/projects/ipc?project=${project.id}`}>
                Enter the terms
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {project && contract && (
        <MilestoneRegister
          projectId={project.id}
          contract={contract}
          milestones={milestoneData?.milestones ?? []}
          summary={milestoneData?.summary ?? null}
          canManage={hasRole(user, PROJECT_MANAGE_ROLES)}
          readOnly={project.status === "closed"}
        />
      )}
    </div>
  );
}
