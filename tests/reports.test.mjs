/**
 * Financial report unit tests.
 *
 * The report layer (Trial Balance, General Ledger, Balance Sheet) had NO
 * coverage, which is how three balance bugs shipped:
 *   1. Trial Balance showed gross debit+credit turnover per account instead
 *      of the net balance on a single side.
 *   2. General Ledger started its running balance at 0, ignoring activity
 *      before the report's start date → wrong closing balance.
 *   3. The paginated account ledger reset the running balance to 0 on every
 *      page → wrong balances beyond page 1.
 *
 * Each test below fails against the pre-fix behaviour and passes after it.
 * Reports derive everything from POSTED journal entries, so we seed raw JEs
 * directly (bypassing schema requirements via collection inserts, like the
 * petty-cash suite) and assert the math.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { seedTenant } from "./helpers/fixtures.mjs";

vi.mock("server-only", () => ({}));
vi.mock("@/app/config/dbConnect", () => ({ default: vi.fn(async () => {}) }));
// Re-implement the (trivial) tenant-scoping helpers here rather than loading
// the real module — its getTenantContext pulls in next-auth → next/server,
// which doesn't resolve under Vitest. Mirrors the production logic exactly.
vi.mock("@/lib/utils/tenant-utils", async () => {
  const { ObjectId } = await import("mongodb");
  return {
    getTenantContext: vi.fn(),
    withTenantScope: (query, companyId, isSuperAdmin) =>
      isSuperAdmin ? query : { ...query, companyId: new ObjectId(companyId) },
    buildTenantMatch: (companyId, isSuperAdmin) =>
      isSuperAdmin ? {} : { companyId: new ObjectId(companyId) },
  };
});

import { getTenantContext } from "@/lib/utils/tenant-utils";
const ReportService = (await import("@/app/mongodb/services/reportsService"))
  .default;
const { getAccountLedger } = await import(
  "@/app/mongodb/queries/accountQueries.js"
);

let seq = 0;
// Insert a POSTED journal entry straight into the collection so we don't have
// to satisfy every required schema field — reports only read these few.
async function postJE(companyId, entryDate, lines, entryNumber) {
  await mongoose.model("JournalEntry").collection.insertOne({
    companyId,
    entryNumber: entryNumber || `JE-${String(++seq).padStart(4, "0")}`,
    status: "posted",
    entryDate,
    lines,
  });
}

describe("financial reports", () => {
  let tenant, bank, sales, office;

  beforeEach(async () => {
    seq = 0;
    tenant = await seedTenant();
    bank = tenant.accounts.bank_main._id;
    sales = tenant.accounts.sales_revenue._id;
    office = tenant.accounts.officeExpense._id;
    // Reports read the tenant from the session; point it at the seeded company.
    getTenantContext.mockResolvedValue({
      companyId: tenant.company._id.toString(),
      isSuperAdmin: false,
    });
  });

  it("trial balance nets each account to one side, not gross turnover", async () => {
    // Dr Bank 1000 / Cr Sales 1000
    await postJE(tenant.company._id, new Date("2026-03-05"), [
      { accountId: bank, debit: 1000, credit: 0 },
      { accountId: sales, debit: 0, credit: 1000 },
    ]);
    // Dr Office 600 / Cr Bank 600  → bank nets to 400 debit
    await postJE(tenant.company._id, new Date("2026-03-10"), [
      { accountId: office, debit: 600, credit: 0 },
      { accountId: bank, debit: 0, credit: 600 },
    ]);

    const tb = await ReportService.generateTrialBalance(new Date("2026-03-31"));
    const row = (code) => tb.accounts.find((a) => a.accountCode === code);

    // Bank had 1000 in + 600 out. Net = 400 on the DEBIT side only.
    // The bug showed debit 1000 AND credit 600 (gross turnover).
    expect(row("1010").debit).toBeCloseTo(400, 2);
    expect(row("1010").credit).toBe(0);

    expect(row("4000").credit).toBeCloseTo(1000, 2); // Sales — credit
    expect(row("4000").debit).toBe(0);
    expect(row("5100").debit).toBeCloseTo(600, 2); // Office expense — debit

    expect(tb.summary.totalDebits).toBeCloseTo(1000, 2);
    expect(tb.summary.totalCredits).toBeCloseTo(1000, 2);
    expect(tb.summary.isBalanced).toBe(true);
  });

  it("general ledger seeds the opening balance from activity before the start date", async () => {
    // BEFORE the window (January): Dr Bank 1000 / Cr Sales 1000
    await postJE(tenant.company._id, new Date("2026-01-15"), [
      { accountId: bank, debit: 1000, credit: 0 },
      { accountId: sales, debit: 0, credit: 1000 },
    ]);
    // IN the window (February): Dr Office 300 / Cr Bank 300
    await postJE(tenant.company._id, new Date("2026-02-10"), [
      { accountId: office, debit: 300, credit: 0 },
      { accountId: bank, debit: 0, credit: 300 },
    ]);

    const gl = await ReportService.generateGeneralLedger(
      bank,
      "2026-02-01",
      "2026-02-28",
    );

    expect(gl.summary.openingBalance).toBeCloseTo(1000, 2); // Jan carried in
    expect(gl.transactions).toHaveLength(1); // only the Feb row
    expect(gl.transactions[0].balance).toBeCloseTo(700, 2); // 1000 - 300
    expect(gl.summary.closingBalance).toBeCloseTo(700, 2);
  });

  it("paginated account ledger carries the opening balance across pages", async () => {
    // 25 entries, each Dr Bank 100 / Cr Sales 100 → bank +100 each.
    // Zero-padded entry numbers keep the sort tiebreaker deterministic so the
    // page boundary matches between the page query and the opening-balance one.
    for (let i = 0; i < 25; i++) {
      await postJE(
        tenant.company._id,
        new Date("2026-04-01"),
        [
          { accountId: bank, debit: 100, credit: 0 },
          { accountId: sales, debit: 0, credit: 100 },
        ],
        `JE-${String(i + 1).padStart(4, "0")}`,
      );
    }

    const page1 = await getAccountLedger(bank, 1);
    expect(page1.openingBalance).toBe(0);
    expect(page1.transactions).toHaveLength(20);
    expect(page1.transactions[19].balance).toBeCloseTo(2000, 2); // 20 * 100

    const page2 = await getAccountLedger(bank, 2);
    expect(page2.openingBalance).toBeCloseTo(2000, 2); // page 1 carried in
    expect(page2.transactions).toHaveLength(5);
    expect(page2.transactions[0].balance).toBeCloseTo(2100, 2); // 2000 + 100
    expect(page2.transactions[4].balance).toBeCloseTo(2500, 2); // 25 * 100
  });

  it("balance sheet folds current-period earnings into equity and balances", async () => {
    // Revenue: Dr Bank 1000 / Cr Sales 1000
    await postJE(tenant.company._id, new Date("2026-03-05"), [
      { accountId: bank, debit: 1000, credit: 0 },
      { accountId: sales, debit: 0, credit: 1000 },
    ]);
    // Expense: Dr Office 400 / Cr Bank 400
    await postJE(tenant.company._id, new Date("2026-03-10"), [
      { accountId: office, debit: 400, credit: 0 },
      { accountId: bank, debit: 0, credit: 400 },
    ]);

    const bs = await ReportService.generateBalanceSheet(new Date("2026-03-31"));

    expect(bs.summary.totalAssets).toBeCloseTo(600, 2); // bank 1000 - 400
    const cye = bs.equity.accounts.find((a) => a.accountCode === "CYE");
    expect(cye.balance).toBeCloseTo(600, 2); // 1000 revenue - 400 expense
    expect(bs.summary.isBalanced).toBe(true); // A = L + E
  });
});
