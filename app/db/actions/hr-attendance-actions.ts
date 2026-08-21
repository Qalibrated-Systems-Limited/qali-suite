"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { withAuthorizedTenant } from "../tenant";
import { roleAllowed } from "@/lib/permissions";
import { HR_VIEW_ROLES, HR_ADMIN_ROLES } from "@/lib/utils/role-gates";
import { userMessage } from "../errors";
import * as attendance from "../repositories/attendance";
import * as employees from "../repositories/employees";
import { getLocalYMD, getTimezone } from "@/lib/hr/time";

/**
 * Postgres-backed attendance actions.
 *
 * The caller's IP is read from the request headers HERE rather than trusted
 * from the client. The source takes `ipAddress` as an argument from the
 * browser, so an IP whitelist — a security control — could be satisfied by
 * sending the right string.
 */

const MARK_ROLES = ["SuperAdmin", "Admin", "Manager", "HR Manager"];

export type ActionResult =
  | { success: true; message?: string; [key: string]: unknown }
  | { success: false; error: string; enforced?: boolean };

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
};

/**
 * The address the request actually came from.
 *
 * x-forwarded-for is a list; the client's own address is the first entry.
 */
async function callerIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip");
}

export async function clockIn(input: {
  location?: { lat?: number; lng?: number; accuracy?: number } | null;
  method?: string;
} = {}): Promise<ActionResult> {
  const ipAddress = await callerIp();

  try {
    const result = await withAuthorizedTenant([], async (tx, { user, companyId }) => {
      const me = await employees.getEmployeeByUser(tx, user.id);
      if (!me) {
        throw new Error(
          "You do not have an employee record yet, so there is nothing to clock in against. Ask HR to create one.",
        );
      }
      // Somebody else's open record from a previous day, closed first, so
      // today starts clean.
      await attendance.closeStaleAttendance(tx, companyId);

      return attendance.clockIn(tx, {
        companyId,
        employeeId: me.id,
        method: input.method ?? "web",
        ipAddress,
        location: input.location ?? null,
      });
    });

    revalidatePath("/dashboard/hr/attendance");
    revalidatePath("/dashboard/hr/my-attendance");
    return { success: true, ...result };
  } catch (err) {
    const enforced = (err as { enforced?: boolean })?.enforced === true;
    return {
      success: false,
      error: userMessage(err, "Could not clock you in."),
      ...(enforced ? { enforced: true } : {}),
    };
  }
}

export async function clockOut(): Promise<ActionResult> {
  const ipAddress = await callerIp();

  try {
    const result = await withAuthorizedTenant([], async (tx, { user }) => {
      const me = await employees.getEmployeeByUser(tx, user.id);
      if (!me) throw new Error("You do not have an employee record yet.");
      return attendance.clockOut(tx, { employeeId: me.id, ipAddress });
    });

    revalidatePath("/dashboard/hr/attendance");
    revalidatePath("/dashboard/hr/my-attendance");
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not clock you out.") };
  }
}

