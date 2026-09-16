import { auth } from "@/auth";
import { redirect } from "next/navigation";
import SopsBoard from "./SopsBoard";
import { getSopsData } from "@/app/db/actions/sops-actions";
import { hasRole, SOP_WRITE_ROLES } from "@/lib/utils/role-gates";

export const metadata = {
  title: "SOP Library | QaliSuite",
  description: "Controlled documents & review schedule.",
};

export const dynamic = "force-dynamic";

export default async function SOPsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const data = await getSopsData();
  const canManage = hasRole(session.user, SOP_WRITE_ROLES);

  return (
    <div style={{ padding: "clamp(16px, 2.4vw, 26px)" }}>
      <SopsBoard sops={data.sops} stats={data.stats} users={data.users} canManage={canManage} />
    </div>
  );
}
