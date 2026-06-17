/**
 * Petty cash STATEMENT — the return is derived from the GL, not typed.
 *
 * computePettyCashStatement aggregates the float account's activity over a date
 * range: CR = every Expense paid from the float, DR = posted JE lines that debit
 * the float (top-ups). This proves the core logic (rows, DR/CR split, running
 * balance, project/category labels) in isolation.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import Account from "@/app/models/account";
import Project from "@/app/models/project";
import "@/app/models/expenses";
import "@/app/models/JournalEntry";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/utils/tenant-utils", () => ({
  getTenantContext: vi.fn(async () => ({})),
}));
vi.mock("@/app/config/dbConnect", () => ({ default: vi.fn(async () => {}) }));

const { computePettyCashStatement } = await import(
  "@/app/mongodb/queries/petty-cash-queries.js"
);

const { ObjectId } = mongoose.Types;
let seq = 0;
async function raw(model, docs) {
  const NUM = { Expense: "expenseNumber", JournalEntry: "entryNumber" };
  const f = NUM[model];
  await mongoose
    .model(model)
    .collection.insertMany(docs.map((d) => (f && d[f] == null ? { ...d, [f]: `${f}-${++seq}` } : d)));
}

describe("computePettyCashStatement", () => {
  let companyId, floatId, bankId, project;

  beforeEach(async () => {
    companyId = new ObjectId();
    floatId = (await Account.create({ companyId, accountCode: "1000", accountName: "Petty Cash", accountType: "asset", subType: "cash", systemAccount: "petty_cash", canPost: true, isActive: true }))._id;
    bankId = (await Account.create({ companyId, accountCode: "1010", accountName: "KCB", accountType: "asset", subType: "bank", canPost: true, isActive: true }))._id;
    project = await Project.create({ companyId, name: "Tom Project", projectNumber: `PRJ-${Date.now()}`, status: "active" });
  });

  it("lists float top-ups (DR) + expenses paid from the float (CR) with running balance", async () => {
    const inRange = new Date("2026-02-10");
    // Top-up: a posted JE that debits the float by 50,000.
    await raw("JournalEntry", [
      { companyId, status: "posted", entryDate: new Date("2026-02-01"), description: "Float received",
        lines: [
          { accountId: floatId, debit: 50000, credit: 0, accountType: "asset" },
          { accountId: bankId, debit: 0, credit: 50000, accountType: "asset" },
        ] },
    ]);
    // Two spends paid from the float — one project-tagged, one category overhead.
    await raw("Expense", [
      { companyId, paidFrom: floatId, status: "posted", expenseDate: inRange, total: 2000, description: "Fuel", projectId: project._id, vendor: { name: "Tom" } },
      { companyId, paidFrom: floatId, status: "paid", expenseDate: inRange, total: 780, description: "Kitchen", category: "office_supplies", vendor: { name: "Sophie" } },
      // out of range / different account — must NOT appear
      { companyId, paidFrom: floatId, status: "posted", expenseDate: new Date("2026-03-05"), total: 999, description: "Next month", vendor: { name: "X" } },
      { companyId, paidFrom: bankId, status: "posted", expenseDate: inRange, total: 888, description: "Paid from bank", vendor: { name: "Y" } },
    ]);

    const { rows, totals } = await computePettyCashStatement(
      { companyId },
      floatId,
      "2026-02-01",
      "2026-02-28",
      0,
    );

    expect(rows).toHaveLength(3); // 1 top-up + 2 in-range float expenses
    expect(totals.debits).toBe(50000);
    expect(totals.credits).toBe(2780);
    expect(totals.closing).toBe(47220);

    const topup = rows.find((r) => r.direction === "debit");
    expect(topup.amount).toBe(50000);

    const fuel = rows.find((r) => r.ref?.includes("expenseNumber") && r.amount === 2000);
    expect(fuel.projectLabel).toBe("Tom Project"); // project name
    const kitchen = rows.find((r) => r.amount === 780);
    expect(kitchen.projectLabel).toBe("office_supplies"); // category fallback

    // running balance ends at the closing figure
    expect(rows[rows.length - 1].balance).toBe(47220);
  });
});
