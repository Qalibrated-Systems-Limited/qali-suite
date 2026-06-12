import { auth } from "@/auth";
import { redirect } from "next/navigation";
import AccessDenied from "@/app/dashboard/components/crm/AccessDenied";
import ExecutiveOverview from "./ExecutiveOverview";

export const metadata = {
  title: "Executive Overview | ERP System",
  description: "The direction of the business at a glance",
};

export const dynamic = "force-dynamic";

// Role-centre exclusivity: the CEO reaches this view at /dashboard (their
// home, via the role registry); this standalone route exists for SuperAdmin
// support access and deep links.
const EXEC_ROLES = ["SuperAdmin", "CEO"];

export default async function ExecutivePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!EXEC_ROLES.includes(session.user.role))
    return <AccessDenied resource="the executive overview" />;

  return <ExecutiveOverview />;
}
