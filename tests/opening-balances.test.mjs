/**
 * Opening Balances (conversion balances) action.
 *
 * Posts ONE balanced `opening_balance` journal entry from a trial-balance grid,
 * plugging any difference into Opening Balance Equity, and blocks a second
 * posting (which would double the books). These prove the core accounting math.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import Account from "@/app/models/account";
import JournalEntry from "@/app/models/JournalEntry";
import { seedTenant } from "./helpers/fixtures.mjs";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/config/dbConnect", () => ({ default: vi.fn(async () => {}) }));
vi.mock("@/lib/plan-gate", () => ({ requirePlanAccess: vi.fn(async () => true) }));
vi.mock("@/lib/utils/server-utils", () => ({
  generateUniqueEntryNumber: vi.fn(async () => "OB-TEST-1"),
}));
vi.mock("@/lib/utils/tenant-utils", () => ({ getTenantContext: vi.fn() }));

import { getTenantContext } from "@/lib/utils/tenant-utils";
const { postOpeningBalances } = await import(
  "@/app/mongodb/actions/opening-balance-actions"
);

describe("postOpeningBalances", () => {
  let tenant, bank, sales;

  beforeEach(async () => {
    tenant = await seedTenant();
    bank = tenant.accounts.bank_main._id;
    sales = tenant.accounts.sales_revenue._id;
    // The fixture COA has no Opening Balance Equity — create the plug account.
    await Account.create({
      companyId: tenant.company._id,
      accountCode: "3500",
      accountName: "Opening Balance Equity",
      accountType: "equity",
      subType: "capital",
      canPost: true,
      isActive: true,
      systemAccount: "opening_balance_equity",
    });
    getTenantContext.mockResolvedValue({
      user: { role: "Admin", name: "Tester", id: "u1" },
      companyId: tenant.company._id,
    });
  });

  it("plugs an unbalanced trial balance into Opening Balance Equity", async () => {
    // Only the bank balance entered — 1,000,000 with nothing on the other side.
    const res = await postOpeningBalances({
      entryDate: "2026-01-01",
      lines: [{ accountId: bank.toString(), debit: 1_000_000, credit: 0 }],
    });

    expect(res.success).toBe(true);
    expect(res.openingBalanceEquity).toBeCloseTo(1_000_000, 2); // credit-normal plug

    const je = await JournalEntry.findOne({
      companyId: tenant.company._id,
      entryType: "opening_balance",
    }).lean();
    expect(je.status).toBe("posted");
    const debit = je.lines.reduce((s, l) => s + (l.debit || 0), 0);
    const credit = je.lines.reduce((s, l) => s + (l.credit || 0), 0);
    expect(debit).toBeCloseTo(credit, 2); // balanced via the plug
    // The plug line lands on Opening Balance Equity as a credit of 1,000,000.
    const obeLine = je.lines.find((l) => l.accountCode === "3500");
    expect(obeLine.credit).toBeCloseTo(1_000_000, 2);
  });

  it("adds no plug when the grid already balances", async () => {
    const res = await postOpeningBalances({
      entryDate: "2026-01-01",
      lines: [
        { accountId: bank.toString(), debit: 1_000_000, credit: 0 },
        { accountId: sales.toString(), debit: 0, credit: 1_000_000 },
      ],
    });

    expect(res.success).toBe(true);
    expect(res.openingBalanceEquity).toBe(0);

    const je = await JournalEntry.findOne({
      companyId: tenant.company._id,
      entryType: "opening_balance",
    }).lean();
    expect(je.lines).toHaveLength(2); // no Opening Balance Equity line added
    expect(je.lines.some((l) => l.accountCode === "3500")).toBe(false);
  });

  it("blocks a second opening-balance posting (would double the books)", async () => {
    await postOpeningBalances({
      entryDate: "2026-01-01",
      lines: [{ accountId: bank.toString(), debit: 500, credit: 0 }],
    });

    const second = await postOpeningBalances({
      entryDate: "2026-01-01",
      lines: [{ accountId: bank.toString(), debit: 500, credit: 0 }],
    });

    expect(second.success).toBe(false);
    expect(second.error).toMatch(/already posted/i);
  });
});
