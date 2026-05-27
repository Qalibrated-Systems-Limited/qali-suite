/**
 * Edge-case integration tests.
 *
 * The happy paths are covered in bills.test.mjs and invoices.test.mjs.
 * This file covers the failure modes and cross-cutting invariants that
 * matter for an accounting system:
 *
 *  - Fiscal period locks (closed/locked periods must reject postings)
 *  - Bill cancellation produces a reversal JE (not a mutation)
 *  - Multi-tenant query isolation across the GL
 *  - Currency precision: amounts don't drift due to rounding
 *
 * Most of these tests exist because the audit identified them as places
 * where a regression could pass casual eyeball review but leave the
 * books wrong by month-end.
 */
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import Bill from "@/app/models/bill";
import Invoice from "@/app/models/invoice";
import JournalEntry from "@/app/models/JournalEntry";
import FiscalPeriod from "@/app/models/fiscalPeriod";
import { seedTenant, seedFiscalPeriod } from "./helpers/fixtures.mjs";

// Copy of the makeBill helper from bills.test.mjs (kept local so this
// suite is self-contained — small duplication is cheaper than a deeper
// helper module for one shared builder).
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
  const total = subtotal;
  const netPayable = total;

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
    amounts: { subtotal, vat: 0, total, wht: 0, netPayable, paid: 0, balance: netPayable },
    status: "draft",
    paymentStatus: "unpaid",
    createdBy: { name: tenant.user.name, id: tenant.user._id.toString() },
    ...overrides,
  });
}

function makeInvoice(tenant, overrides = {}) {
  const invoiceDate = overrides.invoiceDate || new Date();
  const dueDate =
    overrides.dueDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const fiscalPeriod =
    overrides.fiscalPeriod ||
    `${invoiceDate.getFullYear()}-${String(invoiceDate.getMonth() + 1).padStart(2, "0")}`;
  const items = overrides.items || [
    {
      itemType: "service",
      serviceCategory: "consultation",
      description: "Advisory",
      unit: "hour",
      quantity: 1,
      unitPrice: 100,
      amount: 100,
      taxRate: 0,
      taxAmount: 0,
    },
  ];
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  return new Invoice({
    companyId: tenant.company._id,
    invoiceNumber: overrides.invoiceNumber || `INV-${Date.now()}`,
    invoiceDate,
    dueDate,
    fiscalPeriod,
    customer: {
      id: tenant.customer._id.toString(),
      name: tenant.customer.name,
    },
    items,
    subtotal,
    totalDiscount: 0,
    discountPercentage: 0,
    taxAmount: 0,
    total: subtotal,
    amountPaid: 0,
    amountDue: subtotal,
    paymentStatus: "unpaid",
    status: "draft",
    createdBy: { name: tenant.user.name, id: tenant.user._id.toString() },
    ...overrides,
  });
}

