/**
 * Credit note integration tests.
 *
 * A credit note reverses (in whole or part) an invoice that has already
 * been completed. Its journal entry mirrors the invoice's: Dr Revenue +
 * Dr VAT Output (reducing both), Cr Accounts Receivable (reducing what
 * the customer owes). When a credit note is issued for a returned
 * product, inventory is restored via a second JE pair.
 *
 * The fragile parts (and why these tests exist):
 *  - The JE must reverse the original invoice's direction exactly —
 *    every line that was a Cr on the invoice is a Dr on the credit note
 *    and vice versa.
 *  - The credit note must remain balanced even with VAT and discounts.
 *  - Tenant scoping must hold — credit notes against one tenant's
 *    invoice can't surface in another tenant.
 */
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import Invoice from "@/app/models/invoice";
import CreditNote from "@/app/models/creditNote";
import JournalEntry from "@/app/models/JournalEntry";
import { seedTenant } from "./helpers/fixtures.mjs";

// Build a service-only invoice. Same shape as in invoices.test.mjs.
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
  const taxAmount = overrides.taxAmount ?? 0;
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
    taxAmount,
    total: subtotal + taxAmount,
    amountPaid: 0,
    amountDue: subtotal + taxAmount,
    paymentStatus: "unpaid",
    status: "draft",
    createdBy: { name: tenant.user.name, id: tenant.user._id.toString() },
    ...overrides,
  });
}

// Build a minimal credit note tied to a completed invoice.
function makeCreditNote(tenant, invoice, overrides = {}) {
  const creditNoteDate = overrides.creditNoteDate || new Date();
  const items = overrides.items || [
    {
      itemType: "service",
      description: "Refund — wrong advice",
      unit: "hour",
      quantity: 1,
      unitPrice: 100,
      amount: 100,
      taxRate: 0,
      taxAmount: 0,
    },
  ];
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const taxAmount = overrides.taxAmount ?? 0;
  return new CreditNote({
    companyId: tenant.company._id,
    creditNoteNumber: overrides.creditNoteNumber || `CN-${Date.now()}`,
    creditNoteDate,
    invoice: {
      id: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      invoiceTotal: invoice.total,
    },
    customer: {
      id: tenant.customer._id.toString(),
      name: tenant.customer.name,
    },
    reason: overrides.reason || "overcharge",
    reasonDescription:
      overrides.reasonDescription || "Customer was billed in error",
    items,
    subtotal,
    taxAmount,
    total: subtotal + taxAmount,
    status: "draft",
    createdBy: { name: tenant.user.name, id: tenant.user._id.toString() },
    accounting: {},
    ...overrides,
  });
}

