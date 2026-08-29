import { auth } from "@/auth";
import { redirect } from "next/navigation";
import AccessDenied from "@/app/dashboard/components/crm/AccessDenied";
import ExecutiveOverview from "./ExecutiveOverview";
import { EXECUTIVE_VIEW_ROLES } from "@/lib/utils/role-gates";

export const metadata = {
  title: "Executive Overview | ERP System",
  description: "The direction of the business at a glance",
};

export const dynamic = "force-dynamic";

// Role-centre exclusivity: the CEO reaches this view at /dashboard (their
// home, via the role registry); this standalone route exists for SuperAdmin
// support access and deep links.
//
// One constant, shared with the action behind the snapshot. It was an inline
// list here until the snapshot moved to Postgres and needed a gate of its own
// — and two copies of a role list are two copies that drift.

export default async function ExecutivePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!EXECUTIVE_VIEW_ROLES.includes(session.user.role))
    return <AccessDenied resource="the executive overview" />;

  return <ExecutiveOverview />;
}
