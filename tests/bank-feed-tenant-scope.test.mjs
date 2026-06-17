/**
 * Bank-feed allocation tenant isolation.
 *
 * The allocation paths used to load the bank line and target documents with
 * unscoped findById, so a user in tenant A could allocate tenant B's line /
 * post into B's books. The service now scopes the line load via withTenantScope
 * and every document load by the line's own companyId. These prove a foreign
 * line is rejected and a same-tenant allocation still works.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { BankFeedLine, BankStatement } from "@/app/models/bankFeed";
import JournalEntry from "@/app/models/JournalEntry";
import { seedTenant } from "./helpers/fixtures.mjs";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/app/config/dbConnect", () => ({ default: vi.fn(async () => {}) }));
// Real-equivalent tenant helpers without importing the module (it pulls in
// next-auth via getTenantContext, which doesn't load under Vitest).
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

const BankFeedService = (await import("@/app/mongodb/services/bankFeedService"))
  .default;

const { ObjectId } = mongoose.Types;

async function makeLine(tenant) {
  const stmt = await BankStatement.create({
    companyId: tenant.company._id,
    bankAccountId: tenant.accounts.bank_main._id,
    fileName: "stmt.csv",
    status: "ready",
    uploadedBy: { id: "u1", name: "U1" },
  });
  return BankFeedLine.create({
    companyId: tenant.company._id,
    statementId: stmt._id,
    bankAccountId: tenant.accounts.bank_main._id,
    transactionDate: new Date("2026-03-10"),
    description: "Office supplies",
    debitAmount: 1000,
    creditAmount: 0,
    status: "unallocated",
    lineHash: `h-${new ObjectId().toString()}`,
  });
}

describe("bank-feed allocation tenant isolation", () => {
  let tenantA, tenantB, lineB;

  beforeEach(async () => {
    tenantA = await seedTenant({ company: { name: "Tenant A Co", code: "TNTA", email: "a@test.co" } });
    tenantB = await seedTenant({ company: { name: "Tenant B Co", code: "TNTB", email: "b@test.co" } });
    lineB = await makeLine(tenantB);
  });

  it("rejects allocating another tenant's bank line", async () => {
    await expect(
      BankFeedService.allocateToExpense(
        lineB._id,
        { accountId: tenantA.accounts.officeExpense._id, description: "x" },
        "uA",
        "User A",
        tenantA.company._id.toString(), // attacker's own tenant
        false,
      ),
    ).rejects.toThrow(/not found/i);

    // The line must remain untouched.
    const fresh = await BankFeedLine.findById(lineB._id).lean();
    expect(fresh.status).toBe("unallocated");
    expect(fresh.journalEntryId).toBeFalsy();
  });

  it("allows the owning tenant to allocate, posting a balanced entry", async () => {
    const res = await BankFeedService.allocateToExpense(
      lineB._id,
      { accountId: tenantB.accounts.officeExpense._id, description: "Supplies" },
      "uB",
      "User B",
      tenantB.company._id.toString(),
      false,
    );
    expect(res.success).toBe(true);

    const line = await BankFeedLine.findById(lineB._id).lean();
    expect(line.status).toBe("allocated");

    const je = await JournalEntry.findById(line.journalEntryId).lean();
    expect(je.companyId.toString()).toBe(tenantB.company._id.toString());
    const debit = je.lines.reduce((s, l) => s + (l.debit || 0), 0);
    const credit = je.lines.reduce((s, l) => s + (l.credit || 0), 0);
    expect(debit).toBeCloseTo(credit, 2);
  });
});
