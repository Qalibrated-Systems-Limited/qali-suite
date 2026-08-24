/**
 * Attendance on Postgres.
 *
 * Hours worked and overtime are generated columns, so what these pin is that
 * every path — clocking out, a manual entry, the forgot-to-clock-out sweep —
 * lands on the SAME arithmetic against the SAME shift. The source computes
 * them in three places, and one uses a hard-coded eight-hour day.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/utils/tenant-utils", () => ({ getTenantContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

async function expectRejection(promise, pattern) {
  let caught;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught, "expected the operation to be rejected").toBeDefined();
  expect(`${caught.message} ${caught.cause ?? ""}`).toMatch(pattern);
}

const staff = await import("@/app/db/repositories/employees");
const leaveRepo = await import("@/app/db/repositories/leave");
const att = await import("@/app/db/repositories/attendance");

suite("attendance", () => {
  let admin, client, db;
  let companyA, jane;

  const actor = { id: "u-hr", name: "HR" };

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    client = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, { max: 1, onnotice: () => {} });
    db = drizzle(client);
  });
  afterAll(async () => {
    if (client) await client.end();
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, users, entry_counters CASCADE`;

    companyA = randomUUID();
    await admin`INSERT INTO companies (id, name, slug)
                VALUES (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)})`;

    await asTenant(companyA, (tx) => leaveRepo.seedLeaveTypes(tx, companyA));

    jane = await asTenant(companyA, (tx) =>
      staff.createEmployee(tx, {
        companyId: companyA, firstName: "Jane", lastName: "Wanjiru",
        hireDate: "2024-01-08",
      }));
  });

  /** 08:00 EAT on a given day, as an instant. */
  const eat = (day, hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return new Date(Date.UTC(
      Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)),
      h - 3, m,
    ));
  };

  describe("the policy", () => {
    it("hands back sensible defaults before anything is configured", async () => {
      const policy = await asTenant(companyA, (tx) => att.getPolicy(tx, companyA));
      expect(policy.timezone).toBe("Africa/Nairobi");
      expect(policy.standardHours).toBe(8);
      expect(policy.lateGraceMinutes).toBe(15);
    });

    it("keeps exactly one policy per company", async () => {
      await asTenant(companyA, (tx) =>
        att.savePolicy(tx, { companyId: companyA, standardHours: 9, actor }));
      await asTenant(companyA, (tx) =>
        att.savePolicy(tx, { companyId: companyA, standardHours: 10, actor }));

      const [{ n }] = await asTenant(companyA, (tx) =>
        tx.execute(sql`SELECT COUNT(*)::int AS n FROM attendance_config`));
      expect(Number(n)).toBe(1);

      const policy = await asTenant(companyA, (tx) => att.getPolicy(tx, companyA));
      expect(policy.standardHours).toBe(10);
    });

    it("refuses a geofence with nowhere to fence", async () => {
      await expectRejection(
        asTenant(companyA, (tx) =>
          att.savePolicy(tx, { companyId: companyA, geofenceEnabled: true, actor })),
        /geofence_has_a_place/i,
      );
    });

    it("refuses an IP whitelist with no addresses on it", async () => {
      // The source treats an empty list as "allow everything", so ticking the
      // box enforces nothing at all.
      await expectRejection(
        asTenant(companyA, (tx) =>
          att.savePolicy(tx, {
            companyId: companyA, ipWhitelistEnabled: true, ipWhitelist: [], actor,
          })),
        /whitelist_has_addresses/i,
      );
    });
  });

  describe("who may clock in", () => {
    const policy = {
      companyId: "c", timezone: "Africa/Nairobi", shiftStart: "08:00",
      shiftEnd: "17:00", standardHours: 8, lateGraceMinutes: 15,
      overtimeRateMultiplier: 1.5, allowedMethods: ["web"],
      ipWhitelistEnabled: false, ipWhitelist: [], ipWhitelistDescription: "Office",
      geofenceEnabled: false, geofenceLat: null, geofenceLng: null,
      geofenceRadiusMetres: 200, geofenceLabel: "Office",
    };

    it("refuses a method that is not allowed", () => {
      const r = att.checkClockInAllowed(policy, { method: "biometric" });
      expect(r.allowed).toBe(false);
      expect(r.reason).toMatch(/not permitted/i);
    });

    it("refuses a network that is not on the list", () => {
      const r = att.checkClockInAllowed(
        { ...policy, ipWhitelistEnabled: true, ipWhitelist: ["192.168.1."] },
        { method: "web", ipAddress: "41.90.1.1" },
      );
      expect(r.allowed).toBe(false);
    });

    it("accepts a prefix match", () => {
      const r = att.checkClockInAllowed(
        { ...policy, ipWhitelistEnabled: true, ipWhitelist: ["192.168.1."] },
        { method: "web", ipAddress: "192.168.1.100" },
      );
      expect(r.allowed).toBe(true);
    });

    it("refuses when the geofence is on and no location was sent", () => {
      const r = att.checkClockInAllowed(
        { ...policy, geofenceEnabled: true, geofenceLat: -1.2921, geofenceLng: 36.8219 },
        { method: "web" },
      );
      expect(r.allowed).toBe(false);
      expect(r.reason).toMatch(/location/i);
    });

    it("measures the distance and says how far off it is", () => {
      const r = att.checkClockInAllowed(
        { ...policy, geofenceEnabled: true, geofenceLat: -1.2921, geofenceLng: 36.8219 },
        { method: "web", location: { lat: -1.30, lng: 36.83 } },
      );
      expect(r.allowed).toBe(false);
      expect(r.reason).toMatch(/\d+m from Office/);
    });
  });

  describe("clocking in and out", () => {
    it("records a punctual arrival as present", async () => {
      const r = await asTenant(companyA, (tx) =>
        att.clockIn(tx, {
          companyId: companyA, employeeId: jane.id, now: eat("2026-08-03", "08:05"),
        }));
      expect(r.status).toBe("present");
      expect(r.workDate).toBe("2026-08-03");
    });

    it("records a late arrival as late, past the grace period", async () => {
      const r = await asTenant(companyA, (tx) =>
        att.clockIn(tx, {
          companyId: companyA, employeeId: jane.id, now: eat("2026-08-03", "08:20"),
        }));
      expect(r.status).toBe("late");
    });

    it("buckets the day in the tenant's timezone, not UTC", async () => {
      // 01:00 EAT on the 4th is 22:00 UTC on the 3rd. The day is the 4th.
      const r = await asTenant(companyA, (tx) =>
        att.clockIn(tx, {
          companyId: companyA, employeeId: jane.id, now: eat("2026-08-04", "01:00"),
        }));
      expect(r.workDate).toBe("2026-08-04");
    });

    it("refuses a second clock-in on the same day", async () => {
      await asTenant(companyA, (tx) =>
        att.clockIn(tx, {
          companyId: companyA, employeeId: jane.id, now: eat("2026-08-03", "08:00"),
        }));
      await expectRejection(
        asTenant(companyA, (tx) =>
          att.clockIn(tx, {
            companyId: companyA, employeeId: jane.id, now: eat("2026-08-03", "09:00"),
          })),
        /already clocked in/i,
      );
    });

    it("computes the hours and the overtime from the record's own shift", async () => {
      await asTenant(companyA, (tx) =>
        att.savePolicy(tx, { companyId: companyA, standardHours: 9, actor }));

      await asTenant(companyA, (tx) =>
        att.clockIn(tx, {
          companyId: companyA, employeeId: jane.id, now: eat("2026-08-03", "08:00"),
        }));
      const out = await asTenant(companyA, (tx) =>
        att.clockOut(tx, { employeeId: jane.id, now: eat("2026-08-03", "18:00") }));

      expect(out.hoursWorked).toBe(10);
      // Nine-hour day, so one hour of overtime — not two. manualAttendanceEntry
      // in the source computes this against a hard-coded 8.
      expect(out.overtimeHours).toBe(1);
    });

    it("marks a short day as half a day", async () => {
      await asTenant(companyA, (tx) =>
        att.clockIn(tx, {
          companyId: companyA, employeeId: jane.id, now: eat("2026-08-03", "08:00"),
        }));
      const out = await asTenant(companyA, (tx) =>
        att.clockOut(tx, { employeeId: jane.id, now: eat("2026-08-03", "11:00") }));
      expect(out.status).toBe("half_day");
    });

    it("has nothing to close when nobody clocked in", async () => {
      await expectRejection(
        asTenant(companyA, (tx) => att.clockOut(tx, { employeeId: jane.id })),
        /no open clock-in/i,
      );
    });

    it("will not record a departure before the arrival", async () => {
      await asTenant(companyA, (tx) =>
        att.clockIn(tx, {
          companyId: companyA, employeeId: jane.id, now: eat("2026-08-03", "12:00"),
        }));
      await expectRejection(
        asTenant(companyA, (tx) =>
          att.clockOut(tx, { employeeId: jane.id, now: eat("2026-08-03", "09:00") })),
        /earlier than the clock-in/i,
      );
    });
  });

  describe("entering a day by hand", () => {
    it("reads HH:MM as the tenant's wall clock", async () => {
      const r = await asTenant(companyA, (tx) =>
        att.recordManualAttendance(tx, {
          companyId: companyA, employeeId: jane.id, workDate: "2026-08-03",
          checkIn: "08:00", checkOut: "17:00", actor,
        }));
      expect(r.hoursWorked).toBe(9);
      // Eight-hour default, so one hour over.
      expect(r.overtimeHours).toBe(1);
    });

    it("uses the COMPANY's standard day, not a hard-coded eight hours", async () => {
      await asTenant(companyA, (tx) =>
        att.savePolicy(tx, { companyId: companyA, standardHours: 9, actor }));

      const r = await asTenant(companyA, (tx) =>
        att.recordManualAttendance(tx, {
          companyId: companyA, employeeId: jane.id, workDate: "2026-08-03",
          checkIn: "08:00", checkOut: "17:00", actor,
        }));
      expect(r.hoursWorked).toBe(9);
      expect(r.overtimeHours).toBe(0);
    });

    it("will not mark somebody present with no arrival time", async () => {
      await expectRejection(
        asTenant(companyA, (tx) =>
          att.recordManualAttendance(tx, {
            companyId: companyA, employeeId: jane.id, workDate: "2026-08-03",
            status: "present", actor,
          })),
        /needs a clock-in time/i,
      );
    });

    it("corrects a day that was already recorded", async () => {
      await asTenant(companyA, (tx) =>
        att.clockIn(tx, {
          companyId: companyA, employeeId: jane.id, now: eat("2026-08-03", "09:30"),
        }));
      const fixed = await asTenant(companyA, (tx) =>
        att.recordManualAttendance(tx, {
          companyId: companyA, employeeId: jane.id, workDate: "2026-08-03",
          checkIn: "08:00", checkOut: "17:00", status: "present",
          notes: "Clocked in late by mistake", actor,
        }));
      expect(fixed.status).toBe("present");
      expect(fixed.hoursWorked).toBe(9);
    });
  });

  describe("marking the day's absentees", () => {
    it("does nothing on a weekend", async () => {
      const r = await asTenant(companyA, (tx) =>
        att.markAbsentees(tx, { companyId: companyA, workDate: "2026-08-08" }));
      // The source marks Saturdays absent, because it never asks whether the
      // date is a working day.
      expect(r.marked).toBe(0);
      expect(r.skipped).toBe("not a working day");
    });

    it("does nothing on a public holiday", async () => {
      await asTenant(companyA, (tx) =>
        tx.execute(sql`
          INSERT INTO public_holidays (company_id, name, day, month, year, is_recurring)
          VALUES (${companyA}::uuid, 'Special Day', 3, 8, 2026, false)`));

      const r = await asTenant(companyA, (tx) =>
        att.markAbsentees(tx, { companyId: companyA, workDate: "2026-08-03" }));
      expect(r.marked).toBe(0);
    });

    it("marks the people who did not turn up", async () => {
      const r = await asTenant(companyA, (tx) =>
        att.markAbsentees(tx, { companyId: companyA, workDate: "2026-08-03" }));
      expect(r.absent).toBe(1);
    });

    it("does NOT call approved leave an absence", async () => {
      const types = await asTenant(companyA, (tx) => leaveRepo.listLeaveTypes(tx));
      const annual = types.find((t) => t.code === "annual");
      await asTenant(companyA, (tx) =>
        leaveRepo.grantYearEntitlements(tx, {
          companyId: companyA, employeeId: jane.id, year: 2026,
        }));
      const req = await asTenant(companyA, (tx) =>
        leaveRepo.createLeaveRequest(tx, {
          companyId: companyA, employeeId: jane.id, leaveTypeId: annual.id,
          fromDate: "2026-08-03", toDate: "2026-08-07", submit: true,
        }));
      await asTenant(companyA, (tx) =>
        leaveRepo.approveLeaveRequest(tx, { id: req.id, actor: { id: "m", name: "M" } }));

      const r = await asTenant(companyA, (tx) =>
        att.markAbsentees(tx, { companyId: companyA, workDate: "2026-08-03" }));
      // The source marks them absent — so leave that HR granted shows on the
      // employee's record as an unexplained absence.
      expect(r.absent).toBe(0);
      expect(r.onLeave).toBe(1);
    });

    it("leaves an existing record alone, and can be run twice", async () => {
      await asTenant(companyA, (tx) =>
        att.clockIn(tx, {
          companyId: companyA, employeeId: jane.id, now: eat("2026-08-03", "08:00"),
        }));
      const first = await asTenant(companyA, (tx) =>
        att.markAbsentees(tx, { companyId: companyA, workDate: "2026-08-03" }));
      const second = await asTenant(companyA, (tx) =>
        att.markAbsentees(tx, { companyId: companyA, workDate: "2026-08-03" }));
      expect(first.marked).toBe(0);
      expect(second.marked).toBe(0);
    });
  });

  describe("forgetting to clock out", () => {
    it("closes yesterday's open record at the shift end", async () => {
      await asTenant(companyA, (tx) =>
        tx.execute(sql`
          INSERT INTO attendance (company_id, employee_id, work_date, check_in,
                                  status, shift_start, standard_hours)
          VALUES (${companyA}::uuid, ${jane.id}::uuid, '2026-01-05'::date,
                  ${eat("2026-01-05", "08:00").toISOString()}, 'present', '08:00', 8)`));

      const { closed } = await asTenant(companyA, (tx) =>
        att.closeStaleAttendance(tx, companyA));
      expect(closed).toBe(1);

      const [row] = await asTenant(companyA, (tx) =>
        att.getEmployeeAttendance(tx, {
          employeeId: jane.id, from: "2026-01-01", to: "2026-01-31",
        }));
      expect(row.hoursWorked).toBe(9);   // 08:00 to 17:00
      expect(row.autoClosedOut).toBe(true);
    });

    it("leaves today's open record alone", async () => {
      await asTenant(companyA, (tx) =>
        att.clockIn(tx, { companyId: companyA, employeeId: jane.id }));
      const { closed } = await asTenant(companyA, (tx) =>
        att.closeStaleAttendance(tx, companyA));
      expect(closed).toBe(0);
    });
  });

  describe("the roster", () => {
    it("shows everybody, and tells apart not-marked from absent", async () => {
      await asTenant(companyA, (tx) =>
        staff.createEmployee(tx, {
          companyId: companyA, firstName: "Peter", lastName: "Otieno",
          hireDate: "2024-01-08",
        }));
      await asTenant(companyA, (tx) =>
        att.clockIn(tx, {
          companyId: companyA, employeeId: jane.id, now: eat("2026-08-03", "08:00"),
        }));

      const roster = await asTenant(companyA, (tx) =>
        att.getDailyRoster(tx, { workDate: "2026-08-03" }));
      expect(roster).toHaveLength(2);

      const jane_ = roster.find((r) => r.name === "Jane Wanjiru");
      const peter = roster.find((r) => r.name === "Peter Otieno");
      expect(jane_.status).toBe("present");
      // Nobody has run the roster for Peter — which is not the same as his
      // having been absent.
      expect(peter.status).toBeNull();
    });

    it("adds up the day", async () => {
      await asTenant(companyA, (tx) =>
        att.clockIn(tx, {
          companyId: companyA, employeeId: jane.id, now: eat("2026-08-03", "08:30"),
        }));
      await asTenant(companyA, (tx) =>
        att.clockOut(tx, { employeeId: jane.id, now: eat("2026-08-03", "18:00") }));

      const stats = await asTenant(companyA, (tx) =>
        att.getDayStats(tx, "2026-08-03"));
      expect(stats.present).toBe(1);
      expect(stats.late).toBe(1);
      expect(stats.totalHours).toBe(9.5);
      expect(stats.totalOvertime).toBe(1.5);
    });
  });
});
