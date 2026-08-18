/**
 * The payroll accrual journal.
 *
 * Payroll balances by an identity — gross = paye + nssf + shif + levy + other
 * deductions + net — so the entry should balance at zero. It carried a ±1
 * tolerance instead, absorbing rounding it should never have had, and using
 * the balance check to stand in for a GL-mapping check it could not actually
 * perform.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import Account from "@/app/models/account";
import "@/app/models/JournalEntry";
import "@/app/models/erp-counter";
import { seedTenant } from "./helpers/fixtures.mjs";

vi.mock("@/lib/utils/tenant-utils", () => ({
  getTenantContext: vi.fn(async () => ({
    user: { id: "u1", name: "Payroll Officer", role: "Admin" },
    companyId: globalThis.__companyId,
    isSuperAdmin: false,
  })),
}));
vi.mock("@/app/config/dbConnect", () => ({ default: vi.fn(async () => {}) }));
vi.mock("@/lib/plan-gate", () => ({ requirePlanAccess: vi.fn(async () => {}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));

const { postPayrollAccrualJournal } = await import(
  "@/app/mongodb/actions/hr-payroll-actions"
);

describe("payroll accrual journal", () => {
  let companyId;
  let gl;

  beforeAll(async () => {
    const tenant = await seedTenant();
    companyId = tenant.company._id;
    globalThis.__companyId = String(companyId);
  });

  beforeEach(async () => {
    await Account.deleteMany({ companyId });
    const mk = async (code, name, type) =>
      (await Account.create({
        companyId, accountCode: code, accountName: name,
        accountType: type, isActive: true,
      }))._id;

    gl = {
      salaryExpense: await mk("6000", "Salaries", "expense"),
      employerNssfExpense: await mk("6010", "Employer NSSF", "expense"),
      employerAhlExpense: await mk("6020", "Employer AHL", "expense"),
      payePayable: await mk("2400", "PAYE Payable", "liability"),
      nssfPayable: await mk("2410", "NSSF Payable", "liability"),
      shifPayable: await mk("2420", "SHIF Payable", "liability"),
      ahlPayable: await mk("2430", "AHL Payable", "liability"),
      salaryPayable: await mk("2440", "Net Salaries Payable", "liability"),
      staffLoansReceivable: await mk("1400", "Staff Loans", "asset"),
    };
  });

  /** Totals that satisfy the payroll identity to the cent. */
  function run(overrides = {}) {
    const totals = {
      totalGrossPay: 100000.55,
      totalPAYE: 20000.15,
      totalNSSF: 2160.20,
      totalSHIF: 2750.10,
      totalHousingLevy: 1500.05,
      totalOtherDeductions: 500.05,
      totalEmployerNSSF: 2160.20,
      totalEmployerAHL: 1500.05,
      // gross - (paye + nssf + shif + levy + other)
      totalNetPay: 100000.55 - (20000.15 + 2160.20 + 2750.10 + 1500.05 + 500.05),
      ...overrides,
    };
    return {
      _id: new mongoose.Types.ObjectId(),
      companyId,
      period: { label: "Aug 2026", month: 8, year: 2026 },
      totals,
    };
  }

  const user = { id: "u1", name: "Payroll Officer" };

  it("balances exactly, with no tolerance absorbing the difference", async () => {
    const jeId = await postPayrollAccrualJournal(run(), gl, user);
    expect(jeId).toBeTruthy();

    const JournalEntry = mongoose.model("JournalEntry");
    const je = await JournalEntry.findById(jeId).lean();
    const debits = je.lines.reduce((s, l) => s + (l.debit || 0), 0);
    const credits = je.lines.reduce((s, l) => s + (l.credit || 0), 0);

    // The identity holds, so the entry ties to the cent. Rounding each total
    // to whole units independently used to break this by several units.
    expect(Math.abs(debits - credits)).toBeLessThan(0.005);
    expect(debits).toBeCloseTo(103660.80, 2);
  });

  it("names an unmapped account instead of silently dropping its line", async () => {
    // Staff loans carry only 0.40. The line used to vanish and the imbalance
    // sat under the ±1 tolerance, so the deduction never reached the books.
    const r = run({ totalOtherDeductions: 0.40 });
    r.totals.totalNetPay =
      r.totals.totalGrossPay -
      (r.totals.totalPAYE + r.totals.totalNSSF + r.totals.totalSHIF +
       r.totals.totalHousingLevy + 0.40);

    await expect(
      postPayrollAccrualJournal(r, { ...gl, staffLoansReceivable: null }, user),
    ).rejects.toThrow(/staffLoansReceivable not mapped|mapping is incomplete/i);
  });

  it("catches two missing legs that would have cancelled each other out", async () => {
    // Employer NSSF expense and NSSF payable both unmapped. Their amounts
    // very nearly offset, so the old check saw a small imbalance and passed —
    // leaving NSSF absent from the books entirely, no expense and no liability.
    await expect(
      postPayrollAccrualJournal(
        run(),
        { ...gl, employerNssfExpense: null, nssfPayable: null },
        user,
      ),
    ).rejects.toThrow(/employerNssfExpense|nssfPayable/);
  });

  it("refuses a mapping that points at an account which does not exist", async () => {
    await expect(
      postPayrollAccrualJournal(
        run(),
        { ...gl, payePayable: new mongoose.Types.ObjectId() },
        user,
      ),
    ).rejects.toThrow(/do not exist/i);
  });

  it("does not require a mapping for a component with no amount", async () => {
    // Nothing was deducted for staff loans, so that account is not needed.
    const r = run({ totalOtherDeductions: 0 });
    r.totals.totalNetPay =
      r.totals.totalGrossPay -
      (r.totals.totalPAYE + r.totals.totalNSSF + r.totals.totalSHIF +
       r.totals.totalHousingLevy);

    const jeId = await postPayrollAccrualJournal(
      r,
      { ...gl, staffLoansReceivable: null },
      user,
    );
    expect(jeId).toBeTruthy();
  });

  it("refuses an entry that does not tie, rather than posting it out by a unit", async () => {
    // A component total that disagrees with the payslips it came from.
    const r = run({ totalPAYE: 20000.15 + 0.80 });
    await expect(postPayrollAccrualJournal(r, gl, user)).rejects.toThrow(
      /unbalanced by 0\.80/i,
    );
  });
});
