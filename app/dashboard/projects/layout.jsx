import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PlanGate } from "@/components/plan-gate-boundary";
import ProjectControlNav from "./components/ProjectControlNav";
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
   * The Project Control workspace — the template's grouped sidebar replaces the
   * old per-section tab strip. The sidebar is a client component that reads the
   * selected project from `?project=`, so the layout hands it nothing.
   */
  return (
    <PlanGate module="projects" feature="Project Management">
      <div className="flex flex-col md:flex-row">
        {/* `useSearchParams` in the nav needs a Suspense boundary, or the whole
            module opts out of static rendering. */}
        <Suspense fallback={<div className="shrink-0 border-b border-border bg-card md:min-h-screen md:w-60 md:border-b-0 md:border-r" />}>
          <ProjectControlNav />
        </Suspense>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </PlanGate>
  );
}
