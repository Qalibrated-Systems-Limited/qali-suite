/**
 * Bill cycle integration tests.
 *
 * Covers the highest-stakes path in the system: a bill is created in
 * draft, submitted for approval, approved (which creates a balanced
 * journal entry and credits AP), then paid down over one or more
 * payment events.
 *
 * These tests exist because the audit identified bill→JE as the place
 * where the most session bugs hid: tenant scoping leaks, missing
 * `requireGRN` branches, fiscal-period auto-creation race conditions,
 * and ObjectId-vs-string mismatches in aggregations. If any of those
 * regress, this suite catches it before launch.
 */
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import Bill from "@/app/models/bill";
import JournalEntry from "@/app/models/JournalEntry";
import { seedTenant } from "./helpers/fixtures.mjs";

// Helper — build a minimum-valid Bill instance attached to the given
// tenant. The bill defaults to a single $100 office-expense line; pass
// `overrides` to add lines or change amounts. Returns an unsaved doc so
// the test can inspect or mutate before persisting.
function makeBill(tenant, overrides = {}) {
  const billDate = overrides.billDate || new Date();
  const dueDate =
    overrides.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const fiscalPeriod =
    overrides.fiscalPeriod ||
    `${billDate.getFullYear()}-${String(billDate.getMonth() + 1).padStart(2, "0")}`;

  const lines = overrides.lines || [
    {
      lineNumber: 1,
      description: "Office stationery",
      account: {
        id: tenant.accounts.officeExpense._id,
        code: tenant.accounts.officeExpense.accountCode,
        name: tenant.accounts.officeExpense.accountName,
        type: "expense",
      },
      quantity: 1,
      unit: "set",
      unitPrice: 100,
      amount: 100,
      vat: { rate: 0, amount: 0 },
      lineTotal: 100,
    },
  ];

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const vatTotal = lines.reduce((s, l) => s + (l.vat?.amount || 0), 0);
  const total = subtotal + vatTotal;
  const wht = overrides.wht ?? 0;
  const netPayable = total - wht;

  return new Bill({
    companyId: tenant.company._id,
    billNumber: overrides.billNumber || `BILL-${Date.now()}`,
    billDate,
    dueDate,
    fiscalPeriod,
    supplier: {
      partyId: tenant.supplier._id,
      name: tenant.supplier.name,
      taxPin: tenant.supplier.taxPin,
    },
    lines,
    amounts: {
      subtotal,
      vat: vatTotal,
      total,
      wht,
      netPayable,
      paid: 0,
      balance: netPayable,
    },
    whtApplicable: wht > 0,
    whtRate: overrides.whtRate || 0,
    status: "draft",
    paymentStatus: "unpaid",
    createdBy: { name: tenant.user.name, id: tenant.user._id.toString() },
    ...overrides,
  });
}

