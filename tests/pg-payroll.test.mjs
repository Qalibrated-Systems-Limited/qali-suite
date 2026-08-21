/**
 * Payroll and staff loans on Postgres.
 *
 * The things worth pinning are the ones the source got wrong: totals that
 * follow the payslips, a journal that cannot post with an account missing, an
 * approval that is atomic with its posting, and a void that gives the loan
 * instalments back.
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
const payroll = await import("@/app/db/repositories/payroll");
const loansRepo = await import("@/app/db/repositories/loans");

suite("payroll", () => {
  let admin, client, db;
  let companyA, jane, accounts;

  const actor = { id: "u-cfo", name: "The CFO" };

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

  /** Kenya's rates as at 2026, which is what the seeded config uses. */
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

  beforeEach(async () => {
    await admin`TRUNCATE companies CASCADE`;
    await admin`TRUNCATE users CASCADE`;
    await admin`TRUNCATE entry_counters`;

    companyA = randomUUID();
    await admin`INSERT INTO companies (id, name, slug)
                VALUES (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)})`;

    accounts = await asTenant(companyA, (tx) => makeAccounts(tx));

    await asTenant(companyA, async (tx) => {
      const { id } = await payroll.saveRates(tx, { companyId: companyA, ...RATES });
      await payroll.saveGlMapping(tx, { configId: id, mapping: accounts });
      await leaveRepo.seedLeaveTypes(tx, companyA);
    });

    jane = await asTenant(companyA, (tx) =>
      staff.createEmployee(tx, {
        companyId: companyA,
        firstName: "Jane",
        lastName: "Wanjiru",
        hireDate: "2024-01-08",
        basicSalary: 80000,
        allowanceHousing: 20000,
        bankName: "KCB",
        bankAccount: "1234567890",
      }));
  });

  const makeRun = (over = {}) =>
    asTenant(companyA, (tx) =>
      payroll.createRun(tx, {
        companyId: companyA, month: 8, year: 2026, actor, ...over,
      }));

  const generate = (runId) =>
    asTenant(companyA, (tx) =>
      payroll.generateEntries(tx, { companyId: companyA, runId, actor }));

  describe("the rates", () => {
    it("will not accept two configurations covering the same month", async () => {
      await expectRejection(
        asTenant(companyA, (tx) =>
          payroll.saveRates(tx, {
            companyId: companyA, ...RATES, name: "Duplicate",
            effectiveFrom: "2025-01-01",
          })),
        /payroll_configs_no_overlap/i,
      );
    });

    it("refuses PAYE bands with a gap in them", async () => {
      // Income between 288,000 and 300,000 would be taxed at nothing at all,
      // silently. The source validates neither overlap nor gaps.
      await expectRejection(
        asTenant(companyA, (tx) =>
          payroll.saveRates(tx, {
            companyId: companyA, ...RATES, name: "Gappy",
            effectiveFrom: "2015-01-01", effectiveTo: "2019-12-31",
            brackets: [
              { from: 0, to: 288000, rate: 0.1 },
              { from: 300000, to: null, rate: 0.3 },
            ],
          })),
        /leave a gap/i,
      );
    });

    it("refuses PAYE bands that stop short of infinity", async () => {
      await expectRejection(
        asTenant(companyA, (tx) =>
          payroll.saveRates(tx, {
            companyId: companyA, ...RATES, name: "Capped",
            effectiveFrom: "2015-01-01", effectiveTo: "2019-12-31",
            brackets: [{ from: 0, to: 288000, rate: 0.1 }],
          })),
        /must be open-ended/i,
      );
    });

    it("refuses overlapping bands", async () => {
      await expectRejection(
        asTenant(companyA, (tx) =>
          payroll.saveRates(tx, {
            companyId: companyA, ...RATES, name: "Overlapping",
            effectiveFrom: "2015-01-01", effectiveTo: "2019-12-31",
            brackets: [
              { from: 0, to: 300000, rate: 0.1 },
              { from: 288000, to: null, rate: 0.3 },
            ],
          })),
        /paye_brackets_no_overlap/i,
      );
    });
  });

  describe("the run", () => {
    it("numbers itself and takes the rates for the period", async () => {
      const run = await makeRun();
      expect(run.payrollNumber).toBe("PR-202608-00001");
      expect(run.payrollConfigId).toBeTruthy();
    });

    it("allows only one live run per month", async () => {
      await makeRun();
      await expectRejection(makeRun(), /payroll_runs_one_per_period/i);
    });

    it("lets a replacement run once the first is voided", async () => {
      const first = await makeRun();
      await generate(first.id);
      await asTenant(companyA, (tx) =>
        payroll.voidRun(tx, {
          companyId: companyA, runId: first.id, reason: "Wrong salaries", actor,
        }));
      await expect(makeRun()).resolves.toBeTruthy();
    });

    it("refuses a period no configuration covers", async () => {
      await expectRejection(
        makeRun({ month: 8, year: 2019 }),
        /No payroll rates cover/i,
      );
    });
  });

  describe("generating payslips", () => {
    it("computes Kenya's statutory deductions off the configured rates", async () => {
      const run = await makeRun();
      const { processed } = await generate(run.id);
      expect(processed).toBe(1);

      const [entry] = await asTenant(companyA, (tx) =>
        payroll.listEntries(tx, run.id));

      expect(entry.grossPay).toBe(100000);
      // NSSF: 6% of the first 8,000 plus 6% of the next 64,000 = 4,320.
      expect(entry.nssf).toBe(4320);
      expect(entry.employerNssf).toBe(4320);
      // SHIF: 2.75% of gross.
      expect(entry.shif).toBe(2750);
      // AHL: 1.5% each side.
      expect(entry.housingLevy).toBe(1500);
      expect(entry.employerHousingLevy).toBe(1500);
      // The identity that payroll balances by.
      expect(entry.grossPay - entry.totalDeductions).toBe(entry.netPay);
    });

    it("adds up the run from the payslips, without being asked", async () => {
      const run = await makeRun();
      await generate(run.id);

      const full = await asTenant(companyA, (tx) => payroll.getRun(tx, run.id));
      expect(full.totals.employeeCount).toBe(1);
      expect(full.totals.gross).toBe(100000);
      // gross = deductions + net, exactly.
      expect(full.totals.gross - full.totals.deductions).toBe(full.totals.net);
    });

    it("keeps the run's totals right when a payslip is edited", async () => {
      const run = await makeRun();
      await generate(run.id);
      const [entry] = await asTenant(companyA, (tx) => payroll.listEntries(tx, run.id));

      await asTenant(companyA, (tx) =>
        payroll.updateEntry(tx, { entryId: entry.id, values: { bonus: 15000 }, actor }));

      const full = await asTenant(companyA, (tx) => payroll.getRun(tx, run.id));
      // The source recomputes totals only when the action remembers to call
      // syncRunTotals, and the accrual journal is built from them.
      expect(full.totals.gross).toBe(115000);
      expect(full.totals.gross - full.totals.deductions).toBe(full.totals.net);
    });

    it("carries a one-off line into the payslip and the run", async () => {
      const run = await makeRun();
      await generate(run.id);
      const [entry] = await asTenant(companyA, (tx) => payroll.listEntries(tx, run.id));

      await asTenant(companyA, (tx) =>
        payroll.addEntryLine(tx, {
          companyId: companyA, entryId: entry.id,
          kind: "deduction", description: "Uniform", amount: 2000,
        }));

      const after = await asTenant(companyA, (tx) => payroll.getEntry(tx, entry.id));
      expect(after.additionalDeductions).toBe(2000);
      expect(after.netPay).toBe(entry.netPay - 2000);

      const full = await asTenant(companyA, (tx) => payroll.getRun(tx, run.id));
      expect(full.totals.net).toBe(after.netPay);
    });

    it("pro-rates somebody who joined mid-month", async () => {
      await asTenant(companyA, (tx) =>
        staff.createEmployee(tx, {
          companyId: companyA, firstName: "Late", lastName: "Joiner",
          hireDate: "2026-08-17", basicSalary: 21000, allowanceHousing: 0,
        }));

      const run = await makeRun();
      await generate(run.id);
      const entries = await asTenant(companyA, (tx) => payroll.listEntries(tx, run.id));
      const late = entries.find((e) => e.employeeName === "Late Joiner");

      // August 2026 has 21 working days; the 17th is a Monday, leaving 11.
      expect(late.workingDaysTotal).toBe(21);
      expect(late.workingDaysWorked).toBe(11);
      expect(late.basicSalary).toBe(Math.round(21000 * (11 / 21)));
    });

    it("deducts unpaid leave, and only unpaid leave", async () => {
      const types = await asTenant(companyA, (tx) => leaveRepo.listLeaveTypes(tx));
      const unpaid = types.find((t) => t.code === "unpaid");

      const r = await asTenant(companyA, (tx) =>
        leaveRepo.createLeaveRequest(tx, {
          companyId: companyA, employeeId: jane.id, leaveTypeId: unpaid.id,
          fromDate: "2026-08-03", toDate: "2026-08-07", submit: true,
        }));
      await asTenant(companyA, (tx) =>
        leaveRepo.approveLeaveRequest(tx, { id: r.id, actor: { id: "m", name: "M" } }));

      const run = await makeRun();
      await generate(run.id);
      const [entry] = await asTenant(companyA, (tx) => payroll.listEntries(tx, run.id));

      expect(entry.unpaidLeaveDays).toBe(5);
      expect(entry.workingDaysWorked).toBe(16);
      expect(entry.grossPay).toBe(
        Math.round(80000 * (16 / 21)) + Math.round(20000 * (16 / 21)),
      );
    });

    it("re-running converges instead of duplicating", async () => {
      const run = await makeRun();
      await generate(run.id);
      const { processed } = await generate(run.id);
      expect(processed).toBe(1);

      const entries = await asTenant(companyA, (tx) => payroll.listEntries(tx, run.id));
      expect(entries).toHaveLength(1);
    });
  });

  describe("approving", () => {
    it("posts a balanced accrual journal in the same breath", async () => {
      const run = await makeRun();
      await generate(run.id);

      const { journalEntryId } = await asTenant(companyA, (tx) =>
        payroll.approveRun(tx, { companyId: companyA, runId: run.id, actor }));

      const [totals] = await asTenant(companyA, (tx) =>
        tx.execute(sql`
          SELECT SUM(debit) AS debits, SUM(credit) AS credits
            FROM journal_lines WHERE entry_id = ${journalEntryId}::uuid`));
      expect(Number(totals.debits)).toBe(Number(totals.credits));

      const full = await asTenant(companyA, (tx) => payroll.getRun(tx, run.id));
      expect(full.status).toBe("approved");
      expect(full.journals.map((j) => j.kind)).toContain("accrual");
    });

    it("REFUSES to approve when an account carrying money is unmapped, and names it", async () => {
      await asTenant(companyA, (tx) =>
        tx.execute(sql`UPDATE payroll_configs SET shif_payable_account_id = NULL`));

      const run = await makeRun();
      await generate(run.id);

      // The source drops the unmapped leg, then infers "is a mapping missing?"
      // from "is the entry unbalanced?" — so a small leg vanishes under the
      // tolerance and posts, and two missing legs can cancel out entirely.
      await expectRejection(
        asTenant(companyA, (tx) =>
          payroll.approveRun(tx, { companyId: companyA, runId: run.id, actor })),
        /SHIF payable .* not mapped/i,
      );

      const still = await asTenant(companyA, (tx) => payroll.getRun(tx, run.id));
      expect(still.status).not.toBe("approved");
    });

    it("does not approve an empty run", async () => {
      const run = await makeRun();
      await expectRejection(
        asTenant(companyA, (tx) =>
          payroll.approveRun(tx, { companyId: companyA, runId: run.id, actor })),
        /no payslips/i,
      );
    });

    it("dates the accrual to the end of the period it was earned in", async () => {
      const run = await makeRun();
      await generate(run.id);
      const { journalEntryId } = await asTenant(companyA, (tx) =>
        payroll.approveRun(tx, { companyId: companyA, runId: run.id, actor }));

      const [entry] = await asTenant(companyA, (tx) =>
        tx.execute(sql`SELECT entry_date FROM journal_entries WHERE id = ${journalEntryId}::uuid`));
      expect(String(entry.entry_date).slice(0, 10)).toBe("2026-08-31");
    });
  });

  describe("paying and voiding", () => {
    it("clears salaries payable against the bank", async () => {
      const run = await makeRun();
      await generate(run.id);
      await asTenant(companyA, (tx) =>
        payroll.approveRun(tx, { companyId: companyA, runId: run.id, actor }));

      const { journalEntryId } = await asTenant(companyA, (tx) =>
        payroll.markRunPaid(tx, { companyId: companyA, runId: run.id, actor }));

      const lines = await asTenant(companyA, (tx) =>
        tx.execute(sql`
          SELECT account_id, debit, credit FROM journal_lines
           WHERE entry_id = ${journalEntryId}::uuid ORDER BY line_number`));
      expect(lines).toHaveLength(2);
      expect(lines[0].account_id).toBe(accounts.salaryPayable);
      expect(lines[1].account_id).toBe(accounts.bankAccount);

      const entries = await asTenant(companyA, (tx) => payroll.listEntries(tx, run.id));
      expect(entries.every((e) => e.paymentStatus === "paid")).toBe(true);
    });

    it("will not void a payroll that has already been paid", async () => {
      const run = await makeRun();
      await generate(run.id);
      await asTenant(companyA, (tx) =>
        payroll.approveRun(tx, { companyId: companyA, runId: run.id, actor }));
      await asTenant(companyA, (tx) =>
        payroll.markRunPaid(tx, { companyId: companyA, runId: run.id, actor }));

      await expectRejection(
        asTenant(companyA, (tx) =>
          payroll.voidRun(tx, {
            companyId: companyA, runId: run.id, reason: "Mistake", actor,
          })),
        /has been paid/i,
      );
    });

    it("reverses the journal when voided", async () => {
      const run = await makeRun();
      await generate(run.id);
      await asTenant(companyA, (tx) =>
        payroll.approveRun(tx, { companyId: companyA, runId: run.id, actor }));

      const { journalsReversed } = await asTenant(companyA, (tx) =>
        payroll.voidRun(tx, {
          companyId: companyA, runId: run.id, reason: "Wrong rates", actor,
        }));
      expect(journalsReversed).toBe(1);

      const full = await asTenant(companyA, (tx) => payroll.getRun(tx, run.id));
      expect(full.status).toBe("voided");
      expect(full.journals.filter((j) => j.kind === "reversal")).toHaveLength(1);
    });
  });

  describe("loans", () => {
    const newLoan = (over = {}) =>
      asTenant(companyA, (tx) =>
        loansRepo.createLoan(tx, {
          companyId: companyA, employeeId: jane.id, loanType: "staff_loan",
          principalAmount: 60000, tenureMonths: 6,
          startMonth: 8, startYear: 2026,
          actor: { id: "hr", name: "HR" }, ...over,
        }));

    it("builds a schedule that sums to exactly what was borrowed", async () => {
      const loan = await newLoan({ principalAmount: 50000, tenureMonths: 3 });
      const full = await asTenant(companyA, (tx) => loansRepo.getLoan(tx, loan.id));
      expect(full.schedule).toHaveLength(3);
      expect(full.schedule.reduce((s, i) => s + i.principal, 0)).toBe(50000);
      expect(full.outstandingBalance).toBe(50000);
    });

    it("refuses a repayment larger than two thirds of monthly pay", async () => {
      // Kenya's Employment Act caps deductions at two thirds of wages. The
      // source checks nothing, and the payslip comes out negative.
      await expectRejection(
        newLoan({ principalAmount: 600000, tenureMonths: 3 }),
        /two thirds/i,
      );
    });

    it("is deducted through payroll, and marked repaid on approval", async () => {
      const loan = await newLoan({ principalAmount: 60000, tenureMonths: 6 });
      await asTenant(companyA, (tx) =>
        loansRepo.approveLoan(tx, { id: loan.id, actor }));
      await asTenant(companyA, (tx) =>
        loansRepo.disburseLoan(tx, {
          companyId: companyA, id: loan.id, method: "bank", actor,
        }));

      const run = await makeRun();
      await generate(run.id);
      const [entry] = await asTenant(companyA, (tx) => payroll.listEntries(tx, run.id));
      expect(entry.loanRepayment).toBe(10000);

      await asTenant(companyA, (tx) =>
        payroll.approveRun(tx, { companyId: companyA, runId: run.id, actor }));

      const after = await asTenant(companyA, (tx) => loansRepo.getLoan(tx, loan.id));
      expect(after.totalRepaid).toBe(10000);
      expect(after.outstandingBalance).toBe(50000);
    });

    it("GIVES THE INSTALMENT BACK when the payroll is voided", async () => {
      const loan = await newLoan({ principalAmount: 60000, tenureMonths: 6 });
      await asTenant(companyA, (tx) => loansRepo.approveLoan(tx, { id: loan.id, actor }));
      await asTenant(companyA, (tx) =>
        loansRepo.disburseLoan(tx, {
          companyId: companyA, id: loan.id, method: "bank", actor,
        }));

      const run = await makeRun();
      await generate(run.id);
      await asTenant(companyA, (tx) =>
        payroll.approveRun(tx, { companyId: companyA, runId: run.id, actor }));

      const { installmentsRestored } = await asTenant(companyA, (tx) =>
        payroll.voidRun(tx, {
          companyId: companyA, runId: run.id, reason: "Wrong month", actor,
        }));
      expect(installmentsRestored).toBe(1);

      // The source reverses the journal and leaves the instalment marked
      // deducted, so the loan shows a repayment that is no longer in the books
      // and the next run deducts the same month again.
      const after = await asTenant(companyA, (tx) => loansRepo.getLoan(tx, loan.id));
      expect(after.totalRepaid).toBe(0);
      expect(after.outstandingBalance).toBe(60000);
      expect(after.installmentsPending).toBe(6);
    });

    it("posts the disbursement to the ledger", async () => {
      const loan = await newLoan();
      await asTenant(companyA, (tx) => loansRepo.approveLoan(tx, { id: loan.id, actor }));
      const { journalEntryId } = await asTenant(companyA, (tx) =>
        loansRepo.disburseLoan(tx, {
          companyId: companyA, id: loan.id, method: "bank", actor,
        }));

      const lines = await asTenant(companyA, (tx) =>
        tx.execute(sql`
          SELECT account_id, debit, credit FROM journal_lines
           WHERE entry_id = ${journalEntryId}::uuid ORDER BY line_number`));
      expect(lines[0].account_id).toBe(accounts.staffLoansReceivable);
      expect(Number(lines[0].debit)).toBe(60000);
      expect(lines[1].account_id).toBe(accounts.bankAccount);
      expect(Number(lines[1].credit)).toBe(60000);
    });

    it("will not cancel a loan that has been repaid into", async () => {
      const loan = await newLoan();
      await asTenant(companyA, (tx) => loansRepo.approveLoan(tx, { id: loan.id, actor }));
      await asTenant(companyA, (tx) =>
        loansRepo.disburseLoan(tx, {
          companyId: companyA, id: loan.id, method: "bank", actor,
        }));
      const run = await makeRun();
      await generate(run.id);
      await asTenant(companyA, (tx) =>
        payroll.approveRun(tx, { companyId: companyA, runId: run.id, actor }));

      await expectRejection(
        asTenant(companyA, (tx) =>
          loansRepo.cancelLoan(tx, { companyId: companyA, id: loan.id, actor })),
        /already been made/i,
      );
    });

    it("closes a loan once nothing is left pending", async () => {
      const loan = await newLoan({ principalAmount: 10000, tenureMonths: 1 });
      await asTenant(companyA, (tx) => loansRepo.approveLoan(tx, { id: loan.id, actor }));
      await asTenant(companyA, (tx) =>
        loansRepo.disburseLoan(tx, {
          companyId: companyA, id: loan.id, method: "bank", actor,
        }));

      const run = await makeRun();
      await generate(run.id);
      await asTenant(companyA, (tx) =>
        payroll.approveRun(tx, { companyId: companyA, runId: run.id, actor }));

      const after = await asTenant(companyA, (tx) => loansRepo.getLoan(tx, loan.id));
      expect(after.status).toBe("fully_repaid");
      expect(after.outstandingBalance).toBe(0);
    });
  });

  describe("the P9 certificate", () => {
    it("leaves voided runs out of the year's income", async () => {
      const good = await makeRun({ month: 7 });
      await generate(good.id);
      await asTenant(companyA, (tx) =>
        payroll.approveRun(tx, { companyId: companyA, runId: good.id, actor }));

      const bad = await makeRun({ month: 8 });
      await generate(bad.id);
      await asTenant(companyA, (tx) =>
        payroll.voidRun(tx, {
          companyId: companyA, runId: bad.id, reason: "Duplicate", actor,
        }));

      const p9 = await asTenant(companyA, (tx) =>
        payroll.getP9Data(tx, { employeeId: jane.id, year: 2026 }));
      // A payslip that was reversed out of the books is not income, and the
      // source's P9 route counts it.
      expect(p9).toHaveLength(1);
      expect(p9[0].month).toBe(7);
    });
  });
});
