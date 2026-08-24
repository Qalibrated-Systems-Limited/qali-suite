/**
 * Integration tests for stock movements and the COGS provenance chain.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as movementRepo from "@/app/db/repositories/stockMovements";
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

/** Drizzle wraps driver errors; the Postgres message lands on `.cause`. */
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

suite("postgres stock movements", () => {
  let sql_admin;
  let client;
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
    sql_admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    // Restricted role provisioned once by tests/setup.global.mjs — a
    // superuser would bypass RLS and make isolation tests vacuous.
    client = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, { max: 1, onnotice: () => {} });
    db = drizzle(client);
  });

  afterAll(async () => {
    if (client) await client.end();
    if (sql_admin) {
      await sql_admin.end();
    }
  });

  beforeEach(async () => {
    await sql_admin`TRUNCATE companies, entry_counters CASCADE`;

    companyA = randomUUID();
    arAccount = randomUUID();
    salesAccount = randomUUID();

    await sql_admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Tenant A', ${"a-" + companyA.slice(0, 8)})
    `;

    await asTenant(companyA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, system_account) VALUES
          (${arAccount},    ${companyA}, '1100', 'Receivables', 'asset',   'accounts_receivable'),
          (${salesAccount}, ${companyA}, '4000', 'Sales',       'revenue', NULL)
      `);
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
          costPrice: "10.0000",
          quantityOnHand: "100",
        })
      ).id;
    });
  });

  describe("recording", () => {
    it("captures stock levels either side of the movement", async () => {
      const movement = await asTenant(companyA, (tx) =>
        movementRepo.recordMovement(tx, {
          companyId: companyA,
          productId: widget,
          movementType: "sale",
          direction: "out",
          quantity: "12",
        }),
      );

      expect(movement.previousStock).toBe("100.0000");
      expect(movement.newStock).toBe("88.0000");
      expect(movement.totalCost).toBe("120.0000"); // 12 × 10.00
    });

    it("snapshots the product name as at the movement", async () => {
      const movement = await asTenant(companyA, (tx) =>
        movementRepo.recordMovement(tx, {
          companyId: companyA,
          productId: widget,
          movementType: "sale",
          direction: "out",
          quantity: "1",
        }),
      );
      expect(movement.productSkuAtMovement).toBe("WID-1");

      await asTenant(companyA, (tx) =>
        tx.execute(sql`UPDATE products SET name = 'Widget Mk II', sku = 'WID-2' WHERE id = ${widget}`),
      );

      const fetched = await asTenant(companyA, (tx) =>
        movementRepo.getMovement(tx, movement.id),
      );
      expect(fetched.productSkuAtMovement).toBe("WID-1");
    });

    it("refuses levels that contradict the quantity", async () => {
      // Mongo records previous/new/quantity and reconciles none of them, so a
      // movement can claim 10 left while the level fell by 8.
      await expectRejection(
        asTenant(companyA, (tx) =>
          tx.execute(sql`
            INSERT INTO stock_movements
              (company_id, movement_number, product_id, movement_type, direction,
               quantity, previous_stock, new_stock)
            VALUES (${companyA}, 'SM-BAD', ${widget}, 'sale', 'out',
                    '10', '100', '92')
          `),
        ),
        /levels_consistent/i,
      );
    });
  });

  describe("immutability", () => {
    it("refuses to change what happened", async () => {
      const movement = await asTenant(companyA, (tx) =>
        movementRepo.recordMovement(tx, {
          companyId: companyA,
          productId: widget,
          movementType: "sale",
          direction: "out",
          quantity: "5",
        }),
      );

      await expectRejection(
        asTenant(companyA, (tx) =>
          tx.execute(sql`UPDATE stock_movements SET quantity = '50' WHERE id = ${movement.id}`),
        ),
        /immutable/i,
      );
    });

    it("allows accounting links to be attached afterwards", async () => {
      const movement = await asTenant(companyA, (tx) =>
        movementRepo.recordMovement(tx, {
          companyId: companyA,
          productId: widget,
          movementType: "sale",
          direction: "out",
          quantity: "5",
        }),
      );

      const entryId = await asTenant(companyA, async (tx) => {
        const [e] = await tx.execute(sql`
          INSERT INTO journal_entries (company_id, entry_number, entry_date, entry_type, description, status)
          VALUES (${companyA}, 'JE-SM', '2026-08-01', 'goods_dispatch', 'cogs', 'draft')
          RETURNING id
        `);
        return e.id;
      });

      const updated = await asTenant(companyA, (tx) =>
        movementRepo.attachAccounting(tx, movement.id, { cogsJournalEntryId: entryId }),
      );
      expect(updated.cogsJournalEntryId).toBe(entryId);
    });

    it("reverses by writing a mirror, leaving the original intact", async () => {
      const original = await asTenant(companyA, (tx) =>
        movementRepo.recordMovement(tx, {
          companyId: companyA,
          productId: widget,
          movementType: "sale",
          direction: "out",
          quantity: "7",
        }),
      );

      const reversal = await asTenant(companyA, (tx) =>
        movementRepo.reverseMovement(tx, original.id, randomUUID()),
      );

      expect(reversal.direction).toBe("in");
      expect(reversal.quantity).toBe("7.0000");
      expect(reversal.originalMovementId).toBe(original.id);

      const after = await asTenant(companyA, (tx) =>
        movementRepo.getMovement(tx, original.id),
      );
      // The original's facts are unchanged; only its status moved.
      expect(after.quantity).toBe("7.0000");
      expect(after.isReversed).toBe(true);
      expect(after.status).toBe("reversed");
    });
  });

  describe("COGS provenance chain", () => {
    it("links invoice line, COGS posting and stock movement", async () => {
      const invoice = await asTenant(companyA, (tx) =>
        invoiceRepo.createInvoice(tx, {
          companyId: companyA,
          customerId: customer,
          invoiceDate: "2026-08-01",
          lines: [{ productId: widget, quantity: "10", unitPrice: "25.0000" }],
        }),
      );

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
      const chain = await asTenant(companyA, (tx) =>
        movementRepo.getCogsProvenance(tx, full.lines[0].id),
      );

      // Every link present: invoiced, costed, moved.
      expect(chain.quantity_invoiced).toBe("10.0000");
      expect(chain.quantity_costed).toBe("10.0000");
      expect(chain.quantity_moved).toBe("10.0000");
      expect(chain.costed_by).toBe("invoice");
      expect(chain.total_cost).toBe("100.0000");
      expect(chain.movement_number).toBeTruthy();
      expect(chain.costed_vs_moved_variance).toBe("0.0000");

      // The movement must describe the transition that actually happened.
      // completeInvoice used to issue the stock first and record afterwards,
      // so a sale of 10 from 100 was written down as "90 -> 80": both levels
      // understated by the quantity that moved, on every sale.
      const [mv] = await asTenant(companyA, (tx) =>
        tx.execute(sql`
          SELECT previous_stock, new_stock FROM stock_movements
           WHERE invoice_line_id = ${full.lines[0].id}
        `),
      );
      expect(mv.previous_stock).toBe("100.0000");
      expect(mv.new_stock).toBe("90.0000");
    });

    it("surfaces a variance when the weighbridge costed a different quantity", async () => {
      const invoice = await asTenant(companyA, (tx) =>
        invoiceRepo.createInvoice(tx, {
          companyId: companyA,
          customerId: customer,
          invoiceDate: "2026-08-01",
          lines: [{ productId: widget, quantity: "10", unitPrice: "25.0000" }],
        }),
      );
      const full = await asTenant(companyA, (tx) =>
        invoiceRepo.getInvoice(tx, invoice.id),
      );
      const lineId = full.lines[0].id;

      // Weighbridge costs the weighed 9.75 before the invoice completes.
      await asTenant(companyA, async (tx) => {
        const [e] = await tx.execute(sql`
          INSERT INTO journal_entries (company_id, entry_number, entry_date, entry_type, description, status)
          VALUES (${companyA}, 'JE-WB', '2026-08-01', 'goods_dispatch', 'gate', 'draft')
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
      });

      await asTenant(companyA, (tx) =>
        invoiceRepo.completeInvoice(tx, invoice.id, {
          arAccountId: arAccount,
          revenueAccountId: salesAccount,
          completedById: randomUUID(),
        }),
      );

      const chain = await asTenant(companyA, (tx) =>
        movementRepo.getCogsProvenance(tx, lineId),
      );

      expect(chain.costed_by).toBe("weighbridge");
      expect(chain.quantity_costed).toBe("9.7500");
      expect(chain.quantity_moved).toBe("10.0000");
      // The discrepancy is a number someone can query, not a warning string.
      expect(chain.costed_vs_moved_variance).toBe("-0.2500");

      const variances = await asTenant(companyA, (tx) =>
        movementRepo.getProvenanceVariances(tx),
      );
      expect(variances).toHaveLength(1);
    });
  });

  describe("tenant isolation", () => {
    it("hides another tenant's movements", async () => {
      await asTenant(companyA, (tx) =>
        movementRepo.recordMovement(tx, {
          companyId: companyA,
          productId: widget,
          movementType: "sale",
          direction: "out",
          quantity: "1",
        }),
      );

      const companyB = randomUUID();
      await sql_admin`
        INSERT INTO companies (id, name, slug)
        VALUES (${companyB}, 'Tenant B', ${"b-" + companyB.slice(0, 8)})
      `;
      const seen = await asTenant(companyB, (tx) => movementRepo.listMovements(tx));
      expect(seen).toHaveLength(0);
    });
  });
});
