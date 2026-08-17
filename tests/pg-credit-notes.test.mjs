/**
 * Integration tests for the credit notes repository against a real PostgreSQL.
 *
 * Skipped unless DATABASE_URL is set. See tests/pg-accounting-core.test.mjs for
 * how to start a throwaway server.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as creditNoteRepo from "@/app/db/repositories/creditNotes";
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

suite("postgres credit notes", () => {
  let client;
  let admin;
  let db;
  let companyA;
  let customer;
  let accounts;
  let widget;
  let invoice;
  let invoiceLineId;

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
      ar: randomUUID(),
      revenue: randomUUID(),
      vatOutput: randomUUID(),
      inventory: randomUUID(),
      cogs: randomUUID(),
    };

    await client`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Tenant A', ${"a-" + companyA.slice(0, 8)})
    `;

    await asTenant(companyA, async (tx) => {
      const rows = [
        [accounts.ar, "1200", "Accounts Receivable", "asset"],
        [accounts.revenue, "4000", "Sales", "revenue"],
        [accounts.vatOutput, "2300", "VAT Output", "liability"],
        [accounts.inventory, "1300", "Inventory", "asset"],
        [accounts.cogs, "5000", "Cost of Goods Sold", "expense"],
      ];
      for (const [id, code, name, type] of rows) {
        await tx.execute(sql`
          INSERT INTO accounts (id, company_id, account_code, account_name, account_type)
          VALUES (${id}, ${companyA}, ${code}, ${name}, ${type})
        `);
      }

      customer = (
        await partyRepo.createParty(tx, {
          companyId: companyA,
          name: "Acme Ltd",
          primaryType: "customer",
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

      invoice = await invoiceRepo.createInvoice(tx, {
        companyId: companyA,
        customerId: customer,
        invoiceDate: "2026-08-01",
        lines: [{ productId: widget, quantity: "10", unitPrice: "100.0000" }],
      });

      await invoiceRepo.completeInvoice(tx, invoice.id, {
        arAccountId: accounts.ar,
        revenueAccountId: accounts.revenue,
        completedById: randomUUID(),
      });

      const full = await invoiceRepo.getInvoice(tx, invoice.id);
      invoiceLineId = full.lines[0].id;
    });
  });

  /** Credits 2 widgets at 100 with 16% tax. */
  async function makeNote(overrides = {}) {
    return asTenant(companyA, (tx) =>
      creditNoteRepo.createCreditNote(tx, {
        companyId: companyA,
        invoiceId: invoice.id,
        creditNoteDate: "2026-08-10",
        reason: "return",
        reasonDescription: "Two units returned damaged",
        lines: [
          {
            description: "Widget",
            productId: widget,
            quantity: "2",
            unitPrice: "100.0000",
            taxRate: "16",
            originalInvoiceLineId: invoiceLineId,
            originalQuantity: "10",
            originalUnitPrice: "100.0000",
          },
        ],
        ...overrides,
      }),
    );
  }

  describe("amounts are derived from the lines (§9.3)", () => {
    it("computes subtotal, tax, total and remaining from the lines alone", async () => {
      const note = await makeNote();
      expect(note.subtotal).toBe("200.0000");
      expect(note.taxAmount).toBe("32.0000");
      expect(note.total).toBe("232.0000");
      expect(note.amountApplied).toBe("0.0000");
      expect(note.amountRemaining).toBe("232.0000");
    });

    it("re-derives the header when a line is added", async () => {
      const note = await makeNote();
      await asTenant(companyA, (tx) =>
        tx.execute(sql`
          INSERT INTO credit_note_lines
            (company_id, credit_note_id, line_number, item_type, description,
             quantity, unit_price, tax_rate)
          VALUES (${companyA}, ${note.id}, 2, 'service', 'Restocking waiver',
                  1, 50, 16)
        `),
      );
      const after = await asTenant(companyA, (tx) =>
        creditNoteRepo.getCreditNote(tx, note.id),
      );
      expect(after.subtotal).toBe("250.0000");
      expect(after.taxAmount).toBe("40.0000");
      expect(after.total).toBe("290.0000");
    });

    it("refuses a credit note with no lines, at COMMIT", async () => {
      await expectRejection(
        asTenant(companyA, (tx) =>
          tx.execute(sql`
            INSERT INTO credit_notes
              (company_id, credit_note_number, credit_note_date, invoice_id,
               invoice_number_at_issue, customer_id, customer_name_at_issue,
               reason, reason_description)
            VALUES (${companyA}, 'CN-EMPTY', '2026-08-10', ${invoice.id},
                    'INV-1', ${customer}, 'Acme Ltd', 'other', 'Nothing')
          `),
        ),
        /at least one line/i,
      );
    });
  });

  describe("application", () => {
    it("refuses to apply more than the credit is worth, exactly", async () => {
      const note = await makeNote();
      await asTenant(companyA, (tx) =>
        creditNoteRepo.issueCreditNote(tx, note.id, {
          arAccountId: accounts.ar,
          revenueAccountId: accounts.revenue,
          vatOutputAccountId: accounts.vatOutput,
          inventoryAccountId: accounts.inventory,
          cogsAccountId: accounts.cogs,
          issuedById: randomUUID(),
        }),
      );

      await expectRejection(
        asTenant(companyA, (tx) =>
          creditNoteRepo.applyCreditNote(tx, note.id, "232.0100"),
        ),
        /credit_notes_not_over_applied/i,
      );
    });

    it("marks fully applied only at exactly zero remaining", async () => {
      const note = await makeNote();
      await asTenant(companyA, (tx) =>
        creditNoteRepo.issueCreditNote(tx, note.id, {
          arAccountId: accounts.ar,
          revenueAccountId: accounts.revenue,
          vatOutputAccountId: accounts.vatOutput,
          inventoryAccountId: accounts.inventory,
          cogsAccountId: accounts.cogs,
          issuedById: randomUUID(),
        }),
      );

      // A cent short. `amountRemaining <= 0.01` would have called this done.
      const partial = await asTenant(companyA, (tx) =>
        creditNoteRepo.applyCreditNote(tx, note.id, "231.9900"),
      );
      expect(partial.amountRemaining).toBe("0.0100");
      expect(partial.status).toBe("issued");

      const settled = await asTenant(companyA, (tx) =>
        creditNoteRepo.applyCreditNote(tx, note.id, "0.0100"),
      );
      expect(settled.amountRemaining).toBe("0.0000");
      expect(settled.status).toBe("applied");
    });

    it("reduces what the customer owes on the invoice", async () => {
      const note = await makeNote();
      await asTenant(companyA, (tx) =>
        creditNoteRepo.issueCreditNote(tx, note.id, {
          arAccountId: accounts.ar,
          revenueAccountId: accounts.revenue,
          vatOutputAccountId: accounts.vatOutput,
          inventoryAccountId: accounts.inventory,
          cogsAccountId: accounts.cogs,
          issuedById: randomUUID(),
        }),
      );
      await asTenant(companyA, (tx) =>
        creditNoteRepo.applyCreditNote(tx, note.id, "232.0000"),
      );

      const [row] = await asTenant(companyA, (tx) =>
        tx.execute(sql`SELECT amount_paid, payment_status FROM invoices WHERE id = ${invoice.id}`),
      );
      expect(row.amount_paid).toBe("232.0000");
      expect(row.payment_status).toBe("partial");
    });

    it("refuses to apply a credit note that has not been issued", async () => {
      const note = await makeNote();
      await expect(
        asTenant(companyA, (tx) =>
          creditNoteRepo.applyCreditNote(tx, note.id, "10.0000"),
        ),
      ).rejects.toThrow(/only an issued credit note/i);
    });
  });

  describe("issuing", () => {
    it("posts DR revenue, DR VAT output, CR receivable", async () => {
      const note = await makeNote({
        lines: [
          {
            description: "Widget",
            productId: widget,
            quantity: "2",
            unitPrice: "100.0000",
            taxRate: "16",
            originalInvoiceLineId: invoiceLineId,
          },
        ],
      });

      const { entry } = await asTenant(companyA, (tx) =>
        creditNoteRepo.issueCreditNote(tx, note.id, {
          arAccountId: accounts.ar,
          revenueAccountId: accounts.revenue,
          vatOutputAccountId: accounts.vatOutput,
          issuedById: randomUUID(),
        }),
      );

      const lines = await asTenant(companyA, (tx) =>
        tx.execute(sql`
          SELECT account_id, debit, credit FROM journal_lines
           WHERE entry_id = ${entry.id} ORDER BY line_number
        `),
      );
      expect(lines).toHaveLength(3);
      expect(lines[0].account_id).toBe(accounts.revenue);
      expect(lines[0].debit).toBe("200.0000");
      expect(lines[1].account_id).toBe(accounts.vatOutput);
      expect(lines[1].debit).toBe("32.0000");
      expect(lines[2].account_id).toBe(accounts.ar);
      expect(lines[2].credit).toBe("232.0000");
    });

    it("values returned stock at the cost the sale took out, not today's", async () => {
      const note = await makeNote({
        lines: [
          {
            description: "Widget",
            productId: widget,
            quantity: "2",
            unitPrice: "100.0000",
            taxRate: "16",
            restoreInventory: true,
            originalInvoiceLineId: invoiceLineId,
          },
        ],
      });

      // The product is re-costed between the sale and the return.
      await asTenant(companyA, (tx) =>
        tx.execute(sql`UPDATE products SET cost_price = 90 WHERE id = ${widget}`),
      );

      const { inventoryEntryId, costedAtCurrentPrice } = await asTenant(
        companyA,
        (tx) =>
          creditNoteRepo.issueCreditNote(tx, note.id, {
            arAccountId: accounts.ar,
            revenueAccountId: accounts.revenue,
            vatOutputAccountId: accounts.vatOutput,
            inventoryAccountId: accounts.inventory,
            cogsAccountId: accounts.cogs,
            issuedById: randomUUID(),
          }),
      );

      expect(costedAtCurrentPrice).toHaveLength(0);

      const lines = await asTenant(companyA, (tx) =>
        tx.execute(sql`
          SELECT account_id, debit, credit FROM journal_lines
           WHERE entry_id = ${inventoryEntryId} ORDER BY line_number
        `),
      );
      // 2 × 40 (the invoice line's unit_cost), not 2 × 90.
      expect(lines[0].debit).toBe("80.0000");
      expect(lines[1].credit).toBe("80.0000");
    });

    it("records the stock coming back with the levels either side of it", async () => {
      const note = await makeNote({
        lines: [
          {
            description: "Widget",
            productId: widget,
            quantity: "2",
            unitPrice: "100.0000",
            restoreInventory: true,
            originalInvoiceLineId: invoiceLineId,
          },
        ],
      });

      await asTenant(companyA, (tx) =>
        creditNoteRepo.issueCreditNote(tx, note.id, {
          arAccountId: accounts.ar,
          revenueAccountId: accounts.revenue,
          vatOutputAccountId: accounts.vatOutput,
          inventoryAccountId: accounts.inventory,
          cogsAccountId: accounts.cogs,
          issuedById: randomUUID(),
        }),
      );

      const [mv] = await asTenant(companyA, (tx) =>
        tx.execute(sql`
          SELECT movement_type, direction, previous_stock, new_stock
            FROM stock_movements WHERE movement_type = 'return'
        `),
      );
      expect(mv.direction).toBe("in");
      // The sale left 90 on hand; two come back.
      expect(mv.previous_stock).toBe("90.0000");
      expect(mv.new_stock).toBe("92.0000");
    });

    it("refuses to issue the same credit note twice", async () => {
      const note = await makeNote();
      const issue = () =>
        asTenant(companyA, (tx) =>
          creditNoteRepo.issueCreditNote(tx, note.id, {
            arAccountId: accounts.ar,
            revenueAccountId: accounts.revenue,
            vatOutputAccountId: accounts.vatOutput,
            inventoryAccountId: accounts.inventory,
            cogsAccountId: accounts.cogs,
            issuedById: randomUUID(),
          }),
        );
      await issue();
      await expect(issue()).rejects.toThrow(/not in draft status/i);
    });
  });

  describe("snapshots (§9.4)", () => {
    it("keeps the customer name as at issue", async () => {
      const note = await makeNote();
      expect(note.customerNameAtIssue).toBe("Acme Ltd");

      await asTenant(companyA, (tx) =>
        tx.execute(sql`UPDATE parties SET name = 'Acme Holdings PLC' WHERE id = ${customer}`),
      );

      const after = await asTenant(companyA, (tx) =>
        creditNoteRepo.getCreditNote(tx, note.id),
      );
      expect(after.customerNameAtIssue).toBe("Acme Ltd");
    });

    it("refuses to rewrite the invoice/customer snapshot", async () => {
      const note = await makeNote();
      await expectRejection(
        asTenant(companyA, (tx) =>
          tx.execute(sql`UPDATE credit_notes SET customer_name_at_issue = 'Other' WHERE id = ${note.id}`),
        ),
        /immutable/i,
      );
    });

    it("links the credited line to the invoice line, not an array index", async () => {
      const note = await makeNote();
      const full = await asTenant(companyA, (tx) =>
        creditNoteRepo.getCreditNote(tx, note.id),
      );
      expect(full.lines[0].originalInvoiceLineId).toBe(invoiceLineId);
    });
  });

  describe("isolation", () => {
    it("hides another tenant's credit notes", async () => {
      await makeNote();
      const companyB = randomUUID();
      await client`
        INSERT INTO companies (id, name, slug)
        VALUES (${companyB}, 'Tenant B', ${"b-" + companyB.slice(0, 8)})
      `;
      const seen = await asTenant(companyB, (tx) =>
        creditNoteRepo.listCreditNotes(tx),
      );
      expect(seen).toHaveLength(0);
    });
  });
});
