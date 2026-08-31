import "../technical/technical.css";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import AccessDenied from "../projects/components/AccessDenied";
import CalibrationBoard from "./CalibrationBoard";
import { getCalibrationData } from "@/app/db/actions/technical-actions";
import { hasRole, TECHNICAL_WRITE_ROLES } from "@/lib/utils/role-gates";

export const metadata = {
  title: "Calibration (17025) | Technical",
  description: "ISO/IEC 17025 calibration — certificates, standards & jobs",
};

export default async function CalibrationPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const data = await getCalibrationData();
  const canManage = hasRole(session.user, TECHNICAL_WRITE_ROLES);

  return (
    <div className="tech">
      <div className="tech-stripe" />
      <CalibrationBoard
        jobs={data.jobs}
        standards={data.standards}
        stats={data.stats}
        canManage={canManage}
      />
    </div>
  );
}
