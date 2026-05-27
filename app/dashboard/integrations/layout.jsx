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

  if (!planIncludes(session.user.companyPlan, "integration")) {
    redirect("/dashboard/settings?upgrade=integration");
  }

  return <>{children}</>;
}
