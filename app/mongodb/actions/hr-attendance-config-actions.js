"use server";

import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import AttendanceConfig from "@/app/models/attendanceConfig";
import { requirePlanAccess } from "@/lib/plan-gate";

export async function saveAttendanceConfig(_prevState, formData) {
  try {
    await requirePlanAccess("hr");
    const session = await auth();
    if (!session?.user) return { success: false, error: "Unauthorized" };
    if (!["SuperAdmin", "Admin", "HR"].includes(session.user.role)) return { success: false, error: "Forbidden" };

    await dbConnect();
    const { companyId } = await getTenantContext();

    // Parse form values
    const shiftStart   = formData.get("shiftStart")   || "08:00";
    const shiftEnd     = formData.get("shiftEnd")     || "17:00";
    const standardHours      = parseFloat(formData.get("standardHours")      || "8");
    const lateGraceMinutes   = parseInt(formData.get("lateGraceMinutes")      || "15");
    const overtimeRateMultiplier = parseFloat(formData.get("overtimeRateMultiplier") || "1.5");

    // Allowed methods — checkboxes
    const methodFields = ["web", "mobile", "qr", "biometric", "manual"];
    const allowedMethods = methodFields.filter((m) => formData.get(`method_${m}`) === "on");

    // IP whitelist
    const ipEnabled     = formData.get("ipEnabled") === "on";
    const ipRaw         = formData.get("ips") || "";
    const ips           = ipRaw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    const ipDescription = formData.get("ipDescription") || "Office network";

    // Geofence
    const geoEnabled      = formData.get("geoEnabled") === "on";
    const geoLat          = parseFloat(formData.get("geoLat")    || "0") || null;
    const geoLng          = parseFloat(formData.get("geoLng")    || "0") || null;
    const geoRadius       = parseInt(formData.get("geoRadius")   || "200");
    const geoLabel        = formData.get("geoLabel") || "Office";

    const update = {
      companyId,
      isActive: true,
      shiftStart,
      shiftEnd,
      standardHours,
      lateGraceMinutes,
      overtimeRateMultiplier,
      enforcement: {
        allowedMethods: allowedMethods.length > 0 ? allowedMethods : methodFields,
        ipWhitelist: {
          enabled: ipEnabled,
          ips,
          description: ipDescription,
        },
        geoFence: {
          enabled: geoEnabled,
          lat: geoLat,
          lng: geoLng,
          radiusMeters: geoRadius,
          label: geoLabel,
        },
      },
      lastModifiedBy: { name: session.user.name, id: session.user.id },
    };

    await AttendanceConfig.findOneAndUpdate(
      { companyId },
      { $set: update },
      { upsert: true, new: true }
    );

    revalidatePath("/dashboard/settings/attendance-config");
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Failed to save attendance config" };
  }
}
