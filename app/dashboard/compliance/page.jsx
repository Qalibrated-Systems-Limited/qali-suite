import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ComplianceBoard from "./ComplianceBoard";
import { getComplianceData } from "@/app/db/actions/compliance-actions";
import { hasRole, COMPLIANCE_WRITE_ROLES } from "@/lib/utils/role-gates";

export const metadata = {
  title: "Compliance | QaliSuite",
  description: "Certificates, statutory obligations & renewal tasks.",
};

export const dynamic = "force-dynamic";

export default async function CompliancePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const data = await getComplianceData();
  const canManage = hasRole(session.user, COMPLIANCE_WRITE_ROLES);

  return (
    <div style={{ padding: "clamp(16px, 2.4vw, 26px)" }}>
      <ComplianceBoard
        certificates={data.certificates}
        obligations={data.obligations}
        tasks={data.tasks}
        stats={data.stats}
        users={data.users}
        canManage={canManage}
      />
    </div>
  );
}
