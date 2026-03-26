"use server";

import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import Attendance from "@/app/models/attendance";
import AttendanceConfig from "@/app/models/attendanceConfig";
import EmployeeProfile from "@/app/models/employeeProfile";
import { requirePlanAccess } from "@/lib/plan-gate";

// ============================================
// HR ATTENDANCE ACTIONS
// ============================================

const ALLOWED_HR = ["Admin", "HR", "Manager"];

// ── Helpers ──────────────────────────────────────────────────────────────

// Normalise a date to midnight UTC (the "day key")
function toDateKey(d) {
  const dt = new Date(d);
  dt.setUTCHours(0, 0, 0, 0);
  return dt;
}

// Determine if checkIn is "late" relative to shiftStart (HH:MM) + 15 min grace
function isLate(checkIn, shiftStart = "08:00") {
  const [h, m] = shiftStart.split(":").map(Number);
  // Use UTC methods — shift config times are stored as UTC-based values
  const checkInMins = checkIn.getUTCHours() * 60 + checkIn.getUTCMinutes();
  const shiftMins = h * 60 + m + 15; // 15-minute grace period
  return checkInMins > shiftMins;
}

// Build employee snapshot from profile
function employeeSnapshot(profile) {
  return {
    profileId:      profile._id,
    partyId:        profile.partyId,
    employeeName:   `${profile.personalInfo?.firstName || ""} ${profile.personalInfo?.lastName || ""}`.trim(),
    employeeNumber: profile.employeeNumber,
    department:     profile.employment?.department || "",
  };
}

// ── CLOCK IN ─────────────────────────────────────────────────────────────
// Server action — called from ClockInWidget client component.
// Accepts optional location (GPS coords) and ipAddress for enforcement.
// If the company has an AttendanceConfig with IP whitelist or geofence
// enabled, those rules are validated here before writing the record.
export async function clockIn({ profileId, method = "web", ipAddress, location } = {}) {
  try {
    await requirePlanAccess("hr");

    const session = await auth();
    if (!session?.user) return { success: false, error: "Unauthorized" };

    await dbConnect();
    const { companyId } = await getTenantContext();

    // Ownership check — employees can only clock in for themselves
    if (!["Admin", "HR", "Manager", "SuperAdmin"].includes(session.user.role)) {
      const ownerProfile = await EmployeeProfile.findById(profileId).select("userId").lean();
      if (!ownerProfile || ownerProfile.userId?.toString() !== session.user.id) {
        return { success: false, error: "You can only clock in for yourself" };
      }
    }

    // ── Load config & enforce rules ───────────────────────────────────────
    const config = await AttendanceConfig.getActive(companyId);
    const enforcement = AttendanceConfig.validateClockIn(config, { ipAddress, location, method });
    if (!enforcement.allowed) {
      return { success: false, error: enforcement.reason, enforced: true };
    }

    const configShiftStart  = config?.shiftStart || "08:00";
    const standardHours     = config?.standardHours || 8;
    const lateGraceMins     = config?.lateGraceMinutes ?? 15;

    const profile = await EmployeeProfile.findOne(
      withTenantScope({ _id: profileId }, companyId, false)
    )
      .select("_id partyId personalInfo employeeNumber employment companyId")
      .lean();

    // Per-employee shift overrides company config if set
    const shiftStart = profile?.employment?.shiftStart || configShiftStart;

    if (!profile) return { success: false, error: "Employee not found" };
    if (profile.employment?.status === "terminated") return { success: false, error: "Employee is terminated" };

    const now = new Date();
    const dateKey = toDateKey(now);

    // Check for existing record today
    const existing = await Attendance.findOne({ companyId, profileId: profile._id, date: dateKey });
    if (existing?.checkIn) return { success: false, error: "Already clocked in today" };

    // ── Determine late status using config grace period ───────────────────
    const [h, m] = shiftStart.split(":").map(Number);
    const checkInMins = now.getUTCHours() * 60 + now.getUTCMinutes();
    const graceEndMins = h * 60 + m + lateGraceMins;
    const late = checkInMins > graceEndMins;

    const snap = employeeSnapshot(profile);

    const record = await Attendance.findOneAndUpdate(
      { companyId, profileId: profile._id, date: dateKey },
      {
        $set: {
          companyId,
          ...snap,
          date: dateKey,
          shiftStart,
          standardHours,
          checkIn: now,
          status: late ? "late" : "present",
          method,
          ipAddress: ipAddress || null,
          location: location || undefined,
        },
      },
      { upsert: true, new: true }
    );

    revalidatePath("/dashboard/hr/attendance");
    return {
      success: true,
      attendanceId: record._id.toString(),
      status: record.status,
      checkIn: record.checkIn.toISOString(),
    };
  } catch (error) {
    if (error.code === 11000) return { success: false, error: "Already clocked in today" };
    return { success: false, error: error.message || "Clock-in failed" };
  }
}

