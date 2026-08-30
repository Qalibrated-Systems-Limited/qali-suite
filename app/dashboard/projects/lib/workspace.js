import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canSeeProjectsNav } from "@/lib/permissions";
import {
  getProjectsForWorkspace,
  getProjectById,
} from "@/app/db/actions/project-actions";

/**
 * Shared context for the eight project-scoped module pages (Milestone
 * Tracker, Programme, Engineer's Instructions, Site Diary, Forms Register,
 * IPC & Payments, Cash Requisitions, Monthly Report).
 *
 * Each of those pages needs the same three things before it can render:
 * an authenticated + authorized session, the list of projects to offer in
 * the switcher, and which one is currently selected (from `?project=`, or
 * the first project when nothing is selected yet). Centralising it here
 * keeps that resolution — and the plan-gate-mirroring role check the list
 * page already does on its own — in one place instead of copied eight times.
 *
 * EVERY PROJECT, not just the live ones. This used `getActiveProjects()` —
 * `status IN ('planning','active')` — which is correct for a picker on a new
 * invoice and wrong here: a site diary and an instruction register are read
 * most AFTER a job finishes, for the final account or a dispute. Filtering to
 * live jobs made the records of every completed one unreachable.
 */
export async function getWorkspaceContext(searchParams) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { user } = session;

  if (!canSeeProjectsNav(user.role)) {
    return { denied: true, user, projects: [], project: null };
  }

  const projects = await getProjectsForWorkspace();

  /**
   * A `?project=` that names a project this tenant HAS is honoured, even when
   * it is not in the switcher's list — and the switcher now lists everything,
   * so that is a narrow case. The previous version fell back to `projects[0]`
   * silently, which meant a bookmarked link to a completed job's diary quietly
   * showed a DIFFERENT project's diary. A wrong answer that looks right is
   * worse than an empty one.
   *
   * `getProjectById` is RLS-scoped and carries the uuid guard, so a made-up or
   * another tenant's id comes back null rather than leaking or throwing.
   */
  const requestedId = searchParams?.project;
  const requested = requestedId ? await getProjectById(requestedId) : null;

  const project = requested ?? (projects[0] ? await getProjectById(projects[0].id) : null);

  return {
    denied: false,
    user,
    projects,
    project,
    /** The link named a project that is gone, or was never this tenant's. */
    notFound: Boolean(requestedId && !requested),
  };
}