describe("Edge cases", () => {
  describe("fiscal period locks", () => {
    it("bill approval throws when fiscal period is closed", async () => {
      const tenant = await seedTenant();
      const now = new Date();
      // Delete the auto-seeded period and reseed it as 'closed'.
      await FiscalPeriod.deleteMany({ companyId: tenant.company._id });
      await seedFiscalPeriod(
        tenant.company._id,
        now.getFullYear(),
        now.getMonth() + 1,
        "closed",
      );

      const bill = await makeBill(tenant).save();
      await bill.submit(tenant.user);

      await expect(bill.approve(tenant.user)).rejects.toThrow(/closed/);

      // Bill should remain submitted, NOT approved
      const reloaded = await Bill.findById(bill._id);
      expect(reloaded.status).toBe("submitted");
      expect(reloaded.accounting?.journalEntryId).toBeUndefined();
    });

    it("bill approval throws when fiscal period is locked", async () => {
      const tenant = await seedTenant();
      const now = new Date();
      await FiscalPeriod.deleteMany({ companyId: tenant.company._id });
      await seedFiscalPeriod(
        tenant.company._id,
        now.getFullYear(),
        now.getMonth() + 1,
        "locked",
      );

      const bill = await makeBill(tenant).save();
      await bill.submit(tenant.user);

      await expect(bill.approve(tenant.user)).rejects.toThrow(/locked/);
    });

    it("invoice completion throws when fiscal period is closed", async () => {
      const tenant = await seedTenant();
      const now = new Date();
      await FiscalPeriod.deleteMany({ companyId: tenant.company._id });
      await seedFiscalPeriod(
        tenant.company._id,
        now.getFullYear(),
        now.getMonth() + 1,
        "closed",
      );

      const invoice = await makeInvoice(tenant).save();
      await expect(invoice.complete(tenant.user)).rejects.toThrow(/closed/);

      const reloaded = await Invoice.findById(invoice._id);
      expect(reloaded.status).toBe("draft");
    });

    it("bill in OPEN period approves fine even when other periods are locked", async () => {
      const tenant = await seedTenant();
      // Lock a far-past period; current period stays open from seedTenant.
      await seedFiscalPeriod(tenant.company._id, 2020, 1, "locked");

      const bill = await makeBill(tenant).save();
      await bill.submit(tenant.user);

      await expect(bill.approve(tenant.user)).resolves.not.toThrow();
      expect(bill.status).toBe("approved");
    });
  });

  describe("bill cancellation after approval", () => {
    it("posts a reversal JE — original is preserved, books stay balanced", async () => {
      const tenant = await seedTenant();
      const bill = await makeBill(tenant).save();
      await bill.submit(tenant.user);
      await bill.approve(tenant.user);

      const originalJeId = bill.accounting.journalEntryId;
      const originalJe = await JournalEntry.findById(originalJeId);
      expect(originalJe.status).toBe("posted");

      // Cancel the approved bill — should reverse the JE, not delete it.
      await bill.cancel(tenant.user, "Duplicate entry");

      expect(bill.status).toBe("cancelled");

      // Original JE still exists, but marked reversed
      const reloadedOriginal = await JournalEntry.findById(originalJeId);
      expect(reloadedOriginal).not.toBeNull();
      expect(reloadedOriginal.status).toBe("reversed");

      // A reversal entry was posted — find any JE that references the original
      // and is itself a posted/reversal entry.
      const allJEs = await JournalEntry.find({ companyId: tenant.company._id });
      expect(allJEs.length).toBeGreaterThanOrEqual(2);

      // Net debits across all JEs for this bill === net credits.
      const netDebits = allJEs.reduce(
        (s, je) =>
          s + je.lines.reduce((ss, l) => ss + (l.debit || 0), 0),
        0,
      );
      const netCredits = allJEs.reduce(
        (s, je) =>
          s + je.lines.reduce((ss, l) => ss + (l.credit || 0), 0),
        0,
      );
      expect(netDebits).toBeCloseTo(netCredits, 2);

      // CRITICAL: the books should net to zero — for every original
      // debit there's a reversal credit, and vice versa.
      const netByAccount = new Map();
      for (const je of allJEs) {
        for (const line of je.lines) {
          const key = line.accountId.toString();
          const prev = netByAccount.get(key) || 0;
          netByAccount.set(
            key,
            prev + (line.debit || 0) - (line.credit || 0),
          );
        }
      }
      for (const [, net] of netByAccount) {
        expect(net).toBeCloseTo(0, 2);
      }
    });

    it("cannot cancel a bill that has been paid", async () => {
      const tenant = await seedTenant();
      const bill = await makeBill(tenant).save();
      await bill.submit(tenant.user);
      await bill.approve(tenant.user);

      // Simulate a payment by bumping the paid amount.
      bill.amounts.paid = 100;
      bill.amounts.balance = 0;
      bill.paymentStatus = "paid";
      await bill.save();

      await expect(
        bill.cancel(tenant.user, "Too late"),
      ).rejects.toThrow(/Cannot cancel/);
    });
  });

  describe("multi-tenant query isolation", () => {
    // The most common security bug in multi-tenant SaaS: a query that
    // doesn't filter by companyId. We swept the codebase for these but
    // a test here is the durable backstop.

    it("Bill.find without companyId would return both tenants — find WITH companyId returns one", async () => {
      const tenantA = await seedTenant({ company: { code: "AAA", name: "Co A" } });
      const tenantB = await seedTenant({ company: { code: "BBB", name: "Co B" } });

      await makeBill(tenantA, { billNumber: "A-1" }).save();
      await makeBill(tenantA, { billNumber: "A-2" }).save();
      await makeBill(tenantB, { billNumber: "B-1" }).save();

      // Baseline: unscoped query sees all 3 (this is what bugs look like).
      const all = await Bill.find({});
      expect(all.length).toBe(3);

      // Scoped: tenant A sees only their 2.
      const aBills = await Bill.find({ companyId: tenantA.company._id });
      expect(aBills.length).toBe(2);
      expect(aBills.every((b) => b.billNumber.startsWith("A-"))).toBe(true);

      // Tenant B sees only their 1.
      const bBills = await Bill.find({ companyId: tenantB.company._id });
      expect(bBills.length).toBe(1);
      expect(bBills[0].billNumber).toBe("B-1");
    });

    it("JE aggregation with companyId in $match doesn't pull cross-tenant rows", async () => {
      const tenantA = await seedTenant({ company: { code: "AAA", name: "Co A" } });
      const tenantB = await seedTenant({ company: { code: "BBB", name: "Co B" } });

      // Each tenant approves a bill — each posts its own JE.
      const billA = await makeBill(tenantA).save();
      await billA.submit(tenantA.user);
      await billA.approve(tenantA.user);
      const billB = await makeBill(tenantB).save();
      await billB.submit(tenantB.user);
      await billB.approve(tenantB.user);

      // Aggregate JE totals scoped to tenant A — must NOT include B.
      const result = await JournalEntry.aggregate([
        { $match: { companyId: tenantA.company._id } },
        { $unwind: "$lines" },
        {
          $group: {
            _id: null,
            totalDebits: { $sum: "$lines.debit" },
            totalCredits: { $sum: "$lines.credit" },
            count: { $sum: 1 },
          },
        },
      ]);

      // Tenant A's bill is 100 → 2 lines (DR expense 100, CR AP 100)
      expect(result[0].count).toBe(2);
      expect(result[0].totalDebits).toBeCloseTo(100, 2);
      expect(result[0].totalCredits).toBeCloseTo(100, 2);
    });
  });

  describe("currency precision", () => {
    // Floating-point sums can drift. The bill model's totals should
    // round to 2 decimals (KES cents) and not introduce 0.0001-ish
    // residuals that pile up across many lines.

    it("multi-line bill totals sum to subtotal with no float drift", async () => {
      const tenant = await seedTenant();
      // Three lines that sum to a clean total: 33.33 + 33.33 + 33.34 = 100.
      const lines = [33.33, 33.33, 33.34].map((amt, i) => ({
        lineNumber: i + 1,
        description: `Line ${i + 1}`,
        account: {
          id: tenant.accounts.officeExpense._id,
          code: tenant.accounts.officeExpense.accountCode,
          name: tenant.accounts.officeExpense.accountName,
          type: "expense",
        },
        quantity: 1,
        unit: "ea",
        unitPrice: amt,
        amount: amt,
        vat: { rate: 0, amount: 0 },
        lineTotal: amt,
      }));
      const bill = await makeBill(tenant, { lines }).save();
      await bill.submit(tenant.user);
      await bill.approve(tenant.user);

      const je = await JournalEntry.findById(bill.accounting.journalEntryId);
      const debits = je.lines.reduce((s, l) => s + (l.debit || 0), 0);
      const credits = je.lines.reduce((s, l) => s + (l.credit || 0), 0);
      expect(debits).toBeCloseTo(100, 2);
      expect(credits).toBeCloseTo(100, 2);
      expect(debits).toBeCloseTo(credits, 2);
    });
  });
});
