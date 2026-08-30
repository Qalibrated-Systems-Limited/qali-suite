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
 * ProjectsNav renders the module's sticky sub-navigation (Dashboard,
 * Milestone Tracker, Programme, Engineer's Instructions, Site Diary, Forms
 * Register, IPC & Payments, Cash Requisitions, Monthly Report) above every
 * page in the module — the same pattern HR uses for its own sub-nav. It
 * mirrors the "Projects" dropdown added to the sidebar in
 * components/sidebar-content-grouped.jsx, so the same nine destinations are
 * reachable both from the sidebar and from within any project page.
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
