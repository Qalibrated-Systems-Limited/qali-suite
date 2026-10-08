import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canSeeFinanceNav } from "@/lib/permissions";
import { hasRole, FINANCE_WRITE_ROLES } from "@/lib/utils/role-gates";
import { getCommissionOverview } from "@/app/db/actions/commission-actions";
import CommissionWorkspace from "./CommissionWorkspace";

export const metadata = {
  title: "Commissions | Finance",
  description: "Tiered sales commission and the earners leaderboard",
};

export default async function CommissionsPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeFinanceNav(session.user.role)) redirect("/dashboard");

  const sp = await searchParams;
  const month = sp?.month || "";
  const status = sp?.status || "";

  const data = await getCommissionOverview(month || null, status || null);
  const canManage = hasRole(session.user, FINANCE_WRITE_ROLES);

  return (
    <CommissionWorkspace
      data={data}
      canManage={canManage}
      month={month}
      status={status}
    />
  );
}