export async function recordManualAttendance(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const employeeId = str(formData, "employeeId");
  const workDate = str(formData, "date") || str(formData, "workDate");
  if (!employeeId || !workDate) {
    return { success: false, error: "Employee and date are required" };
  }

  try {
    await withAuthorizedTenant(MARK_ROLES, (tx, { user, companyId }) =>
      attendance.recordManualAttendance(tx, {
        companyId,
        employeeId,
        workDate,
        checkIn: str(formData, "checkIn") || null,
        checkOut: str(formData, "checkOut") || null,
        status: str(formData, "status") || undefined,
        shift: str(formData, "shift") || undefined,
        notes: str(formData, "notes") || null,
        actor: { id: user.id, name: user.name },
      }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not save the record.") };
  }

  revalidatePath("/dashboard/hr/attendance");
  revalidatePath(`/dashboard/hr/employees/${employeeId}/attendance`);
  return { success: true };
}

export async function markAbsentees(workDate: string): Promise<ActionResult> {
  try {
    const result = await withAuthorizedTenant(MARK_ROLES, (tx, { companyId }) =>
      attendance.markAbsentees(tx, { companyId, workDate }),
    );

    revalidatePath("/dashboard/hr/attendance");
    if (result.marked === 0 && "skipped" in result) {
      return {
        success: true,
        message: `${workDate} is not a working day — nothing to mark.`,
      };
    }
    const parts = [];
    if (result.absent) parts.push(`${result.absent} absent`);
    if (result.onLeave) parts.push(`${result.onLeave} on approved leave`);
    return {
      success: true,
      message: parts.length ? `Marked ${parts.join(", ")}.` : "Everybody is already accounted for.",
      ...result,
    };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not mark the day.") };
  }
}

export async function saveAttendancePolicy(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const list = (key: string) =>
    str(formData, key)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  try {
    await withAuthorizedTenant([...HR_ADMIN_ROLES], (tx, { user, companyId }) =>
      attendance.savePolicy(tx, {
        companyId,
        timezone: str(formData, "timezone") || undefined,
        shiftStart: str(formData, "shiftStart") || undefined,
        shiftEnd: str(formData, "shiftEnd") || undefined,
        standardHours: Number(str(formData, "standardHours") || 8),
        lateGraceMinutes: Number(str(formData, "lateGraceMinutes") || 15),
        overtimeRateMultiplier: Number(str(formData, "overtimeRateMultiplier") || 1.5),
        allowedMethods: list("allowedMethods"),
        ipWhitelistEnabled: formData.get("ipWhitelistEnabled") === "true",
        ipWhitelist: list("ipWhitelist"),
        ipWhitelistDescription: str(formData, "ipWhitelistDescription") || undefined,
        geofenceEnabled: formData.get("geofenceEnabled") === "true",
        geofenceLat: str(formData, "geofenceLat") ? Number(str(formData, "geofenceLat")) : null,
        geofenceLng: str(formData, "geofenceLng") ? Number(str(formData, "geofenceLng")) : null,
        geofenceRadiusMetres: Number(str(formData, "geofenceRadiusMetres") || 200),
        geofenceLabel: str(formData, "geofenceLabel") || undefined,
        actor: { id: user.id, name: user.name },
      }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not save the attendance policy.") };
  }

  revalidatePath("/dashboard/settings/attendance-config");
  revalidatePath("/dashboard/hr/attendance");
  return { success: true, message: "Attendance policy saved." };
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getAttendanceForPage(
  opts: { workDate?: string; departmentId?: string; search?: string } = {},
) {
  return withAuthorizedTenant([...HR_VIEW_ROLES], async (tx, { companyId }) => {
    const policy = await attendance.getPolicy(tx, companyId);
    const workDate = opts.workDate || getLocalYMD(new Date(), getTimezone(policy));

    // Best-effort: yesterday's forgotten clock-outs, closed on the way in.
    await attendance.closeStaleAttendance(tx, companyId);

    const [roster, stats] = await Promise.all([
      attendance.getDailyRoster(tx, {
        workDate,
        departmentId: opts.departmentId || null,
        search: opts.search,
      }),
      attendance.getDayStats(tx, workDate),
    ]);

    return { workDate, timezone: policy.timezone, roster, stats, policy };
  });
}

export async function getEmployeeAttendanceForPage(input: {
  employeeId: string;
  month: number;
  year: number;
}) {
  const from = `${input.year}-${String(input.month).padStart(2, "0")}-01`;
  return withAuthorizedTenant([...HR_VIEW_ROLES], async (tx) => {
    const [{ last_day }] = (await tx.execute(
      // From the database, so the month's last day is not lost to a timezone.
      (await import("drizzle-orm")).sql`
        SELECT (date_trunc('month', ${from}::date) + interval '1 month - 1 day')::date AS last_day`,
    )) as unknown as Array<{ last_day: string }>;
    const to = String(last_day).slice(0, 10);

    const [employee, records, summary] = await Promise.all([
      employees.getEmployee(tx, input.employeeId),
      attendance.getEmployeeAttendance(tx, { employeeId: input.employeeId, from, to }),
      attendance.getAttendanceSummary(tx, {
        employeeIds: [input.employeeId],
        from,
        to,
      }),
    ]);

    return {
      employee,
      records,
      summary: summary[0] ?? {
        employeeId: input.employeeId,
        daysPresent: 0, daysLate: 0, daysAbsent: 0,
        daysOnLeave: 0, daysHalf: 0, totalHours: 0, totalOvertime: 0,
      },
      from,
      to,
    };
  });
}

/** What the clock-in widget shows the signed-in user. */
export async function getMyAttendanceToday() {
  return withAuthorizedTenant([], async (tx, { user, companyId }) => {
    const me = await employees.getEmployeeByUser(tx, user.id);
    if (!me) return { employee: null, today: null };

    await attendance.closeStaleAttendance(tx, companyId);
    const today = await attendance.getTodayForEmployee(tx, {
      companyId,
      employeeId: me.id,
    });
    return {
      employee: { id: me.id, name: me.fullName, employeeNumber: me.employeeNumber },
      today,
    };
  });
}

export async function getMyAttendanceHistory(month: number, year: number) {
  return withAuthorizedTenant([], async (tx, { user }) => {
    const me = await employees.getEmployeeByUser(tx, user.id);
    if (!me) return { employee: null, records: [], summary: null };

    const from = `${year}-${String(month).padStart(2, "0")}-01`;
    const [{ last_day }] = (await tx.execute(
      (await import("drizzle-orm")).sql`
        SELECT (date_trunc('month', ${from}::date) + interval '1 month - 1 day')::date AS last_day`,
    )) as unknown as Array<{ last_day: string }>;
    const to = String(last_day).slice(0, 10);

    const [records, summary] = await Promise.all([
      attendance.getEmployeeAttendance(tx, { employeeId: me.id, from, to }),
      attendance.getAttendanceSummary(tx, { employeeIds: [me.id], from, to }),
    ]);

    return {
      employee: { id: me.id, name: me.fullName, employeeNumber: me.employeeNumber },
      records,
      summary: summary[0] ?? null,
      from,
      to,
    };
  });
}

export async function getAttendancePolicy() {
  return withAuthorizedTenant([...HR_VIEW_ROLES], (tx, { companyId }) =>
    attendance.getPolicy(tx, companyId),
  );
}

/** Whether the current user may use the clock-in widget at all. */
export async function canClockIn() {
  return withAuthorizedTenant([], async (tx, { user }) => {
    const me = await employees.getEmployeeByUser(tx, user.id);
    return {
      hasEmployeeRecord: Boolean(me),
      isManager: roleAllowed(user.role, MARK_ROLES),
    };
  });
}
