import { eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { attendance, attendanceConfig } from "../schema";
import {
  getTimezone,
  getLocalYMD,
  getLocalMinutesSinceMidnight,
  localDateTimeFromYmd,
  minutesOfDay,
} from "@/lib/hr/time";

/**
 * Attendance.
 *
 * Hours worked and overtime are generated columns (0047), so nothing here
 * computes them — which is the point: the source computes them in three
 * places, and one of the three uses a hard-coded eight-hour day instead of the
 * company's configured shift.
 *
 * Everything is bucketed by the tenant's LOCAL day. `work_date` is a real
 * date, not an instant.
 */

export interface AttendancePolicy {
  companyId: string;
  timezone: string;
  shiftStart: string;
  shiftEnd: string;
  standardHours: number;
  lateGraceMinutes: number;
  overtimeRateMultiplier: number;
  allowedMethods: string[];
  ipWhitelistEnabled: boolean;
  ipWhitelist: string[];
  ipWhitelistDescription: string;
  geofenceEnabled: boolean;
  geofenceLat: number | null;
  geofenceLng: number | null;
  geofenceRadiusMetres: number;
  geofenceLabel: string;
}

/** Sensible defaults for a tenant that has never configured attendance. */
const DEFAULT_POLICY = {
  timezone: "Africa/Nairobi",
  shiftStart: "08:00",
  shiftEnd: "17:00",
  standardHours: 8,
  lateGraceMinutes: 15,
  overtimeRateMultiplier: 1.5,
  allowedMethods: ["web", "mobile", "qr", "biometric", "manual"],
  ipWhitelistEnabled: false,
  ipWhitelist: [] as string[],
  ipWhitelistDescription: "Office network",
  geofenceEnabled: false,
  geofenceLat: null,
  geofenceLng: null,
  geofenceRadiusMetres: 200,
  geofenceLabel: "Office",
};

export async function getPolicy(
  tx: Tx,
  companyId: string,
): Promise<AttendancePolicy> {
  const [row] = await tx
    .select()
    .from(attendanceConfig)
    .where(eq(attendanceConfig.companyId, companyId));

  if (!row) return { companyId, ...DEFAULT_POLICY };

  return {
    companyId,
    timezone: row.timezone,
    shiftStart: row.shiftStart,
    shiftEnd: row.shiftEnd,
    standardHours: Number(row.standardHours),
    lateGraceMinutes: row.lateGraceMinutes,
    overtimeRateMultiplier: Number(row.overtimeRateMultiplier),
    allowedMethods: row.allowedMethods,
    ipWhitelistEnabled: row.ipWhitelistEnabled,
    ipWhitelist: row.ipWhitelist,
    ipWhitelistDescription: row.ipWhitelistDescription,
    geofenceEnabled: row.geofenceEnabled,
    geofenceLat: row.geofenceLat === null ? null : Number(row.geofenceLat),
    geofenceLng: row.geofenceLng === null ? null : Number(row.geofenceLng),
    geofenceRadiusMetres: row.geofenceRadiusMetres,
    geofenceLabel: row.geofenceLabel,
  };
}

export async function savePolicy(
  tx: Tx,
  input: Partial<AttendancePolicy> & {
    companyId: string;
    actor?: { id?: string | null; name?: string | null };
  },
) {
  const values = {
    companyId: input.companyId,
    timezone: input.timezone ?? DEFAULT_POLICY.timezone,
    shiftStart: input.shiftStart ?? DEFAULT_POLICY.shiftStart,
    shiftEnd: input.shiftEnd ?? DEFAULT_POLICY.shiftEnd,
    standardHours: String(input.standardHours ?? DEFAULT_POLICY.standardHours),
    lateGraceMinutes: input.lateGraceMinutes ?? DEFAULT_POLICY.lateGraceMinutes,
    overtimeRateMultiplier: String(
      input.overtimeRateMultiplier ?? DEFAULT_POLICY.overtimeRateMultiplier,
    ),
    allowedMethods: input.allowedMethods?.length
      ? input.allowedMethods
      : DEFAULT_POLICY.allowedMethods,
    ipWhitelistEnabled: input.ipWhitelistEnabled ?? false,
    ipWhitelist: input.ipWhitelist ?? [],
    ipWhitelistDescription:
      input.ipWhitelistDescription ?? DEFAULT_POLICY.ipWhitelistDescription,
    geofenceEnabled: input.geofenceEnabled ?? false,
    geofenceLat: input.geofenceLat == null ? null : String(input.geofenceLat),
    geofenceLng: input.geofenceLng == null ? null : String(input.geofenceLng),
    geofenceRadiusMetres:
      input.geofenceRadiusMetres ?? DEFAULT_POLICY.geofenceRadiusMetres,
    geofenceLabel: input.geofenceLabel ?? DEFAULT_POLICY.geofenceLabel,
    lastModifiedById: input.actor?.id ?? null,
    lastModifiedByName: input.actor?.name ?? null,
    updatedAt: new Date(),
  };

  const [saved] = await tx
    .insert(attendanceConfig)
    .values({ ...values, createdById: input.actor?.id ?? null })
    .onConflictDoUpdate({ target: attendanceConfig.companyId, set: values })
    .returning();

  return saved;
}

/**
 * Whether a clock-in is allowed from where and how it was made.
 *
 * Carried over from AttendanceConfig.validateClockIn with one behaviour
 * change, and it is a correction: an IP whitelist that is switched on with no
 * addresses in it USED TO ALLOW EVERYTHING — `if (allowedIPs.length > 0 &&
 * ipAddress)` — so ticking the box enforced nothing. The schema now refuses
 * that combination outright, and this reads as though it cannot happen.
 */
export function checkClockInAllowed(
  policy: AttendancePolicy,
  attempt: {
    method?: string;
    ipAddress?: string | null;
    location?: { lat?: number | null; lng?: number | null } | null;
  },
): { allowed: true } | { allowed: false; reason: string } {
  const method = attempt.method ?? "web";
  if (policy.allowedMethods.length && !policy.allowedMethods.includes(method)) {
    return {
      allowed: false,
      reason: `Clocking in by "${method}" is not permitted here. Allowed: ${policy.allowedMethods.join(", ")}.`,
    };
  }

  if (policy.ipWhitelistEnabled) {
    const ip = (attempt.ipAddress ?? "").trim();
    if (!ip) {
      return {
        allowed: false,
        reason: `Clock-in is only allowed from the ${policy.ipWhitelistDescription}, and your network could not be identified.`,
      };
    }
    const ok = policy.ipWhitelist.some((allowed) => {
      const a = allowed.trim();
      return a !== "" && (ip === a || ip.startsWith(a));
    });
    if (!ok) {
      return {
        allowed: false,
        reason: `Clock-in is only allowed from the ${policy.ipWhitelistDescription}. Your network (${ip}) is not on the list.`,
      };
    }
  }

  if (policy.geofenceEnabled && policy.geofenceLat != null && policy.geofenceLng != null) {
    const lat = attempt.location?.lat;
    const lng = attempt.location?.lng;
    if (lat == null || lng == null) {
      return {
        allowed: false,
        reason: `Clock-in needs your location to confirm you are within ${policy.geofenceRadiusMetres}m of ${policy.geofenceLabel}. Allow location access and try again.`,
      };
    }
    const distance = haversineMetres(
      policy.geofenceLat,
      policy.geofenceLng,
      lat,
      lng,
    );
    if (distance > policy.geofenceRadiusMetres) {
      return {
        allowed: false,
        reason: `You are ${Math.round(distance)}m from ${policy.geofenceLabel}; the limit is ${policy.geofenceRadiusMetres}m.`,
      };
    }
  }

  return { allowed: true };
}

function haversineMetres(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** The shift that applies to one employee: theirs if set, otherwise the company's. */
async function shiftFor(tx: Tx, employeeId: string, policy: AttendancePolicy) {
  const [row] = (await tx.execute(sql`
    SELECT shift_start, shift_end, status FROM employees WHERE id = ${employeeId}::uuid
  `)) as unknown as Array<{
    shift_start: string | null;
    shift_end: string | null;
    status: string;
  }>;
  if (!row) throw new Error("Employee not found");
  return {
    start: row.shift_start || policy.shiftStart,
    end: row.shift_end || policy.shiftEnd,
    status: row.status,
  };
}

export async function clockIn(
  tx: Tx,
  input: {
    companyId: string;
    employeeId: string;
    method?: string;
    ipAddress?: string | null;
    location?: { lat?: number | null; lng?: number | null; accuracy?: number | null } | null;
    now?: Date;
  },
) {
  const policy = await getPolicy(tx, input.companyId);
  const gate = checkClockInAllowed(policy, {
    method: input.method,
    ipAddress: input.ipAddress,
    location: input.location,
  });
  if (gate.allowed === false) {
    const err = new Error(gate.reason) as Error & { enforced?: boolean };
    // Marked so the widget can say "you are not allowed to clock in from
    // here" rather than "something went wrong".
    err.enforced = true;
    throw err;
  }

  const shift = await shiftFor(tx, input.employeeId, policy);
  if (shift.status === "terminated") {
    throw new Error("This employment has ended.");
  }

  const now = input.now ?? new Date();
  const tz = getTimezone(policy);
  const workDate = getLocalYMD(now, tz);

  const [existing] = (await tx.execute(sql`
    SELECT id, check_in FROM attendance
     WHERE employee_id = ${input.employeeId}::uuid AND work_date = ${workDate}::date
  `)) as unknown as Array<{ id: string; check_in: string | null }>;
  if (existing?.check_in) {
    throw new Error("You have already clocked in today.");
  }

  const late =
    getLocalMinutesSinceMidnight(now, tz) >
    minutesOfDay(shift.start) + policy.lateGraceMinutes;

  const [row] = (await tx.execute(sql`
    INSERT INTO attendance
      (company_id, employee_id, work_date, shift_start, standard_hours,
       check_in, status, method, ip_address, location_lat, location_lng,
       location_accuracy)
    VALUES (${input.companyId}::uuid, ${input.employeeId}::uuid, ${workDate}::date,
            ${shift.start}, ${policy.standardHours}, ${now.toISOString()},
            ${late ? "late" : "present"}, ${input.method ?? "web"},
            ${input.ipAddress ?? null},
            ${input.location?.lat ?? null}, ${input.location?.lng ?? null},
            ${input.location?.accuracy ?? null})
    ON CONFLICT (employee_id, work_date) DO UPDATE
      SET check_in = EXCLUDED.check_in,
          status = EXCLUDED.status,
          method = EXCLUDED.method,
          shift_start = EXCLUDED.shift_start,
          standard_hours = EXCLUDED.standard_hours,
          ip_address = EXCLUDED.ip_address,
          location_lat = EXCLUDED.location_lat,
          location_lng = EXCLUDED.location_lng,
          location_accuracy = EXCLUDED.location_accuracy,
          marked_absent_at = NULL,
          updated_at = now()
    RETURNING id, work_date, check_in, status
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    id: String(row.id),
    workDate: String(row.work_date),
    checkIn: new Date(row.check_in as string).toISOString(),
    status: String(row.status),
    late,
  };
}

/**
 * Closes the open record.
 *
 * "The most recent one still open", not "today's" — a night shift crosses
 * local midnight, and the source already made that choice deliberately.
 */
export async function clockOut(
  tx: Tx,
  input: { employeeId: string; now?: Date; ipAddress?: string | null },
) {
  const now = input.now ?? new Date();

  const [open] = (await tx.execute(sql`
    SELECT id, check_in FROM attendance
     WHERE employee_id = ${input.employeeId}::uuid
       AND check_in IS NOT NULL AND check_out IS NULL
     ORDER BY check_in DESC
     LIMIT 1
  `)) as unknown as Array<{ id: string; check_in: string }>;

  if (!open) throw new Error("There is no open clock-in to close.");
  if (new Date(open.check_in) > now) {
    throw new Error("A clock-out cannot be earlier than the clock-in.");
  }

  const [row] = (await tx.execute(sql`
    UPDATE attendance
       SET check_out = ${now.toISOString()},
           ip_address = COALESCE(${input.ipAddress ?? null}, ip_address),
           updated_at = now()
     WHERE id = ${open.id}::uuid AND check_out IS NULL
    RETURNING id, hours_worked, overtime_hours, standard_hours, status
  `)) as unknown as Array<Record<string, unknown>>;

  if (!row) throw new Error("That record was closed by somebody else.");

  // Half a day is decided AFTER the hours are known, and the hours are the
  // database's. A short day stays short; a full one keeps present or late.
  const hours = Number(row.hours_worked ?? 0);
  const standard = Number(row.standard_hours);
  if (hours < standard / 2 && row.status !== "half_day") {
    await tx.execute(sql`
      UPDATE attendance SET status = 'half_day', updated_at = now()
       WHERE id = ${open.id}::uuid
    `);
  }

  return {
    id: String(row.id),
    hoursWorked: hours,
    overtimeHours: Number(row.overtime_hours ?? 0),
    status: hours < standard / 2 ? "half_day" : String(row.status),
  };
}

/**
 * Records or corrects a day by hand.
 *
 * The shift and standard hours come from the POLICY, which is the correction:
 * manualAttendanceEntry computes overtime against a hard-coded 8 hours, so a
 * manual entry at a company on a nine-hour day records an hour of overtime
 * nobody worked — and it never records standardHours on the row, so nothing
 * downstream can tell.
 */
export async function recordManualAttendance(
  tx: Tx,
  input: {
    companyId: string;
    employeeId: string;
    workDate: string;
    checkIn?: string | null;
    checkOut?: string | null;
    status?: string;
    shift?: string;
    notes?: string | null;
    actor?: { id?: string | null; name?: string | null };
  },
) {
  if (!input.workDate) throw new Error("A date is required");

  const policy = await getPolicy(tx, input.companyId);
  const shift = await shiftFor(tx, input.employeeId, policy);
  const tz = getTimezone(policy);

  const asInstant = (value?: string | null) => {
    const v = (value ?? "").trim();
    if (!v) return null;
    // "HH:MM" is a wall-clock time in the tenant's zone; a full ISO string is
    // already an instant.
    return v.includes("T")
      ? new Date(v).toISOString()
      : localDateTimeFromYmd(input.workDate, v, tz).toISOString();
  };

  const checkIn = asInstant(input.checkIn);
  const checkOut = asInstant(input.checkOut);
  if (checkOut && !checkIn) {
    throw new Error("A clock-out needs a clock-in on the same day.");
  }
  if (checkIn && checkOut && checkOut < checkIn) {
    throw new Error("The clock-out is earlier than the clock-in.");
  }

  const status = input.status ?? (checkIn ? "present" : "absent");
  if (["present", "late", "half_day"].includes(status) && !checkIn) {
    throw new Error(
      `A day marked "${status.replace("_", " ")}" needs a clock-in time.`,
    );
  }

  const [row] = (await tx.execute(sql`
    INSERT INTO attendance
      (company_id, employee_id, work_date, shift, shift_start, standard_hours,
       check_in, check_out, status, method, notes,
       overridden_by_id, overridden_by_name, overridden_at)
    VALUES (${input.companyId}::uuid, ${input.employeeId}::uuid, ${input.workDate}::date,
            ${input.shift ?? "morning"}, ${shift.start}, ${policy.standardHours},
            ${checkIn}, ${checkOut}, ${status}, 'manual', ${input.notes ?? null},
            ${input.actor?.id ?? null}, ${input.actor?.name ?? null}, now())
    ON CONFLICT (employee_id, work_date) DO UPDATE
      SET shift = EXCLUDED.shift,
          shift_start = EXCLUDED.shift_start,
          standard_hours = EXCLUDED.standard_hours,
          check_in = EXCLUDED.check_in,
          check_out = EXCLUDED.check_out,
          status = EXCLUDED.status,
          method = 'manual',
          notes = EXCLUDED.notes,
          overridden_by_id = EXCLUDED.overridden_by_id,
          overridden_by_name = EXCLUDED.overridden_by_name,
          overridden_at = now(),
          updated_at = now()
    RETURNING id, hours_worked, overtime_hours, status
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    id: String(row.id),
    hoursWorked: row.hours_worked === null ? null : Number(row.hours_worked),
    overtimeHours: row.overtime_hours === null ? null : Number(row.overtime_hours),
    status: String(row.status),
  };
}

/**
 * Marks the day's absentees.
 *
 * Three things the source's bulkMarkAbsent does not do:
 *
 *   - it marks WEEKENDS and public holidays as absent, because it never asks
 *     whether the date is a working day;
 *   - it marks people who are on APPROVED LEAVE as absent, so the leave they
 *     were granted shows as an unexplained absence on their record;
 *   - it inserts rather than upserting, so a second run raises duplicate-key
 *     errors it then swallows with `ordered: false`.
 */
export async function markAbsentees(
  tx: Tx,
  input: { companyId: string; workDate: string },
) {
  const [{ working }] = (await tx.execute(sql`
    SELECT working_days(${input.companyId}::uuid, ${input.workDate}::date,
                        ${input.workDate}::date) AS working
  `)) as unknown as Array<{ working: number }>;

  if (Number(working) === 0) {
    return { marked: 0, skipped: "not a working day" as const };
  }

  const rows = (await tx.execute(sql`
    INSERT INTO attendance
      (company_id, employee_id, work_date, status, method, marked_absent_at,
       shift_start, standard_hours)
    SELECT ${input.companyId}::uuid, e.id, ${input.workDate}::date,
           CASE WHEN ol.employee_id IS NOT NULL THEN 'on_leave' ELSE 'absent' END,
           'manual', now(),
           COALESCE(e.shift_start, cfg.shift_start, '08:00'),
           COALESCE(cfg.standard_hours, 8)
      FROM employees e
      LEFT JOIN attendance_config cfg ON cfg.company_id = e.company_id
      LEFT JOIN LATERAL (
        SELECT r.employee_id
          FROM leave_requests r
         WHERE r.employee_id = e.id
           AND r.status IN ('approved', 'completed')
           AND ${input.workDate}::date BETWEEN r.from_date AND r.to_date
         LIMIT 1
      ) ol ON TRUE
     WHERE e.status IN ('active', 'probation', 'on_leave')
       AND NOT EXISTS (
         SELECT 1 FROM attendance a
          WHERE a.employee_id = e.id AND a.work_date = ${input.workDate}::date
       )
    RETURNING id, status
  `)) as unknown as Array<{ id: string; status: string }>;

  return {
    marked: rows.length,
    absent: rows.filter((r) => r.status === "absent").length,
    onLeave: rows.filter((r) => r.status === "on_leave").length,
  };
}

/**
 * Closes records left open from a day that has ended.
 *
 * The clock-out is the employee's own shift end on that date. Best-effort and
 * idempotent — it only touches records that are still open.
 */
export async function closeStaleAttendance(tx: Tx, companyId: string) {
  const policy = await getPolicy(tx, companyId);
  const tz = getTimezone(policy);
  const today = getLocalYMD(new Date(), tz);

  const open = (await tx.execute(sql`
    SELECT a.id, a.work_date, a.check_in,
           COALESCE(e.shift_end, ${policy.shiftEnd}) AS shift_end
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
     WHERE a.work_date < ${today}::date
       AND a.check_in IS NOT NULL
       AND a.check_out IS NULL
     LIMIT 500
  `)) as unknown as Array<{
    id: string;
    work_date: string;
    check_in: string;
    shift_end: string;
  }>;

  let closed = 0;
  for (const r of open) {
    const day = String(r.work_date).slice(0, 10);
    const shiftEnd = localDateTimeFromYmd(day, r.shift_end, tz);
    // A shift end before the clock-in (a night shift, or a misconfiguration)
    // would be negative hours, which the schema refuses. Use the clock-in
    // itself, which records a zero-length day rather than an impossible one.
    const checkOut =
      shiftEnd.getTime() >= new Date(r.check_in).getTime()
        ? shiftEnd
        : new Date(r.check_in);

    const result = (await tx.execute(sql`
      UPDATE attendance
         SET check_out = ${checkOut.toISOString()},
             auto_closed_out = true,
             auto_closed_at = now(),
             updated_at = now()
       WHERE id = ${r.id}::uuid AND check_out IS NULL
      RETURNING id, hours_worked, standard_hours
    `)) as unknown as Array<Record<string, unknown>>;

    if (result.length) {
      closed++;
      const hours = Number(result[0].hours_worked ?? 0);
      const standard = Number(result[0].standard_hours);
      if (hours < standard / 2) {
        await tx.execute(sql`
          UPDATE attendance SET status = 'half_day', updated_at = now()
           WHERE id = ${r.id}::uuid
        `);
      }
    }
  }

  return { closed };
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** The day's roster: every employee, present or not. */
export async function getDailyRoster(
  tx: Tx,
  input: { workDate: string; departmentId?: string | null; search?: string },
) {
  const filters = [sql`e.status <> 'terminated'`];
  if (input.departmentId) {
    filters.push(sql`e.department_id = ${input.departmentId}::uuid`);
  }
  if (input.search?.trim()) {
    const like = `%${input.search.trim()}%`;
    filters.push(sql`(e.full_name ILIKE ${like} OR e.employee_number ILIKE ${like})`);
  }

  const rows = (await tx.execute(sql`
    SELECT e.id AS employee_id, e.full_name, e.employee_number, e.photo_url,
           d.name AS department,
           a.id AS attendance_id, a.check_in, a.check_out, a.hours_worked,
           a.overtime_hours, a.status, a.method, a.notes, a.auto_closed_out,
           a.shift_start, a.standard_hours
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN attendance a
             ON a.employee_id = e.id AND a.work_date = ${input.workDate}::date
     WHERE ${sql.join(filters, sql` AND `)}
     ORDER BY e.full_name
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    employeeId: String(r.employee_id),
    name: String(r.full_name),
    employeeNumber: String(r.employee_number),
    photoUrl: (r.photo_url as string) ?? null,
    department: (r.department as string) ?? null,
    attendanceId: (r.attendance_id as string) ?? null,
    checkIn: r.check_in ? new Date(r.check_in as string).toISOString() : null,
    checkOut: r.check_out ? new Date(r.check_out as string).toISOString() : null,
    hoursWorked: r.hours_worked === null ? null : Number(r.hours_worked),
    overtimeHours: r.overtime_hours === null ? null : Number(r.overtime_hours),
    // No record at all is "not marked" rather than absent — the difference
    // between nobody having run the roster and somebody not turning up.
    status: (r.status as string) ?? null,
    method: (r.method as string) ?? null,
    notes: (r.notes as string) ?? null,
    autoClosedOut: Boolean(r.auto_closed_out),
    shiftStart: (r.shift_start as string) ?? null,
    standardHours: r.standard_hours === null ? null : Number(r.standard_hours),
  }));
}

export async function getDayStats(tx: Tx, workDate: string) {
  const [row] = (await tx.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM employees WHERE status <> 'terminated') AS headcount,
      COUNT(*) FILTER (WHERE a.status IN ('present', 'late'))::int AS present,
      COUNT(*) FILTER (WHERE a.status = 'late')::int      AS late,
      COUNT(*) FILTER (WHERE a.status = 'absent')::int    AS absent,
      COUNT(*) FILTER (WHERE a.status = 'on_leave')::int  AS on_leave,
      COUNT(*) FILTER (WHERE a.status = 'half_day')::int  AS half_day,
      COUNT(*) FILTER (WHERE a.check_in IS NOT NULL AND a.check_out IS NULL)::int
        AS still_in,
      COALESCE(SUM(a.hours_worked), 0)::numeric(10,2)   AS total_hours,
      COALESCE(SUM(a.overtime_hours), 0)::numeric(10,2) AS total_overtime
      FROM attendance a
     WHERE a.work_date = ${workDate}::date
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    headcount: Number(row.headcount),
    present: Number(row.present),
    late: Number(row.late),
    absent: Number(row.absent),
    onLeave: Number(row.on_leave),
    halfDay: Number(row.half_day),
    stillClockedIn: Number(row.still_in),
    totalHours: Number(row.total_hours),
    totalOvertime: Number(row.total_overtime),
  };
}

export async function getEmployeeAttendance(
  tx: Tx,
  input: { employeeId: string; from: string; to: string; limit?: number },
) {
  const rows = (await tx.execute(sql`
    SELECT id, work_date, check_in, check_out, hours_worked, overtime_hours,
           status, method, notes, auto_closed_out, overridden_by_name
      FROM attendance
     WHERE employee_id = ${input.employeeId}::uuid
       AND work_date BETWEEN ${input.from}::date AND ${input.to}::date
     ORDER BY work_date DESC
     LIMIT ${Math.min(Math.max(input.limit ?? 100, 1), 400)}
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    workDate: String(r.work_date).slice(0, 10),
    checkIn: r.check_in ? new Date(r.check_in as string).toISOString() : null,
    checkOut: r.check_out ? new Date(r.check_out as string).toISOString() : null,
    hoursWorked: r.hours_worked === null ? null : Number(r.hours_worked),
    overtimeHours: r.overtime_hours === null ? null : Number(r.overtime_hours),
    status: String(r.status),
    method: String(r.method),
    notes: (r.notes as string) ?? null,
    autoClosedOut: Boolean(r.auto_closed_out),
    overriddenByName: (r.overridden_by_name as string) ?? null,
  }));
}

/** Totals over a window — for the employee page and for payroll's overtime. */
export async function getAttendanceSummary(
  tx: Tx,
  input: { employeeIds?: string[]; from: string; to: string },
) {
  const scope = input.employeeIds?.length
    ? sql`AND a.employee_id = ANY(${sql.raw(
        `ARRAY[${input.employeeIds.map((id) => `'${id}'`).join(",")}]::uuid[]`,
      )})`
    : sql``;

  const rows = (await tx.execute(sql`
    SELECT a.employee_id,
           COUNT(*) FILTER (WHERE a.status IN ('present', 'late'))::int AS days_present,
           COUNT(*) FILTER (WHERE a.status = 'late')::int      AS days_late,
           COUNT(*) FILTER (WHERE a.status = 'absent')::int    AS days_absent,
           COUNT(*) FILTER (WHERE a.status = 'on_leave')::int  AS days_on_leave,
           COUNT(*) FILTER (WHERE a.status = 'half_day')::int  AS days_half,
           COALESCE(SUM(a.hours_worked), 0)::numeric(10,2)     AS total_hours,
           COALESCE(SUM(a.overtime_hours), 0)::numeric(10,2)   AS total_overtime
      FROM attendance a
     WHERE a.work_date BETWEEN ${input.from}::date AND ${input.to}::date
       ${scope}
     GROUP BY a.employee_id
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    employeeId: String(r.employee_id),
    daysPresent: Number(r.days_present),
    daysLate: Number(r.days_late),
    daysAbsent: Number(r.days_absent),
    daysOnLeave: Number(r.days_on_leave),
    daysHalf: Number(r.days_half),
    totalHours: Number(r.total_hours),
    totalOvertime: Number(r.total_overtime),
  }));
}

/** The clock-in widget's view of the current user. */
export async function getTodayForEmployee(
  tx: Tx,
  input: { companyId: string; employeeId: string },
) {
  const policy = await getPolicy(tx, input.companyId);
  const tz = getTimezone(policy);
  const today = getLocalYMD(new Date(), tz);
  const shift = await shiftFor(tx, input.employeeId, policy);

  const [row] = (await tx.execute(sql`
    SELECT id, check_in, check_out, hours_worked, overtime_hours, status
      FROM attendance
     WHERE employee_id = ${input.employeeId}::uuid AND work_date = ${today}::date
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    workDate: today,
    timezone: tz,
    shiftStart: shift.start,
    shiftEnd: shift.end,
    geofenceEnabled: policy.geofenceEnabled,
    ipWhitelistEnabled: policy.ipWhitelistEnabled,
    record: row
      ? {
          id: String(row.id),
          checkIn: row.check_in ? new Date(row.check_in as string).toISOString() : null,
          checkOut: row.check_out ? new Date(row.check_out as string).toISOString() : null,
          hoursWorked: row.hours_worked === null ? null : Number(row.hours_worked),
          overtimeHours: row.overtime_hours === null ? null : Number(row.overtime_hours),
          status: String(row.status),
        }
      : null,
  };
}
