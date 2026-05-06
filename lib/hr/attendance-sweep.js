import Attendance from "@/app/models/attendance";
import AttendanceConfig from "@/app/models/attendanceConfig";
import EmployeeProfile from "@/app/models/employeeProfile";
import {
  getTimezone,
  getLocalDateKey,
  localDateTime,
} from "@/lib/hr/time";

// ============================================
// STALE CLOCK-IN AUTO-CLOSE SWEEP
// ============================================
// Closes records that have a checkIn but no checkOut and whose date is
// before today (in the tenant's local timezone). This is the "user forgot
// to clock out" recovery path — without it, yesterday's record sits open
// forever, hoursWorked stays 0, and bulkMarkAbsent skips them.
//
// Auto-close strategy:
//   - checkOut := the employee's effective shiftEnd of that local date
//     (per-employee shiftEnd > company config shiftEnd)
//   - hoursWorked / overtime computed from checkIn → checkOut
//   - record.autoClosedOut = true (audit flag)
//   - status:
//       hoursWorked < standardHours/2 → "half-day"
//       otherwise → keep present/late
//
// Called best-effort from getMyTodayAttendance and the daily attendance
// page. Safe to run concurrently — only modifies records that are still
// open (checkOut: null).
// ============================================
export async function closeStaleAttendance(companyId) {
  if (!companyId) return { closed: 0 };

  try {
    const config = await AttendanceConfig.getActive(companyId);
    const tz = getTimezone(config);
    const todayKey = getLocalDateKey(new Date(), tz);
    const configShiftEnd = config?.shiftEnd || "17:00";
    const configStandardHours = config?.standardHours || 8;

    // Find open records whose day-key is strictly before today's local day-key.
    const open = await Attendance.find({
      companyId,
      date: { $lt: todayKey },
      checkIn: { $exists: true, $ne: null },
      checkOut: null,
    })
      .select("_id profileId date checkIn shiftStart standardHours status")
      .lean();

    if (open.length === 0) return { closed: 0 };

    // Pull per-employee shiftEnd overrides in one go.
    const profileIds = open.map((r) => r.profileId).filter(Boolean);
    const profiles = await EmployeeProfile.find({
      _id: { $in: profileIds },
      companyId,
    })
      .select("_id employment.shiftEnd employment.shiftStart")
      .lean();
    const profileMap = new Map(
      profiles.map((p) => [p._id.toString(), p]),
    );

    const ops = [];
    for (const r of open) {
      const prof = profileMap.get(r.profileId?.toString());
      const shiftEnd = prof?.employment?.shiftEnd || configShiftEnd;
      const standardHours = r.standardHours || configStandardHours;

      // checkOut = local shiftEnd on the record's date.
      const checkOut = localDateTime(r.date, shiftEnd, tz);
      // Guard against a checkOut earlier than checkIn (mis-configured shift)
      // — treat as 0 hours rather than negative.
      const ms = Math.max(0, checkOut.getTime() - new Date(r.checkIn).getTime());
      const hoursWorked = Math.round((ms / 3_600_000) * 100) / 100;
      const overtime = Math.max(
        0,
        Math.round((hoursWorked - standardHours) * 100) / 100,
      );
      const status =
        hoursWorked < standardHours / 2 ? "half-day" : r.status || "present";

      ops.push({
        updateOne: {
          // Only close if still open — race-safe.
          filter: { _id: r._id, checkOut: null },
          update: {
            $set: {
              checkOut,
              hoursWorked,
              overtime,
              status,
              autoClosedOut: true,
              autoClosedAt: new Date(),
            },
          },
        },
      });
    }

    if (ops.length === 0) return { closed: 0 };
    const result = await Attendance.bulkWrite(ops, { ordered: false });
    return { closed: result.modifiedCount || 0 };
  } catch (err) {
    console.error("[closeStaleAttendance] failed:", err.message);
    return { closed: 0 };
  }
}
