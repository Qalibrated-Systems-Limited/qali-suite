import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { getAttendancePolicy } from "@/app/db/actions/hr-attendance-actions";
import { HR_ADMIN_ROLES } from "@/lib/utils/role-gates";
import { roleAllowed } from "@/lib/permissions";
import AttendanceConfigClient from "./AttendanceConfigClient";

export const metadata = { title: "Attendance Config | Settings" };

export default async function AttendanceConfigPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!roleAllowed(session.user.role, HR_ADMIN_ROLES)) redirect("/dashboard/settings");

  // Always a policy: a company with none gets the defaults, which is what the
  // clock-in path uses too.
  const policy = await getAttendancePolicy();
  const config = {
    shiftStart: policy.shiftStart,
    shiftEnd: policy.shiftEnd,
    standardHours: policy.standardHours,
    lateGraceMinutes: policy.lateGraceMinutes,
    overtimeRateMultiplier: policy.overtimeRateMultiplier,
    allowedMethods: policy.allowedMethods,
    ipEnabled: policy.ipWhitelistEnabled,
    ips: policy.ipWhitelist.join("\n"),
    ipDescription: policy.ipWhitelistDescription,
    geoEnabled: policy.geofenceEnabled,
    geoLat: policy.geofenceLat ?? "",
    geoLng: policy.geofenceLng ?? "",
    geoRadius: policy.geofenceRadiusMetres,
    geoLabel: policy.geofenceLabel,
    timezone: policy.timezone,
  };

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
        <p className="text-sm text-muted-foreground">
          Shift hours, the late threshold, and where clocking in is allowed
          from. A whitelist or a geofence that is switched on must actually
          have addresses or a location — switched on and empty used to enforce
          nothing.
        </p>
      </div>

      <AttendanceConfigClient config={config} />
    </div>
  );
}
