import { cache } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canSeeProjectsNav } from "@/lib/permissions";
import {
  getProjectsForWorkspace,
  getProjectById,
} from "@/app/db/actions/project-actions";
import { selectProject, sectionsFor } from "./sections";

/**
 * The switcher's list, once per request.
 *
 * Both the module LAYOUT (which needs every project's section flags to draw the
 * nav) and every PAGE under it (which needs the list for the switcher) ask for
 * this, so without `cache` each render ran the query twice. React's `cache`
 * dedupes it within one request — see PROJECTS-QALITRACK-PLAN.md §10.
 */
export const workspaceProjects = cache(() => getProjectsForWorkspace());

/**
 * Shared context for the project-scoped pages in the Projects module.
 *
 * Each needs the same three things before it can render: an authenticated and
 * authorized session, the list of projects to offer in the switcher, and which
 * one is selected. Centralising it keeps that resolution — and the
 * plan-gate-mirroring role check the list page does on its own — in one place
 * instead of copied per page.
 *
 * EVERY PROJECT, not just the live ones. This used `getActiveProjects()` —
 * `status IN ('planning','active')` — which is right for a picker on a new
 * invoice and wrong here: a site diary and an instruction register are read
 * most AFTER a job finishes, for the final account or a dispute.
 *
 * The `?project=` rule and the section flags both live in `./sections`, because
 * the nav is a client component that needs the same two answers and a rule
 * stated twice is a rule that drifts.
 *
 * `detail` — the switcher row carries `id`, `projectNumber`, `name`, `status`
 * and the section flags, which is everything most pages read. `getProjectById`
 * additionally computes the live actuals, the effective budget and the progress
 * roll-up: three aggregate passes. Only the pages that need a field off the
 * full record ask for it.
 */
export async function getWorkspaceContext(
  searchParams,
  { detail = false, section = null } = {},
) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { user } = session;

  if (!canSeeProjectsNav(user.role)) {
    return {
      denied: true,
      hidden: false,
      user,
      projects: [],
      project: null,
      notFound: false,
      typeName: null,
      sections: sectionsFor(null),
    };
  }

  const projects = await workspaceProjects();
  const { project: summary, notFound } = selectProject(projects, searchParams?.project);

  const project =
    summary && detail ? await getProjectById(summary.id) : summary;

  /** From the summary row, which carries them, not from `getProjectById`. */
  const sections = sectionsFor(summary);

  return {
    denied: false,
    /**
     * This project's type excludes the section the page belongs to.
     *
     * The nav already hides it, and hiding a link is a sign on an unlocked
     * door — the same mistake the plan gate made when only the LIST page
     * checked it and any project could still be opened by URL. So the page
     * asks too, and a `section` that is not named here is not gated at all.
     */
    hidden: Boolean(section && summary && sections[section] === false),
    user,
    projects,
    project,
    notFound,
    typeName: summary?.typeName ?? null,
    sections,
  };
}
