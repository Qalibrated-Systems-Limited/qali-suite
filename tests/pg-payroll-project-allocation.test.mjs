/**
 * Payroll labour reaching the project — 0090.
 *
 * The worked example, with the real numbers:
 *
 *   Jane is salaried at KES 100,000 gross. February 2026 has 20 working days,
 *   so her day costs 5,000. Her timesheets say 12 days on Project A, 6 on
 *   Project B, and 2 days nobody booked.
 *
 *     Project A    60,000
 *     Project B    30,000
 *     unallocated  10,000
 *     ----------  -------
 *                 100,000
 *
 * What is asserted here is mostly that the last line stays 100,000. The
 * failure this guards against is not a wrong split — it is a split that
 * invents expense, which is what any entry crediting cash or a payable would
 * do. Every allocation below is a DIMENSION on a debit payroll already made.
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

const staff = await import("@/app/db/repositories/employees");
const leaveRepo = await import("@/app/db/repositories/leave");
const payroll = await import("@/app/db/repositories/payroll");
const projectsRepo = await import("@/app/db/repositories/projects");

suite("payroll labour reaches the project", () => {
  let admin, client, db;
  let companyA, jane, janeParty, accounts, projectA, projectB;

  const actor = { id: null, name: "The CFO" };

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);

  const RATES = {
    name: "FY 2025/2026",
    effectiveFrom: "2020-01-01",
    personalRelief: 2400,
    nssfTierILimit: 8000,
    nssfTierIILimit: 72000,
    nssfEmployeeRate: 0.06,
    nssfEmployerRate: 0.06,
    shifRate: 0.0275,
    shifMinimum: 300,
    ahlEmployeeRate: 0.015,
    ahlEmployerRate: 0.015,
    brackets: [
      { from: 0, to: 288000, rate: 0.1 },
      { from: 288000, to: 388000, rate: 0.25 },
      { from: 388000, to: 6000000, rate: 0.3 },
      { from: 6000000, to: 9600000, rate: 0.325 },
      { from: 9600000, to: null, rate: 0.35 },
    ],
  };

  async function makeAccounts(tx) {
    const map = {};
    const chart = [
      ["salaryExpense", "6000", "Salaries and Wages", "expense"],
      ["employerNssfExpense", "6010", "Employer NSSF", "expense"],
      ["employerAhlExpense", "6020", "Employer AHL", "expense"],
      ["salaryPayable", "2100", "Salaries Payable", "liability"],
      ["payePayable", "2110", "PAYE Payable", "liability"],
      ["nssfPayable", "2120", "NSSF Payable", "liability"],
      ["shifPayable", "2130", "SHIF Payable", "liability"],
      ["ahlPayable", "2140", "AHL Payable", "liability"],
      ["bankAccount", "1000", "Bank", "asset"],
      ["staffLoansReceivable", "1200", "Staff Loans", "asset"],
      ["interestIncome", "4100", "Interest Income", "revenue"],
    ];
    for (const [key, code, name, type] of chart) {
      const id = randomUUID();
      await tx.execute(sql`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type)
        VALUES (${id}, ${companyA}, ${code}, ${name}, ${type}::account_type)`);
      map[key] = id;
    }
    return map;
  }

  /**
   * February 2026 is 28 days beginning on a Sunday, so it is exactly 20
   * working days with no holiday seeded — which makes a 100,000 salary
   * 5,000 a day and every figure below a round number.
   */
  const WEEKDAYS = [
    "2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06",
    "2026-02-09", "2026-02-10", "2026-02-11", "2026-02-12", "2026-02-13",
    "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20",
    "2026-02-23", "2026-02-24", "2026-02-25", "2026-02-26", "2026-02-27",
  ];

  const roster = (projectId) =>
    inA((tx) =>
      projectsRepo.upsertAssignment(tx, {
        companyId: companyA,
        projectId,
        partyId: janeParty,
        partyName: "Jane Wanjiru",
        partyType: "employee",
        rateAmount: "4000.0000",
        rateUnit: "day",
        assignedByName: "Seed",
      }),
    );

  /** Book `dates` to a project and approve them, which is what the ledger reads. */
  async function book(assignment, dates, projectId) {
    for (const workDate of dates) {
      const t = await inA((tx) =>
        projectsRepo.createTimesheet(tx, {
          companyId: companyA,
          projectId,
          assignmentId: assignment.id,
          workDate,
          quantity: 1,
          unit: "day",
          enteredByName: "Seed",
        }),
      );
      await inA((tx) =>
        projectsRepo.setTimesheetStatus(tx, t.id, "approved", actor),
      );
    }
  }

  const makeRun = () =>
    inA((tx) =>
      payroll.createRun(tx, {
        companyId: companyA,
        month: 2,
        year: 2026,
        actor,
      }),
    );

  const generate = (runId) =>
    inA((tx) =>
      payroll.generateEntries(tx, { companyId: companyA, runId, actor }),
    );

  const approve = (runId) =>
    inA((tx) => payroll.approveRun(tx, { companyId: companyA, runId, actor }));

  /** Every posted line on one account, by project. */
  async function ledger(accountId) {
    const rows = await inA((tx) =>
      tx.execute(sql`
        SELECT COALESCE(jl.project_id::text, 'none')  AS project_id,
               SUM(jl.debit - jl.credit)::float8      AS amount
          FROM journal_lines jl
          JOIN journal_entries je ON je.id = jl.entry_id
         WHERE jl.account_id = ${accountId}::uuid
           AND je.status = 'posted'
         GROUP BY jl.project_id`),
    );
    const out = {};
    for (const r of rows) out[String(r.project_id)] = Number(r.amount);
    return out;
  }

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
    await admin`INSERT INTO companies (id, name, slug)
                VALUES (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)})`;

    accounts = await inA((tx) => makeAccounts(tx));

    await inA(async (tx) => {
      const { id } = await payroll.saveRates(tx, { companyId: companyA, ...RATES });
      await payroll.saveGlMapping(tx, { configId: id, mapping: accounts });
      await leaveRepo.seedLeaveTypes(tx, companyA);
    });

    // 80,000 basic + 20,000 housing = 100,000 gross, and 20 working days in
    // February makes that exactly 5,000 a day.
    jane = await inA((tx) =>
      staff.createEmployee(tx, {
        companyId: companyA,
        firstName: "Jane",
        lastName: "Wanjiru",
        hireDate: "2024-01-08",
        basicSalary: 80000,
        allowanceHousing: 20000,
        bankName: "KCB",
        bankAccount: "1234567890",
      }),
    );
    const [row] = await inA((tx) =>
      tx.execute(sql`SELECT party_id::text FROM employees WHERE id = ${jane.id}::uuid`),
    );
    janeParty = String(row.party_id);

    projectA = (
      await inA((tx) =>
        projectsRepo.createProject(tx, {
          companyId: companyA,
          name: "Otho Road",
          createdByName: "Seed",
        }),
      )
    ).id;
    projectB = (
      await inA((tx) =>
        projectsRepo.createProject(tx, {
          companyId: companyA,
          name: "Bridge",
          createdByName: "Seed",
        }),
      )
    ).id;
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the split", () => {
    it("puts 60,000 on A, 30,000 on B and leaves 10,000 unallocated", async () => {
      const a = await roster(projectA);
      const b = await roster(projectB);
      await book(a, WEEKDAYS.slice(0, 12), projectA);
      await book(b, WEEKDAYS.slice(12, 18), projectB);

      const run = await makeRun();
      await generate(run.id);
      await approve(run.id);

      const salaries = await ledger(accounts.salaryExpense);
      expect(salaries[projectA]).toBeCloseTo(60000, 2);
      expect(salaries[projectB]).toBeCloseTo(30000, 2);
      expect(salaries.none).toBeCloseTo(10000, 2);
    });

    it("does not invent a shilling — the total is still the gross", async () => {
      // The point of the whole design. Any entry crediting cash or a payable
      // would have made 160,000 of expense from a 100,000 salary.
      const a = await roster(projectA);
      const b = await roster(projectB);
      await book(a, WEEKDAYS.slice(0, 12), projectA);
      await book(b, WEEKDAYS.slice(12, 18), projectB);

      const run = await makeRun();
      await generate(run.id);
      await approve(run.id);

      const salaries = await ledger(accounts.salaryExpense);
      const total = Object.values(salaries).reduce((s, n) => s + n, 0);
      expect(total).toBeCloseTo(100000, 2);
    });

    it("splits the employer contributions on the same days", async () => {
      // Burdened cost. Jane costs a project more than her salary line, and a
      // contractor pricing off a report that omits this will underbid.
      const a = await roster(projectA);
      await book(a, WEEKDAYS.slice(0, 12), projectA);

      const run = await makeRun();
      await generate(run.id);
      await approve(run.id);

      const nssf = await ledger(accounts.employerNssfExpense);
      const ahl = await ledger(accounts.employerAhlExpense);
      const nssfTotal = Object.values(nssf).reduce((s, n) => s + n, 0);
      const ahlTotal = Object.values(ahl).reduce((s, n) => s + n, 0);

      // 12 of 20 days is 60% of each, and the totals are untouched.
      expect(nssf[projectA]).toBeCloseTo(nssfTotal * 0.6, 2);
      expect(ahl[projectA]).toBeCloseTo(ahlTotal * 0.6, 2);
      expect(nssfTotal).toBeGreaterThan(0);
    });

    it("leaves the statutory payables with no project at all", async () => {
      // PAYE is owed to KRA, not to a job. Tagging it would put a statutory
      // liability inside a contract's cost.
      const a = await roster(projectA);
      await book(a, WEEKDAYS.slice(0, 12), projectA);

      const run = await makeRun();
      await generate(run.id);
      await approve(run.id);

      for (const key of ["payePayable", "nssfPayable", "shifPayable", "salaryPayable"]) {
        const rows = await ledger(accounts[key]);
        expect(Object.keys(rows)).toEqual(["none"]);
      }
    });

    it("posts exactly what it always did when nobody logs time", async () => {
      // The pre-0090 entry, for every company that does not run projects.
      const run = await makeRun();
      await generate(run.id);
      await approve(run.id);

      const salaries = await ledger(accounts.salaryExpense);
      expect(Object.keys(salaries)).toEqual(["none"]);
      expect(salaries.none).toBeCloseTo(100000, 2);
    });

    it("allocates on days even when the roster carries no rate", async () => {
      // The roster rate is 0089's ESTIMATE. The ledger apportions what payroll
      // actually paid, so a missing rate cannot cost the project its labour.
      const a = await inA((tx) =>
        projectsRepo.upsertAssignment(tx, {
          companyId: companyA,
          projectId: projectA,
          partyId: janeParty,
          partyName: "Jane Wanjiru",
          partyType: "employee",
          rateAmount: null,
          rateUnit: null,
          assignedByName: "Seed",
        }),
      );
      await book(a, WEEKDAYS.slice(0, 10), projectA);

      const run = await makeRun();
      await generate(run.id);
      await approve(run.id);

      const salaries = await ledger(accounts.salaryExpense);
      expect(salaries[projectA]).toBeCloseTo(50000, 2);
    });

    it("never allocates more than was paid, however many days were booked", async () => {
      // 24 days booked in a 20-day month — weekend work on a fixed salary.
      // Dividing by 20 would allocate 120,000 of a 100,000 salary and invent
      // expense out of a rounding rule.
      const a = await roster(projectA);
      const saturdays = ["2026-02-07", "2026-02-14", "2026-02-21", "2026-02-28"];
      await book(a, [...WEEKDAYS, ...saturdays], projectA);

      const run = await makeRun();
      await generate(run.id);
      await approve(run.id);

      const salaries = await ledger(accounts.salaryExpense);
      expect(salaries[projectA]).toBeCloseTo(100000, 2);
      expect(salaries[projectA]).toBeLessThanOrEqual(100000.0001);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the timesheet that arrives late", () => {
    it("moves the dimension without reopening the payroll journal", async () => {
      const a = await roster(projectA);
      await book(a, WEEKDAYS.slice(0, 12), projectA);

      const run = await makeRun();
      await generate(run.id);
      await approve(run.id);

      const before = await ledger(accounts.salaryExpense);
      expect(before[projectA]).toBeCloseTo(60000, 2);

      // Four more days approved after payroll posted.
      const b = await roster(projectB);
      await book(b, WEEKDAYS.slice(12, 16), projectB);

      const result = await inA((tx) =>
        payroll.reallocateProjectLabour(tx, {
          companyId: companyA,
          payrollRunId: run.id,
          actor,
        }),
      );
      expect(result).not.toBeNull();

      const after = await ledger(accounts.salaryExpense);
      expect(after[projectA]).toBeCloseTo(60000, 2);
      expect(after[projectB]).toBeCloseTo(20000, 2);
      expect(after.none).toBeCloseTo(20000, 2);

      // And the account still holds exactly the gross.
      const total = Object.values(after).reduce((s, n) => s + n, 0);
      expect(total).toBeCloseTo(100000, 2);
    });

    it("posts nothing the second time", async () => {
      const a = await roster(projectA);
      await book(a, WEEKDAYS.slice(0, 12), projectA);

      const run = await makeRun();
      await generate(run.id);
      await approve(run.id);

      const b = await roster(projectB);
      await book(b, WEEKDAYS.slice(12, 16), projectB);

      const first = await inA((tx) =>
        payroll.reallocateProjectLabour(tx, {
          companyId: companyA,
          payrollRunId: run.id,
          actor,
        }),
      );
      const second = await inA((tx) =>
        payroll.reallocateProjectLabour(tx, {
          companyId: companyA,
          payrollRunId: run.id,
          actor,
        }),
      );

      expect(first).not.toBeNull();
      // Idempotent: nothing left to move, so no journal at all.
      expect(second).toBeNull();
    });

    it("takes the labour back off a project whose time was rejected", async () => {
      const a = await roster(projectA);
      await book(a, WEEKDAYS.slice(0, 12), projectA);

      const run = await makeRun();
      await generate(run.id);
      await approve(run.id);

      // Every one of those days turns out to have been the wrong job.
      const rows = await inA((tx) =>
        projectsRepo.listProjectTimesheets(tx, projectA),
      );
      for (const r of rows) {
        await inA((tx) => projectsRepo.setTimesheetStatus(tx, r.id, "rejected"));
      }

      await inA((tx) =>
        payroll.reallocateProjectLabour(tx, {
          companyId: companyA,
          payrollRunId: run.id,
          actor,
        }),
      );

      const after = await ledger(accounts.salaryExpense);
      expect(after[projectA] ?? 0).toBeCloseTo(0, 2);
      expect(after.none).toBeCloseTo(100000, 2);
    });

    it("refuses to re-allocate a run that has not posted", async () => {
      const run = await makeRun();
      await generate(run.id);

      const err = await inA((tx) =>
        payroll.reallocateProjectLabour(tx, {
          companyId: companyA,
          payrollRunId: run.id,
          actor,
        }),
      ).then(
        () => null,
        (e) => e,
      );
      expect(err?.message).toMatch(/accrual has posted|Approve it first/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("what the project now reads", () => {
    it("shows the labour in the ledger-derived actuals", async () => {
      // 0084 gave `journal_lines` the dimension and said anything posted with
      // a project appears automatically. This is the proof for labour.
      const a = await roster(projectA);
      await book(a, WEEKDAYS.slice(0, 12), projectA);

      const run = await makeRun();
      await generate(run.id);
      await approve(run.id);

      const map = await inA((tx) =>
        projectsRepo.getProjectLedgerActuals(tx, [projectA]),
      );
      const actuals = map.get(projectA);
      expect(actuals.costs).toBeGreaterThanOrEqual(60000);
    });
  });
});
