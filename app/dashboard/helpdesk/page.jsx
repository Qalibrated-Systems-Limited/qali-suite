import { auth } from "@/auth";
import { redirect } from "next/navigation";
import HelpdeskBoard from "./HelpdeskBoard";
import { getHelpdeskData } from "@/app/db/actions/helpdesk-actions";
import { hasRole, HELPDESK_WRITE_ROLES } from "@/lib/utils/role-gates";

export const metadata = {
  title: "Help Desk | QaliSuite",
  description: "Ticketing — log, triage, assign and resolve requests against SLA.",
};

export default async function HelpdeskPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const data = await getHelpdeskData();
  const canManage = hasRole(session.user, HELPDESK_WRITE_ROLES);

  return (
    <div style={{ padding: "clamp(16px, 2.4vw, 26px)" }}>
      <HelpdeskBoard
        tickets={data.tickets}
        categories={data.categories}
        stats={data.stats}
        users={data.users}
        canManage={canManage}
      />
    </div>
  );
}
