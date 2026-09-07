/**
 * Timesheets, and the end of labour being invisible to a project — 0089.
 *
 * The hole this closes was measured: on the 2026-09-03 worked example a job
 * reported 45.6% margin against a true 18.9%, because a contractor's own
 * wages reached the P&L through payroll and reached no project at all.
 *
 * What is asserted here is mostly the shape of the two lies the schema now
 * refuses — a subcontractor charged twice for the same work, and a person's
 * day sold to three jobs — plus the apportionment that makes a monthly salary
 * split across two jobs sum back to the salary.
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

const { userMessage } = await import("@/app/db/errors");
const repo = await import("@/app/db/repositories/projects");

const failsWith = async (fn, pattern) => {
  const err = await fn().then(
    () => {
      throw new Error("expected a rejection");
    },
    (e) => e,
  );
  expect(userMessage(err)).toMatch(pattern);
};

suite("timesheets — the join to labour", () => {
  let admin, client, db;
  let companyA, project, otherProject, employee, supplier;
  const actor = { id: null, name: "Test User" };

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);

  /** A roster row, which is where the rate and the costing rule live. */
  const roster = (over = {}) =>
    inA((tx) =>
      repo.upsertAssignment(tx, {
        companyId: companyA,
        projectId: over.projectId ?? project,
        partyId: over.partyId ?? employee,
        partyName: over.partyName ?? "Jane Site",
        partyType: over.partyType ?? "employee",
        // `??` would swallow an explicit null, which is exactly the case
        // "the roster carries no rate at all" is testing.
        rateAmount: "rateAmount" in over ? over.rateAmount : "1000.0000",
        rateUnit: "rateUnit" in over ? over.rateUnit : "day",
        assignedByName: "Seed",
      }),
    );

  const log = (assignment, over = {}) =>
    inA((tx) =>
      repo.createTimesheet(tx, {
        companyId: companyA,
        projectId: over.projectId ?? project,
        assignmentId: assignment.id,
        workDate: over.workDate ?? "2026-09-02",
        quantity: over.quantity ?? 1,
        unit: over.unit ?? "day",
        taskId: over.taskId ?? null,
        costCodeId: over.costCodeId ?? null,
        billable: over.billable,
        billRate: over.billRate,
        enteredByName: "Seed",
      }),
    );

  const actualsOf = (id = project) =>
    inA((tx) => repo.computeProjectActuals(tx, id));

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    client = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, {
      max: 1,
      onnotice: () => {},
    });
    db = drizzle(client);
  });
  afterAll(async () => {
    if (client) await client.end();
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, users, _migration_id_map, entry_counters CASCADE`;
    companyA = randomUUID();
    employee = randomUUID();
    supplier = randomUUID();

    await admin`INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)})`;
    await asTenant(companyA, (tx) =>
      tx.execute(sql`
        INSERT INTO parties (id, company_id, primary_type, is_employee, is_supplier, name)
        VALUES
          (${employee}, ${companyA}, 'employee', true, false, 'Jane Site'),
          (${supplier}, ${companyA}, 'supplier', false, true, 'Mwangi Plant Hire')`),
    );

    project = (
      await inA((tx) =>
        repo.createProject(tx, {
          companyId: companyA,
          name: "Otho Road",
          createdByName: "Seed",
        }),
      )
    ).id;
    otherProject = (
      await inA((tx) =>
        repo.createProject(tx, {
          companyId: companyA,
          name: "Bridge",
          createdByName: "Seed",
        }),
      )
    ).id;
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("what a day costs", () => {
    it("multiplies a day rate by days", async () => {
      const a = await roster({ rateAmount: "1000.0000", rateUnit: "day" });
      const t = await log(a, { quantity: 1, unit: "day" });
      expect(Number(t.costAmount)).toBe(1000);
    });

    it("multiplies an hourly rate by hours", async () => {
      const a = await roster({ rateAmount: "250.0000", rateUnit: "hour" });
      const t = await log(a, { quantity: 6, unit: "hour" });
      expect(Number(t.costAmount)).toBe(1500);
    });

    it("converts between the two through the company's standard day", async () => {
      // Eight hours is a day, because attendance_config says so — not because
      // a constant in a screen says so.
      const a = await roster({ rateAmount: "800.0000", rateUnit: "day" });
      const t = await log(a, { quantity: 4, unit: "hour" });
      expect(Number(t.costAmount)).toBe(400);
    });

    it("follows the company's own standard day when it is not eight", async () => {
      await inA((tx) =>
        tx.execute(sql`
          INSERT INTO attendance_config (company_id, standard_hours, allowed_methods, ip_whitelist)
          VALUES (${companyA}, 10, ARRAY['web'], ARRAY[]::text[])
          ON CONFLICT (company_id) DO UPDATE SET standard_hours = 10`),
      );
      const a = await roster({ rateAmount: "1000.0000", rateUnit: "day" });
      const t = await log(a, { quantity: 5, unit: "hour" });
      // Half of a ten-hour day, not five eighths of an eight-hour one.
      expect(Number(t.costAmount)).toBe(500);
    });

    it("apportions a monthly salary across that month's working days", async () => {
      // September 2026: 30 days, 22 of them Mon-Fri, no holidays seeded.
      const a = await roster({ rateAmount: "44000.0000", rateUnit: "month" });
      const t = await log(a, { workDate: "2026-09-02", quantity: 1, unit: "day" });
      expect(Number(t.costAmount)).toBe(2000);
    });

    it("uses each month's OWN working days, so a split month sums back", async () => {
      // The whole reason for working_days() over a flat 22: two different
      // months divide by two different numbers, and each month's days still
      // add up to that month's salary.
      const a = await roster({ rateAmount: "44000.0000", rateUnit: "month" });

      const sept = await log(a, { workDate: "2026-09-02", quantity: 1, unit: "day" });
      const feb = await inA((tx) =>
        repo.createTimesheet(tx, {
          companyId: companyA,
          projectId: project,
          assignmentId: a.id,
          workDate: "2026-02-03",
          quantity: 1,
          unit: "day",
          enteredByName: "Seed",
        }),
      );

      // February 2026 has 20 working days; September has 22. A flat divisor
      // would have made these two numbers equal, and both of them wrong.
      expect(Number(sept.costAmount)).toBe(2000);
      expect(Number(feb.costAmount)).toBe(2200);
    });

    it("takes a public holiday out of the divisor", async () => {
      await inA((tx) =>
        tx.execute(sql`
          INSERT INTO public_holidays (company_id, name, day, month, year, is_recurring)
          VALUES (${companyA}, 'Test Day', 3, 9, 2026, false)`),
      );
      const a = await roster({ rateAmount: "44000.0000", rateUnit: "month" });
      const t = await log(a, { workDate: "2026-09-02", quantity: 1, unit: "day" });
      // 21 working days now, not 22 — the same holiday calendar payroll uses.
      expect(Number(t.costAmount)).toBeCloseTo(44000 / 21, 4);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("only an employee's time produces cost", () => {
    it("records a subcontractor's day and charges nothing for it", async () => {
      // Decision 2. Their cost arrives on a bill carrying the project, and
      // computeActualsFor counts it at approved. Counting the timesheet as
      // well would charge the job twice for the same work.
      const a = await roster({
        partyId: supplier,
        partyName: "Mwangi Plant Hire",
        partyType: "supplier",
        rateAmount: "12000.0000",
        rateUnit: "day",
      });
      const t = await log(a);

      expect(t.costAmount).toBeNull();
      // The quantity is still there — it is what a day-rate argument at the
      // end of the job is had with.
      expect(Number(t.quantity)).toBe(1);
      expect(Number(t.rateAmount)).toBe(12000);
    });

    it("treats `both` as a supplier, because they will invoice you", async () => {
      const a = await roster({
        partyId: supplier,
        partyName: "Mwangi Plant Hire",
        partyType: "both",
        rateAmount: "12000.0000",
      });
      expect((await log(a)).costAmount).toBeNull();
    });

    it("charges nothing for a fixed-price engagement", async () => {
      // A lump sum is a milestone, not a timesheet. The days are recorded and
      // the money comes from the contract.
      const a = await roster({ rateAmount: "500000.0000", rateUnit: "fixed" });
      expect((await log(a)).costAmount).toBeNull();
    });

    it("charges nothing when the roster carries no rate at all", async () => {
      const a = await roster({ rateAmount: null, rateUnit: null });
      const t = await log(a);
      // NULL is "no cost", never "zero cost" — the screen shows a dash.
      expect(t.costAmount).toBeNull();
    });

    it("refuses a cost written directly onto a supplier's line", async () => {
      const a = await roster({
        partyId: supplier,
        partyName: "Mwangi Plant Hire",
        partyType: "supplier",
        rateAmount: "12000.0000",
      });
      const t = await log(a);
      await failsWith(
        () =>
          inA((tx) =>
            tx.execute(sql`
              UPDATE project_timesheets SET cost_amount = 12000 WHERE id = ${t.id}`),
          ),
        /only an employee's time carries a cost/i,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("a person's day cannot be sold twice", () => {
    it("refuses a second full day on the same date", async () => {
      const here = await roster();
      const there = await roster({ projectId: otherProject });

      await log(here, { workDate: "2026-09-02", quantity: 1, unit: "day" });
      await failsWith(
        () =>
          log(there, {
            projectId: otherProject,
            workDate: "2026-09-02",
            quantity: 1,
            unit: "day",
          }),
        /cannot be charged twice/i,
      );
    });

    it("allows a day split across two jobs", async () => {
      const here = await roster();
      const there = await roster({ projectId: otherProject });

      const first = await log(here, { quantity: 5, unit: "hour" });
      const second = await log(there, {
        projectId: otherProject,
        quantity: 3,
        unit: "hour",
      });
      await inA((tx) => repo.setTimesheetStatus(tx, first.id, "approved", actor));
      await inA((tx) => repo.setTimesheetStatus(tx, second.id, "approved", actor));

      // Five hours here and three there is a day, and a monthly salary split
      // this way still sums back to the salary.
      const a = await actualsOf();
      const b = await actualsOf(otherProject);
      expect(a.costs + b.costs).toBeCloseTo(1000, 4);
    });

    it("refuses the nine-hour day that overflows the split", async () => {
      const here = await roster();
      const there = await roster({ projectId: otherProject });
      await log(here, { quantity: 5, unit: "hour" });
      await failsWith(
        () => log(there, { projectId: otherProject, quantity: 4, unit: "hour" }),
        /cannot be charged twice/i,
      );
    });

    it("does not count a rejected line as a claim on the day", async () => {
      const here = await roster();
      const there = await roster({ projectId: otherProject });

      const first = await log(here, { quantity: 1, unit: "day" });
      await inA((tx) => repo.setTimesheetStatus(tx, first.id, "rejected"));

      // The day is free again, which is the point of rejecting it.
      const second = await log(there, {
        projectId: otherProject,
        quantity: 1,
        unit: "day",
      });
      expect(second.id).toBeTruthy();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("what reaches the project's cost", () => {
    it("counts an approved line as incurred and a submitted one as committed", async () => {
      // The same basis 0088 put bills, claims and expenses on.
      const a = await roster();
      const t = await log(a);

      expect((await actualsOf()).costs).toBe(0);

      await inA((tx) => repo.setTimesheetStatus(tx, t.id, "submitted"));
      let actuals = await actualsOf();
      expect(actuals.costs).toBe(0);
      expect(actuals.committed).toBe(1000);

      await inA((tx) => repo.setTimesheetStatus(tx, t.id, "approved", actor));
      actuals = await actualsOf();
      expect(actuals.costs).toBe(1000);
      expect(actuals.committed).toBe(0);
    });

    it("leaves a subcontractor's approved time out of the cost entirely", async () => {
      const a = await roster({
        partyId: supplier,
        partyName: "Mwangi Plant Hire",
        partyType: "supplier",
        rateAmount: "12000.0000",
      });
      const t = await log(a);
      await inA((tx) => repo.setTimesheetStatus(tx, t.id, "approved", actor));

      // Their bill is the number. This must add nothing on top of it.
      expect((await actualsOf()).costs).toBe(0);
    });

    it("summarises labour in both days and hours", async () => {
      const a = await roster();
      const t = await log(a, { quantity: 4, unit: "hour" });
      await inA((tx) => repo.setTimesheetStatus(tx, t.id, "approved", actor));

      const summary = await inA((tx) =>
        repo.getProjectLabourSummary(tx, [project]),
      );
      expect(summary.get(project)).toMatchObject({
        costIncurred: 500,
        days: 0.5,
        hours: 4,
        entries: 1,
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the rate is a snapshot", () => {
    it("does not restate last month's cost when somebody gets a raise", async () => {
      const a = await roster({ rateAmount: "1000.0000", rateUnit: "day" });
      const t = await log(a);
      expect(Number(t.costAmount)).toBe(1000);

      await inA((tx) =>
        repo.updateAssignment(tx, a.id, { rate: { amount: 2000, unit: "day" } }),
      );

      const after = await inA((tx) => repo.getTimesheet(tx, t.id));
      expect(Number(after.costAmount)).toBe(1000);
      expect(Number(after.rateAmount)).toBe(1000);
    });

    it("re-derives when the entry itself is corrected", async () => {
      // Correcting the quantity restates the cost, which is right: an
      // approval is of the day's work, not of a number that is now wrong.
      const a = await roster({ rateAmount: "1000.0000", rateUnit: "day" });
      const t = await log(a, { quantity: 4, unit: "hour" });
      expect(Number(t.costAmount)).toBe(500);

      const fixed = await inA((tx) =>
        repo.updateTimesheet(tx, t.id, { quantity: 8, unit: "hour" }),
      );
      expect(Number(fixed.costAmount)).toBe(1000);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("what it refuses", () => {
    it("refuses time against another project's roster", async () => {
      const elsewhere = await roster({ projectId: otherProject });
      await failsWith(
        () => log(elsewhere, { projectId: project }),
        /different project's roster/i,
      );
    });

    it("refuses time dated after somebody left the roster", async () => {
      const a = await roster();
      await inA((tx) => repo.setAssignmentStatus(tx, a.id, "removed"));
      await failsWith(
        () => log(a, { workDate: "2099-01-05" }),
        /left this project/i,
      );
    });

    it("still accepts time worked BEFORE they left, entered afterwards", async () => {
      const a = await roster();
      await inA((tx) => repo.setAssignmentStatus(tx, a.id, "removed"));
      const t = await log(a, { workDate: "2026-01-05" });
      expect(Number(t.costAmount)).toBe(1000);
    });

    it("refuses more than a day on one line", async () => {
      const a = await roster();
      await failsWith(
        () => log(a, { quantity: 25, unit: "hour" }),
        /cannot be longer than a day/i,
      );
    });

    it("refuses a negative or zero quantity", async () => {
      const a = await roster();
      await failsWith(
        () => log(a, { quantity: 0, unit: "hour" }),
        /enter how long was worked/i,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("approval", () => {
    it("clears the approver when a line is sent back", async () => {
      // The pair CHECK is a biconditional: a line back in draft that kept its
      // approval stamp is how an unapproved day reads as approved.
      const a = await roster();
      const t = await log(a);
      const approved = await inA((tx) =>
        repo.setTimesheetStatus(tx, t.id, "approved", { id: null, name: "Boss" }),
      );
      expect(approved.approvedAt).not.toBeNull();
      expect(approved.approvedByName).toBe("Boss");

      const back = await inA((tx) => repo.setTimesheetStatus(tx, t.id, "draft"));
      expect(back.approvedAt).toBeNull();
      expect(back.approvedByName).toBeNull();
    });

    it("approves a week in one statement, and only what was awaiting it", async () => {
      const a = await roster();
      const one = await log(a, { workDate: "2026-09-01" });
      const two = await log(a, { workDate: "2026-09-02" });
      const draft = await log(a, { workDate: "2026-09-03" });

      await inA((tx) => repo.setTimesheetStatus(tx, one.id, "submitted"));
      await inA((tx) => repo.setTimesheetStatus(tx, two.id, "submitted"));

      const rows = await inA((tx) =>
        repo.approveTimesheets(tx, [one.id, two.id, draft.id], actor),
      );
      // The draft is skipped rather than swept up by a stale checkbox.
      expect(rows).toHaveLength(2);
      expect((await actualsOf()).costs).toBe(2000);
    });

    it("will not delete an approved entry", async () => {
      const a = await roster();
      const t = await log(a);
      await inA((tx) => repo.setTimesheetStatus(tx, t.id, "approved", actor));
      expect(await inA((tx) => repo.deleteTimesheet(tx, t.id))).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("a task's actual hours", () => {
    it("is the sum of its timesheets — 0071's missing column", async () => {
      const t = await inA((tx) =>
        repo.createTask(tx, {
          companyId: companyA,
          projectId: project,
          title: "Earthworks",
          estimatedHours: "16.00",
          createdByName: "Seed",
        }),
      );
      const a = await roster();
      await log(a, { workDate: "2026-09-01", quantity: 6, unit: "hour", taskId: t.id });
      await log(a, { workDate: "2026-09-02", quantity: 4, unit: "hour", taskId: t.id });

      const hours = await inA((tx) => repo.getTaskActualHours(tx, [t.id]));
      expect(hours.get(t.id)).toBe(10);
    });

    it("refuses a task belonging to another project", async () => {
      const stray = await inA((tx) =>
        repo.createTask(tx, {
          companyId: companyA,
          projectId: otherProject,
          title: "Bridge deck",
          createdByName: "Seed",
        }),
      );
      const a = await roster();
      await failsWith(
        () => log(a, { taskId: stray.id }),
        /different project/i,
      );
    });
  });
});
