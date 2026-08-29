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
/**
 * The privileged connection: CREATE ROLE, GRANT, TRUNCATE. The app's own
 * DATABASE_URL connects as app_user, which has none of those by design — see
 * migration 0023. Falls back to DATABASE_URL for a single-role local setup.
 */
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
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
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    client = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, { max: 1, onnotice: () => {} });
    db = drizzle(client);
  });

  afterAll(async () => {
    if (client) await client.end();
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, entry_counters CASCADE`;

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

    await admin`
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
      await admin`
        INSERT INTO companies (id, name, slug)
        VALUES (${companyB}, 'Tenant B', ${"b-" + companyB.slice(0, 8)})
      `;
      const seen = await asTenant(companyB, (tx) =>
        taxRepo.listTaxTransactions(tx),
      );
      expect(seen).toHaveLength(0);
    });
  });

  /**
   * The queries the eight /dashboard/tax screens actually run.
   *
   * Everything above this point tests the write side and the repository as it
   * shipped with 0018/0019 — which had no callers at all, because the screens
   * were still reading the Mongo collection. These cover the reads added to
   * point them here, and two of them pin behaviour that is deliberately NOT
   * what Mongo did.
   */
  describe("the screen queries", () => {
    /** The approved bill raises VAT input 2408.00 and WHT 752.50, both 2026-08. */
    it("pages and counts a filtered list", async () => {
      await approvedBill();

      const all = await asTenant(companyA, (tx) =>
        taxRepo.listTaxTransactionsPaged(tx, {}, 1, 20),
      );
      expect(all.total).toBe(2);
      expect(all.rows).toHaveLength(2);

      const wht = await asTenant(companyA, (tx) =>
        taxRepo.listTaxTransactionsPaged(tx, { taxType: "wht" }, 1, 20),
      );
      expect(wht.total).toBe(1);
      expect(wht.rows[0].tax_type).toBe("wht");

      // The count is the count of MATCHES, not of the page — the pager reads it.
      const firstOfOne = await asTenant(companyA, (tx) =>
        taxRepo.listTaxTransactionsPaged(tx, {}, 1, 1),
      );
      expect(firstOfOne.rows).toHaveLength(1);
      expect(firstOfOne.total).toBe(2);

      const secondPage = await asTenant(companyA, (tx) =>
        taxRepo.listTaxTransactionsPaged(tx, {}, 2, 1),
      );
      expect(secondPage.rows).toHaveLength(1);
      expect(secondPage.rows[0].id).not.toBe(firstOfOne.rows[0].id);
    });

    it("filters on filed and remitted as three states, not two", async () => {
      const { taxes } = await approvedBill();
      const whtId = taxes.find((t) => t.taxType === "wht").id;
      await asTenant(companyA, (tx) =>
        taxRepo.markAsFiled(tx, whtId, randomUUID(), "KRA/2026/08"),
      );

      const filed = await asTenant(companyA, (tx) =>
        taxRepo.listTaxTransactionsPaged(tx, { filed: true }, 1, 20),
      );
      expect(filed.total).toBe(1);

      const unfiled = await asTenant(companyA, (tx) =>
        taxRepo.listTaxTransactionsPaged(tx, { filed: false }, 1, 20),
      );
      expect(unfiled.total).toBe(1);

      // Undefined is "either", which is not the same as false.
      const either = await asTenant(companyA, (tx) =>
        taxRepo.listTaxTransactionsPaged(tx, { filed: undefined }, 1, 20),
      );
      expect(either.total).toBe(2);
    });

    it("searches the party snapshot, and treats the term as a literal", async () => {
      await approvedBill();

      const byName = await asTenant(companyA, (tx) =>
        taxRepo.listTaxTransactionsPaged(tx, { search: "vivo" }, 1, 20),
      );
      expect(byName.total).toBe(2);

      const byPin = await asTenant(companyA, (tx) =>
        taxRepo.listTaxTransactionsPaged(tx, { search: "P05123" }, 1, 20),
      );
      expect(byPin.total).toBe(2);

      // Mongo ran $regex with the raw search string, so "%" and ".*" matched
      // everything. Escaped, "%" is a literal percent sign — and exactly one of
      // these two rows contains one, the WHT record whose description reads
      // "WHT 5% withheld on payment to Vivo Energy". Unescaped it would match
      // both, which is the failure this pins.
      const wildcard = await asTenant(companyA, (tx) =>
        taxRepo.listTaxTransactionsPaged(tx, { search: "%" }, 1, 20),
      );
      expect(wildcard.total).toBe(1);
      expect(wildcard.rows[0].tax_type).toBe("wht");

      const underscore = await asTenant(companyA, (tx) =>
        taxRepo.listTaxTransactionsPaged(tx, { search: "Vivo_Energy" }, 1, 20),
      );
      expect(underscore.total).toBe(0);
    });

    it("splits filed and unfiled over the same filters as the list", async () => {
      const { taxes } = await approvedBill();
      await asTenant(companyA, (tx) =>
        taxRepo.markAsFiled(tx, taxes[0].id, randomUUID(), "KRA/2026/08"),
      );

      const stats = await asTenant(companyA, (tx) =>
        taxRepo.getTaxTransactionStats(tx, {}),
      );
      expect(stats.total_transactions).toBe(2);
      expect(stats.filed_count).toBe(1);
      expect(stats.unfiled_count).toBe(1);
      // 2408.00 VAT input + 752.50 WHT.
      expect(Number(stats.total_tax_amount)).toBeCloseTo(3160.5, 4);

      const scoped = await asTenant(companyA, (tx) =>
        taxRepo.getTaxTransactionStats(tx, { taxType: "wht" }),
      );
      expect(scoped.total_transactions).toBe(1);
    });

    it("counts unfiled VAT for real, which the Mongo dashboard hardcoded to zero", async () => {
      await approvedBill(); // VAT input, unfiled
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

      const before = await asTenant(companyA, (tx) =>
        taxRepo.getVatUnfiledCounts(tx, "2026-08"),
      );
      expect(before.input_unfiled).toBe(1);
      expect(before.output_unfiled).toBe(1);

      // Filing one moves it out of the count — the whole point of the card.
      const vatOut = await asTenant(companyA, (tx) =>
        taxRepo.listTaxTransactionsPaged(tx, { taxType: "vat_output" }, 1, 1),
      );
      await asTenant(companyA, (tx) =>
        taxRepo.markAsFiled(tx, vatOut.rows[0].id, randomUUID(), "KRA/2026/08"),
      );

      const after = await asTenant(companyA, (tx) =>
        taxRepo.getVatUnfiledCounts(tx, "2026-08"),
      );
      expect(after.input_unfiled).toBe(1);
      expect(after.output_unfiled).toBe(0);

      // WHT is not VAT and must not leak into either side of the return.
      const other = await asTenant(companyA, (tx) =>
        taxRepo.getVatUnfiledCounts(tx, "2026-09"),
      );
      expect(other.input_unfiled).toBe(0);
      expect(other.output_unfiled).toBe(0);
    });

    it("reports the whole unremitted WHT balance, not the date range's share", async () => {
      await approvedBill();

      // A range that contains the transaction: totals and outstanding agree.
      const inRange = await asTenant(companyA, (tx) =>
        taxRepo.getWhtSummary(tx, "2026-08-01", "2026-08-31"),
      );
      expect(Number(inRange.total_wht)).toBeCloseTo(752.5, 4);
      expect(Number(inRange.remitted)).toBe(0);
      expect(inRange.transaction_count).toBe(1);
      expect(Number(inRange.unremitted)).toBeCloseTo(752.5, 4);

      // A range that excludes it: the period total is zero, but money still
      // owed to KRA does not stop being owed because the reader narrowed the
      // dates. Mongo's unremitted aggregation carried no date filter either.
      const outOfRange = await asTenant(companyA, (tx) =>
        taxRepo.getWhtSummary(tx, "2026-09-01", "2026-09-30"),
      );
      expect(Number(outOfRange.total_wht)).toBe(0);
      expect(outOfRange.transaction_count).toBe(0);
      expect(Number(outOfRange.unremitted)).toBeCloseTo(752.5, 4);
      expect(outOfRange.unremitted_count).toBe(1);
    });

    it("summarises the fields the KRA tiles read", async () => {
      await approvedBill();

      const s = await asTenant(companyA, (tx) =>
        taxRepo.getTaxSummary(tx, "2026-08-01", "2026-08-31"),
      );

      // The four the card reads, none of which TaxService.getTaxSummary ever
      // returned — which is why all four tiles rendered zero.
      expect(s.unfiled_vat).toBe(1);
      expect(s.unfiled_wht).toBe(1);
      expect(s.filed_vat).toBe(0);
      expect(s.filed_wht).toBe(0);
      expect(Number(s.unremitted_wht)).toBeCloseTo(752.5, 4);
      expect(Number(s.total_tax)).toBeCloseTo(3160.5, 4);

      // And the three it did, kept alongside them.
      expect(Number(s.vat_input)).toBeCloseTo(2408, 4);
      expect(Number(s.vat_output)).toBe(0);
      expect(Number(s.wht_total)).toBeCloseTo(752.5, 4);
    });

    it("totals WHT by rate, carrying the code that was stored", async () => {
      await approvedBill(); // 5% on a 15,050 base → 752.50

      const rows = await asTenant(companyA, (tx) =>
        taxRepo.getWhtReportByRate(tx, "2026-01-01", "2026-12-31"),
      );
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].tax_rate)).toBe(5);
      // The stored code, not one rebuilt from the rate. The bill was created
      // with whtRate "5" and the numeric(5,2) column hands it back as "5.00",
      // so recordBillTaxes wrote "WHT-5.00" — while reconstructing the label
      // from the rate here would print "WHT-5". That gap is the whole reason
      // this column is selected rather than derived.
      expect(rows[0].tax_code).toBe("WHT-5.00");
      expect(Number(rows[0].total_withheld)).toBeCloseTo(752.5, 4);
      expect(Number(rows[0].total_base)).toBeCloseTo(15050, 4);
      expect(rows[0].transaction_count).toBe("1");
    });

    it("lists filing periods most recent first, without duplicates", async () => {
      await approvedBill(); // two rows, both 2026-08

      const { id: billId } = await asTenant(companyA, (tx) =>
        billRepo.createBill(tx, {
          companyId: companyA,
          supplierId: supplier,
          billDate: "2026-06-01",
          dueDate: "2026-06-30",
          lines: [
            {
              description: "Diesel",
              accountId: accounts.fuel,
              quantity: "1",
              unitPrice: "100",
              vatRate: "16",
            },
          ],
        }),
      );
      await asTenant(companyA, (tx) =>
        taxRepo.recordTaxTransaction(tx, {
          companyId: companyA,
          transactionNumber: "VAT-IN-JUNE",
          transactionDate: "2026-06-15",
          taxType: "vat_input",
          taxCode: "VAT-16",
          taxRate: "16",
          baseAmount: "100",
          taxAmount: "16",
          totalAmount: "116",
          partyId: supplier,
          partyType: "supplier",
          sourceDocumentType: "bill",
          sourceDocumentId: billId,
          accountId: accounts.vatInput,
        }),
      );

      const periods = await asTenant(companyA, (tx) =>
        taxRepo.getFilingPeriods(tx, 24),
      );
      // Two rows share 2026-08 and collapse to one entry.
      expect(periods).toEqual(["2026-08", "2026-06"]);

      const capped = await asTenant(companyA, (tx) =>
        taxRepo.getFilingPeriods(tx, 1),
      );
      expect(capped).toEqual(["2026-08"]);
    });

    it("hides another tenant's rows from every one of them", async () => {
      await approvedBill();
      const companyB = randomUUID();
      await admin`
        INSERT INTO companies (id, name, slug)
        VALUES (${companyB}, 'Tenant B', ${"b-" + companyB.slice(0, 8)})
      `;

      await asTenant(companyB, async (tx) => {
        expect((await taxRepo.listTaxTransactionsPaged(tx, {}, 1, 20)).total).toBe(0);
        expect((await taxRepo.getTaxTransactionStats(tx, {})).total_transactions).toBe(0);
        expect(await taxRepo.getFilingPeriods(tx, 24)).toEqual([]);

        const unfiled = await taxRepo.getVatUnfiledCounts(tx, "2026-08");
        expect(unfiled.input_unfiled).toBe(0);

        const summary = await taxRepo.getTaxSummary(tx, "2026-01-01", "2026-12-31");
        expect(Number(summary.total_tax)).toBe(0);
        expect(Number(summary.unremitted_wht)).toBe(0);
      });
    });
  });
});
