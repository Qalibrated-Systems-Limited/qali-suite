import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { planIncludes } from "@/lib/plans";

// ============================================
// INTEGRATIONS LAYOUT
// Plan-gated to Enterprise + Admin role only.
// ============================================

export default async function IntegrationsLayout({ children }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (!["SuperAdmin", "Admin"].includes(session.user.role)) redirect("/dashboard");

  // Plan gate applies to tenant Admins only. SuperAdmin is the platform
  // operator — their companyPlan is a home-tenant UX hint, not a license;
  // bouncing them to the upgrade page locked them out of platform plumbing.
  if (
    session.user.role !== "SuperAdmin" &&
    !planIncludes(session.user.companyPlan, "integration")
  ) {
    redirect("/dashboard/settings?upgrade=integration");
  }

  return <>{children}</>;
}
