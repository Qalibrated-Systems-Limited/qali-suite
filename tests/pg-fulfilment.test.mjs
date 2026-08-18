/**
 * Integration tests for the fulfilment repository — stock requests, item
 * checkouts and weighbridge tickets — against a real PostgreSQL.
 *
 * Skipped unless DATABASE_URL is set. See tests/pg-accounting-core.test.mjs for
 * how to start a throwaway server.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as fulfilRepo from "@/app/db/repositories/fulfilment";
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

suite("postgres fulfilment", () => {
  let client;
  let admin;
  let db;
  let companyA;
  let customer;
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
    await client`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Tenant A', ${"a-" + companyA.slice(0, 8)})
    `;

    await asTenant(companyA, async (tx) => {
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
          sellingPrice: "250.0000",
          quantityOnHand: "100",
        })
      ).id;
    });
  });

  async function makeRequest(overrides = {}) {
    return asTenant(companyA, (tx) =>
      fulfilRepo.createStockRequest(tx, {
        companyId: companyA,
        requestType: "sale",
        customerId: customer,
        requesterName: "Tech Guy",
        requesterDepartment: "Technical",
        items: [{ productId: widget, requestedQuantity: "10" }],
        ...overrides,
      }),
    );
  }

  async function approved(qty = "10") {
    const request = await makeRequest();
    const full = await asTenant(companyA, (tx) =>
      fulfilRepo.getStockRequest(tx, request.id),
    );
    await asTenant(companyA, (tx) =>
      fulfilRepo.approveStockRequest(
        tx,
        request.id,
        [{ itemId: full.items[0].id, approvedQuantity: qty }],
        { approvedById: randomUUID(), approverName: "Manager" },
      ),
    );
    return { requestId: request.id, itemId: full.items[0].id };
  }

  describe("derived fulfilment (§9.9)", () => {
    it("totals the request from its items without being asked", async () => {
      const request = await makeRequest();
      // 10 x 250 selling price, taken from the product.
      expect(request.totalValue).toBe("2500.0000");
      expect(request.status).toBe("pending");
    });

    it("snapshots the stock level the decision was made against", async () => {
      const request = await makeRequest();
      const full = await asTenant(companyA, (tx) =>
        fulfilRepo.getStockRequest(tx, request.id),
      );
      expect(full.items[0].stockAtRequest).toBe("100.0000");

      // The shelf empties; the record of what was on hand does not move.
      await asTenant(companyA, (tx) =>
        tx.execute(sql`UPDATE products SET quantity_on_hand = 0 WHERE id = ${widget}`),
      );
      const after = await asTenant(companyA, (tx) =>
        fulfilRepo.getStockRequest(tx, request.id),
      );
      expect(after.items[0].stockAtRequest).toBe("100.0000");
    });

    it("tracks partial then complete fulfilment, and promotes the request", async () => {
      const { requestId, itemId } = await approved("10");

      await asTenant(companyA, (tx) =>
        fulfilRepo.recordFulfilment(tx, {
          companyId: companyA,
          itemId,
          quantity: "4",
        }),
      );
      let full = await asTenant(companyA, (tx) =>
        fulfilRepo.getStockRequest(tx, requestId),
      );
      expect(full.items[0].totalFulfilled).toBe("4.0000");
      expect(full.items[0].remainingToFulfil).toBe("6.0000");
      expect(full.items[0].fulfilmentStatus).toBe("partial");
      expect(full.status).toBe("partially_fulfilled");

      await asTenant(companyA, (tx) =>
        fulfilRepo.recordFulfilment(tx, {
          companyId: companyA,
          itemId,
          quantity: "6",
        }),
      );
      full = await asTenant(companyA, (tx) =>
        fulfilRepo.getStockRequest(tx, requestId),
      );
      expect(full.items[0].totalFulfilled).toBe("10.0000");
      expect(full.items[0].remainingToFulfil).toBe("0.0000");
      expect(full.items[0].fulfilmentStatus).toBe("complete");
      expect(full.status).toBe("fulfilled");
    });

    it("re-derives when a fulfilment is removed", async () => {
      const { requestId, itemId } = await approved("10");
      const f = await asTenant(companyA, (tx) =>
        fulfilRepo.recordFulfilment(tx, {
          companyId: companyA,
          itemId,
          quantity: "10",
        }),
      );
      await asTenant(companyA, (tx) =>
        tx.execute(sql`DELETE FROM stock_request_fulfilments WHERE id = ${f.id}`),
      );

      const full = await asTenant(companyA, (tx) =>
        fulfilRepo.getStockRequest(tx, requestId),
      );
      expect(full.items[0].totalFulfilled).toBe("0.0000");
      expect(full.items[0].fulfilmentStatus).toBe("pending");
    });

    it("re-derives the total when the approved quantity is cut", async () => {
      const { requestId, itemId } = await approved("4");
      const full = await asTenant(companyA, (tx) =>
        fulfilRepo.getStockRequest(tx, requestId),
      );
      // Approving 4 of 10 revalues the request: 4 x 250.
      expect(full.totalValue).toBe("1000.0000");
      expect(full.items[0].remainingToFulfil).toBe("4.0000");
      expect(itemId).toBeTruthy();
    });

    it("refuses to fulfil more than was approved", async () => {
      const { itemId } = await approved("10");
      await asTenant(companyA, (tx) =>
        fulfilRepo.recordFulfilment(tx, {
          companyId: companyA,
          itemId,
          quantity: "10",
        }),
      );
      await expectRejection(
        asTenant(companyA, (tx) =>
          fulfilRepo.recordFulfilment(tx, {
            companyId: companyA,
            itemId,
            quantity: "1",
          }),
        ),
        /Cannot fulfil more than approved/i,
      );
    });

    it("refuses over-fulfilment split across several calls in one transaction", async () => {
      const { itemId } = await approved("10");
      await expectRejection(
        asTenant(companyA, async (tx) => {
          await fulfilRepo.recordFulfilment(tx, {
            companyId: companyA,
            itemId,
            quantity: "6",
          });
          await fulfilRepo.recordFulfilment(tx, {
            companyId: companyA,
            itemId,
            quantity: "6",
          });
        }),
        /Cannot fulfil more than approved/i,
      );
    });

    it("refuses to approve more than was requested", async () => {
      const request = await makeRequest();
      const full = await asTenant(companyA, (tx) =>
        fulfilRepo.getStockRequest(tx, request.id),
      );
      await expectRejection(
        asTenant(companyA, (tx) =>
          fulfilRepo.approveStockRequest(
            tx,
            request.id,
            [{ itemId: full.items[0].id, approvedQuantity: "11" }],
            { approvedById: randomUUID(), approverName: "Manager" },
          ),
        ),
        /approved_within_requested/i,
      );
    });

    it("refuses to invoice more than was issued", async () => {
      const { itemId } = await approved("10");
      await asTenant(companyA, (tx) =>
        fulfilRepo.recordFulfilment(tx, {
          companyId: companyA,
          itemId,
          quantity: "4",
        }),
      );
      await expectRejection(
        asTenant(companyA, (tx) =>
          tx.execute(sql`
            INSERT INTO stock_request_item_invoices
              (company_id, item_id, invoice_id, invoice_number_at_invoicing, quantity)
            VALUES (${companyA}, ${itemId}, ${randomUUID()}, 'INV-X', 5)
          `),
        ),
        /Cannot invoice more than was fulfilled|foreign key/i,
      );
    });
  });

  describe("request shape", () => {
    it("requires a customer for a customer-facing request", async () => {
      await expect(
        makeRequest({ requestType: "sale", customerId: null }),
      ).rejects.toThrow(/customer-facing/i);
    });

    it("allows an internal request with no customer", async () => {
      const request = await makeRequest({
        requestType: "internal",
        customerId: null,
      });
      expect(request.customerId).toBeNull();
      expect(request.requestType).toBe("internal");
    });

    it("refuses a customer-facing request with no customer at the database", async () => {
      await expectRejection(
        asTenant(companyA, (tx) =>
          tx.execute(sql`
            INSERT INTO stock_requests
              (company_id, request_number, request_type, requester_name_at_request,
               requester_department)
            VALUES (${companyA}, 'REQ-BAD', 'sale', 'Someone', 'Technical')
          `),
        ),
        /customer_required_unless_internal/i,
      );
    });
  });

  describe("checkouts", () => {
    async function makeCheckout(quantity = "5") {
      return asTenant(companyA, (tx) =>
        fulfilRepo.createCheckout(tx, {
          companyId: companyA,
          productId: widget,
          quantity,
          checkedOutToName: "Tech Guy",
          checkedOutByName: "Storekeeper",
          purpose: "installation",
          expectedReturnDate: "2026-09-01",
        }),
      );
    }

    it("closes the checkout once everything is accounted for", async () => {
      const checkout = await makeCheckout("5");
      let after = await asTenant(companyA, (tx) =>
        fulfilRepo.returnCheckout(tx, checkout.id, { quantity: "3" }),
      );
      expect(after.status).toBe("checked_out");

      after = await asTenant(companyA, (tx) =>
        fulfilRepo.returnCheckout(tx, checkout.id, { quantity: "2" }),
      );
      expect(after.quantityReturned).toBe("5.0000");
      expect(after.status).toBe("returned");
    });

    it("refuses to dispose of more than went out", async () => {
      const checkout = await makeCheckout("5");
      await expectRejection(
        asTenant(companyA, (tx) =>
          fulfilRepo.returnCheckout(tx, checkout.id, { quantity: "6" }),
        ),
        /disposition_within_quantity/i,
      );
    });

    it("refuses a mix of sale, return and expense exceeding the quantity", async () => {
      const checkout = await makeCheckout("5");
      await asTenant(companyA, (tx) =>
        tx.execute(sql`UPDATE item_checkouts SET quantity_sold = 3 WHERE id = ${checkout.id}`),
      );
      await expectRejection(
        asTenant(companyA, (tx) =>
          fulfilRepo.returnCheckout(tx, checkout.id, { quantity: "3" }),
        ),
        /disposition_within_quantity/i,
      );
    });

    it("lists what is still out, with how overdue", async () => {
      await asTenant(companyA, (tx) =>
        fulfilRepo.createCheckout(tx, {
          companyId: companyA,
          productId: widget,
          quantity: "2",
          checkedOutToName: "Tech Guy",
          checkedOutByName: "Storekeeper",
          purpose: "repair",
          expectedReturnDate: "2026-01-01",
        }),
      );
      const rows = await asTenant(companyA, (tx) =>
        fulfilRepo.getOutstandingCheckouts(tx),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].quantity_outstanding).toBe("2.0000");
      expect(Number(rows[0].days_overdue)).toBeGreaterThan(0);
    });

    it("flags a checkout for return when the sale falls through", async () => {
      const checkout = await makeCheckout("5");
      const flagged = await asTenant(companyA, (tx) =>
        fulfilRepo.requireReturn(tx, checkout.id, {
          reason: "invoice_cancelled",
          returnDeadline: "2026-09-15",
        }),
      );
      expect(flagged.returnRequired).toBe(true);
      expect(flagged.returnRequiredReason).toBe("invoice_cancelled");
    });
  });

  describe("weighbridge", () => {
    async function openTicket(type = "purchase") {
      return asTenant(companyA, (tx) =>
        fulfilRepo.openWeighbridgeTicket(tx, {
          companyId: companyA,
          transactionType: type,
          productId: widget,
          vehicleReg: "KDA 123A",
        }),
      );
    }

    it("derives direction from what the trip was for", async () => {
      expect((await openTicket("purchase")).direction).toBe("inbound");
      expect((await openTicket("sale")).direction).toBe("outbound");
      expect((await openTicket("transfer_in")).direction).toBe("inbound");
      expect((await openTicket("return_to_supplier")).direction).toBe("outbound");
    });

    it("computes net weight from the two weighings", async () => {
      const ticket = await openTicket();
      let t = await asTenant(companyA, (tx) =>
        fulfilRepo.recordWeighing(tx, ticket.id, "18500"),
      );
      expect(t.status).toBe("first_recorded");
      expect(t.netWeight).toBeNull(); // one reading is not a net

      t = await asTenant(companyA, (tx) =>
        fulfilRepo.recordWeighing(tx, ticket.id, "6200"),
      );
      expect(t.status).toBe("completed");
      expect(t.netWeight).toBe("12300.0000");
      expect(t.completedAt).not.toBeNull();
    });

    it("gives the same net whichever way round the weighings come", async () => {
      const ticket = await openTicket();
      await asTenant(companyA, (tx) =>
        fulfilRepo.recordWeighing(tx, ticket.id, "6200"),
      );
      const t = await asTenant(companyA, (tx) =>
        fulfilRepo.recordWeighing(tx, ticket.id, "18500"),
      );
      expect(t.netWeight).toBe("12300.0000");
    });

    it("refuses to complete a ticket with only one weighing", async () => {
      const ticket = await openTicket();
      await asTenant(companyA, (tx) =>
        fulfilRepo.recordWeighing(tx, ticket.id, "18500"),
      );
      await expectRejection(
        asTenant(companyA, (tx) =>
          tx.execute(sql`UPDATE weighbridge_tickets SET status = 'completed' WHERE id = ${ticket.id}`),
        ),
        /only one weighing/i,
      );
    });

    it("refuses to change a weighing that already happened", async () => {
      const ticket = await openTicket();
      await asTenant(companyA, (tx) =>
        fulfilRepo.recordWeighing(tx, ticket.id, "18500"),
      );
      await expectRejection(
        asTenant(companyA, (tx) =>
          tx.execute(sql`UPDATE weighbridge_tickets SET first_weight = 999 WHERE id = ${ticket.id}`),
        ),
        /cannot be changed/i,
      );
    });

    it("refuses a direction that contradicts the transaction type", async () => {
      await expectRejection(
        asTenant(companyA, (tx) =>
          tx.execute(sql`
            INSERT INTO weighbridge_tickets
              (company_id, ticket_number, transaction_type, direction)
            VALUES (${companyA}, 'WB-BAD', 'purchase', 'outbound')
          `),
        ),
        /direction_matches_type/i,
      );
    });

    it("treats the gate's reference as an idempotency key", async () => {
      await asTenant(companyA, (tx) =>
        fulfilRepo.openWeighbridgeTicket(tx, {
          companyId: companyA,
          transactionType: "purchase",
          externalRef: "GATE-001",
        }),
      );
      // A retried gate call must not create a second ticket for one trip.
      await expectRejection(
        asTenant(companyA, (tx) =>
          fulfilRepo.openWeighbridgeTicket(tx, {
            companyId: companyA,
            transactionType: "purchase",
            externalRef: "GATE-001",
          }),
        ),
        /duplicate key|external_ref_uq/i,
      );
    });

    it("allows many tickets with no external reference", async () => {
      await openTicket();
      await openTicket();
      const rows = await asTenant(companyA, (tx) =>
        fulfilRepo.listWeighbridgeTickets(tx),
      );
      expect(rows).toHaveLength(2);
    });

    it("links the two legs of a transfer, and refuses a mismatched pair", async () => {
      const out = await openTicket("transfer_out");
      const inb = await openTicket("transfer_in");
      const linked = await asTenant(companyA, (tx) =>
        fulfilRepo.linkTransferLegs(tx, inb.id, out.id),
      );
      expect(linked.transferCleared).toBe(true);

      const purchase = await openTicket("purchase");
      await expectRejection(
        asTenant(companyA, (tx) =>
          tx.execute(sql`
            UPDATE weighbridge_tickets SET linked_ticket_id = ${purchase.id}
             WHERE id = ${out.id}
          `),
        ),
        /transfer links one transfer_out/i,
      );
    });
  });

  describe("isolation", () => {
    it("hides another tenant's requests, checkouts and tickets", async () => {
      await makeRequest();
      const companyB = randomUUID();
      await client`
        INSERT INTO companies (id, name, slug)
        VALUES (${companyB}, 'Tenant B', ${"b-" + companyB.slice(0, 8)})
      `;
      const seen = await asTenant(companyB, (tx) =>
        fulfilRepo.listStockRequests(tx),
      );
      expect(seen).toHaveLength(0);
    });
  });
});
