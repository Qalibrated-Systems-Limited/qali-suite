/**
 * `= ANY(...)` over a JavaScript array, across every repository that filters
 * on one.
 *
 * THE BUG THIS EXISTS FOR. `sql`... ANY(${arr}::text[])`` does not work in any
 * nesting: drizzle expands a JS array to a parameter TUPLE — `($1, $2)` — and
 * `::text[]` cannot cast one, so Postgres raises 22P02 "malformed array
 * literal". Twelve call sites carried it.
 *
 * It survived because every call site guards on `array.length`, so the broken
 * branch is skipped whenever the filter is empty — and every existing suite
 * called these functions with no status filter. The dashboard's AlertsStrip
 * called `countNonconformances({ status: 'disposition_proposed' })` on every
 * load and had never once returned a number.
 *
 * The lesson for the assertions below: exercise the FILTERED path, not just
 * the unfiltered one. A list function tested only with no arguments tests the
 * branch that cannot fail.
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

const ncr = await import("@/app/db/repositories/nonconformance");
const claims = await import("@/app/db/repositories/claims");
const pos = await import("@/app/db/repositories/purchaseOrders");
const grns = await import("@/app/db/repositories/goodsReceipts");
const assets = await import("@/app/db/repositories/assets");
const { anyOf } = await import("@/app/db/repositories/sqlHelpers");

suite("array filters", () => {
  let admin, client, db, companyId;

  const asTenant = (fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });

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
    companyId = randomUUID();
    await admin`INSERT INTO companies (id, name, slug)
      VALUES (${companyId}, 'Acme', ${"a-" + companyId.slice(0, 8)})`;
  });

  describe("the helper", () => {
    it("builds a castable array from one value", async () => {
      const [r] = await asTenant((tx) =>
        tx.execute(sql`SELECT ('a' = ${anyOf(["a"], "text[]")}) AS hit`),
      );
      expect(r.hit).toBe(true);
    });

    it("builds a castable array from several", async () => {
      const [r] = await asTenant((tx) =>
        tx.execute(sql`SELECT ('b' = ${anyOf(["a", "b", "c"], "text[]")}) AS hit`),
      );
      expect(r.hit).toBe(true);
    });

    it("works nested inside another fragment, which is where it broke", async () => {
      const inner = sql`'a' = ${anyOf(["a"], "text[]")}`;
      const [r] = await asTenant((tx) =>
        tx.execute(sql`SELECT (TRUE AND ${inner}) AS hit`),
      );
      expect(r.hit).toBe(true);
    });

    it("casts to an enum type as well as text", async () => {
      const [r] = await asTenant((tx) =>
        tx.execute(
          sql`SELECT ('draft'::employee_claim_status = ${anyOf(["draft", "approved"], "employee_claim_status[]")}) AS hit`,
        ),
      );
      expect(r.hit).toBe(true);
    });
  });

  /**
   * Each of these raised 22P02 before the fix. They assert only that the
   * FILTERED call returns a number — the point is that it runs at all.
   */
  describe("every repository that filters on an array", () => {
    it("countNonconformances — the one the dashboard called on every load", async () => {
      const single = await asTenant((tx) =>
        ncr.countNonconformances(tx, { status: "disposition_proposed" }),
      );
      const many = await asTenant((tx) =>
        ncr.countNonconformances(tx, { status: ["disposition_proposed", "open"] }),
      );
      expect(single).toBe(0);
      expect(many).toBe(0);
    });

    it("listNonconformances", async () => {
      const rows = await asTenant((tx) =>
        ncr.listNonconformances(tx, { status: ["open"] }),
      );
      expect(Array.isArray(rows)).toBe(true);
    });

    it("countClaimsAwaitingApproval", async () => {
      const n = await asTenant((tx) =>
        claims.countClaimsAwaitingApproval(tx, ["advance_request", "reimbursement"]),
      );
      expect(typeof n).toBe("number");
    });

    it("listPurchaseOrders", async () => {
      const rows = await asTenant((tx) =>
        pos.listPurchaseOrders(tx, { status: ["draft", "sent"] }),
      );
      expect(Array.isArray(rows)).toBe(true);
    });

    it("listGoodsReceipts", async () => {
      const rows = await asTenant((tx) =>
        grns.listGoodsReceipts(tx, { status: ["draft"] }),
      );
      expect(Array.isArray(rows)).toBe(true);
    });

    it("listAssets", async () => {
      const { assets: rows } = await asTenant((tx) =>
        assets.listAssets(tx, { status: ["active", "idle"] }),
      );
      expect(Array.isArray(rows)).toBe(true);
    });
  });
});