describe("Credit note cycle", () => {
  describe("draft → issued", () => {
    it("creates a draft credit note with sane defaults", async () => {
      const tenant = await seedTenant();
      const invoice = await makeInvoice(tenant).save();
      await invoice.complete(tenant.user);

      const cn = await makeCreditNote(tenant, invoice).save();

      expect(cn.status).toBe("draft");
      expect(cn.total).toBe(100);
      expect(cn.companyId.toString()).toBe(tenant.company._id.toString());
      expect(cn.invoice.id.toString()).toBe(invoice._id.toString());
    });

    it("issue() posts a balanced JE that REVERSES the invoice direction", async () => {
      const tenant = await seedTenant();
      const invoice = await makeInvoice(tenant).save();
      await invoice.complete(tenant.user);

      const cn = await makeCreditNote(tenant, invoice).save();
      await cn.issue(tenant.user);

      expect(cn.status).toBe("issued");
      expect(cn.accounting?.journalEntryId).toBeDefined();

      const je = await JournalEntry.findById(cn.accounting.journalEntryId);
      expect(je).not.toBeNull();
      expect(je.status).toBe("posted");

      // Balanced
      const debits = je.lines.reduce((s, l) => s + (l.debit || 0), 0);
      const credits = je.lines.reduce((s, l) => s + (l.credit || 0), 0);
      expect(debits).toBeCloseTo(credits, 2);
      expect(debits).toBeCloseTo(100, 2);

      // Revenue is DEBITED on a credit note (opposite of an invoice's Cr Revenue)
      const revLine = je.lines.find(
        (l) =>
          l.accountId.toString() ===
          tenant.accounts.sales_revenue._id.toString(),
      );
      expect(revLine?.debit).toBe(100);
      expect(revLine?.credit).toBe(0);

      // AR is CREDITED (opposite of an invoice's Dr AR)
      const arLine = je.lines.find(
        (l) =>
          l.accountId.toString() ===
          tenant.accounts.accounts_receivable._id.toString(),
      );
      expect(arLine?.credit).toBe(100);
      expect(arLine?.debit).toBe(0);
    });

    it("posts VAT output on the debit side when taxAmount > 0", async () => {
      const tenant = await seedTenant();
      // Invoice 100 + 16 VAT = 116 gross
      const invItems = [
        {
          itemType: "service",
          serviceCategory: "consultation",
          description: "Advisory",
          unit: "hour",
          quantity: 1,
          unitPrice: 100,
          amount: 100,
          taxRate: 16,
          taxAmount: 16,
        },
      ];
      const invoice = await makeInvoice(tenant, {
        items: invItems,
        taxAmount: 16,
      }).save();
      await invoice.complete(tenant.user);

      // Credit-note matches: 100 + 16 VAT = 116
      const cnItems = [
        {
          itemType: "service",
          description: "Refund",
          unit: "hour",
          quantity: 1,
          unitPrice: 100,
          amount: 100,
          taxRate: 16,
          taxAmount: 16,
        },
      ];
      const cn = await makeCreditNote(tenant, invoice, {
        items: cnItems,
        taxAmount: 16,
      }).save();
      await cn.issue(tenant.user);

      const je = await JournalEntry.findById(cn.accounting.journalEntryId);

      const debits = je.lines.reduce((s, l) => s + (l.debit || 0), 0);
      const credits = je.lines.reduce((s, l) => s + (l.credit || 0), 0);
      expect(debits).toBeCloseTo(credits, 2);

      // VAT Output is DEBITED (reducing the VAT liability we earlier credited)
      const vatLine = je.lines.find(
        (l) =>
          l.accountId.toString() ===
          tenant.accounts.vat_output._id.toString(),
      );
      expect(vatLine?.debit).toBe(16);

      // AR credited for the gross
      const arLine = je.lines.find(
        (l) =>
          l.accountId.toString() ===
          tenant.accounts.accounts_receivable._id.toString(),
      );
      expect(arLine?.credit).toBe(116);
    });

    it("refuses to issue an already-issued credit note", async () => {
      const tenant = await seedTenant();
      const invoice = await makeInvoice(tenant).save();
      await invoice.complete(tenant.user);

      const cn = await makeCreditNote(tenant, invoice).save();
      await cn.issue(tenant.user);

      await expect(cn.issue(tenant.user)).rejects.toThrow(/Can only issue/);
    });
  });

  describe("invariants: invoice + credit-note net to zero", () => {
    it("Dr/Cr across both JEs leaves every account net-zero (full reversal)", async () => {
      // Issue invoice, complete it (posts revenue JE), then credit-note
      // the exact same amount. After both, every account in the GL
      // should net to zero — the books are unchanged.
      const tenant = await seedTenant();
      const invoice = await makeInvoice(tenant).save();
      await invoice.complete(tenant.user);

      const cn = await makeCreditNote(tenant, invoice).save();
      await cn.issue(tenant.user);

      const allJEs = await JournalEntry.find({
        companyId: tenant.company._id,
      });
      // 2 JEs: revenue from invoice + reversal from credit note
      expect(allJEs.length).toBe(2);

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

    it("every JE line has either debit OR credit, never both", async () => {
      const tenant = await seedTenant();
      const invoice = await makeInvoice(tenant).save();
      await invoice.complete(tenant.user);
      const cn = await makeCreditNote(tenant, invoice).save();
      await cn.issue(tenant.user);

      const je = await JournalEntry.findById(cn.accounting.journalEntryId);
      for (const line of je.lines) {
        const dr = line.debit || 0;
        const cr = line.credit || 0;
        expect(
          (dr > 0 && cr === 0) || (cr > 0 && dr === 0),
          `${line.accountCode}: dr=${dr} cr=${cr}`,
        ).toBe(true);
      }
    });

    it("CN line normal sides are inverted vs an invoice line", async () => {
      // Revenue: invoice credits it (normal side); CN debits it (reverses).
      // VAT Output: invoice credits it; CN debits it.
      // AR: invoice debits it; CN credits it.
      const tenant = await seedTenant();
      const invItems = [
        {
          itemType: "service",
          serviceCategory: "consultation",
          description: "X",
          unit: "hour",
          quantity: 1,
          unitPrice: 100,
          amount: 100,
          taxRate: 16,
          taxAmount: 16,
        },
      ];
      const invoice = await makeInvoice(tenant, {
        items: invItems,
        taxAmount: 16,
      }).save();
      await invoice.complete(tenant.user);

      const cnItems = [
        {
          itemType: "service",
          description: "Refund X",
          unit: "hour",
          quantity: 1,
          unitPrice: 100,
          amount: 100,
          taxRate: 16,
          taxAmount: 16,
        },
      ];
      const cn = await makeCreditNote(tenant, invoice, {
        items: cnItems,
        taxAmount: 16,
      }).save();
      await cn.issue(tenant.user);

      const invJE = await JournalEntry.findById(
        invoice.accounting.revenueJournalEntryId,
      );
      const cnJE = await JournalEntry.findById(cn.accounting.journalEntryId);

      // Helper: get (debit, credit) for a given account in a JE
      const sideOf = (je, accountId) => {
        const line = je.lines.find(
          (l) => l.accountId.toString() === accountId.toString(),
        );
        return { debit: line?.debit || 0, credit: line?.credit || 0 };
      };

      const arInv = sideOf(invJE, tenant.accounts.accounts_receivable._id);
      const arCN = sideOf(cnJE, tenant.accounts.accounts_receivable._id);
      expect(arInv.debit).toBe(arCN.credit); // invoice debits AR; CN credits same amount
      expect(arInv.credit).toBe(arCN.debit); // and vice versa (both 0 here)

      const revInv = sideOf(invJE, tenant.accounts.sales_revenue._id);
      const revCN = sideOf(cnJE, tenant.accounts.sales_revenue._id);
      expect(revInv.credit).toBe(revCN.debit);
      expect(revInv.debit).toBe(revCN.credit);

      const vatInv = sideOf(invJE, tenant.accounts.vat_output._id);
      const vatCN = sideOf(cnJE, tenant.accounts.vat_output._id);
      expect(vatInv.credit).toBe(vatCN.debit);
      expect(vatInv.debit).toBe(vatCN.credit);
    });
  });

  describe("tenant isolation", () => {
    it("credit-note JE posts to the same tenant as the credit note", async () => {
      const tenantA = await seedTenant({ company: { code: "AAA", name: "Co A" } });
      const tenantB = await seedTenant({ company: { code: "BBB", name: "Co B" } });

      const invA = await makeInvoice(tenantA).save();
      await invA.complete(tenantA.user);
      const cnA = await makeCreditNote(tenantA, invA).save();
      await cnA.issue(tenantA.user);

      const je = await JournalEntry.findById(cnA.accounting.journalEntryId);
      expect(je.companyId.toString()).toBe(tenantA.company._id.toString());
      expect(je.companyId.toString()).not.toBe(tenantB.company._id.toString());
    });
  });
});
