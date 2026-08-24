/**
 * Leave on Postgres.
 *
 * The balance is not a counter here, so most of these assert the thing the
 * source could not: that what is available follows from the requests, straight
 * away, however the requests got into that state.
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
const leave = await import("@/app/db/repositories/leave");

suite("leave", () => {
  let admin, client, db;
  let companyA, otherCompany, annual, unpaid, sick, jane, peter;

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
    await admin`TRUNCATE companies CASCADE`;
    // users is platform-wide, so truncating companies does not clear it.
    await admin`TRUNCATE users, entry_counters CASCADE`;

    companyA = randomUUID();
    otherCompany = randomUUID();
    await admin`INSERT INTO companies (id, name, slug) VALUES
      (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)}),
      (${otherCompany}, 'Elsewhere', ${"e-" + otherCompany.slice(0, 8)})`;

    await asTenant(companyA, (tx) => leave.seedLeaveTypes(tx, companyA));
    const types = await asTenant(companyA, (tx) => leave.listLeaveTypes(tx));
    annual = types.find((t) => t.code === "annual");
    unpaid = types.find((t) => t.code === "unpaid");
    sick = types.find((t) => t.code === "sick");

    jane = await asTenant(companyA, (tx) =>
      staff.createEmployee(tx, {
        companyId: companyA, firstName: "Jane", lastName: "Wanjiru",
        hireDate: "2025-01-06", gender: "female", basicSalary: 60000,
      }));
    peter = await asTenant(companyA, (tx) =>
      staff.createEmployee(tx, {
        companyId: companyA, firstName: "Peter", lastName: "Otieno",
        hireDate: "2025-01-06", gender: "male",
      }));

    await asTenant(companyA, (tx) =>
      leave.grantYearEntitlements(tx, {
        companyId: companyA, employeeId: jane.id, year: 2026, gender: "female",
      }));
  });

  const request = (over = {}) =>
    asTenant(companyA, (tx) =>
      leave.createLeaveRequest(tx, {
        companyId: companyA,
        employeeId: jane.id,
        leaveTypeId: annual.id,
        fromDate: "2026-03-02",   // Monday
        toDate: "2026-03-06",     // Friday
        submit: true,
        actor: { id: "hr1", name: "HR" },
        ...over,
      }));

  describe("leave types", () => {
    it("seeds the standard set once", async () => {
      const again = await asTenant(companyA, (tx) => leave.seedLeaveTypes(tx, companyA));
      expect(again.seeded).toBe(0);
      const types = await asTenant(companyA, (tx) => leave.listLeaveTypes(tx));
      expect(types.map((t) => t.code)).toContain("annual");
      expect(types).toHaveLength(6);
    });

    it("says which types consume an entitlement, as data", async () => {
      // The source asks `leaveType !== "unpaid"` at five call sites, so renaming
      // the code silently starts deducting unpaid leave from annual.
      expect(unpaid.affectsBalance).toBe(false);
      expect(unpaid.isPaid).toBe(false);
      expect(annual.affectsBalance).toBe(true);
    });

    it("refuses a carry-over cap larger than the entitlement", async () => {
      await expectRejection(
        asTenant(companyA, (tx) =>
          leave.createLeaveType(tx, {
            companyId: companyA, name: "Study", defaultEntitlement: 5, maxCarryOver: 10,
          })),
        /carry_over_within_entitlement/i,
      );
    });

    it("will not delete a type that has been used", async () => {
      await request();
      await expectRejection(
        asTenant(companyA, (tx) => leave.deleteLeaveType(tx, annual.id)),
        /standard leave type|leave request/i,
      );
    });
  });

  describe("the balance", () => {
    it("moves with the request, at every step", async () => {
      const balances = () =>
        asTenant(companyA, (tx) => leave.getLeaveBalances(tx, jane.id, 2026));

      const before = (await balances()).find((b) => b.code === "annual");
      expect(before.entitledDays).toBe(21);
      expect(before.availableDays).toBe(21);

      const r = await request();       // 5 working days, submitted
      const pending = (await balances()).find((b) => b.code === "annual");
      expect(pending.pendingDays).toBe(5);
      expect(pending.takenDays).toBe(0);
      // Available drops while a decision is outstanding, so two requests
      // cannot both be made against the same days.
      expect(pending.availableDays).toBe(16);
      expect(pending.balanceDays).toBe(21);

      await asTenant(companyA, (tx) =>
        leave.approveLeaveRequest(tx, { id: r.id, actor: { id: "mgr", name: "Manager" } }));

      const taken = (await balances()).find((b) => b.code === "annual");
      expect(taken.takenDays).toBe(5);
      expect(taken.pendingDays).toBe(0);
      expect(taken.balanceDays).toBe(16);
      expect(taken.availableDays).toBe(16);
    });

    it("gives the days back when a request is rejected", async () => {
      const r = await request();
      await asTenant(companyA, (tx) =>
        leave.rejectLeaveRequest(tx, {
          id: r.id, reason: "Cover not available", actor: { id: "mgr", name: "Manager" },
        }));

      const b = (await asTenant(companyA, (tx) =>
        leave.getLeaveBalances(tx, jane.id, 2026))).find((x) => x.code === "annual");
      expect(b.pendingDays).toBe(0);
      expect(b.availableDays).toBe(21);
    });

    it("is right even when the status is changed behind the application's back", async () => {
      // The point of deriving it. A counter would now be wrong forever.
      const r = await request();
      await asTenant(companyA, (tx) =>
        tx.execute(sql`UPDATE leave_requests SET status = 'approved',
                       approved_at = now() WHERE id = ${r.id}::uuid`));

      const b = (await asTenant(companyA, (tx) =>
        leave.getLeaveBalances(tx, jane.id, 2026))).find((x) => x.code === "annual");
      expect(b.takenDays).toBe(5);
      expect(b.balanceDays).toBe(16);
    });

    it("does not touch the balance for a type that consumes none", async () => {
      await asTenant(companyA, (tx) =>
        leave.createLeaveRequest(tx, {
          companyId: companyA, employeeId: jane.id, leaveTypeId: unpaid.id,
          fromDate: "2026-04-06", toDate: "2026-04-10", submit: true,
        }));

      const b = (await asTenant(companyA, (tx) =>
        leave.getLeaveBalances(tx, jane.id, 2026))).find((x) => x.code === "annual");
      expect(b.availableDays).toBe(21);
    });

    it("refuses a request longer than what is left", async () => {
      await expectRejection(
        request({ fromDate: "2026-03-02", toDate: "2026-05-29" }),
        /Not enough Annual Leave/i,
      );
    });
  });

  describe("counting the days", () => {
    it("counts working days, not calendar days", async () => {
      const r = await request({ fromDate: "2026-03-02", toDate: "2026-03-08" });
      // Mon-Sun is seven days; five of them are working days.
      expect(Number(r.totalDays)).toBe(5);
    });

    it("skips public holidays", async () => {
      await asTenant(companyA, (tx) =>
        tx.execute(sql`
          INSERT INTO public_holidays (company_id, name, day, month, year, is_recurring)
          VALUES (${companyA}::uuid, 'Special Day', 4, 3, 2026, false)`));

      const r = await request({ fromDate: "2026-03-02", toDate: "2026-03-06" });
      expect(Number(r.totalDays)).toBe(4);
    });

    it("refuses a period with no working days in it at all", async () => {
      await expectRejection(
        request({ fromDate: "2026-03-07", toDate: "2026-03-08" }), // Sat-Sun
        /no working days/i,
      );
    });

    it("will not accept a half day spread over a week", async () => {
      await expectRejection(
        request({ fromDate: "2026-03-02", toDate: "2026-03-06", isHalfDay: true }),
        /half day is a single day/i,
      );
    });
  });

  describe("overlapping leave", () => {
    it("cannot be booked twice over the same days", async () => {
      await request();
      await expectRejection(
        request({ fromDate: "2026-03-04", toDate: "2026-03-10", leaveTypeId: sick.id }),
        /leave_requests_no_overlap/i,
      );
    });

    it("does not block a rejected request from being re-requested", async () => {
      const r = await request();
      await asTenant(companyA, (tx) =>
        leave.rejectLeaveRequest(tx, {
          id: r.id, reason: "Try another week", actor: { id: "mgr", name: "M" },
        }));
      // A rejection reserves nothing.
      await expect(request()).resolves.toBeTruthy();
    });

    it("does not block the SAME days for a different person", async () => {
      await request();
      await asTenant(companyA, (tx) =>
        leave.grantYearEntitlements(tx, {
          companyId: companyA, employeeId: peter.id, year: 2026, gender: "male",
        }));
      await expect(request({ employeeId: peter.id })).resolves.toBeTruthy();
    });
  });

  describe("the workflow", () => {
    it("recalls a request back to DRAFT, so it can be sent again", async () => {
      const r = await request();
      const recalled = await asTenant(companyA, (tx) =>
        leave.recallLeaveRequest(tx, { id: r.id }));

      // The source leaves it in a 'recalled' state that submit() will not
      // accept, so the request is stranded and the employee must start again.
      expect(recalled.status).toBe("draft");
      expect(recalled.recalledAt).toBeTruthy();

      const resubmitted = await asTenant(companyA, (tx) =>
        leave.submitLeaveRequest(tx, { id: r.id }));
      expect(resubmitted.status).toBe("submitted");
    });

    it("will not let somebody approve their own leave", async () => {
      // A real login, because employees.user_id is a foreign key now.
      await admin`INSERT INTO users (id, name, email, role, home_company_id)
                  VALUES ('u-jane', 'Jane Wanjiru', 'jane@example.com', 'Employee', ${companyA})`;
      await asTenant(companyA, (tx) =>
        tx.execute(sql`UPDATE employees SET user_id = 'u-jane' WHERE id = ${jane.id}::uuid`));
      const r = await request();
      await expectRejection(
        asTenant(companyA, (tx) =>
          leave.approveLeaveRequest(tx, { id: r.id, actor: { id: "u-jane", name: "Jane" } })),
        /can't approve your own/i,
      );
    });

    it("requires a reason to reject", async () => {
      const r = await request();
      await expectRejection(
        asTenant(companyA, (tx) =>
          leave.rejectLeaveRequest(tx, { id: r.id, reason: "  ", actor: { id: "m", name: "M" } })),
        /needs a reason/i,
      );
    });

    it("cancels approved leave that has not been taken, and returns the days", async () => {
      const r = await request({ fromDate: "2026-12-07", toDate: "2026-12-11" });
      await asTenant(companyA, (tx) =>
        leave.approveLeaveRequest(tx, { id: r.id, actor: { id: "mgr", name: "M" } }));

      // The source defines an ADMIN_CANCEL role list and a 'cancelled' status
      // and implements neither, so this could only be undone in the database.
      const cancelled = await asTenant(companyA, (tx) =>
        leave.cancelLeaveRequest(tx, {
          id: r.id, reason: "Project deadline moved", actor: { id: "hr", name: "HR" },
        }));
      expect(cancelled.status).toBe("cancelled");

      const b = (await asTenant(companyA, (tx) =>
        leave.getLeaveBalances(tx, jane.id, 2026))).find((x) => x.code === "annual");
      expect(b.availableDays).toBe(21);
    });

    it("marks finished leave complete, dated when it actually ended", async () => {
      const r = await request({ fromDate: "2026-01-05", toDate: "2026-01-09" });
      await asTenant(companyA, (tx) =>
        leave.approveLeaveRequest(tx, { id: r.id, actor: { id: "m", name: "M" } }));

      const { completed } = await asTenant(companyA, (tx) =>
        leave.completeFinishedLeave(tx, companyA));
      expect(completed).toBe(1);

      const after = await asTenant(companyA, (tx) => leave.getLeaveRequest(tx, r.id));
      expect(after.status).toBe("completed");
      expect(after.completedAt.slice(0, 10)).toBe("2026-01-09");
    });
  });

  describe("year end", () => {
    it("carries unused days forward WITHOUT erasing last year", async () => {
      await asTenant(companyA, (tx) =>
        leave.setEntitlement(tx, {
          companyId: companyA, employeeId: jane.id, leaveTypeId: annual.id,
          year: 2026, entitledDays: 21,
        }));
      const r = await request();   // 5 days
      await asTenant(companyA, (tx) =>
        leave.approveLeaveRequest(tx, { id: r.id, actor: { id: "m", name: "M" } }));

      const { processed, totalCarried } = await asTenant(companyA, (tx) =>
        leave.runCarryOver(tx, { companyId: companyA, fromYear: 2026, toYear: 2027 }));
      expect(processed).toBe(1);
      // 16 unused, capped at the type's max of 5.
      expect(totalCarried).toBe(5);

      const next = (await asTenant(companyA, (tx) =>
        leave.getLeaveBalances(tx, jane.id, 2027))).find((x) => x.code === "annual");
      expect(next.carryOverDays).toBe(5);
      expect(next.entitledDays).toBe(21);
      expect(next.availableDays).toBe(26);

      // And 2026 is untouched — the source overwrites the row's year, which
      // erases the record of what was taken.
      const prev = (await asTenant(companyA, (tx) =>
        leave.getLeaveBalances(tx, jane.id, 2026))).find((x) => x.code === "annual");
      expect(prev.takenDays).toBe(5);
      expect(prev.entitledDays).toBe(21);
    });

    it("runs the carry-over twice with the same result", async () => {
      const once = await asTenant(companyA, (tx) =>
        leave.runCarryOver(tx, { companyId: companyA, fromYear: 2026, toYear: 2027 }));
      const twice = await asTenant(companyA, (tx) =>
        leave.runCarryOver(tx, { companyId: companyA, fromYear: 2026, toYear: 2027 }));
      expect(twice.totalCarried).toBe(once.totalCarried);

      const next = (await asTenant(companyA, (tx) =>
        leave.getLeaveBalances(tx, jane.id, 2027))).find((x) => x.code === "annual");
      expect(next.carryOverDays).toBe(5);
    });
  });

  describe("accrual", () => {
    it("states the entitlement as a total, so running it twice changes nothing", async () => {
      await asTenant(companyA, (tx) =>
        leave.runAccrual(tx, {
          companyId: companyA, year: 2026, throughMonth: 6,
          leaveTypeId: annual.id, daysPerMonth: 1.75,
        }));
      await asTenant(companyA, (tx) =>
        leave.runAccrual(tx, {
          companyId: companyA, year: 2026, throughMonth: 6,
          leaveTypeId: annual.id, daysPerMonth: 1.75,
        }));

      const b = (await asTenant(companyA, (tx) =>
        leave.getLeaveBalances(tx, jane.id, 2026))).find((x) => x.code === "annual");
      // The source uses $inc, so the second run would make this 21.
      expect(b.entitledDays).toBe(10.5);
    });

    it("accrues from the hire month for somebody who joined mid-year", async () => {
      const late = await asTenant(companyA, (tx) =>
        staff.createEmployee(tx, {
          companyId: companyA, firstName: "Late", lastName: "Joiner",
          hireDate: "2026-04-01",
        }));

      await asTenant(companyA, (tx) =>
        leave.runAccrual(tx, {
          companyId: companyA, year: 2026, throughMonth: 6,
          leaveTypeId: annual.id, daysPerMonth: 1.75,
        }));

      const b = (await asTenant(companyA, (tx) =>
        leave.getLeaveBalances(tx, late.id, 2026))).find((x) => x.code === "annual");
      // April, May, June — three months, not six. The source credits everyone
      // the same regardless of when they started.
      expect(b.entitledDays).toBe(5.25);
    });
  });

  describe("encashment", () => {
    it("records a payout separately from leave actually taken", async () => {
      const { amount } = await asTenant(companyA, (tx) =>
        leave.encashLeave(tx, {
          companyId: companyA, employeeId: jane.id, leaveTypeId: annual.id,
          year: 2026, days: 5, dailyRate: 2000,
        }));
      expect(amount).toBe(10000);

      const b = (await asTenant(companyA, (tx) =>
        leave.getLeaveBalances(tx, jane.id, 2026))).find((x) => x.code === "annual");
      expect(b.encashedDays).toBe(5);
      // NOT counted as days taken — the source adds them to usedDays, which
      // makes a payout look like an absence on every report.
      expect(b.takenDays).toBe(0);
      expect(b.availableDays).toBe(16);
    });

    it("refuses to encash more than is left", async () => {
      await expectRejection(
        asTenant(companyA, (tx) =>
          leave.encashLeave(tx, {
            companyId: companyA, employeeId: jane.id, leaveTypeId: annual.id,
            year: 2026, days: 30, dailyRate: 2000,
          })),
        /Not enough leave to encash/i,
      );
    });
  });

  describe("tenant isolation", () => {
    it("keeps one company's leave out of another's", async () => {
      await request();
      const mine = await asTenant(companyA, (tx) => leave.listLeaveRequests(tx));
      expect(mine.total).toBe(1);

      const theirs = await asTenant(otherCompany, (tx) => leave.listLeaveRequests(tx));
      expect(theirs.total).toBe(0);
    });
  });
});