// ── GET MY TODAY (used by ClockInWidget) ─────────────────────────────────
// Returns the current user's attendance record for today (or null)
// plus the active config's geofence/IP settings for client-side awareness.
export async function getMyTodayAttendance() {
  try {
    const session = await auth();
    if (!session?.user) return { record: null, config: null };

    await dbConnect();
    const { companyId } = await getTenantContext();

    // Find the employee profile for the current user
    const profile = await EmployeeProfile.findOne(
      withTenantScope({ userId: session.user.id }, companyId, false)
    )
      .select("_id employment.status employment.shiftStart employment.shiftEnd")
      .lean();

    if (!profile) return { record: null, config: null, noProfile: true };

    const dateKey = toDateKey(new Date());
    const [record, config] = await Promise.all([
      Attendance.findOne({ companyId, profileId: profile._id, date: dateKey }).lean(),
      AttendanceConfig.getActive(companyId),
    ]);

    return {
      profileId: profile._id.toString(),
      record: record
        ? {
            _id:         record._id.toString(),
            checkIn:     record.checkIn?.toISOString() || null,
            checkOut:    record.checkOut?.toISOString() || null,
            hoursWorked: record.hoursWorked || 0,
            status:      record.status,
          }
        : null,
      config: {
        geoFenceEnabled: config?.enforcement?.geoFence?.enabled || false,
        ipWhitelistEnabled: config?.enforcement?.ipWhitelist?.enabled || false,
        shiftStart: profile?.employment?.shiftStart || config?.shiftStart || "08:00",
        shiftEnd:   profile?.employment?.shiftEnd   || config?.shiftEnd   || "17:00",
      },
    };
  } catch (error) {
    return { record: null, config: null, error: error.message };
  }
}

// ── CLOCK OUT ────────────────────────────────────────────────────────────
export async function clockOut({ profileId, method = "web", ipAddress } = {}) {
  try {
    const session = await auth();
    if (!session?.user) return { success: false, error: "Unauthorized" };

    await dbConnect();
    const { companyId } = await getTenantContext();

    // Ownership check — employees can only clock out for themselves
    if (!["Admin", "HR", "Manager", "SuperAdmin"].includes(session.user.role)) {
      const profile = await EmployeeProfile.findById(profileId).select("userId").lean();
      if (!profile || profile.userId?.toString() !== session.user.id) {
        return { success: false, error: "You can only clock out for yourself" };
      }
    }

    const now = new Date();
    const dateKey = toDateKey(now);

    const record = await Attendance.findOne({
      companyId,
      profileId,
      date: dateKey,
    });

    if (!record) return { success: false, error: "No clock-in record found for today" };
    if (!record.checkIn) return { success: false, error: "Cannot clock out without clocking in" };
    if (record.checkOut) return { success: false, error: "Already clocked out today" };

    const hoursWorked = (now - record.checkIn) / 3_600_000; // ms → hours
    const overtime = Math.max(0, hoursWorked - record.standardHours);

    // If worked less than half standard hours → half-day; else keep present/late
    const status = hoursWorked < record.standardHours / 2 ? "half-day" : record.status;

    record.checkOut = now;
    record.hoursWorked = Math.round(hoursWorked * 100) / 100;
    record.overtime = Math.round(overtime * 100) / 100;
    record.status = status;
    if (ipAddress) record.ipAddress = ipAddress;
    await record.save();

    revalidatePath("/dashboard/hr/attendance");
    return { success: true, hoursWorked: record.hoursWorked, overtime: record.overtime };
  } catch (error) {
    return { success: false, error: error.message || "Clock-out failed" };
  }
}

