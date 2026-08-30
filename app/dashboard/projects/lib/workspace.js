import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canSeeProjectsNav } from "@/lib/permissions";
import {
  getActiveProjects,
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
 * `getActiveProjects()` is "the picker five other modules render" (its own
 * docstring) — reusing it keeps the switcher consistent with every other
 * project picker in the app, at the cost of only offering active projects
 * here for now.
 */
export async function getWorkspaceContext(searchParams) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { user } = session;

  if (!canSeeProjectsNav(user.role)) {
    return { denied: true, user, projects: [], project: null };
  }

  const projects = await getActiveProjects();

  const requestedId = searchParams?.project;
  const selectedId =
    (requestedId && projects.some((p) => p.id === requestedId)
      ? requestedId
      : projects[0]?.id) || null;

  const project = selectedId ? await getProjectById(selectedId) : null;

  return { denied: false, user, projects, project };
}
