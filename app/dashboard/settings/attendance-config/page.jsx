import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import AttendanceConfig from "@/app/models/attendanceConfig";
import AttendanceConfigClient from "./AttendanceConfigClient";

export const metadata = { title: "Attendance Config | Settings" };

async function loadConfig() {
  await dbConnect();
  const { companyId } = await getTenantContext();
  const config = await AttendanceConfig.getActive(companyId);
  if (!config) return null;
  // Serialise for client
  return {
    shiftStart:              config.shiftStart || "08:00",
    shiftEnd:                config.shiftEnd || "17:00",
    standardHours:           config.standardHours ?? 8,
    lateGraceMinutes:        config.lateGraceMinutes ?? 15,
    overtimeRateMultiplier:  config.overtimeRateMultiplier ?? 1.5,
    allowedMethods:          config.enforcement?.allowedMethods || ["web","mobile","qr","biometric","manual"],
    ipEnabled:               config.enforcement?.ipWhitelist?.enabled || false,
    ips:                     (config.enforcement?.ipWhitelist?.ips || []).join("\n"),
    ipDescription:           config.enforcement?.ipWhitelist?.description || "Office network",
    geoEnabled:              config.enforcement?.geoFence?.enabled || false,
    geoLat:                  config.enforcement?.geoFence?.lat ?? "",
    geoLng:                  config.enforcement?.geoFence?.lng ?? "",
    geoRadius:               config.enforcement?.geoFence?.radiusMeters ?? 200,
    geoLabel:                config.enforcement?.geoFence?.label || "Office",
  };
}

export default async function AttendanceConfigPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["SuperAdmin", "Admin", "HR"].includes(session.user.role)) redirect("/dashboard/settings");

  const config = await loadConfig();

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/settings" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Settings
        </Link>
        <span>/</span>
        <span className="text-foreground">Attendance</span>
      </div>

      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">Attendance Configuration</h1>
        <p className="text-sm text-muted-foreground">Shift hours, late threshold, IP restriction, and geofencing.</p>
      </div>

      <AttendanceConfigClient config={config} />
    </div>
  );
}
