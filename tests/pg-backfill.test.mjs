/**
 * Tests for the cutover scripts: backfill and reconciliation.
 *
 * These decide whether a real tenant's books move, and until now neither had a
 * test — a change to the database role (migrations 0023/0024) broke both
 * silently, and it was only caught by running them by hand.
 *
 * Uses its own throwaway MongoDB rather than the shared one from
 * tests/setup.global.mjs, so the fixture cannot be truncated out from under it
 * by another suite's cleanup.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { MongoMemoryServer } from "mongodb-memory-server";
import { backfill } from "@/app/db/backfill/backfill";
import { reconcile } from "@/app/db/backfill/reconcile";
import { seedTestSource } from "@/app/db/backfill/seed-test-source";

const DATABASE_URL = process.env.DATABASE_URL;
/** The backfill needs privileges the application role does not have. */
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("postgres backfill and reconciliation", () => {
  let mongod;
  let mongoUri;
  let admin;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create({ binary: { version: "7.0.14" } });
    mongoUri = `${mongod.getUri()}stockvault`;
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  }, 120_000);

  afterAll(async () => {
    if (admin) await admin.end();
    if (mongod) await mongod.stop();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies CASCADE`;
    await admin`TRUNCATE _migration_id_map, _migration_rejects, entry_counters`;
    await seedTestSource(mongoUri);
  });

  async function run() {
    return backfill({ mongoUri, databaseUrl: ADMIN_URL });
  }

  describe("backfill", () => {
    it("migrates the accounting core and reports what it moved", async () => {
      const stats = await run();
      expect(stats).toMatchObject({
        companies: 1,
        accounts: 3,
        fiscalPeriods: 1,
        parties: 1,
        products: 2,
      });
      // Four of the five source entries land; the fifth is quarantined below.
      expect(stats.entries).toBe(4);
      expect(stats.lines).toBe(7);
    });

    it("migrates products, exactly and with the SKU normalised", async () => {
      await run();
      const rows = await admin`
        SELECT sku, name, unit, category, quantity_on_hand::text AS on_hand,
               quantity_committed::text AS committed, reorder_level::text AS reorder,
               cost_price::text AS cost, selling_price::text AS price,
               costing_method::text AS method, is_active
          FROM products ORDER BY sku
      `;
      expect(rows.map((r) => r.sku)).toEqual(["GAD-1", "WID-1"]);

      const widget = rows.find((r) => r.sku === "WID-1");
      expect(widget.name).toBe("Widget");
      expect(widget.unit).toBe("pcs");
      expect(widget.category).toBe("Hardware");
      expect(widget.on_hand).toBe("100.0000");
      expect(widget.committed).toBe("10.0000");
      expect(widget.reorder).toBe("25.0000");
      // 40.5 as a float becomes exactly 40.5000, not 40.4999...
      expect(widget.cost).toBe("40.5000");
      expect(widget.price).toBe("250.0000");
      expect(widget.method).toBe("fifo");
      expect(widget.is_active).toBe(true);

      // 99.99 is the classic float that does not survive naive conversion.
      const gadget = rows.find((r) => r.sku === "GAD-1");
      expect(gadget.price).toBe("99.9900");
      // status "discontinued" beats isActive true: three states flatten to two.
      expect(gadget.is_active).toBe(false);
    });

    it("quarantines an unbalanced entry instead of rounding it into agreement", async () => {
      const stats = await run();
      expect(stats.rejected).toBe(1);

      const [reject] = await admin`
        SELECT reason, detail FROM _migration_rejects
      `;
      expect(reject.reason).toBe("unbalanced_in_source");
      expect(reject.detail.entryNumber).toBe("JE-00003");
      // Half a cent. The old `Math.abs(d - c) < 0.01` guard called this
      // balanced and would have posted it.
      expect(reject.detail.debits).toBe("100.0000");
      expect(reject.detail.credits).toBe("99.9950");
      expect(reject.detail.variance).toBe("0.0050");

      // And it is genuinely absent from the ledger, not silently corrected.
      const entries = await admin`
        SELECT entry_number FROM journal_entries WHERE entry_number = 'JE-00003'
      `;
      expect(entries).toHaveLength(0);
    });

    it("converts money exactly, with no float residue", async () => {
      await run();
      const rows = await admin`
        SELECT a.account_code,
               SUM(l.debit)::text  AS debit,
               SUM(l.credit)::text AS credit
          FROM journal_lines l
          JOIN accounts a ON a.id = l.account_id
         GROUP BY a.account_code ORDER BY a.account_code
      `;
      const byCode = Object.fromEntries(rows.map((r) => [r.account_code, r]));
      // 5000 posted + 250 from the draft entry. Drafts migrate: only posted
      // entries are balance-gated, because only they claim to be a ledger.
      // The 100 from JE-00003 never arrives — it was quarantined.
      expect(byCode["1000"].debit).toBe("5250.0000");
      expect(byCode["4000"].credit).toBe("17300.0000");
    });

    it("puts every row behind the tenant boundary", async () => {
      await run();
      const [company] = await admin`SELECT id FROM companies`;

      // MUST be the application role. `admin` is a superuser and bypasses
      // every policy, so asserting isolation on it proves nothing — which is
      // the §9A failure mode, and it caught this test out first time.
      const app = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, {
        max: 1,
        onnotice: () => {},
      });
      try {
        const scoped = await app.begin(async (tx) => {
          await tx`SELECT set_config('app.company_id', ${company.id}, true)`;
          return tx`SELECT count(*)::int AS n FROM journal_entries`;
        });
        expect(scoped[0].n).toBe(4);

        // Another tenant sees nothing. The backfill wrote through RLS rather
        // than around it, so this holds for whatever it produced.
        const other = await app.begin(async (tx) => {
          await tx`SELECT set_config('app.company_id', ${"00000000-0000-0000-0000-000000000000"}, true)`;
          return tx`SELECT count(*)::int AS n FROM journal_entries`;
        });
        expect(other[0].n).toBe(0);
      } finally {
        await app.end();
      }
    });

    it("is resumable: a second run adds nothing", async () => {
      const first = await run();
      const second = await run();

      // The id map is reused, so the same documents map to the same rows and
      // the second run migrates the same entries rather than quarantining them.
      expect(second.entries).toBe(first.entries);
      expect(second.rejected).toBe(first.rejected);

      const [entries] = await admin`SELECT count(*)::int AS n FROM journal_entries`;
      const [lines] = await admin`SELECT count(*)::int AS n FROM journal_lines`;
      expect(entries.n).toBe(4);
      expect(lines.n).toBe(7);

      // And one reject row per rejected document, however many times it ran.
      const [rejects] = await admin`SELECT count(*)::int AS n FROM _migration_rejects`;
      expect(rejects.n).toBe(1);
    });
  });

  describe("reconciliation", () => {
    it("blocks cutover and names the pre-existing drift", async () => {
      await run();
      const { failures, findings } = await reconcile({
        mongoUri,
        databaseUrl: ADMIN_URL,
      });

      expect(failures).toBeGreaterThan(0);

      // The finding that matters: the SOURCE ledger does not tie, and by
      // exactly the amount the old tolerance was hiding.
      const drift = findings.find((f) => f.kind === "source_out_of_balance");
      expect(drift).toBeDefined();
      expect(drift.variance).toBe("0.0050");

      // And the quarantine is surfaced rather than left for someone to notice.
      expect(findings.some((f) => f.kind === "quarantined")).toBe(true);
    });

    it("reports the accounts that differ, not just a total", async () => {
      await run();
      const { findings } = await reconcile({
        mongoUri,
        databaseUrl: ADMIN_URL,
      });
      const accounts = findings
        .filter((f) => f.kind === "account_variance")
        .map((f) => f.account)
        .sort();
      // Both legs of the quarantined entry.
      expect(accounts).toEqual(["1000", "4000"]);
    });

    it("passes once the source ledger is consistent", async () => {
      // Remove the deliberately-drifted entry from the source, then migrate a
      // ledger that does tie.
      const { MongoClient } = await import("mongodb");
      const client = new MongoClient(mongoUri);
      await client.connect();
      await client
        .db()
        .collection("journalentries")
        .deleteOne({ entryNumber: "JE-00003" });
      await client.close();

      const stats = await run();
      expect(stats.rejected).toBe(0);

      const { failures, findings } = await reconcile({
        mongoUri,
        databaseUrl: ADMIN_URL,
      });
      expect(findings).toEqual([]);
      expect(failures).toBe(0);
    });
  });
});
