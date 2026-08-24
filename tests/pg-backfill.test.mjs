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
    await admin`TRUNCATE companies, _migration_id_map, _migration_rejects, entry_counters CASCADE`;
    await seedTestSource(mongoUri);
  });

  async function run() {
    return backfill({ mongoUri, databaseUrl: ADMIN_URL });
  }

  describe("backfill", () => {
    it("carries the settings the books obey, not just the tenant root", async () => {
      await run();

      const [c] = await admin`SELECT * FROM companies`;
      // The currency comes from settings.currency. The old read looked for a
      // `baseCurrency` field the model does not have, so every backfilled
      // tenant silently landed on KES whatever it actually trades in.
      expect(c.base_currency).toBe("USD");
      expect(c.code).toBe("PILOT");
      expect(c.tax_pin).toBe("P051234567X");
      expect(c.plan).toBe("professional");
      expect(c.max_users).toBe(25);

      const [s] = await admin`SELECT * FROM company_settings
                               WHERE company_id = ${c.id}`;
      // A VAT-exempt tenant must not be handed 16% because the backfill only
      // moved four columns.
      expect(Number(s.default_vat_rate)).toBe(0);
      expect(s.invoice_prefix).toBe("SI");
      expect(s.default_costing_method).toBe("fifo");
      expect(Number(s.bill_payment_value)).toBe(250000);
      expect(s.feature_multi_currency).toBe(true);
      // Untouched keys land on the platform default rather than null.
      expect(Number(s.stock_adjustment_value)).toBe(50000);
    });

    it("brings users across with their id, and links them to their party", async () => {
      await run();

      const [u] = await admin`SELECT * FROM users`;
      // The Mongo id IS the id. Every actor column already holds it (0031),
      // so keeping it makes each of those a foreign key rather than a second
      // id map to carry forever.
      expect(u.id).toMatch(/^[0-9a-f]{24}$/);
      expect(u.name).toBe("Jane Wanjiru");
      // Lowercased on the way in — Mongo enforces this with a setter, which
      // enforces nothing if a write ever bypasses it.
      expect(u.email).toBe("jane@pilot.co.ke");
      expect(u.role).toBe("Accountant");
      expect(u.token_version).toBe(3);

      const [grant] = await admin`SELECT * FROM user_company_access`;
      expect(grant.user_id).toBe(u.id);
      expect(grant.granted_via).toBe("primary");

      // "In THIS company, this login is that person." The link is on the
      // grant, not on the user, because a party is company-scoped.
      const [party] = await admin`SELECT name FROM parties
                                   WHERE id = ${grant.party_id}`;
      expect(party.name).toBe("Jane Wanjiru");
    });

    it("is idempotent about the company record", async () => {
      await run();
      // A backfill is meant to be re-runnable after a partial failure. The
      // company insert used DO NOTHING, so a second pass corrected nothing.
      await admin`UPDATE company_settings SET invoice_prefix = 'WRONG'`;
      await run();

      const [s] = await admin`SELECT invoice_prefix FROM company_settings`;
      expect(s.invoice_prefix).toBe("SI");
    });

    it("migrates the accounting core and reports what it moved", async () => {
      const stats = await run();
      expect(stats).toMatchObject({
        companies: 1,
        accounts: 3,
        fiscalPeriods: 2,
        parties: 2,
        users: 1,
        userGrants: 1,
        products: 2,
        weighbridgeTickets: 1,
        stockRequests: 2,
        stockRequestItems: 3,
        stockRequestApprovals: 1,
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

    it("migrates a period nobody has opened yet", async () => {
      await run();
      const rows = await admin`
        SELECT period_code, status::text FROM fiscal_periods ORDER BY period_code
      `;
      // Onboarding leaves eleven of every twelve periods at "future", and the
      // target enum did not carry the value until 0030 — so this would have
      // failed on the first real tenant, not on the fixture.
      expect(rows).toEqual([
        { period_code: "2026-08", status: "open" },
        { period_code: "2026-09", status: "future" },
      ]);
    });

    it("quarantines an unbalanced entry instead of rounding it into agreement", async () => {
      await run();

      const [reject] = await admin`
        SELECT reason, detail FROM _migration_rejects
         WHERE reason = 'unbalanced_in_source'
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
      expect(rejects.n).toBe(4);

      // And no duplicated children: the item and approval ids come from the
      // id map, so a second pass over the same subdocuments is a no-op.
      const [items] = await admin`SELECT count(*)::int AS n FROM stock_request_items`;
      const [approvals] = await admin`SELECT count(*)::int AS n FROM stock_request_approvals`;
      expect(items.n).toBe(3);
      expect(approvals.n).toBe(1);
    });
  });

  describe("weighbridge tickets", () => {
    it("generates net weight rather than trusting a seeded one", async () => {
      await run();
      const [t] = await admin`
        SELECT ticket_number, direction::text, first_weight::text AS first,
               second_weight::text AS second, net_weight::text AS net,
               status::text, external_ref
          FROM weighbridge_tickets
      `;
      expect(t.ticket_number).toBe("WB-00001");
      expect(t.direction).toBe("inbound");
      expect(t.first).toBe("18500.0000");
      expect(t.second).toBe("6200.0000");
      // Computed by the column, not carried from the source.
      expect(t.net).toBe("12300.0000");
      expect(t.status).toBe("completed");
      expect(t.external_ref).toBe("GATE-001");
    });

    it("quarantines a ticket whose direction contradicts its purpose", async () => {
      await run();
      const [r] = await admin`
        SELECT detail FROM _migration_rejects
         WHERE reason = 'direction_contradicts_transaction_type'
      `;
      expect(r.detail.ticketNumber).toBe("WB-00002");
      expect(r.detail.transactionType).toBe("purchase");
      expect(r.detail.direction).toBe("outbound");
      expect(r.detail.expected).toBe("inbound");
    });

    it("quarantines a ticket completed on one weighing", async () => {
      await run();
      const [r] = await admin`
        SELECT detail FROM _migration_rejects
         WHERE reason = 'completed_without_both_weighings'
      `;
      expect(r.detail.ticketNumber).toBe("WB-00003");
      expect(r.detail.secondWeight).toBeNull();
    });
  });

  describe("stock requests", () => {
    it("reads a creation-default approved quantity as unapproved, not as zero", async () => {
      await run();
      const [item] = await admin`
        SELECT i.approved_quantity, i.requested_quantity::text AS requested,
               i.remaining_to_fulfil::text AS remaining,
               i.fulfilment_status::text AS status, i.sku_at_request,
               r.total_value::text AS total_value
          FROM stock_request_items i
          JOIN stock_requests r ON r.id = i.request_id
         WHERE r.request_number = 'SR-00001'
      `;

      // The source stores 0, which every one of its own readers resolves as
      // `approvedQuantity || requestedQuantity`. Carrying the 0 literally
      // would make the target zero — and then nothing could be issued against
      // this request without tripping the over-fulfilment trigger at step 12.
      expect(item.approved_quantity).toBeNull();
      expect(item.requested).toBe("12.0000");
      expect(item.remaining).toBe("12.0000");
      expect(item.status).toBe("pending");
      // The SKU is normalised the same way the product's own is.
      expect(item.sku_at_request).toBe("WID-1");
      // Derived from the items by trigger, not carried: 12 x 250.
      expect(item.total_value).toBe("3000.0000");
    });

    it("re-derives a stale total value rather than carrying it", async () => {
      await run();
      const [r] = await admin`
        SELECT total_value::text AS total_value, status::text, priority::text,
               customer_id, customer_name_at_request,
               approved_by_name_at_approval, approval_conditions,
               updated_at
          FROM stock_requests WHERE request_number = 'SR-00002'
      `;
      // The source says 399.96 — 4 x 99.99, never recomputed after the
      // approval cut that line to 3. The target computes it from the items,
      // resolving each target the way the source's own readers do:
      // 3 x 99.99 + 2 x 250.
      expect(r.total_value).toBe("799.9700");
      expect(r.status).toBe("approved");
      expect(r.priority).toBe("normal");
      // customer.id is "" for the customerless types, not null.
      expect(r.customer_id).toBeNull();
      expect(r.customer_name_at_request).toBe("Internal Use");
      // The approver is a User, which this migration does not port, so the
      // name snapshot is what carries.
      expect(r.approved_by_name_at_approval).toBe("Ada Manager");
      expect(r.approval_conditions).toBe("Return by month end");
      // Inserting the items fires recalc_request, which stamps updated_at.
      // The source's value is restored over it.
      expect(r.updated_at.toISOString()).toBe("2026-08-12T00:00:00.000Z");
    });

    it("carries the approval history as rows", async () => {
      await run();
      const rows = await admin`
        SELECT a.approver_name_at_action, a.action, a.comments, a.approver_id
          FROM stock_request_approvals a
          JOIN stock_requests r ON r.id = a.request_id
         WHERE r.request_number = 'SR-00002'
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0].approver_name_at_action).toBe("Ada Manager");
      expect(rows[0].action).toBe("approved");
      expect(rows[0].approver_id).toBeNull();
    });

    it("quarantines a customer-facing request whose customer is gone", async () => {
      await run();
      const [r] = await admin`
        SELECT detail FROM _migration_rejects
         WHERE reason = 'customer_not_migrated'
      `;
      expect(r.detail.requestNumber).toBe("SR-00003");
      expect(r.detail.requestType).toBe("demo");
      expect(r.detail.customerName).toBe("Gone Ltd");

      // Not migrated as an internal request, and not migrated without a
      // customer: the target's CHECK requires one for this type, so keeping
      // it would mean reclassifying it.
      const rows = await admin`
        SELECT 1 FROM stock_requests WHERE request_number = 'SR-00003'
      `;
      expect(rows).toHaveLength(0);
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

    it("passes only when the whole source is clean, not just the ledger", async () => {
      // ANY quarantine blocks cutover, not only a ledger variance: a document
      // that did not migrate is missing data, whatever collection it came
      // from. So clearing the drifted entry is not enough — the two malformed
      // weighbridge tickets have to go too.
      const { MongoClient } = await import("mongodb");
      const client = new MongoClient(mongoUri);
      await client.connect();
      await client
        .db()
        .collection("journalentries")
        .deleteOne({ entryNumber: "JE-00003" });
      await client
        .db()
        .collection("weighbridgeTickets")
        .deleteMany({ ticketNumber: { $in: ["WB-00002", "WB-00003"] } });
      await client
        .db()
        .collection("stockrequests")
        .deleteOne({ requestNumber: "SR-00003" });
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
