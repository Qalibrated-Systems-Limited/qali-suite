/**
 * PayrollEntry model integration tests.
 *
 * Specifically tests the `.recalculate()` instance method that sums up
 * earnings, sums up deductions, and computes net pay. This is the
 * payslip math — if it's wrong, every employee on payday is paid the
 * wrong amount. High-value tests.
 *
 * The Kenya tax calculators themselves are unit-tested in
 * tests/payroll-tax.test.mjs (no DB). This file tests that the model's
 * recalculate hook glues those numbers together correctly.
 */
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import PayrollEntry from "@/app/models/payrollEntry";
import { seedTenant } from "./helpers/fixtures.mjs";

const { ObjectId } = mongoose.Types;

// Build a minimum-valid PayrollEntry. Doesn't save until you call .save()
// — most tests just call .recalculate() and inspect the in-memory result.
function makeEntry(tenant, overrides = {}) {
  return new PayrollEntry({
    companyId: tenant.company._id,
    payrollRunId: overrides.payrollRunId || new ObjectId(),
    partyId: overrides.partyId || new ObjectId(),
    profileId: overrides.profileId || new ObjectId(),
    employeeNumber: overrides.employeeNumber || "EMP-001",
    employeeName: overrides.employeeName || "Test Employee",
    earnings: {
      basicSalary: 0,
      housingAllowance: 0,
      transportAllowance: 0,
      medicalAllowance: 0,
      otherAllowance: 0,
      overtime: 0,
      bonus: 0,
      commission: 0,
      additional: [],
      grossPay: 0,
      ...(overrides.earnings || {}),
    },
    deductions: {
      paye: 0,
      nssf: 0,
      shif: 0,
      housingLevy: 0,
      insuranceRelief: 0,
      loanRepayment: 0,
      saccoDeduction: 0,
      additional: [],
      totalDeductions: 0,
      ...(overrides.deductions || {}),
    },
    employerContributions: {
      nssf: 0,
      housingLevy: 0,
      ...(overrides.employerContributions || {}),
    },
    netPay: 0,
    ...overrides,
  });
}

describe("PayrollEntry.recalculate()", () => {
  it("sums basic + allowances + overtime into grossPay", async () => {
    const tenant = await seedTenant();
    const entry = makeEntry(tenant, {
      earnings: {
        basicSalary: 50_000,
        housingAllowance: 15_000,
        transportAllowance: 5_000,
        overtime: 3_000,
        bonus: 2_000,
      },
    });

    entry.recalculate();

    // 50000 + 15000 + 5000 + 3000 + 2000 = 75000
    expect(entry.earnings.grossPay).toBe(75_000);
  });

  it("sums PAYE + NSSF + SHIF + housing levy + loan into totalDeductions", async () => {
    const tenant = await seedTenant();
    const entry = makeEntry(tenant, {
      earnings: { basicSalary: 50_000, grossPay: 50_000 },
      deductions: {
        paye: 5_000,
        nssf: 3_000,
        shif: 1_375,
        housingLevy: 750,
        loanRepayment: 2_000,
        saccoDeduction: 500,
      },
    });

    entry.recalculate();

    // 5000 + 3000 + 1375 + 750 + 2000 + 500 = 12625
    expect(entry.deductions.totalDeductions).toBe(12_625);
  });

  it("computes netPay = grossPay - totalDeductions", async () => {
    const tenant = await seedTenant();
    const entry = makeEntry(tenant, {
      earnings: { basicSalary: 60_000 },
      deductions: { paye: 7_000, nssf: 3_000, shif: 1_650, housingLevy: 900 },
    });

    entry.recalculate();

    expect(entry.earnings.grossPay).toBe(60_000);
    expect(entry.deductions.totalDeductions).toBe(12_550);
    expect(entry.netPay).toBe(47_450);
  });

  it("rolls 'additional' earnings and deductions into the totals", async () => {
    const tenant = await seedTenant();
    const entry = makeEntry(tenant, {
      earnings: {
        basicSalary: 50_000,
        additional: [
          { description: "Sign-on bonus", amount: 10_000 },
          { description: "Acting allowance", amount: 5_000 },
        ],
      },
      deductions: {
        paye: 8_000,
        additional: [
          { description: "Welfare", amount: 500 },
          { description: "Damages", amount: 2_000 },
        ],
      },
    });

    entry.recalculate();

    // gross: 50000 + 10000 + 5000 = 65000
    expect(entry.earnings.grossPay).toBe(65_000);
    // deductions: 8000 + 500 + 2000 = 10500
    expect(entry.deductions.totalDeductions).toBe(10_500);
    // net: 65000 − 10500 = 54500
    expect(entry.netPay).toBe(54_500);
  });

  it("handles missing/zero values without producing NaN", async () => {
    const tenant = await seedTenant();
    // Brand new entry, all zeroes
    const entry = makeEntry(tenant);
    entry.recalculate();

    expect(entry.earnings.grossPay).toBe(0);
    expect(entry.deductions.totalDeductions).toBe(0);
    expect(entry.netPay).toBe(0);
    expect(Number.isNaN(entry.netPay)).toBe(false);
  });

  it("produces a negative netPay when deductions exceed gross (caller must validate)", async () => {
    // The model doesn't clamp net pay to 0 — it just does the arithmetic.
    // Validation that deductions ≤ gross is the action layer's job.
    // This test pins the current behavior so a refactor doesn't silently
    // change it without an explicit decision.
    const tenant = await seedTenant();
    const entry = makeEntry(tenant, {
      earnings: { basicSalary: 10_000 },
      deductions: { paye: 5_000, loanRepayment: 8_000 },
    });

    // The schema has min: 0 on netPay; this should throw on save.
    entry.recalculate();
    expect(entry.netPay).toBe(-3_000);

    // ...but trying to persist it should fail validation, which is
    // the safety net we expect at the database boundary.
    await expect(entry.save()).rejects.toThrow();
  });

  it("returns the entry itself (chainable)", async () => {
    const tenant = await seedTenant();
    const entry = makeEntry(tenant, {
      earnings: { basicSalary: 50_000 },
    });
    const result = entry.recalculate();
    expect(result).toBe(entry);
  });
});
