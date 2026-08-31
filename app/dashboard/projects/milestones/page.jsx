import { redirect } from "next/navigation";

/**
 * "Milestone Tracker" was a second view of `project_tasks` — and it did not
 * show milestones, because there is no milestone table in this schema. It has
 * become the Work breakdown view of the Programme; see
 * PROJECTS-QALITRACK-PLAN.md §10.3.
 *
 * The route stays as a redirect rather than being deleted, so a bookmark or a
 * link in somebody's email still lands on the right page with the right
 * project selected.
 */
export default async function MilestonesRedirect({ searchParams }) {
  const sp = await searchParams;
  const params = new URLSearchParams({ view: "list" });
  if (sp?.project) params.set("project", sp.project);
  redirect(`/dashboard/projects/programme?${params.toString()}`);
}
