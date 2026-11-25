import "../technical/technical.css";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { roleAllowed } from "@/lib/permissions";
import { INVOICE_WRITE_ROLES } from "@/lib/utils/role-gates";
import AccessDenied from "../projects/components/AccessDenied";
import CalibrationBoard from "./CalibrationBoard";
import {
  getCalibrationData,
  getMyTechnicalStanding,
  getTechnicalTeam,
} from "@/app/db/actions/technical-actions";

export const metadata = {
  title: "Calibration (17025) | Technical",
  description: "ISO/IEC 17025 calibration — certificates, standards & jobs",
};

export default async function CalibrationPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [data, me, team] = await Promise.all([
    getCalibrationData(),
    getMyTechnicalStanding(),
    getTechnicalTeam(),
  ]);

  return (
    <div className="tech">
      <div className="tech-stripe" />
      <CalibrationBoard
        jobs={data.jobs}
        standards={data.standards}
        stats={data.stats}
        me={me}
        canBill={roleAllowed(session.user.role, [...INVOICE_WRITE_ROLES])}
        team={team}
      />
    </div>
  );
}
