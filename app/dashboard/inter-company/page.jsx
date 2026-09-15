import { auth } from "@/auth";
import { redirect } from "next/navigation";
import InterCompanyBoard from "./InterCompanyBoard";
import { getInterCompanyData } from "@/app/db/actions/intercompany-actions";
import { hasRole, INTERCOMPANY_WRITE_ROLES } from "@/lib/utils/role-gates";

export const metadata = {
  title: "Inter-Company | QaliSuite",
  description: "Sister-company contracts, fees & eliminations.",
};

export const dynamic = "force-dynamic";

export default async function InterCompanyPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const data = await getInterCompanyData();
  const canManage = hasRole(session.user, INTERCOMPANY_WRITE_ROLES);

  return (
    <div style={{ padding: "clamp(16px, 2.4vw, 26px)" }}>
      <InterCompanyBoard
        contracts={data.contracts}
        transactions={data.transactions}
        stats={data.stats}
        canManage={canManage}
      />
    </div>
  );
}
