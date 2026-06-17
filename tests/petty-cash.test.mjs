/**
 * Petty cash: custodian funds the tin → records spends → submits → MD approves.
 *
 * Covers the CEO's rules (spend tied to a project OR a clear purpose; spend can't
 * exceed the float), the DR/CR balance math, the custodian/MD role split, the
 * project-cost link, AND the GL: funding posts DR Petty Cash / CR Bank, approval
 * posts DR Expense / CR Petty Cash — both balanced, through the same path
 * documents use.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import Account from "@/app/models/account";
import Project from "@/app/models/project";
import JournalEntry from "@/app/models/JournalEntry";
import PettyCashReturn from "@/app/models/pettyCashReturn";
import PettyCashEntry from "@/app/models/pettyCashEntry";
import "@/app/models/erp-counter";
import "@/app/models/Company";
import "@/app/models/fiscalPeriod";
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
  fundPettyCash,
  addPettyCashEntry,
  submitPettyCashReturn,
  approvePettyCashReturn,
} = await import("@/app/mongodb/actions/petty-cash-actions.js");

let companyId, floatId, bankId, expenseId, project;

async function seedAccount(over) {
  const acc = await Account.create({
    companyId,
    canPost: true,
    isActive: true,
    ...over,
  });
  return acc._id;
}

const PERIOD = { from: "2026-02-01", to: "2026-02-28" };
const totals = (je) => ({
  dr: je.lines.reduce((s, l) => s + (l.debit || 0), 0),
  cr: je.lines.reduce((s, l) => s + (l.credit || 0), 0),
});

describe("petty cash lifecycle + GL posting", () => {
  beforeAll(async () => {
    await Promise.all([
      Project.init(),
      PettyCashReturn.init(),
      PettyCashEntry.init(),
      JournalEntry.init(),
    ]);
  });

  beforeEach(async () => {
    companyId = new ObjectId();
    ctx.companyId = companyId.toString();
    ctx.isSuperAdmin = false;
    ctx.user = { name: "Sophie Custodian", id: new ObjectId().toString(), role: "Accountant" };
    floatId = await seedAccount({ accountCode: "1000", accountName: "Petty Cash", accountType: "asset", subType: "cash", systemAccount: "petty_cash" });
    bankId = await seedAccount({ accountCode: "1010", accountName: "KCB Bank", accountType: "asset", subType: "bank" });
    expenseId = await seedAccount({ accountCode: "6000", accountName: "Petty Cash Expenses", accountType: "expense", subType: "operating_expense" });
    project = await Project.create({
      companyId,
      name: "Tom projects",
      projectNumber: `PRJ-${Date.now()}`,
      status: "active",
    });
  });

  it("rejects a blank allocation and an over-float spend", async () => {
    const { returnId: rid } = await createPettyCashReturn({ floatAccountId: floatId.toString(), ...PERIOD });
    await fundPettyCash(rid, { sourceAccountId: bankId.toString(), amount: 50000 });

    expect((await addPettyCashEntry(rid, { payeeName: "Tom", description: "Fuel", projectId: project._id.toString(), amount: 2000 })).success).toBe(true);
    expect((await addPettyCashEntry(rid, { payeeName: "Sophie", description: "Kitchen", purpose: "Welfare", amount: 780 })).success).toBe(true);

    const blank = await addPettyCashEntry(rid, { payeeName: "X", description: "Unexplained", amount: 500 });
    expect(blank.success).toBe(false);
    expect(blank.error).toMatch(/project or .*purpose/i);

    const over = await addPettyCashEntry(rid, { payeeName: "Hardware", description: "Construction materials", projectId: project._id.toString(), amount: 200000 });
    expect(over.success).toBe(false);
    expect(over.error).toMatch(/exceeds the petty cash balance/i);
  });

  it("funding posts DR Petty Cash / CR Bank", async () => {
    const { returnId: rid } = await createPettyCashReturn({ floatAccountId: floatId.toString(), ...PERIOD });
    const res = await fundPettyCash(rid, { sourceAccountId: bankId.toString(), amount: 50000 });
    expect(res.success).toBe(true);

    const je = await JournalEntry.findOne({ companyId, entryType: "transfer" }).lean();
    expect(je.status).toBe("posted");
    const t = totals(je);
    expect(t.dr).toBe(50000);
    expect(t.cr).toBe(50000); // balanced
    const floatLine = je.lines.find((l) => l.accountId.toString() === floatId.toString());
    const bankLine = je.lines.find((l) => l.accountId.toString() === bankId.toString());
    expect(floatLine.debit).toBe(50000); // DR petty cash
    expect(bankLine.credit).toBe(50000); // CR bank
  });

  it("approval posts DR Expense / CR Petty Cash and feeds project cost", async () => {
    const { returnId: rid } = await createPettyCashReturn({ floatAccountId: floatId.toString(), ...PERIOD });
    await fundPettyCash(rid, { sourceAccountId: bankId.toString(), amount: 50000 });
    await addPettyCashEntry(rid, { payeeName: "Tom", description: "Fuel", projectId: project._id.toString(), amount: 2000 });
    await addPettyCashEntry(rid, { payeeName: "Sophie", description: "Kitchen", purpose: "Welfare", amount: 780 });

    const ret = await PettyCashReturn.findById(rid).lean();
    expect(ret.totals.closing).toBe(47220); // 0 + 50000 − 2780

    expect((await submitPettyCashReturn(rid)).success).toBe(true);
    // custodian (Accountant) can't approve
    expect((await approvePettyCashReturn(rid)).success).toBe(false);

    ctx.user = { name: "Henry MD", id: new ObjectId().toString(), role: "CEO" };
    expect((await approvePettyCashReturn(rid)).success).toBe(true);

    // spend JE posted, balanced: DR expense 2780 / CR petty cash 2780
    const je = await JournalEntry.findOne({ companyId, entryType: "expense" }).lean();
    expect(je.status).toBe("posted");
    const t = totals(je);
    expect(t.dr).toBe(2780);
    expect(t.cr).toBe(2780);
    const expLine = je.lines.find((l) => l.accountId.toString() === expenseId.toString());
    const floatLine = je.lines.find((l) => l.accountId.toString() === floatId.toString());
    expect(expLine.debit).toBe(2780); // DR expenses
    expect(floatLine.credit).toBe(2780); // CR petty cash

    // project-tagged spend is now project cost
    const p = await Project.findById(project._id).lean();
    expect(p.financials.totalCosts).toBe(2000);
  });
});