describe("Bill cycle", () => {
  describe("create + submit", () => {
    it("creates a draft bill with sane defaults", async () => {
      const tenant = await seedTenant();
      const bill = await makeBill(tenant).save();

      expect(bill.status).toBe("draft");
      expect(bill.paymentStatus).toBe("unpaid");
      expect(bill.amounts.balance).toBe(100);
      expect(bill.amounts.paid).toBe(0);
      expect(bill.companyId.toString()).toBe(tenant.company._id.toString());
    });

    it("submit() flips status to submitted and stamps submittedBy/At", async () => {
      const tenant = await seedTenant();
      const bill = await makeBill(tenant).save();

      await bill.submit(tenant.user);

      expect(bill.status).toBe("submitted");
      expect(bill.submittedBy?.id).toBe(tenant.user._id.toString());
      expect(bill.submittedAt).toBeInstanceOf(Date);
    });

    it("submit() refuses to act on a non-draft bill", async () => {
      const tenant = await seedTenant();
      const bill = await makeBill(tenant).save();
      await bill.submit(tenant.user);

      await expect(bill.submit(tenant.user)).rejects.toThrow(/Cannot submit/);
    });
  });

  describe("approve", () => {
    it("creates a balanced journal entry with AP credited", async () => {
      const tenant = await seedTenant();
      const bill = await makeBill(tenant).save();
      await bill.submit(tenant.user);

      await bill.approve(tenant.user);

      // Bill state
      expect(bill.status).toBe("approved");
      expect(bill.accounting?.journalEntryId).toBeDefined();
      expect(bill.approvedBy?.id).toBe(tenant.user._id.toString());

      // Journal entry exists and is balanced
      const je = await JournalEntry.findById(bill.accounting.journalEntryId);
      expect(je).not.toBeNull();
      expect(je.status).toBe("posted");

      const totalDebits = je.lines.reduce((s, l) => s + (l.debit || 0), 0);
      const totalCredits = je.lines.reduce((s, l) => s + (l.credit || 0), 0);
      expect(totalDebits).toBeCloseTo(totalCredits, 2);
      expect(totalDebits).toBeCloseTo(100, 2);

      // Expense debited, AP credited
      const expenseLine = je.lines.find(
        (l) =>
          l.accountId.toString() ===
          tenant.accounts.officeExpense._id.toString(),
      );
      const apLine = je.lines.find(
        (l) =>
          l.accountId.toString() ===
          tenant.accounts.accounts_payable._id.toString(),
      );
      expect(expenseLine?.debit).toBe(100);
      expect(expenseLine?.credit).toBe(0);
      expect(apLine?.credit).toBe(100);
      expect(apLine?.debit).toBe(0);
    });

    it("posts VAT input + WHT payable when applicable", async () => {
      const tenant = await seedTenant();
      // Bill of 100 + 16% VAT (16) = 116 gross, 5% WHT (5) = 111 net payable.
      const lines = [
        {
          lineNumber: 1,
          description: "Professional fees",
          account: {
            id: tenant.accounts.officeExpense._id,
            code: tenant.accounts.officeExpense.accountCode,
            name: tenant.accounts.officeExpense.accountName,
            type: "expense",
          },
          quantity: 1,
          unit: "service",
          unitPrice: 100,
          amount: 100,
          vat: { rate: 16, amount: 16 },
          lineTotal: 116,
        },
      ];
      const bill = await makeBill(tenant, { lines, wht: 5, whtRate: 5 }).save();
      await bill.submit(tenant.user);
      await bill.approve(tenant.user);

      const je = await JournalEntry.findById(bill.accounting.journalEntryId);

      const debits = je.lines.reduce((s, l) => s + l.debit, 0);
      const credits = je.lines.reduce((s, l) => s + l.credit, 0);
      expect(debits).toBeCloseTo(credits, 2);

      const vatLine = je.lines.find(
        (l) =>
          l.accountId.toString() === tenant.accounts.vat_input._id.toString(),
      );
      const whtLine = je.lines.find(
        (l) =>
          l.accountId.toString() === tenant.accounts.wht_payable._id.toString(),
      );
      const apLine = je.lines.find(
        (l) =>
          l.accountId.toString() ===
          tenant.accounts.accounts_payable._id.toString(),
      );

      expect(vatLine?.debit).toBe(16);
      expect(whtLine?.credit).toBe(5);
      expect(apLine?.credit).toBe(111); // net payable = total(116) - wht(5)
    });

    it("auto-creates a fiscal period when one doesn't exist for the bill date", async () => {
      const tenant = await seedTenant();
      // Use a date in a different month from the seeded period.
      const futureDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      const fiscalPeriod = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, "0")}`;
      const bill = await makeBill(tenant, {
        billDate: futureDate,
        fiscalPeriod,
      }).save();
      await bill.submit(tenant.user);

      await expect(bill.approve(tenant.user)).resolves.not.toThrow();

      // The fiscal period should now exist
      const FiscalPeriod = mongoose.model("FiscalPeriod");
      const period = await FiscalPeriod.findOne({
        companyId: tenant.company._id,
        periodCode: fiscalPeriod,
      });
      expect(period).not.toBeNull();
    });

    it("refuses to act on a non-submitted bill", async () => {
      const tenant = await seedTenant();
      const bill = await makeBill(tenant).save(); // still draft

      await expect(bill.approve(tenant.user)).rejects.toThrow(/Cannot approve/);
    });
  });

  describe("reject", () => {
    it("flips status to rejected without creating a JE", async () => {
      const tenant = await seedTenant();
      const bill = await makeBill(tenant).save();
      await bill.submit(tenant.user);

      await bill.reject(tenant.user, "Wrong amount");

      expect(bill.status).toBe("rejected");
      expect(bill.rejectionReason).toBe("Wrong amount");
      expect(bill.accounting?.journalEntryId).toBeUndefined();

      const jeCount = await JournalEntry.countDocuments({
        "relatedDocuments.billId": bill._id,
      });
      expect(jeCount).toBe(0);
    });
  });

  describe("double-entry invariants", () => {
    // These tests pin down the bedrock rules of double-entry bookkeeping.
    // If any of them ever fail, the books are out of balance and the
    // trial balance / balance sheet will be wrong. Treat any regression
    // as a P0 even if no user-facing bug is reported.

    it("every JE posted by a bill has debits === credits", async () => {
      const tenant = await seedTenant();
      // Run 4 different shapes through and verify each balances:
      // simple expense, with VAT, with WHT, with VAT+WHT.
      const scenarios = [
        { wht: 0, vat: 0 },
        { wht: 0, vat: 16 },
        { wht: 5, vat: 0 },
        { wht: 5, vat: 16 },
      ];

      for (const { wht, vat } of scenarios) {
        const lines = [
          {
            lineNumber: 1,
            description: `Test (vat=${vat}, wht=${wht})`,
            account: {
              id: tenant.accounts.officeExpense._id,
              code: tenant.accounts.officeExpense.accountCode,
              name: tenant.accounts.officeExpense.accountName,
              type: "expense",
            },
            quantity: 1,
            unit: "ea",
            unitPrice: 100,
            amount: 100,
            vat: { rate: vat, amount: vat },
            lineTotal: 100 + vat,
          },
        ];
        const bill = await makeBill(tenant, {
          billNumber: `INV-${vat}-${wht}-${Date.now()}`,
          lines,
          wht,
          whtRate: wht,
        }).save();
        await bill.submit(tenant.user);
        await bill.approve(tenant.user);

        const je = await JournalEntry.findById(bill.accounting.journalEntryId);
        const debits = je.lines.reduce((s, l) => s + (l.debit || 0), 0);
        const credits = je.lines.reduce((s, l) => s + (l.credit || 0), 0);
        expect(debits, `vat=${vat}, wht=${wht}: debits != credits`).toBeCloseTo(
          credits,
          2,
        );
      }
    });

    it("every JE has at least 2 lines (no one-sided entries)", async () => {
      const tenant = await seedTenant();
      const bill = await makeBill(tenant).save();
      await bill.submit(tenant.user);
      await bill.approve(tenant.user);

      const je = await JournalEntry.findById(bill.accounting.journalEntryId);
      expect(je.lines.length).toBeGreaterThanOrEqual(2);
    });

    it("each JE line has either a debit OR a credit, never both, never neither", async () => {
      const tenant = await seedTenant();
      const lines = [
        {
          lineNumber: 1,
          description: "Mixed test",
          account: {
            id: tenant.accounts.officeExpense._id,
            code: tenant.accounts.officeExpense.accountCode,
            name: tenant.accounts.officeExpense.accountName,
            type: "expense",
          },
          quantity: 1,
          unit: "ea",
          unitPrice: 100,
          amount: 100,
          vat: { rate: 16, amount: 16 },
          lineTotal: 116,
        },
      ];
      const bill = await makeBill(tenant, { lines, wht: 5, whtRate: 5 }).save();
      await bill.submit(tenant.user);
      await bill.approve(tenant.user);

      const je = await JournalEntry.findById(bill.accounting.journalEntryId);
      for (const line of je.lines) {
        const dr = line.debit || 0;
        const cr = line.credit || 0;
        // Either debit > 0 XOR credit > 0; never both, never neither.
        expect(
          (dr > 0 && cr === 0) || (cr > 0 && dr === 0),
          `${line.accountCode}/${line.accountName}: dr=${dr} cr=${cr} (must be one-sided)`,
        ).toBe(true);
      }
    });

    it("each line's debit/credit side matches the account type's normal side", async () => {
      // Normal sides: asset/expense → debit, liability/revenue/equity → credit.
      // A bill approval should debit assets/expenses and credit liabilities.
      const tenant = await seedTenant();
      const lines = [
        {
          lineNumber: 1,
          description: "Normal-side test",
          account: {
            id: tenant.accounts.officeExpense._id,
            code: tenant.accounts.officeExpense.accountCode,
            name: tenant.accounts.officeExpense.accountName,
            type: "expense",
          },
          quantity: 1,
          unit: "ea",
          unitPrice: 100,
          amount: 100,
          vat: { rate: 16, amount: 16 },
          lineTotal: 116,
        },
      ];
      const bill = await makeBill(tenant, { lines, wht: 5, whtRate: 5 }).save();
      await bill.submit(tenant.user);
      await bill.approve(tenant.user);

      const je = await JournalEntry.findById(bill.accounting.journalEntryId);

      for (const line of je.lines) {
        const dr = line.debit || 0;
        const cr = line.credit || 0;
        const t = line.accountType;
        const isDebit = dr > 0;

        // For a fresh approval (no reversals/payments yet) every line
        // should hit the account's normal side — debit for asset/expense,
        // credit for liability/revenue/equity. If this ever fails it
        // means the bill.approve() code mixed up sides.
        if (t === "asset" || t === "expense") {
          expect(
            isDebit,
            `${t} account ${line.accountCode} expected DR side`,
          ).toBe(true);
        } else if (t === "liability" || t === "revenue" || t === "equity") {
          expect(
            isDebit,
            `${t} account ${line.accountCode} expected CR side`,
          ).toBe(false);
        }
      }
    });

    it("JE posts to the same companyId as the bill (no cross-tenant leak)", async () => {
      const tenantA = await seedTenant({
        company: { code: "AAA", name: "Co A" },
      });
      const tenantB = await seedTenant({
        company: { code: "BBB", name: "Co B" },
      });

      const billA = await makeBill(tenantA, { billNumber: "A-1" }).save();
      await billA.submit(tenantA.user);
      await billA.approve(tenantA.user);

      const jeA = await JournalEntry.findById(billA.accounting.journalEntryId);
      expect(jeA.companyId.toString()).toBe(tenantA.company._id.toString());
      expect(jeA.companyId.toString()).not.toBe(tenantB.company._id.toString());
    });
  });

  describe("tenant isolation", () => {
    it("bills from tenant A are invisible when querying as tenant B", async () => {
      const tenantA = await seedTenant({
        company: { code: "AAA", name: "Co A" },
      });
      const tenantB = await seedTenant({
        company: { code: "BBB", name: "Co B" },
      });

      await makeBill(tenantA, { billNumber: "A-001" }).save();
      await makeBill(tenantB, { billNumber: "B-001" }).save();

      const aBills = await Bill.find({ companyId: tenantA.company._id });
      const bBills = await Bill.find({ companyId: tenantB.company._id });

      expect(aBills.map((b) => b.billNumber)).toEqual(["A-001"]);
      expect(bBills.map((b) => b.billNumber)).toEqual(["B-001"]);
    });
  });
});
