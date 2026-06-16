/**
 * Petty cash: custodian records → submits → MD approves, and project-tagged
 * spend becomes project cost on approval.
 *
 * Covers the CEO's rules: a spend must be tied to a project OR a clear purpose
 * (never blank), the DR/CR balance math (opening + top-ups − spend), the
 * custodian/MD role split, and the project-cost link.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import Account from "@/app/models/account";
import Project from "@/app/models/project";
import PettyCashReturn from "@/app/models/pettyCashReturn";
import PettyCashEntry from "@/app/models/pettyCashEntry";
import "@/app/models/erp-counter";
// Models computeProjectActuals touches (registered for the recompute on approve).
import "@/app/models/invoice";
import "@/app/models/creditNote";
import "@/app/models/bill";
import "@/app/models/expenses";
import "@/app/models/employeesClaims";
import "@/app/models/requests";
import "@/app/models/stockmovement";

const { ObjectId } = mongoose.Types;
const ctx = { companyId: null, isSuperAdmin: false, user: null };

vi.mock("server-only", () => ({}));
vi.mock("@/lib/utils/tenant-utils", () => ({
  getTenantContext: vi.fn(async () => ({ ...ctx })),
  withTenantScope: (q, companyId, isSuperAdmin) =>
    isSuperAdmin ? q : { ...q, companyId: new ObjectId(companyId) },
  getCompanyIdForCreate: (explicit, userCompanyId) => explicit || userCompanyId,
}));
vi.mock("@/app/config/dbConnect", () => ({ default: vi.fn(async () => {}) }));
vi.mock("@/lib/plan-gate", () => ({ requirePlanAccess: vi.fn(async () => {}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const {
  createPettyCashReturn,
  addPettyCashEntry,
  submitPettyCashReturn,
  approvePettyCashReturn,
} = await import("@/app/mongodb/actions/petty-cash-actions.js");

let companyId, floatId, project;

async function seedFloat() {
  const acc = await Account.create({
    companyId,
    accountCode: "1000",
    accountName: "Petty Cash",
    accountType: "asset",
    subType: "cash",
    systemAccount: "petty_cash",
    canPost: true,
    isActive: true,
  });
  return acc._id;
}

const PERIOD = { from: "2026-02-01", to: "2026-02-28" };

describe("petty cash lifecycle", () => {
  beforeAll(async () => {
    await Promise.all([
      Project.init(),
      PettyCashReturn.init(),
      PettyCashEntry.init(),
    ]);
  });

  beforeEach(async () => {
    companyId = new ObjectId();
    ctx.companyId = companyId.toString();
    ctx.isSuperAdmin = false;
    ctx.user = { name: "Sophie Custodian", id: new ObjectId().toString(), role: "Accountant" };
    floatId = await seedFloat();
    project = await Project.create({
      companyId,
      name: "Tom projects",
      projectNumber: `PRJ-${Date.now()}`,
      status: "active",
    });
  });

  it("records spend with project or purpose, rejects a blank allocation", async () => {
    const created = await createPettyCashReturn({ floatAccountId: floatId.toString(), ...PERIOD });
    expect(created.success).toBe(true);
    const rid = created.returnId;

    // fund the tin first (float top-up)
    await addPettyCashEntry(rid, {
      payeeName: "Bank", description: "Float received", direction: "debit", amount: 50000,
    });

    // project-tagged spend
    const a = await addPettyCashEntry(rid, {
      payeeName: "Tom Okongo", description: "Fuel - Tom projects",
      projectId: project._id.toString(), amount: 2000,
    });
    expect(a.success).toBe(true);

    // purpose-only spend (overhead, no project)
    const b = await addPettyCashEntry(rid, {
      payeeName: "Sophie Juma", description: "Kitchen supplies", purpose: "Office welfare", amount: 780,
    });
    expect(b.success).toBe(true);

    // blank allocation — no project AND no purpose → rejected
    const bad = await addPettyCashEntry(rid, {
      payeeName: "Someone", description: "Unexplained", amount: 500,
    });
    expect(bad.success).toBe(false);
    expect(bad.error).toMatch(/project or .*purpose/i);

    // a spend beyond the float balance is pushed to the Bill/Expense flow
    const overspend = await addPettyCashEntry(rid, {
      payeeName: "Hardware", description: "Construction materials",
      projectId: project._id.toString(), amount: 200000,
    });
    expect(overspend.success).toBe(false);
    expect(overspend.error).toMatch(/exceeds the petty cash balance/i);

    const entries = await PettyCashEntry.find({ returnId: rid });
    expect(entries.filter((e) => e.direction === "credit")).toHaveLength(2); // blank + overspend rejected
  });

  it("computes the DR/CR balance and posts spend to the project on MD approval", async () => {
    const { returnId: rid } = await createPettyCashReturn({ floatAccountId: floatId.toString(), ...PERIOD });

    // a top-up (debit) and two spends (credits)
    await addPettyCashEntry(rid, { payeeName: "Bank", description: "Float top-up", direction: "debit", amount: 50000 });
    await addPettyCashEntry(rid, { payeeName: "Tom Okongo", description: "Fuel", projectId: project._id.toString(), amount: 2000 });
    await addPettyCashEntry(rid, { payeeName: "Sophie", description: "Kitchen", purpose: "Welfare", amount: 780 });

    let ret = await PettyCashReturn.findById(rid).lean();
    expect(ret.totals.debits).toBe(50000);
    expect(ret.totals.credits).toBe(2780);
    expect(ret.totals.closing).toBe(47220); // 0 opening + 50000 − 2780

    // custodian submits
    expect((await submitPettyCashReturn(rid)).success).toBe(true);

    // a custodian (Accountant) cannot approve
    const denied = await approvePettyCashReturn(rid);
    expect(denied.success).toBe(false);

    // MD approves
    ctx.user = { name: "Henry MD", id: new ObjectId().toString(), role: "CEO" };
    const ok = await approvePettyCashReturn(rid);
    expect(ok.success).toBe(true);

    ret = await PettyCashReturn.findById(rid).lean();
    expect(ret.status).toBe("approved");
    expect(ret.approvedBy.name).toBe("Henry MD");

    // entries marked posted
    const posted = await PettyCashEntry.countDocuments({ returnId: rid, posted: true });
    expect(posted).toBe(3);

    // the project-tagged spend is now project cost
    const p = await Project.findById(project._id).lean();
    expect(p.financials.totalCosts).toBe(2000);
  });
});
