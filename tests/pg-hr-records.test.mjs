/**
 * HR records: probation, letters, disciplinary and grievance cases, training
 * and certificates, performance reviews and recruitment (20261116T063101).
 *
 * Runs through the restricted app role, so RLS is live: the last test checks
 * another company cannot see a single one of these records.
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
const hr = await import("@/app/db/repositories/hrRecords");
const { draftLetter } = await import("@/lib/hr/letters");

suite("HR records", () => {
  let admin, client, db;
  let companyA, companyB, jane, peter;
  const actor = { id: "u-hr", name: "Hannah HR" };

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  const asA = (fn) => asTenant(companyA, fn);

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    client = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, { max: 1, onnotice: () => {} });
    db = drizzle(client);
  });
  afterAll(async () => {
    if (client) await client.end();
    if (admin) await admin.end();
  });

  const hire = (companyId, over) =>
    asTenant(companyId, (tx) =>
      staff.createEmployee(tx, {
        companyId,
        firstName: "Jane",
        lastName: "Wanjiru",
        nationalId: String(Math.floor(Math.random() * 1e8)),
        kraPin: `A${Math.floor(Math.random() * 1e9)}Z`,
        hireDate: "2026-06-01",
        designation: "Site Engineer",
        workLocation: "Nairobi",
        basicSalary: 80000,
        allowanceHousing: 20000,
        bankName: "KCB",
        bankAccount: String(Math.floor(Math.random() * 1e10)),
        ...over,
      }));

  beforeEach(async () => {
    await admin`TRUNCATE companies, users, entry_counters CASCADE`;
    companyA = randomUUID();
    companyB = randomUUID();
    for (const [id, name] of [[companyA, "Pilot Engineering"], [companyB, "Other Co"]]) {
      await admin`INSERT INTO companies (id, name, slug) VALUES (${id}, ${name}, ${"c-" + id.slice(0, 8)})`;
    }
    jane = await hire(companyA, {});
    peter = await hire(companyA, { firstName: "Peter", lastName: "Otieno", designation: "Technician" });
  });

  describe("probation", () => {
    it("is set from the hire date by the migration rule, and capped at twelve months", async () => {
      await asA((tx) => tx.execute(sql`UPDATE employees SET status = 'probation' WHERE id = ${jane.id}::uuid`));
      const set = await asA((tx) => hr.setProbationEnd(tx, jane.id, "2026-12-01", actor));
      expect(set.probationEndDate).toBe("2026-12-01");
      await expectRejection(asA((tx) => hr.setProbationEnd(tx, jane.id, "2027-07-01", actor)), /twelve months/);
      await expectRejection(asA((tx) => hr.setProbationEnd(tx, jane.id, "2026-05-01", actor)), /before the hire date/);
    });

    it("lists a probation that ends within thirty days", async () => {
      const soon = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
      await asA((tx) => tx.execute(sql`
        UPDATE employees SET status = 'probation', hire_date = CURRENT_DATE - 160, probation_end_date = ${soon}::date
         WHERE id = ${jane.id}::uuid`));
      const alerts = await asA((tx) => hr.getHrRecordAlerts(tx));
      expect(alerts.probation_due).toBe(1);
      expect(alerts.probation[0].name).toMatch(/Jane/);
    });
  });

  describe("letters", () => {
    it("drafts standard wording, numbers the letter, and voids it only with a reason", async () => {
      const facts = await asA((tx) => hr.getEmployeeFacts(tx, jane.id));
      const draft = draftLetter("appointment", { employee: facts, company: { name: "Pilot Engineering" } });
      expect(draft.subject).toMatch(/appointment/i);
      expect(draft.body).toMatch(/KES 100,000\.00/);
      expect(draft.body).toMatch(/twenty-one working days/);

      const letter = await asA((tx) =>
        hr.createLetter(tx, { companyId: companyA, employeeId: jane.id, kind: "appointment", ...draft, actor }));
      expect(letter.letterNumber).toBe("HRL-00001");

      await expectRejection(asA((tx) => hr.voidLetter(tx, letter.id, " ")), /why/);
      const voided = await asA((tx) => hr.voidLetter(tx, letter.id, "Wrong salary"));
      expect(voided.status).toBe("void");
      await expectRejection(asA((tx) => hr.voidLetter(tx, letter.id, "again")), /already void/);
    });

    it("refuses an unknown kind or an empty body", async () => {
      await expectRejection(
        asA((tx) => hr.createLetter(tx, { companyId: companyA, employeeId: jane.id, kind: "bribe", subject: "x", body: "y", actor })),
        /kind of letter/,
      );
      await expectRejection(
        asA((tx) => hr.createLetter(tx, { companyId: companyA, employeeId: jane.id, kind: "general", subject: "x", body: "  ", actor })),
        /needs a body/,
      );
    });
  });

  describe("disciplinary and grievance cases", () => {
    const open = (over = {}) =>
      asA((tx) =>
        hr.createCase(tx, {
          companyId: companyA,
          employeeId: jane.id,
          caseType: "disciplinary",
          category: "absenteeism",
          incidentDate: "2026-10-01",
          description: "Absent without leave on 1 October.",
          actor,
          ...over,
        }));

    it("will not warn without a hearing (s.41), and dates the warning's expiry", async () => {
      const c = await open();
      expect(c.caseNumber).toBe("DC-00001");
      await expectRejection(asA((tx) => hr.advanceCase(tx, c.id, { kind: "close", outcome: "written_warning" }, actor)), /s\.41/);

      await asA((tx) => hr.advanceCase(tx, c.id, { kind: "show_cause", issuedOn: "2026-10-02", responseDueOn: "2026-10-05" }, actor));
      await asA((tx) => hr.advanceCase(tx, c.id, { kind: "response", employeeResponse: "I was unwell." }, actor));
      const heard = await asA((tx) =>
        hr.advanceCase(tx, c.id, { kind: "hearing", hearingDate: "2026-10-08", hearingPanel: "HR, Supervisor", accompaniedBy: "Peter" }, actor));
      expect(heard.status).toBe("hearing_scheduled");

      const closed = await asA((tx) =>
        hr.advanceCase(tx, c.id, { kind: "close", outcome: "written_warning", outcomeNotes: "No sick note produced." }, actor));
      expect(closed.status).toBe("closed");
      const sixMonths = new Date();
      sixMonths.setMonth(sixMonths.getMonth() + 6);
      expect(closed.warningExpiresOn).toBe(sixMonths.toISOString().slice(0, 10));

      await expectRejection(asA((tx) => hr.advanceCase(tx, c.id, { kind: "response", employeeResponse: "more" }, actor)), /closed/);
    });

    it("closes a grievance as resolved or not upheld, never as a punishment", async () => {
      const g = await open({ caseType: "grievance", category: "working_conditions", description: "No protective gear issued." });
      expect(g.caseNumber).toBe("GRV-00001");
      await expectRejection(
        asA((tx) => hr.advanceCase(tx, g.id, { kind: "show_cause", issuedOn: "2026-10-02", responseDueOn: "2026-10-05" }, actor)),
        /no show-cause/,
      );
      await expectRejection(asA((tx) => hr.advanceCase(tx, g.id, { kind: "close", outcome: "final_warning" }, actor)), /resolved or not upheld/);
      const done = await asA((tx) => hr.advanceCase(tx, g.id, { kind: "close", outcome: "resolved", outcomeNotes: "Gear issued." }, actor));
      expect(done.warningExpiresOn).toBeNull();
    });

    it("refuses a case dated in the future", async () => {
      await expectRejection(open({ incidentDate: "2999-01-01" }), /future/);
    });
  });

  describe("training and certificates", () => {
    it("checks the dates and lists what is expiring, including what has expired", async () => {
      await expectRejection(
        asA((tx) => hr.createTraining(tx, { companyId: companyA, employeeId: jane.id, kind: "course", title: "First aid", status: "completed", actor })),
        /when it was completed/,
      );
      await expectRejection(
        asA((tx) =>
          hr.createTraining(tx, {
            companyId: companyA, employeeId: jane.id, kind: "certification", title: "Weighing", completedOn: "2026-01-10", expiresOn: "2025-01-01", actor,
          })),
        /expire before/,
      );
      const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
      await asA(async (tx) => {
        await hr.createTraining(tx, { companyId: companyA, employeeId: jane.id, kind: "certification", title: "ISO 17025 internal auditor", completedOn: day(-700), expiresOn: day(20), actor });
        await hr.createTraining(tx, { companyId: companyA, employeeId: peter.id, kind: "licence", title: "Working at height", completedOn: day(-400), expiresOn: day(-5), actor });
        await hr.createTraining(tx, { companyId: companyA, employeeId: peter.id, kind: "course", title: "Induction", completedOn: day(-30), actor });
      });
      const expiring = await asA((tx) => hr.listTraining(tx, { expiringWithin: 60 }));
      expect(expiring.map((r) => r.title)).toEqual(["Working at height", "ISO 17025 internal auditor"]);
      expect(Number(expiring[0].days_to_expiry)).toBe(-5);
    });
  });

  describe("performance reviews", () => {
    const start = () =>
      asA((tx) =>
        hr.createReview(tx, {
          companyId: companyA,
          employeeId: jane.id,
          cycle: "2026 annual",
          periodStart: "2026-01-01",
          periodEnd: "2026-12-31",
          reviewerUserId: null,
          reviewerName: "Sam Supervisor",
          objectives: [
            { objective: "Complete 40 calibrations", weight: 60 },
            { objective: "Zero safety incidents", weight: 40 },
          ],
          actor,
        }));

    it("runs objectives → self-assessment → manager review → completed, each party writing only their part", async () => {
      const r = await start();
      await expectRejection(asA((tx) => hr.saveReview(tx, r.id, "employee", { selfComment: "early" })), /not open/);
      await asA((tx) => hr.saveReview(tx, r.id, "hr", { advance: true }));
      await expectRejection(asA((tx) => hr.saveReview(tx, r.id, "hr", { objectives: [] })), /fixed/);

      await asA((tx) =>
        hr.saveReview(tx, r.id, "employee", {
          objectives: [
            { objective: "anything", weight: 60, selfRating: 4 },
            { objective: "anything", weight: 40, selfRating: 5 },
          ],
          selfComment: "Good year.",
          advance: true,
        }));
      const afterSelf = await asA((tx) => hr.getReview(tx, r.id));
      // The employee's edit did not touch the objectives themselves.
      expect(afterSelf.objectives.map((o) => o.objective)).toEqual(["Complete 40 calibrations", "Zero safety incidents"]);
      expect(afterSelf.objectives.map((o) => o.selfRating)).toEqual([4, 5]);

      await expectRejection(
        asA((tx) => hr.saveReview(tx, r.id, "reviewer", { advance: true })),
        /Rate every objective/,
      );
      const done = await asA((tx) =>
        hr.saveReview(tx, r.id, "reviewer", {
          objectives: [
            { objective: "x", weight: 60, managerRating: 4 },
            { objective: "x", weight: 40, managerRating: 3 },
          ],
          recommendation: "salary_increase",
          advance: true,
        }));
      expect(done.status).toBe("completed");
      expect(Number(done.overallRating)).toBe(3.6);

      const acked = await asA((tx) => hr.acknowledgeReview(tx, r.id));
      expect(acked.employeeAcknowledgedAt).toBeTruthy();
      await expectRejection(asA((tx) => hr.deleteReview(tx, r.id)), /draft/);
    });

    it("needs weights that add up to 100, and one review per cycle", async () => {
      await expectRejection(
        asA((tx) =>
          hr.createReview(tx, {
            companyId: companyA, employeeId: peter.id, cycle: "2026 annual", periodStart: "2026-01-01", periodEnd: "2026-12-31",
            objectives: [{ objective: "A", weight: 50 }, { objective: "B", weight: 30 }], actor,
          })),
        /add up to 100/,
      );
      await start();
      await expectRejection(start(), /already has a review/);
    });
  });

  describe("recruitment", () => {
    it("moves candidates, needs a reason to reject, and fills the vacancy when hired", async () => {
      const v = await asA((tx) => hr.createVacancy(tx, { companyId: companyA, title: "Calibration Technician", positions: 1, actor }));
      expect(v.vacancyNumber).toBe("VAC-00001");
      const a = await asA((tx) => hr.addCandidate(tx, { companyId: companyA, vacancyId: v.id, fullName: "Amina Hassan", email: "amina@x.co", actor }));
      const b = await asA((tx) => hr.addCandidate(tx, { companyId: companyA, vacancyId: v.id, fullName: "Brian Kip", actor }));
      await expectRejection(
        asA((tx) => hr.addCandidate(tx, { companyId: companyA, vacancyId: v.id, fullName: "Bad Mail", email: "nope", actor })),
        /not valid/,
      );

      await asA((tx) => hr.moveCandidate(tx, a.id, { stage: "interview", interviewDate: "2026-11-20", rating: 4 }));
      await expectRejection(asA((tx) => hr.moveCandidate(tx, b.id, { stage: "rejected" })), /reason/);
      await expectRejection(asA((tx) => hr.moveCandidate(tx, a.id, { stage: "hired" })), /next stage/);
      await asA((tx) => hr.moveCandidate(tx, b.id, { stage: "rejected", rejectionReason: "Lacks a certificate" }));

      const amina = await hire(companyA, { firstName: "Amina", lastName: "Hassan" });
      await asA((tx) => hr.hireCandidate(tx, a.id, amina.id));
      const after = await asA((tx) => hr.getVacancy(tx, v.id));
      expect(after.status).toBe("filled");
      expect(after.candidates.find((c) => c.id === a.id).employeeId).toBe(amina.id);
      await expectRejection(
        asA((tx) => hr.addCandidate(tx, { companyId: companyA, vacancyId: v.id, fullName: "Late", actor })),
        /closed/,
      );
    });
  });

  it("builds the HR report and the org chart", async () => {
    await asA((tx) => tx.execute(sql`UPDATE employees SET manager_id = ${jane.id}::uuid WHERE id = ${peter.id}::uuid`));
    const report = await asA((tx) => hr.getHrReport(tx, 2026));
    expect(report.headcountByDept.reduce((n, d) => n + d.headcount, 0)).toBe(2);
    expect(report.movement.find((m) => m.month === "2026-06").joiners).toBe(2);
    const chart = await asA((tx) => hr.listOrgChart(tx));
    expect(chart.find((e) => e.id === peter.id).manager_id).toBe(jane.id);
  });

  it("keeps every record inside its company", async () => {
    await asA(async (tx) => {
      await hr.createLetter(tx, { companyId: companyA, employeeId: jane.id, kind: "general", subject: "Hi", body: "Body", actor });
      await hr.createCase(tx, { companyId: companyA, employeeId: jane.id, caseType: "grievance", category: "pay", incidentDate: "2026-10-01", description: "Late pay", actor });
      await hr.createTraining(tx, { companyId: companyA, employeeId: jane.id, kind: "course", title: "First aid", completedOn: "2026-10-01", actor });
      await hr.createVacancy(tx, { companyId: companyA, title: "Driver", actor });
    });
    const seen = await asTenant(companyB, async (tx) => ({
      letters: await hr.listLetters(tx),
      cases: await hr.listCases(tx),
      training: await hr.listTraining(tx),
      vacancies: await hr.listVacancies(tx),
      jane: await hr.getEmployeeFacts(tx, jane.id),
    }));
    expect(seen).toEqual({ letters: [], cases: [], training: [], vacancies: [], jane: null });

    // Nor can company B write a record against company A's employee.
    await expectRejection(
      asTenant(companyB, (tx) =>
        tx.execute(sql`INSERT INTO hr_letters (company_id, letter_number, employee_id, kind, subject, body)
                       VALUES (${companyB}::uuid, 'X-1', ${jane.id}::uuid, 'general', 's', 'b')`)),
      /violates|foreign key|row-level/i,
    );
  });
});
