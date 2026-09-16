import { auth } from "@/auth";
import { redirect } from "next/navigation";
import QMSBoard from "./QMSBoard";
import { getQmsData } from "@/app/db/actions/qms-actions";
import { hasRole, QMS_WRITE_ROLES } from "@/lib/utils/role-gates";

export const metadata = {
  title: "Quality (QMS) | QaliSuite",
  description: "Non-conformances, CAPA, audits & management review (ISO 9001 / 17025).",
};

export const dynamic = "force-dynamic";

export default async function QMSPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const data = await getQmsData();
  const canManage = hasRole(session.user, QMS_WRITE_ROLES);

  return (
    <div style={{ padding: "clamp(16px, 2.4vw, 26px)" }}>
      <QMSBoard
        ncs={data.ncs}
        audits={data.audits}
        reviews={data.reviews}
        stats={data.stats}
        users={data.users}
        canManage={canManage}
      />
    </div>
  );
}
