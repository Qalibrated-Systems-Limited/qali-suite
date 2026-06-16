/**
 * generatePayrollEntries orchestration test.
 *
 * The statutory math (PAYE/NSSF/SHIF/AHL) and PayrollEntry.recalculate() are
 * unit-tested elsewhere. The UNtested critical path is the action that ties
 * config + active employees + approved leave into upserted entries inside a
 * transaction. The two properties that would cost real money if wrong:
 *
 *   1. IDEMPOTENCY — re-running a run must not create a second entry per
 *      employee (the upsert is keyed by {payrollRunId, partyId}). A duplicate
 *      means double pay.
 *   2. UNPAID LEAVE — an approved "unpaid" (LWOP) leave must reduce that
 *      employee's earnings. Missing it overpays for days not worked.
 *
 * Drives the real generatePayrollEntries against the in-memory replica set;
 * only the Next request glue is mocked.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import PayrollRun from "@/app/models/payrollRun";
import PayrollEntry from "@/app/models/payrollEntry";
import PayrollConfig from "@/app/models/payrollConfig";
import EmployeeProfile from "@/app/models/employeeProfile";
import LeaveRequest from "@/app/models/leaveRequest";
import "@/app/models/erp-counter";
import "@/app/models/loan";
import "@/app/models/publicHoliday";
import "@/app/models/JournalEntry";
import { seedTenant } from "./helpers/fixtures.mjs";

const { ObjectId } = mongoose.Types;
const ctx = { companyId: null, isSuperAdmin: false, user: null };

vi.mock("@/lib/utils/tenant-utils", () => ({
  getTenantContext: vi.fn(async () => ({ ...ctx })),
  withTenantScope: (query, companyId, isSuperAdmin) =>
    isSuperAdmin ? query : { ...query, companyId: new ObjectId(companyId) },
  getCompanyIdForCreate: (explicit, userCompanyId) => explicit || userCompanyId,
}));
vi.mock("@/app/config/dbConnect", () => ({ default: vi.fn(async () => {}) }));
vi.mock("@/lib/plan-gate", () => ({ requirePlanAccess: vi.fn(async () => {}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { generatePayrollEntries } = await import(
  "@/app/mongodb/actions/hr-payroll-actions.js"
);

// Statutory rates (mirrors the Kenya 2025 config used in payroll-tax.test).
const CONFIG = {
  payeBrackets: [
    { from: 0, to: 288_000, rate: 0.1 },
    { from: 288_000, to: 388_000, rate: 0.25 },
    { from: 388_000, to: 6_000_000, rate: 0.3 },
    { from: 6_000_000, to: 9_600_000, rate: 0.325 },
    { from: 9_600_000, to: null, rate: 0.35 },
  ],
  personalRelief: 2_400,
  insuranceReliefRate: 0.15,
  insuranceReliefCap: 5_000,
  nssfTierILimit: 8_000,
  nssfTierIILimit: 72_000,
  nssfEmployeeRate: 0.06,
  nssfEmployerRate: 0.06,
  shifRate: 0.0275,
  ahlEmployeeRate: 0.015,
  ahlEmployerRate: 0.015,
};

// Use a fixed, fully-elapsed past month so leave/holiday windows are stable.
const PERIOD = { month: 1, year: 2025 };

let seq = 0;

async function seedConfig(companyId) {
  return PayrollConfig.create({
    companyId,
    name: "Kenya 2025",
    isActive: true,
    effectiveFrom: new Date(2025, 0, 1),
    ...CONFIG,
  });
}

async function seedEmployee(companyId, overrides = {}) {
  const partyId = overrides.partyId || new ObjectId();
  return EmployeeProfile.create({
    companyId,
    partyId,
    employeeNumber: overrides.employeeNumber || `EMP-${seq++}`,
    personalInfo: {
      firstName: overrides.firstName || "Jane",
      lastName: overrides.lastName || "Doe",
    },
    employment: {
      status: "active",
      hireDate: new Date(2020, 0, 1),
      employmentType: "full_time",
      department: "Operations",
      designation: "Operator",
    },
    compensation: {
      basicSalary: overrides.basicSalary ?? 50_000,
      currency: "KES",
      paymentMethod: "bank",
    },
  });
}

async function seedRun(tenant) {
  return PayrollRun.create({
    companyId: tenant.company._id,
    payrollNumber: `PR-${Date.now()}-${seq++}`,
    period: PERIOD,
    status: "draft",
    createdBy: { name: tenant.user.name, id: tenant.user._id.toString() },
  });
}

describe("generatePayrollEntries", () => {
  let tenant;

  beforeAll(async () => {
    // Pre-build collections/indexes so the first transaction doesn't trip a
    // "catalog changes" WriteConflict (memory-server cold-start quirk).
    await Promise.all([
      PayrollRun.init(),
      PayrollEntry.init(),
      EmployeeProfile.init(),
    ]);
  });

  beforeEach(async () => {
    tenant = await seedTenant();
    ctx.companyId = tenant.company._id.toString();
    ctx.isSuperAdmin = false;
    ctx.user = {
      name: tenant.user.name,
      id: tenant.user._id.toString(),
      role: "Admin", // in PAYROLL_ROLES.CREATE
    };
    await seedConfig(tenant.company._id);
  });

  it("creates one entry per active employee with netPay below gross", async () => {
    await seedEmployee(tenant.company._id, { basicSalary: 50_000 });
    await seedEmployee(tenant.company._id, { basicSalary: 80_000 });
    const run = await seedRun(tenant);

    const res = await generatePayrollEntries(run._id.toString());
    expect(res.success).toBe(true);
    expect(res.employeeCount).toBe(2);

    const entries = await PayrollEntry.find({ payrollRunId: run._id }).lean();
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.earnings.grossPay).toBeGreaterThan(0);
      // statutory deductions were applied ⇒ net strictly below gross
      expect(e.netPay).toBeLessThan(e.earnings.grossPay);
      expect(e.deductions.totalDeductions).toBeGreaterThan(0);
    }
  });

  it("is idempotent — re-running does not double-create entries (no double pay)", async () => {
    await seedEmployee(tenant.company._id, { basicSalary: 50_000 });
    await seedEmployee(tenant.company._id, { basicSalary: 60_000 });
    const run = await seedRun(tenant);

    await generatePayrollEntries(run._id.toString());
    // Re-run still draft/processing → allowed; should UPSERT, not duplicate.
    await PayrollRun.findByIdAndUpdate(run._id, { status: "draft" });
    const res2 = await generatePayrollEntries(run._id.toString());
    expect(res2.success).toBe(true);

    const entries = await PayrollEntry.find({ payrollRunId: run._id }).lean();
    expect(entries).toHaveLength(2); // exactly one per employee, not four
  });

  it("deducts pay for approved unpaid (LWOP) leave", async () => {
    // Baseline employee — no leave.
    await seedEmployee(tenant.company._id, { basicSalary: 50_000 });
    // Employee with ~2 weeks of approved unpaid leave in the period.
    const onLeave = await seedEmployee(tenant.company._id, {
      basicSalary: 50_000,
      employeeNumber: "EMP-LWOP",
    });
    await LeaveRequest.create({
      companyId: tenant.company._id,
      leaveNumber: `LV-${Date.now()}`,
      employee: {
        partyId: onLeave.partyId,
        profileId: onLeave._id,
        name: "Jane Doe",
        employeeNumber: "EMP-LWOP",
      },
      leaveType: "unpaid",
      status: "approved",
      dates: {
        from: new Date(2025, 0, 6), // Mon
        to: new Date(2025, 0, 17), // Fri (two working weeks)
        totalDays: 10,
      },
    });

    const run = await seedRun(tenant);
    const res = await generatePayrollEntries(run._id.toString());
    expect(res.success).toBe(true);

    const lwopEntry = await PayrollEntry.findOne({
      payrollRunId: run._id,
      partyId: onLeave.partyId,
    }).lean();

    // The LWOP employee earns strictly less than their full basic salary.
    expect(lwopEntry.earnings.basicSalary).toBeLessThan(50_000);
    expect(lwopEntry.earnings.basicSalary).toBeGreaterThan(0);
  });
});
