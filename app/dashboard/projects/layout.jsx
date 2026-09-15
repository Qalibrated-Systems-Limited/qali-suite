import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PlanGate } from "@/components/plan-gate-boundary";
import ProjectsNav from "./components/ProjectsNav";
import { workspaceProjects } from "./lib/workspace";
import { canSeeProjectsNav } from "@/lib/permissions";
import { Suspense } from "react";

/**
 * Projects is a Professional module, and only its LIST page checked that.
 * `/dashboard/projects/[id]` and `/dashboard/projects/create` had no gate, so
 * the upgrade prompt on the list was a sign on an unlocked door — any project
 * could still be opened, and a new one created, by URL.
 *
 * The list page keeps its own `checkPlanAccess` call; it is harmless now and
 * costs one cached session read.
 *
 * ProjectsNav renders the module's sticky sub-navigation (Overview, Bill of
 * Quantities, Programme, Engineer's Instructions, Site Diary, Timesheets,
 * IPC & Payments, Cash Requisitions) above every page in the module — the same
 * pattern HR uses for its own sub-nav. It mirrors the "Projects" dropdown in
 * components/sidebar-content-grouped.jsx, so the same EIGHT destinations are
 * reachable from either place.
 *
 * Not ten: `/milestones` and `/forms` are redirects now and the Monthly Report
 * is an action on the project record, because a nav entry must own records and
 * those three did not. See PROJECTS-QALITRACK-PLAN.md §10.3. Timesheets is the
 * one that came back — it owns `project_timesheets`, and it was reachable only
 * by opening a project and scrolling past eight cards.
 */
export default async function ProjectsLayout({ children }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  /**
   * The nav needs every project's section flags, because a layout does not
   * receive `searchParams` and so cannot know which project is selected — the
   * client component applies `selectProject` instead, the same rule the pages
   * use. `workspaceProjects` is React-cached, so the page below this does not
   * repeat the query.
   *
   * Skipped entirely for a role that cannot see projects: the pages render
   * their own Access Denied, and fetching a list for somebody who may not read
   * it is work done to be thrown away.
   */
  const projects = canSeeProjectsNav(session.user.role)
    ? await workspaceProjects()
    : [];

  /**
   * What the switcher last remembered, read here rather than in the nav.
   *
   * The nav is a client component, and reading `document.cookie` during its
   * render would disagree with what the server rendered — a hydration
   * mismatch. A server component may READ a cookie freely; it is only WRITING
   * one that it cannot do, which is why the switcher writes it.
   *
   * Without this the sections vanished from the nav on the dashboard, because
   * that URL carries no `?project=` and is not a project path — even though
   * every section page still knew perfectly well which project was chosen.
   */

  return (
    <PlanGate module="projects" feature="Project Management">
      <div className="flex flex-col">
        {/* `useSearchParams` in the nav needs a Suspense boundary, or the whole
            module opts out of static rendering. */}
        <Suspense fallback={<div className="h-12 border-b border-border bg-card" />}>
          <ProjectsNav projects={projects} />
        </Suspense>
        <main className="flex-1">{children}</main>
      </div>
    </PlanGate>
  );
}
