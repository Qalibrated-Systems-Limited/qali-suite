/**
 * Integration tests for the tax transactions repository against a real
 * PostgreSQL.
 *
 * Skipped unless DATABASE_URL is set. See tests/pg-accounting-core.test.mjs for
 * how to start a throwaway server.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as taxRepo from "@/app/db/repositories/taxTransactions";
import * as billRepo from "@/app/db/repositories/bills";
import * as invoiceRepo from "@/app/db/repositories/invoices";
import * as productRepo from "@/app/db/repositories/products";
import * as partyRepo from "@/app/db/repositories/parties";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

async function expectRejection(promise, pattern) {
  let caught;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught, "expected the operation to be rejected").toBeDefined();
  expect(`${caught.message} ${caught.cause ?? ""}`).toMatch(pattern);
}

suite("postgres tax transactions", () => {
  let client;
  let admin;
  let db;
  let companyA;
  let supplier;
  let customer;
  let accounts;
  let widget;

  async function asTenant(companyId, fn) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  }

  beforeAll(async () => {
    admin = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
    client = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, { max: 1, onnotice: () => {} });
    db = drizzle(client);
  });

  afterAll(async () => {
    if (client) await client.end();
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies CASCADE`;
    await admin`TRUNCATE entry_counters`;

    companyA = randomUUID();
    accounts = {
      ap: randomUUID(),
      ar: randomUUID(),
      revenue: randomUUID(),
      fuel: randomUUID(),
      vatInput: randomUUID(),
      vatOutput: randomUUID(),
      whtPayable: randomUUID(),
    };

    await client`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Tenant A', ${"a-" + companyA.slice(0, 8)})
    `;

    await asTenant(companyA, async (tx) => {
      const rows = [
        [accounts.ap, "2100", "Accounts Payable", "liability"],
        [accounts.ar, "1200", "Accounts Receivable", "asset"],
        [accounts.revenue, "4000", "Sales", "revenue"],
        [accounts.fuel, "5200", "Fuel", "expense"],
        [accounts.vatInput, "1400", "VAT Input", "asset"],
        [accounts.vatOutput, "2300", "VAT Output", "liability"],
        [accounts.whtPayable, "2200", "WHT Payable", "liability"],
      ];
      for (const [id, code, name, type] of rows) {
        await tx.execute(sql`
          INSERT INTO accounts (id, company_id, account_code, account_name, account_type)
          VALUES (${id}, ${companyA}, ${code}, ${name}, ${type})
        `);
      }

      supplier = (
        await partyRepo.createParty(tx, {
          companyId: companyA,
          name: "Vivo Energy",
          primaryType: "supplier",
          taxPin: "P051234567X",
        })
      ).id;
      customer = (
        await partyRepo.createParty(tx, {
          companyId: companyA,
          name: "Acme Ltd",
          primaryType: "customer",
          taxPin: "P059876543Y",
        })
      ).id;
      widget = (
        await productRepo.createProduct(tx, {
          companyId: companyA,
          sku: "WID-1",
          name: "Widget",
          costPrice: "40.0000",
          quantityOnHand: "100",
        })
      ).id;
    });
  });

  /** An approved bill: 15050 net, 16% VAT, 5% WHT. */
  async function approvedBill(overrides = {}) {
    return asTenant(companyA, async (tx) => {
      const bill = await billRepo.createBill(tx, {
        companyId: companyA,
        supplierId: supplier,
        billDate: "2026-08-01",
        dueDate: "2026-08-31",
        whtApplicable: true,
        whtRate: "5",
        lines: [
          {
            description: "Diesel",
            accountId: accounts.fuel,
            quantity: "100",
            unitPrice: "150.50",
            vatRate: "16",
          },
        ],
        ...overrides,
      });
      await billRepo.submitBill(tx, bill.id, randomUUID());
      return billRepo.approveBill(tx, bill.id, {
        apAccountId: accounts.ap,
        vatInputAccountId: accounts.vatInput,
        whtPayableAccountId: accounts.whtPayable,
        approvedById: randomUUID(),
      });
    });
  }

  describe("raised from a bill", () => {
    it("raises VAT Input and WHT when the bill approves", async () => {
      const { taxes } = await approvedBill();
      expect(taxes).toHaveLength(2);

      const vat = taxes.find((t) => t.taxType === "vat_input");
      expect(vat.baseAmount).toBe("15050.0000");
      expect(vat.taxAmount).toBe("2408.0000");
      expect(vat.taxRate).toBe("16.00");
      expect(vat.taxCode).toBe("VAT-16.00");

      const wht = taxes.find((t) => t.taxType === "wht");
      expect(wht.baseAmount).toBe("15050.0000");
      expect(wht.taxAmount).toBe("752.5000");
      // As in Mongo: the bill's net payable, not base - tax. See §9.8.
      expect(wht.totalAmount).toBe("16705.5000");
    });

    it("derives the filing period from the transaction date", async () => {
      const { taxes } = await approvedBill();
      expect(taxes.every((t) => t.filingPeriod === "2026-08")).toBe(true);
    });

    it("links both records to the bill's journal entry", async () => {
      const { taxes, entry } = await approvedBill();
      expect(taxes.every((t) => t.journalEntryId === entry.id)).toBe(true);
    });

    it("raises nothing for a bill with neither VAT nor WHT", async () => {
      const { taxes } = await approvedBill({
        whtApplicable: false,
        whtRate: "0",
        lines: [
          {
            description: "Consulting",
            accountId: accounts.fuel,
            quantity: "1",
            unitPrice: "5000.00",
          },
        ],
      });
      expect(taxes).toHaveLength(0);
    });

    it("computes the effective VAT rate exactly, not to a whole number", async () => {
      // 333.33 at 16% = 53.3328. Mongo rounds (53.3328/333.33)*100 to 16 with
      // Math.round after a float division; the rate here keeps two places.
      const { taxes } = await approvedBill({
        whtApplicable: false,
        whtRate: "0",
        lines: [
          {
            description: "Odd amount",
            accountId: accounts.fuel,
            quantity: "1",
            unitPrice: "333.33",
            vatRate: "16",
          },
        ],
      });
      const vat = taxes.find((t) => t.taxType === "vat_input");
      expect(vat.baseAmount).toBe("333.3300");
      expect(vat.taxAmount).toBe("53.3328");
      expect(vat.taxRate).toBe("16.00");
    });

    it("refuses to raise the same bill's tax twice", async () => {
      const { bill } = await approvedBill();
      await expectRejection(
        asTenant(companyA, (tx) =>
          taxRepo.recordBillTaxes(tx, {
            companyId: companyA,
            billId: bill.id,
            vatInputAccountId: accounts.vatInput,
            whtPayableAccountId: accounts.whtPayable,
          }),
        ),
        /duplicate key|tax_transactions_company_number_uq/i,
      );
    });
  });

  describe("raised from an invoice", () => {
    async function completedInvoice(taxAmount = "160.0000") {
      return asTenant(companyA, async (tx) => {
        const invoice = await invoiceRepo.createInvoice(tx, {
          companyId: companyA,
          customerId: customer,
          invoiceDate: "2026-08-05",
          lines: [
            {
              productId: widget,
              quantity: "10",
              unitPrice: "100.0000",
              taxAmount,
            },
          ],
        });
        return invoiceRepo.completeInvoice(tx, invoice.id, {
          arAccountId: accounts.ar,
          revenueAccountId: accounts.revenue,
          vatOutputAccountId: accounts.vatOutput,
          completedById: randomUUID(),
        });
      });
    }

    it("raises VAT Output when the invoice completes", async () => {
      const { vatOutput } = await completedInvoice();
      expect(vatOutput.taxType).toBe("vat_output");
      expect(vatOutput.taxAmount).toBe("160.0000");
      expect(vatOutput.partyNameAtTransaction).toBe("Acme Ltd");
      expect(vatOutput.filingPeriod).toBe("2026-08");
    });

    it("raises nothing when the invoice carries no tax", async () => {
      const { vatOutput } = await completedInvoice("0");
      expect(vatOutput).toBeNull();
    });
  });

  describe("filing, remittance and certificates", () => {
    async function whtRecord() {
      const { taxes } = await approvedBill();
      return taxes.find((t) => t.taxType === "wht");
    }

    it("files a return and refuses to un-file it", async () => {
      const wht = await whtRecord();
      const filed = await asTenant(companyA, (tx) =>
        taxRepo.markAsFiled(tx, wht.id, randomUUID(), "KRA-REF-1"),
      );
      expect(filed.filed).toBe(true);

      await expectRejection(
        asTenant(companyA, (tx) =>
          tx.execute(sql`UPDATE tax_transactions SET filed = false WHERE id = ${wht.id}`),
        ),
        /already filed/i,
      );
    });

    it("refuses to remit VAT — only withholding and payroll go to KRA", async () => {
      const { taxes } = await approvedBill();
      const vat = taxes.find((t) => t.taxType === "vat_input");
      await expectRejection(
        asTenant(companyA, (tx) =>
          taxRepo.markAsRemitted(tx, vat.id, randomUUID(), "REF"),
        ),
        /only withholding and payroll/i,
      );
    });

    it("refuses a certificate before the tax is remitted", async () => {
      const wht = await whtRecord();
      await expectRejection(
        asTenant(companyA, (tx) =>
          taxRepo.issueCertificate(tx, wht.id, "CERT-1"),
        ),
        /must be remitted before/i,
      );
    });

    it("issues a certificate after remittance, once", async () => {
      const wht = await whtRecord();
      await asTenant(companyA, (tx) =>
        taxRepo.markAsRemitted(tx, wht.id, randomUUID(), "REF-1"),
      );
      const issued = await asTenant(companyA, (tx) =>
        taxRepo.issueCertificate(tx, wht.id, "CERT-1"),
      );
      expect(issued.certificateIssued).toBe(true);
      expect(issued.certificateNumber).toBe("CERT-1");

      await expectRejection(
        asTenant(companyA, (tx) =>
          taxRepo.issueCertificate(tx, wht.id, "CERT-2"),
        ),
        /already been issued/i,
      );
    });

    it("lists what still needs filing and remitting", async () => {
      await approvedBill();
      const unfiled = await asTenant(companyA, (tx) => taxRepo.getUnfiled(tx));
      expect(unfiled).toHaveLength(2);

      const unremitted = await asTenant(companyA, (tx) =>
        taxRepo.getUnremittedWht(tx),
      );
      expect(unremitted).toHaveLength(1);
      expect(unremitted[0].taxType).toBe("wht");
    });
  });

  describe("returns and reports", () => {
    it("nets the VAT return output against input, signed", async () => {
      await approvedBill(); // VAT input 2408
      await asTenant(companyA, async (tx) => {
        const invoice = await invoiceRepo.createInvoice(tx, {
          companyId: companyA,
          customerId: customer,
          invoiceDate: "2026-08-05",
          lines: [
            { productId: widget, quantity: "10", unitPrice: "100.0000", taxAmount: "1600.0000" },
          ],
        });
        await invoiceRepo.completeInvoice(tx, invoice.id, {
          arAccountId: accounts.ar,
          revenueAccountId: accounts.revenue,
          vatOutputAccountId: accounts.vatOutput,
          completedById: randomUUID(),
        });
      });

      const ret = await asTenant(companyA, (tx) =>
        taxRepo.getVatReturn(tx, "2026-08"),
      );
      expect(ret.input_tax).toBe("2408.0000");
      expect(ret.output_tax).toBe("1600.0000");
      // Output less input: negative means refundable, reported as one signed
      // number rather than Mongo's payable/refundable pair.
      expect(ret.vat_payable).toBe("-808.0000");
    });

    it("totals WHT by party for certificate issuing", async () => {
      await approvedBill();
      const rows = await asTenant(companyA, (tx) =>
        taxRepo.getWhtReportByParty(tx, "2026-01-01", "2026-12-31"),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].party_name).toBe("Vivo Energy");
      expect(rows[0].party_tax_pin).toBe("P051234567X");
      expect(rows[0].total_withheld).toBe("752.5000");
      expect(rows[0].certificate_count).toBe("0");
    });
  });

  describe("integrity", () => {
    it("keeps the party name as at the transaction, through a rename", async () => {
      const { taxes } = await approvedBill();
      await asTenant(companyA, (tx) =>
        tx.execute(sql`UPDATE parties SET name = 'Vivo Energy Kenya PLC' WHERE id = ${supplier}`),
      );
      const after = await asTenant(companyA, (tx) =>
        taxRepo.getTaxTransaction(tx, taxes[0].id),
      );
      expect(after.partyNameAtTransaction).toBe("Vivo Energy");
    });

    it("refuses to rewrite the snapshot on a filed return", async () => {
      const { taxes } = await approvedBill();
      await expectRejection(
        asTenant(companyA, (tx) =>
          tx.execute(sql`
            UPDATE tax_transactions SET party_name_at_transaction = 'Someone Else'
             WHERE id = ${taxes[0].id}
          `),
        ),
        /immutable/i,
      );
    });

    it("refuses a source document that does not exist", async () => {
      await expectRejection(
        asTenant(companyA, (tx) =>
          taxRepo.recordTaxTransaction(tx, {
            companyId: companyA,
            transactionNumber: "VAT-OUT-GHOST",
            transactionDate: "2026-08-01",
            taxType: "vat_output",
            taxCode: "VAT-16",
            taxRate: "16",
            baseAmount: "100",
            taxAmount: "16",
            totalAmount: "116",
            partyId: customer,
            partyType: "customer",
            sourceDocumentType: "invoice",
            sourceDocumentId: randomUUID(),
            accountId: accounts.vatOutput,
          }),
        ),
        /does not exist/i,
      );
    });

    it("refuses a malformed filing period", async () => {
      const { bill } = await approvedBill();
      await expectRejection(
        asTenant(companyA, (tx) =>
          taxRepo.recordTaxTransaction(tx, {
            companyId: companyA,
            transactionNumber: "VAT-IN-ODD",
            transactionDate: "2026-08-01",
            taxType: "vat_input",
            taxCode: "VAT-16",
            taxRate: "16",
            baseAmount: "100",
            taxAmount: "16",
            totalAmount: "116",
            partyId: supplier,
            partyType: "supplier",
            sourceDocumentType: "bill",
            sourceDocumentId: bill.id,
            accountId: accounts.vatInput,
            filingPeriod: "August 2026",
          }),
        ),
        /filing_period_format/i,
      );
    });

    it("hides another tenant's tax transactions", async () => {
      await approvedBill();
      const companyB = randomUUID();
      await client`
        INSERT INTO companies (id, name, slug)
        VALUES (${companyB}, 'Tenant B', ${"b-" + companyB.slice(0, 8)})
      `;
      const seen = await asTenant(companyB, (tx) =>
        taxRepo.listTaxTransactions(tx),
      );
      expect(seen).toHaveLength(0);
    });
  });
});
