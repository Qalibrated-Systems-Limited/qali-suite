import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PlanGate } from "@/components/plan-gate-boundary";
import ProjectsNav from "./components/ProjectsNav";

/**
 * Projects is a Professional module, and only its LIST page checked that.
 * `/dashboard/projects/[id]` and `/dashboard/projects/create` had no gate, so
 * the upgrade prompt on the list was a sign on an unlocked door — any project
 * could still be opened, and a new one created, by URL.
 *
 * The list page keeps its own `checkPlanAccess` call; it is harmless now and
 * costs one cached session read.
 *
 * ProjectsNav renders the module's sticky sub-navigation (Dashboard, Bill of
 * Quantities, Programme, Engineer's Instructions, Site Diary, IPC & Payments,
 * Cash Requisitions) above every page in the module — the same pattern HR uses
 * for its own sub-nav. It mirrors the "Projects" dropdown in
 * components/sidebar-content-grouped.jsx, so the same SEVEN destinations are
 * reachable from either place.
 *
 * Seven, not ten: `/milestones` and `/forms` are redirects now and the Monthly
 * Report is an action on the project record, because a nav entry must own
 * records and those three did not. See PROJECTS-QALITRACK-PLAN.md §10.3.
 */
export default async function ProjectsLayout({ children }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <PlanGate module="projects" feature="Project Management">
      <div className="flex flex-col">
        <ProjectsNav />
        <main className="flex-1">{children}</main>
      </div>
    </PlanGate>
  );
}
