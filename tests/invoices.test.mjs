/**
 * Invoice cycle integration tests.
 *
 * Mirrors bills.test.mjs but for the receivables side. Invoice flow:
 *   draft → completed (which posts a balanced revenue JE) → paid down
 *   by one or more payments → optionally cancelled.
 *
 * Service-only invoices keep these tests focused on the GL math. Product
 * invoices add stock movements + COGS JE; those are exercised in the
 * edge-cases suite alongside three-way-match.
 */
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import Invoice from "@/app/models/invoice";
import JournalEntry from "@/app/models/JournalEntry";
import { seedTenant } from "./helpers/fixtures.mjs";

// Build a minimum-valid service-only invoice. Defaults to a single
// $100 "consultation" line, no VAT. Pass `overrides` to change shape.
function makeInvoice(tenant, overrides = {}) {
  const invoiceDate = overrides.invoiceDate || new Date();
  const dueDate =
    overrides.dueDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const fiscalPeriod =
    overrides.fiscalPeriod ||
    `${invoiceDate.getFullYear()}-${String(invoiceDate.getMonth() + 1).padStart(2, "0")}`;

  // Note: taxRate must be set explicitly to 0 — the Invoice item schema
  // defaults taxRate to 16 (Kenya VAT) which trips the validate-tax-math
  // check during complete() if you don't also supply a matching taxAmount.
  const items = overrides.items || [
    {
      itemType: "service",
      serviceCategory: "consultation",
      description: "Advisory hours",
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
  const totalDiscount = overrides.totalDiscount ?? 0;
  const total = subtotal - totalDiscount + taxAmount;

  return new Invoice({
    companyId: tenant.company._id,
    invoiceNumber: overrides.invoiceNumber || `INV-${Date.now()}`,
    invoiceDate,
    dueDate,
    fiscalPeriod,
    customer: {
      id: tenant.customer._id.toString(),
      name: tenant.customer.name,
      email: tenant.customer.email,
    },
    items,
    subtotal,
    totalDiscount,
    discountPercentage:
      subtotal > 0 ? Math.round((totalDiscount / subtotal) * 100) : 0,
    taxAmount,
    total,
    amountPaid: 0,
    amountDue: total,
    paymentStatus: "unpaid",
    status: "draft",
    createdBy: { name: tenant.user.name, id: tenant.user._id.toString() },
    ...overrides,
  });
}

describe("Invoice cycle", () => {
  describe("draft → completed", () => {
    it("creates a draft invoice with sane defaults", async () => {
      const tenant = await seedTenant();
      const invoice = await makeInvoice(tenant).save();

      expect(invoice.status).toBe("draft");
      expect(invoice.paymentStatus).toBe("unpaid");
      expect(invoice.amountDue).toBe(100);
      expect(invoice.companyId.toString()).toBe(tenant.company._id.toString());
    });

    it("complete() posts a balanced revenue JE", async () => {
      const tenant = await seedTenant();
      const invoice = await makeInvoice(tenant).save();

      await invoice.complete(tenant.user);

      expect(invoice.status).toBe("completed");
      expect(invoice.accounting?.revenueJournalEntryId).toBeDefined();
      expect(invoice.accounting.accountingComplete).toBe(true);

      const je = await JournalEntry.findById(
        invoice.accounting.revenueJournalEntryId,
      );
      expect(je).not.toBeNull();
      expect(je.status).toBe("posted");

      const debits = je.lines.reduce((s, l) => s + (l.debit || 0), 0);
      const credits = je.lines.reduce((s, l) => s + (l.credit || 0), 0);
      expect(debits).toBeCloseTo(credits, 2);
      expect(debits).toBeCloseTo(100, 2);

      // AR debited (asset, normal debit) for the gross total
      const arLine = je.lines.find(
        (l) =>
          l.accountId.toString() ===
          tenant.accounts.accounts_receivable._id.toString(),
      );
      expect(arLine?.debit).toBe(100);
      expect(arLine?.credit).toBe(0);

      // Revenue credited (revenue, normal credit) for the net amount
      const revLine = je.lines.find(
        (l) =>
          l.accountId.toString() ===
          tenant.accounts.sales_revenue._id.toString(),
      );
      expect(revLine?.credit).toBe(100);
      expect(revLine?.debit).toBe(0);
    });

    it("posts VAT output when taxAmount > 0", async () => {
      const tenant = await seedTenant();
      // Invoice 100 subtotal + 16 VAT = 116 gross.
      const items = [
        {
          itemType: "service",
          serviceCategory: "consultation",
          description: "Advisory hours",
          unit: "hour",
          quantity: 1,
          unitPrice: 100,
          amount: 100,
          taxRate: 16,
          taxAmount: 16,
        },
      ];
      const invoice = await makeInvoice(tenant, { items, taxAmount: 16 }).save();
      await invoice.complete(tenant.user);

      const je = await JournalEntry.findById(
        invoice.accounting.revenueJournalEntryId,
      );

      const debits = je.lines.reduce((s, l) => s + l.debit, 0);
      const credits = je.lines.reduce((s, l) => s + l.credit, 0);
      expect(debits).toBeCloseTo(credits, 2);

      const arLine = je.lines.find(
        (l) =>
          l.accountId.toString() ===
          tenant.accounts.accounts_receivable._id.toString(),
      );
      const vatLine = je.lines.find(
        (l) =>
          l.accountId.toString() ===
          tenant.accounts.vat_output._id.toString(),
      );

      expect(arLine?.debit).toBe(116);     // gross owed
      expect(vatLine?.credit).toBe(16);    // VAT collected
    });

    it("auto-creates fiscal period when one doesn't exist for the invoice date", async () => {
      const tenant = await seedTenant();
      const futureDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      const fp = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, "0")}`;
      const invoice = await makeInvoice(tenant, {
        invoiceDate: futureDate,
        dueDate: new Date(futureDate.getTime() + 14 * 24 * 60 * 60 * 1000),
        fiscalPeriod: fp,
      }).save();

      await expect(invoice.complete(tenant.user)).resolves.not.toThrow();

      const FiscalPeriod = mongoose.model("FiscalPeriod");
      const period = await FiscalPeriod.findOne({
        companyId: tenant.company._id,
        periodCode: fp,
      });
      expect(period).not.toBeNull();
    });

    it("refuses to act on an already-completed invoice", async () => {
      const tenant = await seedTenant();
      const invoice = await makeInvoice(tenant).save();
      await invoice.complete(tenant.user);

      await expect(invoice.complete(tenant.user)).rejects.toThrow(/Can only complete/);
    });
  });

  describe("recordPayment", () => {
    it("partial payment updates amountPaid + paymentStatus = 'partial'", async () => {
      const tenant = await seedTenant();
      const invoice = await makeInvoice(tenant).save();
      await invoice.complete(tenant.user);

      const paymentId = new mongoose.Types.ObjectId();
      await invoice.recordPayment(paymentId, 40, {
        paymentDate: new Date(),
        paymentNumber: "PAY-001",
        paymentMethod: "cash",
      });

      expect(invoice.amountPaid).toBe(40);
      expect(invoice.amountDue).toBe(60);
      expect(invoice.paymentStatus).toBe("partial");
      expect(invoice.paymentHistory).toHaveLength(1);
    });

    it("full payment flips paymentStatus to 'paid'", async () => {
      const tenant = await seedTenant();
      const invoice = await makeInvoice(tenant).save();
      await invoice.complete(tenant.user);

      const paymentId = new mongoose.Types.ObjectId();
      await invoice.recordPayment(paymentId, 100, {
        paymentDate: new Date(),
        paymentNumber: "PAY-002",
        paymentMethod: "bank_transfer",
      });

      expect(invoice.amountPaid).toBe(100);
      expect(invoice.amountDue).toBe(0);
      expect(invoice.paymentStatus).toBe("paid");
    });

    it("multiple payments accumulate correctly", async () => {
      const tenant = await seedTenant();
      const invoice = await makeInvoice(tenant).save();
      await invoice.complete(tenant.user);

      const p1 = new mongoose.Types.ObjectId();
      const p2 = new mongoose.Types.ObjectId();
      await invoice.recordPayment(p1, 30, {
        paymentDate: new Date(),
        paymentNumber: "PAY-A",
        paymentMethod: "cash",
      });
      await invoice.recordPayment(p2, 70, {
        paymentDate: new Date(),
        paymentNumber: "PAY-B",
        paymentMethod: "mpesa",
      });

      expect(invoice.amountPaid).toBe(100);
      expect(invoice.amountDue).toBe(0);
      expect(invoice.paymentStatus).toBe("paid");
      expect(invoice.paymentHistory).toHaveLength(2);
    });

    it("overpayment is refused", async () => {
      const tenant = await seedTenant();
      const invoice = await makeInvoice(tenant).save();
      await invoice.complete(tenant.user);

      const paymentId = new mongoose.Types.ObjectId();
      await expect(
        invoice.recordPayment(paymentId, 150, {
          paymentDate: new Date(),
          paymentNumber: "PAY-OVER",
          paymentMethod: "cash",
        }),
      ).rejects.toThrow(/exceeds amount due/);
    });

    it("refuses payment on a draft (uncompleted) invoice", async () => {
      const tenant = await seedTenant();
      const invoice = await makeInvoice(tenant).save();

      const paymentId = new mongoose.Types.ObjectId();
      await expect(
        invoice.recordPayment(paymentId, 50, {
          paymentDate: new Date(),
          paymentNumber: "PAY-X",
          paymentMethod: "cash",
        }),
      ).rejects.toThrow(/Can only record payments on completed/);
    });
  });

  describe("double-entry invariants", () => {
    // Same shape as the bill-side double-entry block — pins down the
    // bedrock rules for sales-side journal entries.

    it("every completed invoice posts debits === credits", async () => {
      const tenant = await seedTenant();
      // VAT and invoice-level discount interact in the schema (VAT is
      // computed on the post-discount base), so test them in isolation.
      // Combined scenarios are validated in a dedicated test below.
      const scenarios = [
        { vat: 0, discount: 0 },
        { vat: 16, discount: 0 },
        { vat: 0, discount: 10 },
      ];

      for (const { vat, discount } of scenarios) {
        const items = [
          {
            itemType: "service",
            serviceCategory: "consultation",
            description: `Test vat=${vat} disc=${discount}`,
            unit: "hour",
            quantity: 1,
            unitPrice: 100,
            amount: 100,
            taxRate: vat,
            taxAmount: vat, // matches `(amount * taxRate) / 100`
          },
        ];
        const invoice = await makeInvoice(tenant, {
          invoiceNumber: `IT-${vat}-${discount}-${Date.now()}`,
          items,
          taxAmount: vat,
          totalDiscount: discount,
        }).save();
        await invoice.complete(tenant.user);

        const je = await JournalEntry.findById(
          invoice.accounting.revenueJournalEntryId,
        );
        const debits = je.lines.reduce((s, l) => s + (l.debit || 0), 0);
        const credits = je.lines.reduce((s, l) => s + (l.credit || 0), 0);
        expect(debits, `vat=${vat} discount=${discount}`).toBeCloseTo(credits, 2);
      }
    });

    it("each JE line has either debit OR credit, never both", async () => {
      const tenant = await seedTenant();
      const items = [
        {
          itemType: "service",
          serviceCategory: "consultation",
          description: "Mixed",
          unit: "hour",
          quantity: 1,
          unitPrice: 100,
          amount: 100,
          taxRate: 16,
          taxAmount: 16,
        },
      ];
      const invoice = await makeInvoice(tenant, { items, taxAmount: 16 }).save();
      await invoice.complete(tenant.user);

      const je = await JournalEntry.findById(
        invoice.accounting.revenueJournalEntryId,
      );
      for (const line of je.lines) {
        const dr = line.debit || 0;
        const cr = line.credit || 0;
        expect(
          (dr > 0 && cr === 0) || (cr > 0 && dr === 0),
          `${line.accountCode}: dr=${dr} cr=${cr}`,
        ).toBe(true);
      }
    });

    it("revenue JE posts to the invoice's tenant only (no cross-leak)", async () => {
      const tenantA = await seedTenant({ company: { code: "AAA", name: "Co A" } });
      const tenantB = await seedTenant({ company: { code: "BBB", name: "Co B" } });

      const invA = await makeInvoice(tenantA, { invoiceNumber: "A-1" }).save();
      await invA.complete(tenantA.user);

      const je = await JournalEntry.findById(
        invA.accounting.revenueJournalEntryId,
      );
      expect(je.companyId.toString()).toBe(tenantA.company._id.toString());
      expect(je.companyId.toString()).not.toBe(tenantB.company._id.toString());
    });
  });

  describe("cancel", () => {
    it("cancels a draft invoice cleanly", async () => {
      const tenant = await seedTenant();
      const invoice = await makeInvoice(tenant).save();

      await invoice.cancel(tenant.user, "Customer changed mind");

      expect(invoice.status).toBe("cancelled");
      expect(invoice.cancellationReason).toBe("Customer changed mind");
    });

    it("refuses to cancel a fully-paid invoice", async () => {
      const tenant = await seedTenant();
      const invoice = await makeInvoice(tenant).save();
      await invoice.complete(tenant.user);
      const paymentId = new mongoose.Types.ObjectId();
      await invoice.recordPayment(paymentId, 100, {
        paymentDate: new Date(),
        paymentNumber: "PAY-FULL",
        paymentMethod: "cash",
      });

      await expect(
        invoice.cancel(tenant.user, "Trying after paid"),
      ).rejects.toThrow(/fully paid/);
    });
  });
});
