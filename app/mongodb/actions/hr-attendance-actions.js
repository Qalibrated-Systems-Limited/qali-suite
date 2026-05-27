"use server";

import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import Attendance from "@/app/models/attendance";
import AttendanceConfig from "@/app/models/attendanceConfig";
import EmployeeProfile from "@/app/models/employeeProfile";
import { requirePlanAccess } from "@/lib/plan-gate";
import {
  getTimezone,
  getLocalDateKey,
  getLocalMinutesSinceMidnight,
  localDateTime,
} from "@/lib/hr/time";

// ============================================
// HR ATTENDANCE ACTIONS
// ============================================

const ALLOWED_HR = ["SuperAdmin", "Admin", "HR", "Manager"];

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

    // Self-heal: close any prior-day open record this employee forgot to
    // clock out of, so today's clock-in starts cleanly.
    const { closeStaleAttendance } = await import("@/lib/hr/attendance-sweep");
    await closeStaleAttendance(companyId);

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

    const tz = getTimezone(config);
    const now = new Date();
    const dateKey = getLocalDateKey(now, tz);

    // Check for existing record today
    const existing = await Attendance.findOne({ companyId, profileId: profile._id, date: dateKey });
    if (existing?.checkIn) return { success: false, error: "Already clocked in today" };

    // ── Determine late status using config grace period (in tenant's TZ) ──
    const [h, m] = shiftStart.split(":").map(Number);
    const checkInMins = getLocalMinutesSinceMidnight(now, tz);
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

    // Need the config first to know the tenant's timezone for the day key.
    const config = await AttendanceConfig.getActive(companyId);
    const tz = getTimezone(config);

    // Self-heal: close any clock-ins from prior days that the user forgot
    // to close out. Best-effort; never blocks the widget.
    const { closeStaleAttendance } = await import("@/lib/hr/attendance-sweep");
    await closeStaleAttendance(companyId);

    const dateKey = getLocalDateKey(new Date(), tz);
    const record = await Attendance.findOne({
      companyId,
      profileId: profile._id,
      date: dateKey,
    }).lean();

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

    // Close out the most recent open record (checkIn set, checkOut not yet).
    // Using "most recent open" instead of "today's dateKey" handles night
    // shifts that cross local midnight cleanly.
    const record = await Attendance.findOne({
      companyId,
      profileId,
      checkIn: { $exists: true, $ne: null },
      checkOut: null,
    }).sort({ checkIn: -1 });

    if (!record) return { success: false, error: "No open clock-in record found" };
    if (record.checkOut) return { success: false, error: "Already clocked out" };

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

    // dateStr is a YYYY-MM-DD entered by an HR admin in their (i.e. the
    // tenant's) local timezone. Bucket it as UTC midnight of that local
    // date and interpret HH:MM strings against the same TZ so a manual
    // "08:00" entry is 08:00 EAT, not 08:00 UTC.
    const config = await AttendanceConfig.getActive(companyId);
    const tz = getTimezone(config);
    const dateKey = new Date(`${dateStr}T00:00:00.000Z`);

    // Build checkIn/checkOut from "HH:MM" strings (combined with the date)
    let checkIn = null, checkOut = null, hoursWorked = 0, overtime = 0;
    if (checkInStr) {
      checkIn = checkInStr.includes("T")
        ? new Date(checkInStr)
        : localDateTime(dateKey, checkInStr, tz);
    }
    if (checkOutStr) {
      checkOut = checkOutStr.includes("T")
        ? new Date(checkOutStr)
        : localDateTime(dateKey, checkOutStr, tz);
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

    // dateStr is YYYY-MM-DD in the tenant's local TZ; treat as UTC midnight
    // of that local date for the day-key.
    const dateKey = new Date(`${dateStr}T00:00:00.000Z`);

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
