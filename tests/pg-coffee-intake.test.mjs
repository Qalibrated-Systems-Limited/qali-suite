/**
 * Coffee cooperative intake — the sixth module from §9G's sweep.
 *
 * `coffee-coop.js` posts DR Inventory / CR Farmer Payable through the Mongo
 * JournalEntry model while every ledger screen reads Postgres, and it is
 * reachable: registered in the connector registry and called by
 * app/api/v1/coffee-coop/intake. Every farmer delivery went into a ledger
 * nothing reads.
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

const { CoffeeCoopConnector } = await import(
  "@/lib/integrations/connectors/coffee-coop.js"
);

suite("coffee cooperative intake", () => {
  let admin, client, db, companyA;
  let inventoryAcct, farmerPayableAcct, cherry, season;

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
    await admin`TRUNCATE companies CASCADE`;
    await admin`TRUNCATE entry_counters`;
    companyA = randomUUID();
    inventoryAcct = randomUUID(); farmerPayableAcct = randomUUID();
    cherry = randomUUID(); season = randomUUID();

    await admin`INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Kiambu Coop', ${"k-" + companyA.slice(0, 8)})`;

    await asTenant(companyA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, can_post, system_account)
        VALUES
          (${inventoryAcct}::uuid,     ${companyA}::uuid, '1200', 'Inventory',      'asset',     true, 'inventory'),
          (${farmerPayableAcct}::uuid, ${companyA}::uuid, '2160', 'Farmer Payable', 'liability', true, 'farmer_payable')`);
      await tx.execute(sql`
        INSERT INTO products (id, company_id, sku, name, unit, cost_price, selling_price, quantity_on_hand)
        VALUES (${cherry}::uuid, ${companyA}::uuid, 'CHERRY', 'Coffee Cherry', 'kg', 0, 0, 0)`);
      await tx.execute(sql`
        INSERT INTO coffee_seasons (id, company_id, name, season_type, year, is_active, default_product_id)
        VALUES (${season}::uuid, ${companyA}::uuid, '2026 Main', 'main', 2026, true, ${cherry}::uuid)`);
      await tx.execute(sql`
        INSERT INTO coffee_price_schedule (company_id, season_id, grade, coffee_type, unit_price)
        VALUES (${companyA}::uuid, ${season}::uuid, 'AA', 'cherry', 85)`);
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

  const intake = async (over = {}) => {
    const c = new CoffeeCoopConnector(companyA, null);
    const payload = {
      event: "collection.intake_created",
      farmerCode: "M-0417",
      farmerName: "Wanjiku Kamau",
      coffeeType: "cherry",
      grade: "AA",
      grossWeight: 520,
      deductionWeight: 20,
      ...over,
    };
    return c.execute(await c.map(await c.validate(payload)));
  };

  it("posts DR Inventory / CR Farmer Payable into THIS ledger", async () => {
    const result = await intake({ externalRef: "STN-001" });

    // 520 gross less 20 deduction = 500 kg, at the season's 85/kg.
    expect(result.netWeight).toBe(500);
    expect(result.unitPrice).toBe(85);
    expect(result.totalAmount).toBe(42500);

    expect(await accountNet(inventoryAcct)).toBe(42500);
    expect(await accountNet(farmerPayableAcct)).toBe(-42500);

    const [entry] = await admin`
      SELECT entry_type, status, reference FROM journal_entries`;
    expect(entry).toMatchObject({ entry_type: "purchase", status: "posted" });
    expect(entry.reference).toBe(result.entryNumber);
  });

  it("net weight and total are the database's, not the connector's", async () => {
    // The Mongo model documents both as derived and then stores them as
    // independent numbers the connector computed — so correcting the gross
    // weight afterwards left them behind, while the stock and the farmer's
    // money had already been struck from them. Generated columns here.
    const result = await intake({ externalRef: "STN-002", grossWeight: 331, deductionWeight: 11 });
    expect(result.netWeight).toBe(320);
    expect(result.totalAmount).toBe(27200);

    const [row] = await admin`
      SELECT net_weight::float8 AS net, total_amount::float8 AS total
        FROM farmer_intake_entries WHERE external_ref = 'STN-002'`;
    expect(row.net).toBe(320);
    expect(row.total).toBe(27200);

    // And they follow a correction, rather than staying where they were.
    await admin`UPDATE farmer_intake_entries SET deduction_weight = 31 WHERE external_ref = 'STN-002'`;
    const [after] = await admin`
      SELECT net_weight::float8 AS net, total_amount::float8 AS total
        FROM farmer_intake_entries WHERE external_ref = 'STN-002'`;
    expect(after.net).toBe(300);
    expect(after.total).toBe(25500);
  });

  it("the coffee reaches stock", async () => {
    await intake({ externalRef: "STN-003" });
    const [p] = await admin`
      SELECT quantity_on_hand::float8 AS on_hand, cost_price::float8 AS cost
        FROM products WHERE id = ${cherry}::uuid`;
    expect(p.on_hand).toBe(500);
    // Received at 85/kg into an empty bin, so that is the average.
    expect(p.cost).toBe(85);
  });

  it("the station's reference is an idempotency key", async () => {
    // Mongo indexes externalRef WITHOUT uniqueness, so a retried intake call
    // records the delivery, the stock and the farmer's money a second time.
    await intake({ externalRef: "STN-004" });
    await expect(intake({ externalRef: "STN-004" })).rejects.toThrow(
      /already been recorded/i,
    );

    const [n] = await admin`SELECT count(*)::int AS n FROM farmer_intake_entries`;
    expect(n.n).toBe(1);
    const [j] = await admin`SELECT count(*)::int AS n FROM journal_entries`;
    expect(j.n).toBe(1);
  });

  it("an unpriced grade is recorded, warned about, and posts nothing", async () => {
    const result = await intake({ externalRef: "STN-005", grade: "PB" });
    expect(result.totalAmount).toBe(0);
    expect(result.warnings.join(" ")).toMatch(/No price for PB/i);
    const [n] = await admin`SELECT count(*)::int AS n FROM journal_entries`;
    expect(n.n).toBe(0);
  });

  it("a deduction cannot exceed what arrived", async () => {
    await expect(
      intake({ externalRef: "STN-006", grossWeight: 100, deductionWeight: 100 }),
    ).rejects.toThrow(/deductionWeight cannot be/i);
  });

  it("only one season can be active", async () => {
    // The connector prices an intake from "the active season"; with two, the
    // price a farmer is paid depends on which row the query returned.
    await expect(
      asTenant(companyA, (tx) =>
        tx.execute(sql`
          INSERT INTO coffee_seasons (company_id, name, season_type, year, is_active)
          VALUES (${companyA}::uuid, '2026 Fly', 'fly', 2026, true)`),
      ),
    ).rejects.toThrow();
  });

  it("one price per grade per type per season", async () => {
    await expect(
      asTenant(companyA, (tx) =>
        tx.execute(sql`
          INSERT INTO coffee_price_schedule (company_id, season_id, grade, coffee_type, unit_price)
          VALUES (${companyA}::uuid, ${season}::uuid, 'AA', 'cherry', 99)`),
      ),
    ).rejects.toThrow();
  });

  it("every entry it raises balances", async () => {
    await intake({ externalRef: "STN-007" });
    await intake({ externalRef: "STN-008", grossWeight: 800, deductionWeight: 50 });

    const rows = await admin`
      SELECT entry_id, SUM(debit)::float8 AS d, SUM(credit)::float8 AS c
        FROM journal_lines GROUP BY entry_id`;
    expect(rows.length).toBe(2);
    for (const r of rows) expect(r.d).toBe(r.c);
  });
});

/**
 * The connector registry.
 *
 * Not a Postgres test, but it belongs with the connectors: `logistics` and
 * `miller` were registered against files that do not exist, and `getConnector`
 * picks the loader by key BEFORE it can fall back to `generic` — so naming
 * either type threw on the dynamic import instead of degrading.
 */
describe("connector registry", () => {
  it("every registered type actually loads", async () => {
    const { getConnector, getConnectorTypes } = await import(
      "@/lib/integrations/connectors/registry.js"
    );
    for (const type of getConnectorTypes()) {
      const instance = await getConnector(type, "co", "key", "evt");
      expect(instance).toBeTruthy();
      expect(instance.connectorType).toBe(type);
    }
  });

  it("an unknown type degrades to the generic connector", async () => {
    const { getConnector } = await import(
      "@/lib/integrations/connectors/registry.js"
    );
    const instance = await getConnector("logistics", "co", "key", "evt");
    expect(instance).toBeTruthy();
    expect(instance.connectorType).toBe("logistics");
  });
});
