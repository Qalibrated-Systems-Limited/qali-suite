/**
 * The weighbridge connector, and the half-pair it used to leave behind.
 *
 * §9G: the connector posts through the Mongo JournalEntry model while every
 * ledger screen reads Postgres — and its account matrix maps `purchase` to
 * DR Inventory / CR GR/IR, which is the receipt's own half of a pair whose
 * OTHER half (an approved bill clearing GR/IR) was already being written to
 * Postgres. Half of each pair in each store, so the clearing account could
 * only ever grow.
 *
 * The Postgres side of this was already built — the weighbridge_tickets table,
 * its constraints and its repository functions all shipped with fulfilment
 * (0020-0022). Nothing used them. This is the connector pointed at them.
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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../lib/integrations/webhooks/emitter.js", () => ({
  emitWebhookEvent: vi.fn(),
}));

const { WeighbridgeConnector } = await import(
  "@/lib/integrations/connectors/weighbridge.js"
);

suite("weighbridge connector", () => {
  let admin, client, db, companyA;
  let inventoryAcct, grniAcct, cogsAcct, varianceAcct, widget;

  const asTenant = (c, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${c}, true)`);
      return fn(tx);
    });

  const accountNet = async (accountId) => {
    const [r] = await admin`
      SELECT COALESCE(SUM(debit - credit), 0)::float8 AS net
        FROM journal_lines WHERE account_id = ${accountId}::uuid`;
    return r.net;
  };

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
    inventoryAcct = randomUUID(); grniAcct = randomUUID(); cogsAcct = randomUUID();
    varianceAcct = randomUUID();
    widget = randomUUID();

    await admin`INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)})`;

    await asTenant(companyA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, can_post, system_account)
        VALUES
          (${inventoryAcct}::uuid, ${companyA}::uuid, '1200', 'Inventory',       'asset',     true, 'inventory'),
          (${grniAcct}::uuid,      ${companyA}::uuid, '2150', 'GR/IR Clearing',  'liability', true, 'grni'),
          (${cogsAcct}::uuid,      ${companyA}::uuid, '5000', 'Cost of Sales',   'expense',   true, 'cogs'),
          (${varianceAcct}::uuid,  ${companyA}::uuid, '5300', 'Stock Variance',  'expense',   true, 'stock_variance')`);
      await tx.execute(sql`
        INSERT INTO products (id, company_id, sku, name, unit, cost_price, selling_price, quantity_on_hand)
        VALUES (${widget}::uuid, ${companyA}::uuid, 'MAIZE', 'Maize', 'kg', 50, 80, 1000)`);
      await tx.execute(sql`
        INSERT INTO fiscal_periods
          (company_id, year, month, period_name, period_code, start_date, end_date, status)
        SELECT ${companyA}::uuid, y, m,
               to_char(make_date(y, m, 1), 'FMMonth YYYY'),
               to_char(make_date(y, m, 1), 'YYYY-MM'),
               make_date(y, m, 1),
               (make_date(y, m, 1) + interval '1 month - 1 day')::date, 'open'
          FROM generate_series(2025, 2032) AS y, generate_series(1, 12) AS m`);
    });
  });

  const connector = () => new WeighbridgeConnector(companyA, null);

  /** Drive a whole trip: arrive loaded, leave empty. */
  const weighIn = async (ref, transactionType, first, second, extra = {}) => {
    const c = connector();
    const firstMapped = await c.map(
      await c.validate({
        event: "weighbridge.first_weight",
        ticketRef: ref, transactionType, weight: first,
        productCode: "MAIZE", vehicleReg: "KCB 123X", ...extra,
      }),
    );
    const opened = await c._recordFirstWeight(firstMapped);

    const c2 = connector();
    const secondMapped = await c2.map(
      await c2.validate({
        event: "weighbridge.second_weight",
        ticketRef: ref, transactionType, weight: second,
        productCode: "MAIZE", ...extra,
      }),
    );
    const completed = await c2._recordSecondWeight(secondMapped);
    return { opened, completed };
  };

  it("a purchase posts DR Inventory / CR GR-IR into THIS ledger", async () => {
    const { completed } = await weighIn("GATE-001", "purchase", 12000, 2000);

    expect(completed.netWeight).toBe(10000);
    expect(completed.status).toBe("completed");

    // 10,000 kg at a 50/kg cost price.
    expect(await accountNet(inventoryAcct)).toBe(500000);
    expect(await accountNet(grniAcct)).toBe(-500000);

    const [entry] = await admin`
      SELECT entry_type, status, source_type, reference FROM journal_entries`;
    expect(entry).toMatchObject({
      entry_type: "goods_receipt",
      status: "posted",
      source_type: "weighbridge_ticket",
    });
    expect(entry.reference).toBe(completed.ticketNumber);
  });

  it("the GR/IR position a bill can actually clear", async () => {
    // This is the whole point of §9G's "half the pair is in each store". The
    // receipt credits GR/IR here; an approved bill debits it here too, so the
    // account nets to zero instead of growing forever.
    await weighIn("GATE-002", "purchase", 12000, 2000);
    expect(await accountNet(grniAcct)).toBe(-500000);

    await asTenant(companyA, (tx) =>
      tx.execute(sql`
        SELECT 1 FROM journal_entries WHERE source_type = 'weighbridge_ticket'`),
    );

    const [open] = await admin`
      SELECT COALESCE(SUM(credit - debit), 0)::float8 AS outstanding
        FROM journal_lines WHERE account_id = ${grniAcct}::uuid`;
    expect(open.outstanding).toBe(500000);
  });

  it("a sale with no invoice posts DR Stock Variance / CR Inventory", async () => {
    // The matrix distinguishes `sale` (against an invoice, DR COGS) from
    // `sale_standalone` (no invoice, DR Stock Variance) — direction alone is
    // not enough to decide, which is what the matrix at the top is for.
    const { completed } = await weighIn("GATE-003", "sale_standalone", 500, 300);

    expect(completed.netWeight).toBe(200);
    expect(await accountNet(varianceAcct)).toBe(10000);
    expect(await accountNet(cogsAcct)).toBe(0);
    expect(await accountNet(inventoryAcct)).toBe(-10000);

    const [product] = await admin`
      SELECT quantity_on_hand::float8 AS on_hand FROM products WHERE id = ${widget}::uuid`;
    expect(product.on_hand).toBe(800);
  });

  it("net weight is |first - second|, whichever way round the truck came", async () => {
    // Outbound: arrives empty, leaves loaded. The Mongo model documents net as
    // the absolute difference and then stores it as an independent number;
    // here it is a generated column and cannot disagree.
    const { completed } = await weighIn("GATE-004", "sale_standalone", 300, 900);
    expect(completed.netWeight).toBe(600);
  });

  it("the gate's reference is an idempotency key, so a retry cannot open a second ticket", async () => {
    // Mongo indexes external_ref WITHOUT uniqueness, so a retried gate call
    // creates a second ticket for one trip — and then a second stock movement
    // and a second journal entry when it completes.
    const c = connector();
    const mapped = await c.map(
      await c.validate({
        event: "weighbridge.first_weight",
        ticketRef: "GATE-005", transactionType: "purchase",
        weight: 12000, productCode: "MAIZE",
      }),
    );
    await c._recordFirstWeight(mapped);

    await expect(c._recordFirstWeight(mapped)).rejects.toThrow(
      /already has a first weight/i,
    );

    const [n] = await admin`SELECT count(*)::int AS n FROM weighbridge_tickets`;
    expect(n.n).toBe(1);
  });

  it("a completed ticket is not completed twice", async () => {
    await weighIn("GATE-006", "purchase", 12000, 2000);

    const c = connector();
    const mapped = await c.map(
      await c.validate({
        event: "weighbridge.second_weight",
        ticketRef: "GATE-006", transactionType: "purchase",
        weight: 2000, productCode: "MAIZE",
      }),
    );
    await expect(c._recordSecondWeight(mapped)).rejects.toThrow(/already completed/i);

    const [n] = await admin`SELECT count(*)::int AS n FROM journal_entries`;
    expect(n.n).toBe(1);
  });

  it("a second weight without a first is refused", async () => {
    const c = connector();
    const mapped = await c.map(
      await c.validate({
        event: "weighbridge.second_weight",
        ticketRef: "GATE-007", transactionType: "purchase",
        weight: 2000, productCode: "MAIZE",
      }),
    );
    await expect(c._recordSecondWeight(mapped)).rejects.toThrow(
      /Record first weight before second weight/i,
    );
  });

  it("an unknown product completes the ticket and says what is missing", async () => {
    const c = connector();
    const m1 = await c.map(
      await c.validate({
        event: "weighbridge.first_weight",
        ticketRef: "GATE-008", transactionType: "purchase",
        weight: 12000, productCode: "SORGHUM",
      }),
    );
    await c._recordFirstWeight(m1);

    const c2 = connector();
    const m2 = await c2.map(
      await c2.validate({
        event: "weighbridge.second_weight",
        ticketRef: "GATE-008", transactionType: "purchase",
        weight: 2000, productCode: "SORGHUM",
      }),
    );
    const done = await c2._recordSecondWeight(m2);

    expect(done.status).toBe("completed");
    expect(done.warnings.join(" ")).toMatch(/not found in catalogue/i);
    const [n] = await admin`SELECT count(*)::int AS n FROM journal_entries`;
    expect(n.n).toBe(0);
  });

  it("every entry it raises balances", async () => {
    await weighIn("GATE-009", "purchase", 12000, 2000);
    await weighIn("GATE-010", "sale_standalone", 500, 300);
    await weighIn("GATE-011", "customer_return", 100, 400);

    const rows = await admin`
      SELECT entry_id, SUM(debit)::float8 AS d, SUM(credit)::float8 AS c
        FROM journal_lines GROUP BY entry_id`;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.d).toBe(r.c);
  });
});
