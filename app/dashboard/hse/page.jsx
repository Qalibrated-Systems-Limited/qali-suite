import { auth } from "@/auth";
import { redirect } from "next/navigation";
import HseBoard from "./HseBoard";
import { getHseData } from "@/app/db/actions/hse-actions";
import { hasRole, HSE_WRITE_ROLES } from "@/lib/utils/role-gates";

export const metadata = {
  title: "HSE | QaliSuite",
  description: "Health, Safety & Environment — incidents, RAMS, PPE, training and statutory inspections.",
};

export default async function HSEPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const data = await getHseData();
  const canManage = hasRole(session.user, HSE_WRITE_ROLES);

  return (
    <div style={{ padding: "clamp(16px, 2.4vw, 26px)" }}>
      <HseBoard data={data} canManage={canManage} />
    </div>
  );
}
