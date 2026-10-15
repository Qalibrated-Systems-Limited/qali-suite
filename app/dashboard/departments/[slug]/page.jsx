import { auth } from "@/auth";
import { redirect } from "next/navigation";

/**
 * Departments no longer have landing pages of their own. The ERP has ONE
 * overall dashboard (/dashboard); a department is just a navigation grouping
 * in the sidebar (see components/sidebar-content-grouped.jsx), so any
 * /dashboard/departments/<slug> URL — a bookmark, an old link, the command
 * palette — redirects to that single dashboard rather than rendering a
 * per-department dashboard that duplicated it.
 */
export const metadata = { title: "Dashboard | ERP System" };

export default async function DepartmentPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  redirect("/dashboard");
}