// ── MANUAL ENTRY (HR/Admin) ───────────────────────────────────────────────
// Override or create any attendance record for any date
export async function manualAttendanceEntry(formData) {
  try {
    const session = await auth();
    if (!session?.user) return { success: false, error: "Unauthorized" };
    if (!ALLOWED_HR.includes(session.user.role)) return { success: false, error: "Forbidden" };

    await dbConnect();
    const { companyId } = await getTenantContext();

    const profileId = formData.get("profileId");
    const dateStr   = formData.get("date");           // "YYYY-MM-DD"
    const checkInStr  = formData.get("checkIn");      // "HH:MM" or full ISO
    const checkOutStr = formData.get("checkOut");     // "HH:MM" or full ISO (optional)
    const status    = formData.get("status") || "present";
    const notes     = formData.get("notes") || "";
    const shift     = formData.get("shift") || "morning";

    if (!profileId || !dateStr) return { success: false, error: "Employee and date are required" };

    const profile = await EmployeeProfile.findOne(
      withTenantScope({ _id: profileId }, companyId, false)
    )
      .select("_id partyId personalInfo employeeNumber employment companyId")
      .lean();

    if (!profile) return { success: false, error: "Employee not found" };

    const dateKey = toDateKey(new Date(dateStr));

    // Build checkIn/checkOut from "HH:MM" strings (combined with the date)
    let checkIn = null, checkOut = null, hoursWorked = 0, overtime = 0;
    if (checkInStr) {
      if (checkInStr.includes("T")) {
        checkIn = new Date(checkInStr);
      } else {
        const [h, m] = checkInStr.split(":").map(Number);
        checkIn = new Date(dateKey);
        checkIn.setUTCHours(h, m, 0, 0);
      }
    }
    if (checkOutStr) {
      if (checkOutStr.includes("T")) {
        checkOut = new Date(checkOutStr);
      } else {
        const [h, m] = checkOutStr.split(":").map(Number);
        checkOut = new Date(dateKey);
        checkOut.setUTCHours(h, m, 0, 0);
      }
    }
    if (checkIn && checkOut) {
      hoursWorked = Math.round(((checkOut - checkIn) / 3_600_000) * 100) / 100;
      overtime = Math.max(0, Math.round((hoursWorked - 8) * 100) / 100);
    }

    const snap = employeeSnapshot(profile);

    await Attendance.findOneAndUpdate(
      { companyId, profileId: profile._id, date: dateKey },
      {
        $set: {
          companyId,
          ...snap,
          date: dateKey,
          shift,
          checkIn: checkIn || undefined,
          checkOut: checkOut || undefined,
          hoursWorked,
          overtime,
          status,
          method: "manual",
          notes,
          overriddenBy: { name: session.user.name, id: session.user.id },
          overriddenAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    revalidatePath("/dashboard/hr/attendance");
    revalidatePath(`/dashboard/hr/attendance/${dateStr}`);
    revalidatePath(`/dashboard/hr/employees/${profileId}/attendance`);

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Manual entry failed" };
  }
}

// ── BULK MARK ABSENT ──────────────────────────────────────────────────────
// Runs at end of day: mark all active employees with no check-in as absent
export async function bulkMarkAbsent(dateStr) {
  try {
    const session = await auth();
    if (!session?.user) return { success: false, error: "Unauthorized" };
    if (!ALLOWED_HR.includes(session.user.role)) return { success: false, error: "Forbidden" };

    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    const dateKey = toDateKey(new Date(dateStr));

    // Get all active employees
    const employees = await EmployeeProfile.find(
      withTenantScope(
        { "employment.status": { $in: ["active", "probation"] } },
        companyId,
        isSuperAdmin
      )
    )
      .select("_id partyId personalInfo employeeNumber employment companyId")
      .lean();

    // Get existing records for this date
    const existing = await Attendance.find({
      companyId,
      date: dateKey,
    })
      .select("profileId")
      .lean();

    const existingIds = new Set(existing.map((r) => r.profileId.toString()));

    // Build absent records for employees with no record
    const toCreate = employees
      .filter((p) => !existingIds.has(p._id.toString()))
      .map((p) => ({
        companyId: p.companyId,
        ...employeeSnapshot(p),
        date: dateKey,
        status: "absent",
        method: "manual",
        markedAbsentAt: new Date(),
      }));

    if (toCreate.length === 0) return { success: true, marked: 0 };

    await Attendance.insertMany(toCreate, { ordered: false });

    revalidatePath("/dashboard/hr/attendance");
    revalidatePath(`/dashboard/hr/attendance/${dateStr}`);

    return { success: true, marked: toCreate.length };
  } catch (error) {
    return { success: false, error: error.message || "Bulk mark absent failed" };
  }
}
