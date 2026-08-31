import "../technical/technical.css";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import InspectionBoard from "./InspectionBoard";
import { getInspectionData } from "@/app/db/actions/technical-actions";
import { hasRole, TECHNICAL_WRITE_ROLES } from "@/lib/utils/role-gates";

export const metadata = {
  title: "Inspection (17020) | Technical",
  description: "ISO/IEC 17020 inspection bodies, rulings & appeals",
};

export default async function InspectionPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const data = await getInspectionData();
  const canManage = hasRole(session.user, TECHNICAL_WRITE_ROLES);

  return (
    <div className="tech">
      <div className="tech-stripe" />
      <InspectionBoard
        inspections={data.inspections}
        inspectors={data.inspectors}
        stats={data.stats}
        canManage={canManage}
      />
    </div>
  );
}
