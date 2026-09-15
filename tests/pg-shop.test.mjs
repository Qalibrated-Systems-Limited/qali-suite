/**
 * Online Shop repository against a real PostgreSQL — 0112.
 *
 * Pins the integration that makes the Shop real: the catalogue is the `products`
 * table LEFT JOINed to `shop_listings`, listing is an idempotent upsert, orders
 * stamp item_count/total from their lines and cascade them, and tenants are
 * isolated.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

vi.mock("server-only", () => ({}));

const repo = await import("@/app/db/repositories/shop");

suite("the online shop", () => {
  let admin, client, db, companyA, companyB, prodA;
  const actor = { id: null, name: "Store" };

  const asTenant = (id, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${id}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);
  const inB = (fn) => asTenant(companyB, fn);

  // Products carry RLS; insert on the superuser admin connection with an explicit
  // company_id so the catalogue has something real to join to.
  async function seedProduct(companyId, sku, name, price, stock) {
    const id = randomUUID();
    await admin`
      INSERT INTO products (id, company_id, sku, name, selling_price, quantity_on_hand, is_active)
      VALUES (${id}, ${companyId}, ${sku}, ${name}, ${price}, ${stock}, true)
    `;
    return id;
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
    await admin`TRUNCATE companies, users, products, _migration_id_map, entry_counters CASCADE`;
    companyA = randomUUID();
    companyB = randomUUID();
    await admin`INSERT INTO companies (id, name, slug) VALUES (${companyA}, 'A', ${"a-" + companyA.slice(0, 8)})`;
    await admin`INSERT INTO companies (id, name, slug) VALUES (${companyB}, 'B', ${"b-" + companyB.slice(0, 8)})`;
    prodA = await seedProduct(companyA, "PRD-1001", "Digital Bench Scale 30kg", 18500, 24);
  });

  it("shows the real product in the catalogue, unlisted until listed", async () => {
    let cat = await inA((tx) => repo.listCatalog(tx));
    expect(cat).toHaveLength(1);
    expect(cat[0].name).toBe("Digital Bench Scale 30kg");
    expect(cat[0].listed).toBe(false);
    expect(cat[0].price).toBe(18500);

    await inA((tx) => repo.setListing(tx, { companyId: companyA, productId: prodA, listed: true, shopPrice: 17999 }, actor));
    cat = await inA((tx) => repo.listCatalog(tx));
    expect(cat[0].listed).toBe(true);
    expect(cat[0].price).toBe(17999); // override wins
  });

  it("listing is an idempotent upsert", async () => {
    await inA((tx) => repo.setListing(tx, { companyId: companyA, productId: prodA, listed: true }, actor));
    await inA((tx) => repo.setListing(tx, { companyId: companyA, productId: prodA, listed: false }, actor));
    const cat = await inA((tx) => repo.listCatalog(tx));
    expect(cat[0].listed).toBe(false);
    const stats = await inA((tx) => repo.getShopStats(tx));
    expect(stats.listedProducts).toBe(0);
    expect(stats.catalogItems).toBe(1);
  });

  it("stamps item_count and total from lines and cascades them", async () => {
    const order = await inA((tx) =>
      repo.createOrder(tx, {
        companyId: companyA,
        customerName: "Jane Doe",
        lines: [
          { productId: prodA, description: "Scale", qty: 2, unitPrice: 18500 },
          { productId: null, description: "Delivery", qty: 1, unitPrice: 1500 },
        ],
        createdByName: "Seed",
      }),
    );
    expect(order.orderNumber).toBe("ORD-00001");
    expect(order.itemCount).toBe(3);
    expect(order.total).toBe(2 * 18500 + 1500);

    const lines = await inA((tx) => repo.getOrderLines(tx, order.id));
    expect(lines).toHaveLength(2);

    await inA((tx) => repo.deleteOrder(tx, order.id));
    expect(await inA((tx) => repo.getOrderLines(tx, order.id))).toHaveLength(0);
  });

  it("counts orders and awaiting-payment in stats", async () => {
    await inA((tx) => repo.createOrder(tx, { companyId: companyA, customerName: "A", lines: [{ qty: 1, unitPrice: 100 }], createdByName: "s" }));
    const o2 = await inA((tx) => repo.createOrder(tx, { companyId: companyA, customerName: "B", lines: [{ qty: 1, unitPrice: 100 }], createdByName: "s" }));
    await inA((tx) => repo.setOrderStatus(tx, o2.id, "paid", actor));
    const stats = await inA((tx) => repo.getShopStats(tx));
    expect(stats.totalOrders).toBe(2);
    expect(stats.awaitingPayment).toBe(1);
  });

  it("isolates tenants — B sees neither A's catalogue nor orders", async () => {
    await inA((tx) => repo.createOrder(tx, { companyId: companyA, customerName: "A", lines: [{ qty: 1, unitPrice: 100 }], createdByName: "s" }));
    expect(await inB((tx) => repo.listOrders(tx))).toHaveLength(0);
    expect(await inB((tx) => repo.listCatalog(tx))).toHaveLength(0);
  });
});
