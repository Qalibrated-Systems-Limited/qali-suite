/**
 * Integration tests for the payments repository against a real PostgreSQL.
 *
 * Skipped unless DATABASE_URL is set. See tests/pg-accounting-core.test.mjs for
 * how to start a throwaway server.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as paymentRepo from "@/app/db/repositories/payments";
import * as invoiceRepo from "@/app/db/repositories/invoices";
import * as productRepo from "@/app/db/repositories/products";
import * as partyRepo from "@/app/db/repositories/parties";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Drizzle wraps driver errors, so the Postgres message ends up on `.cause`
 * while `.message` is only "Failed query: ...". Assert against both.
 */
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

suite("postgres payments", () => {
  let client; // non-superuser; subject to RLS
  let admin;
  let db;
  let companyA;
  let customer;
  let bankAccount;
  let widget;
  let invoice;

  async function asTenant(companyId, fn) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  }

  beforeAll(async () => {
    admin = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
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
    bankAccount = randomUUID();

    await client`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Tenant A', ${"a-" + companyA.slice(0, 8)})
    `;

    await asTenant(companyA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type)
        VALUES (${bankAccount}, ${companyA}, '1000', 'Bank', 'asset')
      `);
      customer = (
        await partyRepo.createParty(tx, {
          companyId: companyA,
          name: "Acme Ltd",
          primaryType: "customer",
          email: "ac@acme.co",
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
      invoice = await invoiceRepo.createInvoice(tx, {
        companyId: companyA,
        customerId: customer,
        invoiceDate: "2026-08-01",
        lines: [{ productId: widget, quantity: "10", unitPrice: "100.0000" }],
      });
    });
  });

  async function makePayment(amount = "1000.0000") {
    return asTenant(companyA, (tx) =>
      paymentRepo.createPayment(tx, {
        companyId: companyA,
        paymentType: "received",
        paymentDate: "2026-08-02",
        paymentMethod: "bank_transfer",
        amount,
        partyId: customer,
        accountId: bankAccount,
      }),
    );
  }

  describe("over-allocation (§9.2)", () => {
    it("refuses a fraction of a cent over — Mongo allowed up to 0.01", async () => {
      const payment = await makePayment("1000.0000");
      await expect(
        asTenant(companyA, (tx) =>
          paymentRepo.allocateToInvoice(tx, {
            companyId: companyA,
            paymentId: payment.id,
            invoiceId: invoice.id,
            amount: "1000.0050",
          }),
        ),
      ).rejects.toThrow(/over-allocated/i);
    });

    it("accepts the exact amount", async () => {
      const payment = await makePayment("1000.0000");
      await asTenant(companyA, (tx) =>
        paymentRepo.allocateToInvoice(tx, {
          companyId: companyA,
          paymentId: payment.id,
          invoiceId: invoice.id,
          amount: "1000.0000",
        }),
      );

      const balance = await asTenant(companyA, (tx) =>
        paymentRepo.getPaymentBalance(tx, payment.id),
      );
      expect(balance.total_allocated).toBe("1000.0000");
      expect(balance.unapplied_amount).toBe("0.0000");
      expect(balance.is_fully_applied).toBe(true);
    });

    it("catches over-allocation spread across several calls", async () => {
      const payment = await makePayment("1000.0000");
      // Each allocation is individually fine; together they exceed the payment.
      // The constraint is deferred, so it fires once at COMMIT.
      await expectRejection(
        asTenant(companyA, async (tx) => {
          await paymentRepo.allocateToInvoice(tx, {
            companyId: companyA,
            paymentId: payment.id,
            invoiceId: invoice.id,
            amount: "600.0000",
          });
          await tx.execute(sql`
            INSERT INTO payment_allocations
              (company_id, payment_id, document_type, document_id,
               document_number_at_allocation, original_amount, balance_before, amount_allocated)
            VALUES (${companyA}, ${payment.id}, 'invoice', ${invoice.id},
                    'INV-X', '1000', '400', '600.0000')
          `);
        }),
        /over-allocated|duplicate key/i,
      );
    });
  });

  describe("derived balances (§9.3)", () => {
    it("reports unapplied without clamping it to zero", async () => {
      const payment = await makePayment("1000.0000");
      await asTenant(companyA, (tx) =>
        paymentRepo.allocateToInvoice(tx, {
          companyId: companyA,
          paymentId: payment.id,
          invoiceId: invoice.id,
          amount: "250.0000",
        }),
      );

      const balance = await asTenant(companyA, (tx) =>
        paymentRepo.getPaymentBalance(tx, payment.id),
      );
      expect(balance.total_allocated).toBe("250.0000");
      expect(balance.unapplied_amount).toBe("750.0000");
      expect(balance.is_fully_applied).toBe(false);
    });

    it("lists unapplied payments", async () => {
      const payment = await makePayment("500.0000");
      await asTenant(companyA, (tx) =>
        paymentRepo.allocateToInvoice(tx, {
          companyId: companyA,
          paymentId: payment.id,
          invoiceId: invoice.id,
          amount: "200.0000",
        }),
      );
      const rows = await asTenant(companyA, (tx) =>
        paymentRepo.getUnappliedPayments(tx),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].unapplied_amount).toBe("300.0000");
    });
  });

  describe("snapshots (§9.4)", () => {
    it("keeps the party name as at payment time", async () => {
      const payment = await makePayment("100.0000");
      expect(payment.partyNameAtPayment).toBe("Acme Ltd");

      await asTenant(companyA, (tx) =>
        tx.execute(sql`UPDATE parties SET name = 'Acme Holdings PLC' WHERE id = ${customer}`),
      );

      const fetched = await asTenant(companyA, (tx) =>
        paymentRepo.getPayment(tx, payment.id),
      );
      // The receipt still says what it said when it was issued.
      expect(fetched.partyNameAtPayment).toBe("Acme Ltd");
    });

    it("refuses to rewrite the snapshot", async () => {
      const payment = await makePayment("100.0000");
      await expectRejection(
        asTenant(companyA, (tx) =>
          tx.execute(sql`UPDATE payments SET party_name_at_payment = 'Someone Else' WHERE id = ${payment.id}`),
        ),
        /immutable/i,
      );
    });
  });

  describe("integrity", () => {
    it("refuses an allocation to a document that does not exist", async () => {
      const payment = await makePayment("100.0000");
      await expectRejection(
        asTenant(companyA, (tx) =>
          tx.execute(sql`
            INSERT INTO payment_allocations
              (company_id, payment_id, document_type, document_id,
               document_number_at_allocation, original_amount, balance_before, amount_allocated)
            VALUES (${companyA}, ${payment.id}, 'invoice', ${randomUUID()},
                    'GHOST', '1', '1', '1')
          `),
        ),
        /does not exist/i,
      );
    });

    it("updates the invoice's settlement state", async () => {
      const payment = await makePayment("1000.0000");
      await asTenant(companyA, (tx) =>
        paymentRepo.allocateToInvoice(tx, {
          companyId: companyA,
          paymentId: payment.id,
          invoiceId: invoice.id,
          amount: "400.0000",
        }),
      );

      const [row] = await asTenant(companyA, (tx) =>
        tx.execute(sql`SELECT amount_paid, payment_status FROM invoices WHERE id = ${invoice.id}`),
      );
      expect(row.amount_paid).toBe("400.0000");
      expect(row.payment_status).toBe("partial");
    });

    it("hides another tenant's payments", async () => {
      await makePayment("100.0000");
      const companyB = randomUUID();
      await client`
        INSERT INTO companies (id, name, slug)
        VALUES (${companyB}, 'Tenant B', ${"b-" + companyB.slice(0, 8)})
      `;
      const seen = await asTenant(companyB, (tx) => paymentRepo.listPayments(tx));
      expect(seen).toHaveLength(0);
    });
  });
});
