import "../technical/technical.css";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { roleAllowed } from "@/lib/permissions";
import { INVOICE_WRITE_ROLES } from "@/lib/utils/role-gates";
import InspectionBoard from "./InspectionBoard";
import {
  getInspectionData,
  getMyTechnicalStanding,
  getTechnicalTeam,
} from "@/app/db/actions/technical-actions";

export const metadata = {
  title: "Inspection (17020) | Technical",
  description: "ISO/IEC 17020 inspection bodies, rulings & appeals",
};

export default async function InspectionPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [data, me, team] = await Promise.all([
    getInspectionData(),
    getMyTechnicalStanding(),
    getTechnicalTeam(),
  ]);

  return (
    <div className="tech">
      <div className="tech-stripe" />
      <InspectionBoard
        inspections={data.inspections}
        inspectors={data.inspectors}
        stats={data.stats}
        me={me}
        canBill={roleAllowed(session.user.role, [...INVOICE_WRITE_ROLES])}
        team={team}
      />
    </div>
  );
}
