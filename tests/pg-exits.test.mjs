/**
 * Employee exits on Postgres: the clearance, the final dues, and the end of
 * employment that approval brings with it.
 *
 * The arithmetic is pinned in final-dues.test.mjs. What is pinned here is what
 * the database adds: the facts gathered from payroll, leave and loans; an
 * approval that ends the employment, posts a balanced entry and recovers the
 * loans in one transaction; a statement nobody can change afterwards.
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
const exits = await import("@/app/db/repositories/exits");

suite("employee exits", () => {
  let admin, client, db;
  let companyA, jane, accounts;

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
      ["sundryIncome", "4900", "Sundry Income", "revenue"],
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
    await admin`TRUNCATE companies, users, entry_counters CASCADE`;

    companyA = randomUUID();
    await admin`INSERT INTO companies (id, name, slug, street, city)
                VALUES (${companyA}, 'Pilot Engineering', ${"p-" + companyA.slice(0, 8)},
                        'P.O. Box 1234-00100', 'Nairobi')`;

    accounts = await asA((tx) => makeAccounts(tx));
    const { sundryIncome, ...glMapping } = accounts;
    void sundryIncome;

    await asA(async (tx) => {
      const { id } = await payroll.saveRates(tx, { companyId: companyA, ...RATES });
      await payroll.saveGlMapping(tx, { configId: id, mapping: glMapping });
      await leaveRepo.seedLeaveTypes(tx, companyA);
    });

    // 100,000 a month, hired 8 January 2024.
    jane = await asA((tx) =>
      staff.createEmployee(tx, {
        companyId: companyA,
        firstName: "Jane",
        lastName: "Wanjiru",
        nationalId: "10000001",
        kraPin: "A100000001Z",
        hireDate: "2024-01-08",
        designation: "Site Engineer",
        workLocation: "Nairobi",
        basicSalary: 80000,
        allowanceHousing: 20000,
        bankName: "KCB",
        bankAccount: "1234567890",
      }));
  });

  const startExit = (over = {}) =>
    asA((tx) =>
      exits.createExit(tx, {
        companyId: companyA,
        employeeId: jane.id,
        exitType: "redundancy",
        noticeDate: null,
        lastWorkingDate: "2026-08-14",
        reason: "Site closed",
        actor,
        ...over,
      }));

  const clearAll = (exitId) =>
    asA(async (tx) => {
      const items = await tx.execute(sql`
        SELECT id FROM employee_exit_clearance_items WHERE exit_id = ${exitId}::uuid`);
      for (const { id } of items) {
        await exits.setClearanceStatus(tx, { itemId: id, status: "cleared", actor });
      }
    });

  const approve = (id) =>
    asA((tx) => exits.approveExit(tx, { companyId: companyA, id, actor: { id: "u-cfo", name: "The CFO" } }));

  const codes = (dues) => dues.lines.map((l) => l.code);

  describe("starting an exit", () => {
    it("numbers it and lays out the standard clearance", async () => {
      const exit = await startExit();
      expect(exit.exitNumber).toBe("EX-00001");
      expect(exit.status).toBe("draft");

      const { clearance } = await asA((tx) => exits.getExit(tx, exit.id));
      expect(clearance.length).toBe(exits.DEFAULT_CLEARANCE.length);
      expect(clearance.every((c) => c.status === "pending")).toBe(true);
    });

    it("adds every company asset in the employee's custody to the clearance", async () => {
      await asA((tx) => tx.execute(sql`
        INSERT INTO assets (company_id, asset_number, name, category, acquisition_date,
                            acquisition_cost, depreciation_start_date, assigned_to_party_id)
        VALUES (${companyA}, 'AST-00007', 'Dell Latitude 5440', 'computer', '2025-01-10',
                120000, '2025-01-10', ${jane.partyId})`));
      const exit = await startExit();
      const { clearance } = await asA((tx) => exits.getExit(tx, exit.id));
      const asset = clearance.find((c) => c.area === "Assets");
      expect(asset.item).toBe("Return AST-00007 — Dell Latitude 5440");
      expect(asset.assetId).toBeTruthy();
    });

    it("refuses a second exit while one is live, and allows one after a cancel", async () => {
      const first = await startExit();
      await expectRejection(startExit(), /already has an exit in progress \(EX-00001\)/);

      await asA((tx) => exits.cancelExit(tx, { id: first.id, reason: "Redeployed instead", actor }));
      await expect(startExit()).resolves.toMatchObject({ exitNumber: "EX-00002" });
    });

    it("refuses a last day before the hire date", async () => {
      await expectRejection(startExit({ lastWorkingDate: "2023-12-31" }), /before the hire date/);
    });
  });

  describe("the draft dues", () => {
    it("computes salary, notice, leave and severance from the live facts", async () => {
      await asA(async (tx) => {
        const [annual] = await tx.execute(sql`SELECT id FROM leave_types WHERE code = 'annual'`);
        await leaveRepo.setEntitlement(tx, {
          companyId: companyA, employeeId: jane.id, leaveTypeId: annual.id,
          year: 2026, entitledDays: 21,
        });
      });
      const exit = await startExit();
      const { dues } = await asA((tx) => exits.getExit(tx, exit.id));

      expect(dues.live).toBe(true);
      expect(dues.dailyRate).toBeCloseTo(100000 / 30, 2);
      expect(codes(dues)).toEqual(
        expect.arrayContaining(["unpaid_salary", "notice_pay", "leave_pay", "severance"]),
      );

      // No notice was given: the full 28 days.
      const notice = dues.lines.find((l) => l.code === "notice_pay");
      expect(notice.quantity).toBe(28);
      // Hired January 2024, leaving August 2026: two completed years.
      expect(dues.lines.find((l) => l.code === "severance").quantity).toBe(30);
      // 21 days for the year, pro-rated to 14 August: 7 months and 14/31.
      expect(dues.untakenLeaveDays).toBeCloseTo(21 * (7 + 14 / 31) / 12, 2);

      // Never paid through QaliSuite: salary is counted from 1 August, and it says so.
      expect(dues.warnings.join(" ")).toMatch(/No payslip for this employee has been approved/);

      const t = dues.totals;
      expect(t.paye + t.nssf + t.shif + t.housingLevy + t.otherDeductions + t.net)
        .toBeCloseTo(t.grossEarnings, 2);
    });

    it("pays nothing past an approved payslip, and recovers what it overpaid", async () => {
      const run = await asA((tx) =>
        payroll.createRun(tx, { companyId: companyA, month: 8, year: 2026, actor }));
      await asA((tx) => payroll.generateEntries(tx, { companyId: companyA, runId: run.id, actor }));
      await asA((tx) => payroll.approveRun(tx, { companyId: companyA, runId: run.id, actor }));

      const exit = await startExit({ exitType: "resignation", noticeDate: "2026-07-17" });
      const { dues } = await asA((tx) => exits.getExit(tx, exit.id));
      expect(codes(dues)).not.toContain("unpaid_salary");
      const over = dues.lines.find((l) => l.code === "overpaid_salary");
      // 15–31 August 2026: 15 August is a Saturday, so 11 weekdays.
      expect(over.quantity).toBe(11);
      expect(dues.warnings.join(" ")).not.toMatch(/No payslip/);
    });

    it("warns when the employee sits on a payroll run still being prepared", async () => {
      const run = await asA((tx) =>
        payroll.createRun(tx, { companyId: companyA, month: 8, year: 2026, actor }));
      await asA((tx) => payroll.generateEntries(tx, { companyId: companyA, runId: run.id, actor }));
      const exit = await startExit();
      const { dues } = await asA((tx) => exits.getExit(tx, exit.id));
      expect(dues.warnings.join(" ")).toMatch(/still being prepared.*paid twice/);
    });

    it("takes manual lines, and insists a manual deduction names its account", async () => {
      const exit = await startExit();
      await expectRejection(
        asA((tx) => exits.addManualLine(tx, {
          companyId: companyA, exitId: exit.id, kind: "deduction",
          description: "Phone not returned", amount: 8000,
        })),
        /account a deduction is credited to/,
      );
      await asA((tx) => exits.addManualLine(tx, {
        companyId: companyA, exitId: exit.id, kind: "deduction",
        description: "Phone not returned", amount: 8000, accountId: accounts.sundryIncome,
      }));
      const { dues } = await asA((tx) => exits.getExit(tx, exit.id));
      const manual = dues.lines.find((l) => l.code === "manual");
      expect(manual.amount).toBe(8000);
      expect(manual.id).toBeTruthy();
    });
  });

  describe("approving", () => {
    it("will not approve while the clearance is incomplete", async () => {
      const exit = await startExit();
      await expectRejection(approve(exit.id), /clearance item\(s\) are still pending/);
    });

    it("insists a waived item says why", async () => {
      const exit = await startExit();
      const { clearance } = await asA((tx) => exits.getExit(tx, exit.id));
      await expectRejection(
        asA((tx) => exits.setClearanceStatus(tx, { itemId: clearance[0].id, status: "waived", actor })),
        /why this item is being waived/,
      );
    });

    it("ends the employment, posts a balanced entry and freezes the statement", async () => {
      const exit = await startExit();
      await clearAll(exit.id);
      const { exit: approved, journalEntryId } = await approve(exit.id);

      expect(approved.status).toBe("approved");
      expect(Number(approved.netPay)).toBeGreaterThan(0);

      const [emp] = await asA((tx) => tx.execute(sql`
        SELECT status, termination_date::text AS td FROM employees WHERE id = ${jane.id}::uuid`));
      expect(emp).toEqual({ status: "terminated", td: "2026-08-14" });

      const [sums] = await asA((tx) => tx.execute(sql`
        SELECT SUM(debit)::numeric AS dr, SUM(credit)::numeric AS cr
          FROM journal_lines WHERE entry_id = ${journalEntryId}::uuid`));
      expect(Number(sums.dr)).toBeCloseTo(Number(sums.cr), 2);

      const [payable] = await asA((tx) => tx.execute(sql`
        SELECT SUM(credit)::numeric AS cr FROM journal_lines
         WHERE entry_id = ${journalEntryId}::uuid
           AND account_id = ${accounts.salaryPayable}::uuid`));
      expect(Number(payable.cr)).toBeCloseTo(Number(approved.netPay), 2);

      // The stored statement is what was approved, and it cannot be changed.
      const { dues } = await asA((tx) => exits.getExit(tx, exit.id));
      expect(dues.live).toBe(false);
      expect(dues.totals.net).toBeCloseTo(Number(approved.netPay), 2);
      await expectRejection(
        asA((tx) => tx.execute(sql`
          UPDATE employee_exit_lines SET amount = 1 WHERE exit_id = ${exit.id}::uuid`)),
        /can no longer be changed/,
      );
      await expectRejection(
        asA((tx) => exits.updateExit(tx, {
          id: exit.id, exitType: "redundancy", lastWorkingDate: "2026-08-20", actor,
        })),
        /approved and can no longer be changed/,
      );
    });

    it("refuses to post with a payroll account unmapped", async () => {
      await asA((tx) => tx.execute(sql`UPDATE payroll_configs SET paye_payable_account_id = NULL`));
      const exit = await startExit();
      await clearAll(exit.id);
      await expectRejection(approve(exit.id), /PAYE payable is not mapped/);
      const [still] = await asA((tx) => tx.execute(sql`
        SELECT status FROM employees WHERE id = ${jane.id}::uuid`));
      expect(still.status).not.toBe("terminated");
    });

    it("recovers loan instalments from the dues and closes a loan they clear", async () => {
      const loan = await asA((tx) =>
        loansRepo.createLoan(tx, {
          companyId: companyA, employeeId: jane.id, loanType: "staff_loan",
          principalAmount: 30000, tenureMonths: 3, startMonth: 9, startYear: 2026,
          actor,
        }));
      await asA((tx) => loansRepo.approveLoan(tx, { id: loan.id, actor }));
      await asA((tx) => loansRepo.disburseLoan(tx, {
        companyId: companyA, id: loan.id, method: "bank", actor,
      }));

      const exit = await startExit();
      const { dues } = await asA((tx) => exits.getExit(tx, exit.id));
      expect(dues.lines.find((l) => l.code === "loan_recovery").amount).toBe(30000);

      await clearAll(exit.id);
      await approve(exit.id);

      const inst = await asA((tx) => tx.execute(sql`
        SELECT status, exit_id FROM loan_installments WHERE loan_id = ${loan.id}::uuid`));
      expect(inst.every((i) => i.status === "deducted" && i.exit_id === exit.id)).toBe(true);
      const [l] = await asA((tx) => tx.execute(sql`SELECT status FROM loans WHERE id = ${loan.id}::uuid`));
      expect(l.status).toBe("fully_repaid");
    });
  });

  describe("paying", () => {
    it("clears the payable against the bank", async () => {
      const exit = await startExit();
      await clearAll(exit.id);
      const { exit: approved } = await approve(exit.id);

      const { exit: paid, journalEntryId } = await asA((tx) =>
        exits.payExit(tx, { companyId: companyA, id: exit.id, paymentReference: "EFT-9931", actor }));
      expect(paid.status).toBe("paid");
      expect(paid.paymentReference).toBe("EFT-9931");

      const lines = await asA((tx) => tx.execute(sql`
        SELECT account_id, debit::numeric AS dr, credit::numeric AS cr
          FROM journal_lines WHERE entry_id = ${journalEntryId}::uuid`));
      const bank = lines.find((l) => l.account_id === accounts.bankAccount);
      expect(Number(bank.cr)).toBeCloseTo(Number(approved.netPay), 2);

      await expectRejection(
        asA((tx) => exits.payExit(tx, { companyId: companyA, id: exit.id, actor })),
        /Only approved final dues can be paid/,
      );
    });
  });

  describe("the certificate of service", () => {
    it("is not issued while the employment continues", async () => {
      await expectRejection(
        asA((tx) => exits.getCertificateOfServiceData(tx, jane.id)),
        /issued when the employment ends/,
      );
    });

    it("states what s.51 requires and nothing about why they left", async () => {
      const exit = await startExit();
      await clearAll(exit.id);
      await approve(exit.id);

      const cert = await asA((tx) => exits.getCertificateOfServiceData(tx, jane.id));
      expect(cert.company.name).toBe("Pilot Engineering");
      expect(cert.employee).toMatchObject({
        fullName: "Jane Wanjiru",
        hireDate: "2024-01-08",
        terminationDate: "2026-08-14",
        designation: "Site Engineer",
        workLocation: "Nairobi",
      });
      expect(cert.positions[0]).toEqual({ title: "Site Engineer", from: "2024-01-08" });
      expect(cert.reference).toBe("EX-00001");
      expect(JSON.stringify(cert)).not.toMatch(/Site closed|redundan/i);
    });
  });

  describe("isolation", () => {
    it("shows another tenant nothing", async () => {
      const exit = await startExit();
      const other = randomUUID();
      await admin`INSERT INTO companies (id, name, slug)
                  VALUES (${other}, 'Elsewhere', ${"e-" + other.slice(0, 8)})`;
      const seen = await asTenant(other, (tx) => exits.getExit(tx, exit.id));
      expect(seen).toBeNull();
      const list = await asTenant(other, (tx) => exits.listExits(tx));
      expect(list.total).toBe(0);
    });
  });
});
