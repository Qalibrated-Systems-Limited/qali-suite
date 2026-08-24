import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PlanGate } from "@/components/plan-gate-boundary";

/**
 * Projects is a Professional module, and only its LIST page checked that.
 * `/dashboard/projects/[id]` and `/dashboard/projects/create` had no gate, so
 * the upgrade prompt on the list was a sign on an unlocked door — any project
 * could still be opened, and a new one created, by URL.
 *
 * The list page keeps its own `checkPlanAccess` call; it is harmless now and
 * costs one cached session read.
 */
export default async function ProjectsLayout({ children }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <PlanGate module="projects" feature="Project Management">
      {children}
    </PlanGate>
  );
}
