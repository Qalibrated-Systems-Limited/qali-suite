/**
 * Integration tests for the invoices repository against a real PostgreSQL.
 *
 * Skipped unless DATABASE_URL is set. See tests/pg-accounting-core.test.mjs for
 * how to start a throwaway server.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
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

suite("postgres invoices", () => {
  let client; // non-superuser; subject to RLS
  let admin;  // superuser; setup only
  let db;
  let companyA;
  let customer;
  let widget;
  let arAccount;
  let salesAccount;

  async function asTenant(companyId, fn) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  }

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });

    // A SUPERUSER bypasses RLS even under FORCE ROW LEVEL SECURITY, so an
    // isolation test over the default role would pass regardless of policy.
    // Restricted role provisioned once by tests/setup.global.mjs — a
    // superuser would bypass RLS and make isolation tests vacuous.
    client = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, { max: 1, onnotice: () => {} });
    db = drizzle(client);
  });

  afterAll(async () => {
    if (client) await client.end();
    if (admin) {
      await admin.end();
    }
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies CASCADE`;
    await admin`TRUNCATE entry_counters`;

    companyA = randomUUID();
    arAccount = randomUUID();
    salesAccount = randomUUID();

    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Tenant A', ${"a-" + companyA.slice(0, 8)})
    `;

    await asTenant(companyA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, system_account) VALUES
          (${arAccount},    ${companyA}, '1100', 'Receivables', 'asset',   'accounts_receivable'),
          (${salesAccount}, ${companyA}, '4000', 'Sales',       'revenue', NULL)
      `);
      const party = await partyRepo.createParty(tx, {
        companyId: companyA,
        name: "Acme Ltd",
        primaryType: "customer",
      });
      customer = party.id;

      const product = await productRepo.createProduct(tx, {
        companyId: companyA,
        sku: "WID-1",
        name: "Widget",
        costPrice: "10.0000",
        sellingPrice: "25.0000",
        quantityOnHand: "100",
      });
      widget = product.id;
    });
  });

  describe("draft creation", () => {
    it("commits stock without reducing it", async () => {
      await asTenant(companyA, (tx) =>
        invoiceRepo.createInvoice(tx, {
          companyId: companyA,
          customerId: customer,
          invoiceDate: "2026-08-01",
          lines: [{ productId: widget, quantity: "10", unitPrice: "25.0000" }],
        }),
      );

      const product = await asTenant(companyA, (tx) =>
        productRepo.getProduct(tx, widget),
      );
      expect(product.quantityOnHand).toBe("100.0000");
      expect(product.quantityCommitted).toBe("10.0000");
      // Generated column: 100 - 10 - 0
      expect(product.quantityAvailable).toBe("90.0000");
    });

    it("freezes unit cost from the product at sale time", async () => {
      const invoice = await asTenant(companyA, (tx) =>
        invoiceRepo.createInvoice(tx, {
          companyId: companyA,
          customerId: customer,
          invoiceDate: "2026-08-01",
          lines: [{ productId: widget, quantity: "4", unitPrice: "25.0000" }],
        }),
      );

      // Re-cost the product AFTER the invoice was raised.
      await asTenant(companyA, (tx) =>
        tx.execute(sql`UPDATE products SET cost_price = '99.0000' WHERE id = ${widget}`),
      );

      const fetched = await asTenant(companyA, (tx) =>
        invoiceRepo.getInvoice(tx, invoice.id),
      );
      // The line keeps the cost as at sale, not the new one.
      expect(fetched.lines[0].unitCost).toBe("10.0000");
    });

    it("computes line totals exactly", async () => {
      const invoice = await asTenant(companyA, (tx) =>
        invoiceRepo.createInvoice(tx, {
          companyId: companyA,
          customerId: customer,
          invoiceDate: "2026-08-01",
          lines: [
            { productId: widget, quantity: "3", unitPrice: "19.9900" },
            { productId: widget, quantity: "1", unitPrice: "0.0500" },
          ],
        }),
      );
      // 3 × 19.99 = 59.97, + 0.05 = 60.02 — no float residue.
      expect(invoice.subtotal).toBe("60.0200");
    });

    it("rejects a line claiming a source without its reference", async () => {
      // Drizzle wraps the Postgres error, so the constraint name lives on the
      // cause rather than the message.
      let caught;
      try {
        await asTenant(companyA, (tx) =>
          invoiceRepo.createInvoice(tx, {
            companyId: companyA,
            customerId: customer,
            invoiceDate: "2026-08-01",
            lines: [
              {
                productId: widget,
                quantity: "1",
                unitPrice: "25.0000",
                fulfilmentSource: "stock_request", // no stockRequestId
              },
            ],
          }),
        );
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(String(caught.cause ?? caught)).toMatch(
        /fulfilment_source_consistent/i,
      );
    });
  });

  describe("completion", () => {
    async function draft(lines) {
      return asTenant(companyA, (tx) =>
        invoiceRepo.createInvoice(tx, {
          companyId: companyA,
          customerId: customer,
          invoiceDate: "2026-08-01",
          lines,
        }),
      );
    }

    it("posts a balanced revenue entry and issues the stock", async () => {
      const invoice = await draft([
        { productId: widget, quantity: "10", unitPrice: "25.0000" },
      ]);

      const result = await asTenant(companyA, (tx) =>
        invoiceRepo.completeInvoice(tx, invoice.id, {
          arAccountId: arAccount,
          revenueAccountId: salesAccount,
          completedById: randomUUID(),
        }),
      );

      expect(result.invoice.status).toBe("completed");

      // The revenue entry must balance, or the deferred trigger would have
      // refused the transaction.
      const [totals] = await asTenant(companyA, (tx) =>
        tx.execute(sql`
          SELECT SUM(debit)::text AS dr, SUM(credit)::text AS cr
            FROM journal_lines WHERE entry_id = ${result.revenueEntry.id}
        `),
      );
      expect(totals.dr).toBe("250.0000");
      expect(totals.cr).toBe("250.0000");

      const product = await asTenant(companyA, (tx) =>
        productRepo.getProduct(tx, widget),
      );
      expect(product.quantityOnHand).toBe("90.0000");
      expect(product.quantityCommitted).toBe("0.0000");
    });

    it("records COGS once, at the invoiced quantity", async () => {
      const invoice = await draft([
        { productId: widget, quantity: "10", unitPrice: "25.0000" },
      ]);
      await asTenant(companyA, (tx) =>
        invoiceRepo.completeInvoice(tx, invoice.id, {
          arAccountId: arAccount,
          revenueAccountId: salesAccount,
          completedById: randomUUID(),
        }),
      );

      const full = await asTenant(companyA, (tx) =>
        invoiceRepo.getInvoice(tx, invoice.id),
      );
      const posting = await asTenant(companyA, (tx) =>
        invoiceRepo.getCogsPosting(tx, full.lines[0].id),
      );

      expect(posting.postedBy).toBe("invoice");
      expect(posting.quantity).toBe("10.0000");
      expect(posting.totalCost).toBe("100.0000"); // 10 × 10.00
    });

    it("does not re-post COGS the weighbridge already costed", async () => {
      const invoice = await draft([
        { productId: widget, quantity: "10", unitPrice: "25.0000" },
      ]);
      const full = await asTenant(companyA, (tx) =>
        invoiceRepo.getInvoice(tx, invoice.id),
      );
      const lineId = full.lines[0].id;

      // Weighbridge gets there first, costing the WEIGHED quantity (9.75),
      // which differs from the 10 that will be billed.
      const wbEntry = await asTenant(companyA, async (tx) => {
        const [e] = await tx.execute(sql`
          INSERT INTO journal_entries (company_id, entry_number, entry_date, entry_type, description, status)
          VALUES (${companyA}, 'JE-WB-1', '2026-08-01', 'goods_dispatch', 'gate crossing', 'draft')
          RETURNING id
        `);
        await invoiceRepo.recordCogsPosting(tx, {
          invoiceLineId: lineId,
          companyId: companyA,
          postedBy: "weighbridge",
          journalEntryId: e.id,
          quantity: "9.7500",
          unitCost: "10.0000",
        });
        return e.id;
      });
      expect(wbEntry).toBeTruthy();

      const result = await asTenant(companyA, (tx) =>
        invoiceRepo.completeInvoice(tx, invoice.id, {
          arAccountId: arAccount,
          revenueAccountId: salesAccount,
          completedById: randomUUID(),
        }),
      );

      // The invoice completed, and reported the line as already costed.
      expect(result.invoice.status).toBe("completed");
      expect(result.cogsSkipped).toEqual([lineId]);

      // The weighbridge's figure stands — 9.75, not the billed 10.
      const posting = await asTenant(companyA, (tx) =>
        invoiceRepo.getCogsPosting(tx, lineId),
      );
      expect(posting.postedBy).toBe("weighbridge");
      expect(posting.quantity).toBe("9.7500");

      // Exactly one COGS posting exists for the line.
      const [{ count }] = await asTenant(companyA, (tx) =>
        tx.execute(sql`SELECT count(*)::int AS count FROM cogs_postings WHERE invoice_line_id = ${lineId}`),
      );
      expect(count).toBe(1);
    });

    it("refuses to complete an invoice twice", async () => {
      const invoice = await draft([
        { productId: widget, quantity: "5", unitPrice: "25.0000" },
      ]);
      const opts = {
        arAccountId: arAccount,
        revenueAccountId: salesAccount,
        completedById: randomUUID(),
      };
      await asTenant(companyA, (tx) => invoiceRepo.completeInvoice(tx, invoice.id, opts));

      await expect(
        asTenant(companyA, (tx) => invoiceRepo.completeInvoice(tx, invoice.id, opts)),
      ).rejects.toThrow(/not in draft status/i);
    });
  });

  describe("tenant isolation", () => {
    it("hides another tenant's invoices", async () => {
      await asTenant(companyA, (tx) =>
        invoiceRepo.createInvoice(tx, {
          companyId: companyA,
          customerId: customer,
          invoiceDate: "2026-08-01",
          lines: [{ productId: widget, quantity: "1", unitPrice: "25.0000" }],
        }),
      );

      const companyB = randomUUID();
      await admin`
        INSERT INTO companies (id, name, slug)
        VALUES (${companyB}, 'Tenant B', ${"b-" + companyB.slice(0, 8)})
      `;

      const seen = await asTenant(companyB, (tx) => invoiceRepo.listInvoices(tx));
      expect(seen).toHaveLength(0);
    });
  });

  describe("service lines (§0025)", () => {
    it("invoices a service, which has no product and no stock", async () => {
      const invoice = await asTenant(companyA, (tx) =>
        invoiceRepo.createInvoice(tx, {
          companyId: companyA,
          customerId: customer,
          invoiceDate: "2026-08-01",
          lines: [
            {
              itemType: "service",
              serviceCategory: "installation",
              description: "Installation of pump",
              quantity: "3",
              unitPrice: "2500.0000",
              unit: "hours",
            },
          ],
        }),
      );
      expect(invoice.subtotal).toBe("7500.0000");

      const full = await asTenant(companyA, (tx) =>
        invoiceRepo.getInvoice(tx, invoice.id),
      );
      // A left join, so the service line is present rather than dropped.
      expect(full.lines).toHaveLength(1);
      expect(full.lines[0].itemType).toBe("service");
      expect(full.lines[0].serviceCategory).toBe("installation");
      expect(full.lines[0].productId).toBeNull();
      expect(full.lines[0].unit).toBe("hours");
    });

    it("mixes product and service lines on one invoice", async () => {
      const invoice = await asTenant(companyA, (tx) =>
        invoiceRepo.createInvoice(tx, {
          companyId: companyA,
          customerId: customer,
          invoiceDate: "2026-08-01",
          lines: [
            { productId: widget, quantity: "2", unitPrice: "100.0000" },
            {
              itemType: "service",
              serviceCategory: "labor",
              description: "Fitting",
              quantity: "1",
              unitPrice: "500.0000",
            },
          ],
        }),
      );
      expect(invoice.subtotal).toBe("700.0000");

      // Only the product line reserved stock.
      const product = await asTenant(companyA, (tx) =>
        productRepo.getProduct(tx, widget),
      );
      expect(product.quantityCommitted).toBe("2.0000");
    });

    it("completes a service invoice without moving stock or costing it", async () => {
      const invoice = await asTenant(companyA, (tx) =>
        invoiceRepo.createInvoice(tx, {
          companyId: companyA,
          customerId: customer,
          invoiceDate: "2026-08-01",
          lines: [
            {
              itemType: "service",
              serviceCategory: "consultation",
              description: "Advisory",
              quantity: "1",
              unitPrice: "1000.0000",
            },
          ],
        }),
      );

      await asTenant(companyA, (tx) =>
        invoiceRepo.completeInvoice(tx, invoice.id, {
          arAccountId: arAccount,
          revenueAccountId: salesAccount,
          completedById: randomUUID(),
        }),
      );

      const movements = await asTenant(companyA, (tx) =>
        tx.execute(sql`SELECT count(*)::int AS n FROM stock_movements`),
      );
      expect(movements[0].n).toBe(0);
      const cogs = await asTenant(companyA, (tx) =>
        tx.execute(sql`SELECT count(*)::int AS n FROM cogs_postings`),
      );
      expect(cogs[0].n).toBe(0);
    });

    it("refuses a product line with no product, and a service line with one", async () => {
      await expect(
        asTenant(companyA, (tx) =>
          invoiceRepo.createInvoice(tx, {
            companyId: companyA,
            customerId: customer,
            invoiceDate: "2026-08-01",
            lines: [{ itemType: "product", quantity: "1", unitPrice: "1" }],
          }),
        ),
      ).rejects.toThrow(/product line must name a product/i);

      await expect(
        asTenant(companyA, (tx) =>
          invoiceRepo.createInvoice(tx, {
            companyId: companyA,
            customerId: customer,
            invoiceDate: "2026-08-01",
            lines: [
              { itemType: "service", productId: widget, quantity: "1", unitPrice: "1" },
            ],
          }),
        ),
      ).rejects.toThrow(/service line cannot name a product/i);
    });
  });
});
