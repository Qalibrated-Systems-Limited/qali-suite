/**
 * The funnel before the quote — 0096.
 *
 * `docs/CURRENT-STATE.md` called this a whole missing module: "First touch is
 * the Quote — nothing tracks the funnel before that."
 *
 * Two things here are not transcriptions of the Mongo behaviour, and both are
 * asserted as such: the probability that used to freeze at whatever stage a
 * deal was created in, and a stage trail the database writes so no path can
 * leave it short.
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
vi.mock("@/lib/utils/tenant-utils", () => ({ getTenantContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { userMessage } = await import("@/app/db/errors");
const crm = await import("@/app/db/repositories/crm");
const partiesRepo = await import("@/app/db/repositories/parties");

const failsWith = async (fn, pattern) => {
  const err = await fn().then(
    () => {
      throw new Error("expected a rejection");
    },
    (e) => e,
  );
  expect(userMessage(err)).toMatch(pattern);
};

suite("the funnel before the quote", () => {
  let admin, client, db;
  let companyA, customer;
  const actor = { id: null, name: "The Rep" };

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);

  const lead = (over = {}) =>
    inA((tx) =>
      crm.createLead(tx, {
        companyId: companyA,
        name: over.name ?? "Jane Otieno",
        companyName: "companyName" in over ? over.companyName : "Cabro City Ltd",
        email: over.email ?? "jane@cabro.test",
        source: over.source ?? "referral",
        estimatedValue: over.estimatedValue ?? 250000,
        createdByName: "Seed",
        ...(over.status ? {} : {}),
      }),
    );

  const deal = (over = {}) =>
    inA((tx) =>
      crm.createOpportunity(tx, {
        companyId: companyA,
        name: over.name ?? "Weighbridge installation",
        accountPartyId: over.accountPartyId ?? customer,
        accountName: over.accountName ?? "Cabro City Ltd",
        amount: over.amount ?? 1000000,
        stage: over.stage ?? "qualification",
        probability: "probability" in over ? over.probability : null,
        createdByName: "Seed",
      }),
    );

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    client = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, {
      max: 1,
      onnotice: () => {},
    });
    db = drizzle(client);
  });
  afterAll(async () => {
    if (client) await client.end();
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, users, _migration_id_map, entry_counters CASCADE`;
    companyA = randomUUID();
    await admin`INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)})`;

    customer = (
      await inA((tx) =>
        partiesRepo.createParty(tx, {
          companyId: companyA,
          name: "Cabro City Ltd",
          primaryType: "customer",
        }),
      )
    ).id;
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("probability follows the stage — the bug Mongo froze", () => {
    it("reports the stage default when nobody overrode it", async () => {
      const d = await deal({ stage: "qualification" });
      const read = await inA((tx) => crm.getOpportunity(tx, d.id));
      expect(read.probability).toBe(10);
      expect(read.weightedAmount).toBe(100000);
    });

    it("MOVES with the stage, which the Mongo pre-save hook did not", async () => {
      // Mongo seeded probability once and only when null, so a deal created at
      // qualification and advanced to negotiation still forecast at 10% — and
      // every weighted figure on the board was wrong for it.
      const d = await deal({ stage: "qualification" });
      await inA((tx) =>
        crm.setOpportunityStage(tx, d.id, "negotiation", actor),
      );

      const read = await inA((tx) => crm.getOpportunity(tx, d.id));
      expect(read.probability).toBe(75);
      expect(read.weightedAmount).toBe(750000);
    });

    it("lets an explicit override stick through a stage change", async () => {
      const d = await deal({ stage: "qualification", probability: 40 });
      await inA((tx) => crm.setOpportunityStage(tx, d.id, "proposal", actor));
      const read = await inA((tx) => crm.getOpportunity(tx, d.id));
      expect(read.probability).toBe(40);
    });

    it("refuses a probability outside 0 and 100", async () => {
      await failsWith(
        () => deal({ probability: 140 }),
        /probability_in_range|not allowed/i,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the stage trail is the database's", () => {
    it("records the opening stage on create", async () => {
      const d = await deal({ stage: "qualification" });
      const read = await inA((tx) => crm.getOpportunity(tx, d.id));
      expect(read.stageHistory).toHaveLength(1);
      expect(read.stageHistory[0].stage).toBe("qualification");
    });

    it("appends every transition, in order", async () => {
      const d = await deal();
      await inA((tx) => crm.setOpportunityStage(tx, d.id, "needs_analysis", actor));
      await inA((tx) => crm.setOpportunityStage(tx, d.id, "proposal", actor));

      const read = await inA((tx) => crm.getOpportunity(tx, d.id));
      expect(read.stageHistory.map((h) => h.stage)).toEqual([
        "qualification",
        "needs_analysis",
        "proposal",
      ]);
    });

    it("records nothing when the stage does not change", async () => {
      // The trigger fires on UPDATE OF stage, and a no-op update is not a
      // transition — velocity would be nonsense if it were.
      const d = await deal();
      await inA((tx) => crm.updateOpportunity(tx, d.id, { amount: 2000000 }));
      const read = await inA((tx) => crm.getOpportunity(tx, d.id));
      expect(read.stageHistory).toHaveLength(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("closing a deal", () => {
    it("keeps a lost reason only on a lost deal", async () => {
      // Mongo left both free, so a deal could carry a lost reason into
      // negotiation.
      const d = await deal();
      await failsWith(
        () =>
          inA((tx) =>
            tx.execute(sql`
              UPDATE opportunities SET lost_reason = 'price' WHERE id = ${d.id}::uuid`),
          ),
        /lost_reason_is_lost|not allowed/i,
      );
    });

    it("clears the loss when a deal is reopened", async () => {
      const d = await deal();
      await inA((tx) =>
        crm.setOpportunityStage(tx, d.id, "closed_lost", actor, {
          lostReason: "price",
          lostNote: "Undercut by 12%",
        }),
      );
      let read = await inA((tx) => crm.getOpportunity(tx, d.id));
      expect(read.lostReason).toBe("price");

      await inA((tx) => crm.setOpportunityStage(tx, d.id, "negotiation", actor));
      read = await inA((tx) => crm.getOpportunity(tx, d.id));
      expect(read.lostReason).toBe("");
      expect(read.probability).toBe(75);
    });

    it("drops a closed deal off the pipeline board", async () => {
      const open = await deal({ name: "Still open" });
      const won = await deal({ name: "Won" });
      await inA((tx) => crm.setOpportunityStage(tx, won.id, "closed_won", actor));

      const board = await inA((tx) => crm.getPipeline(tx));
      const names = board.columns.flatMap((c) => c.deals.map((d) => d.name));
      expect(names).toContain("Still open");
      expect(names).not.toContain("Won");
      expect(board.totals.count).toBe(1);
      expect(open.id).toBeTruthy();
    });

    it("gives every open stage a column, even an empty one", async () => {
      // Otherwise the board silently loses a stage the moment it empties.
      const board = await inA((tx) => crm.getPipeline(tx));
      expect(board.columns.map((c) => c.stage)).toEqual([
        "qualification",
        "needs_analysis",
        "proposal",
        "negotiation",
      ]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("a lead is not a party until it converts", () => {
    it("counts open leads without the ones that left the funnel", async () => {
      await lead({ name: "A" });
      const b = await lead({ name: "B" });
      await inA((tx) => crm.setLeadStatus(tx, b.id, "unqualified", actor, "No budget"));

      const stats = await inA((tx) => crm.getLeadStats(tx));
      expect(stats.total).toBe(2);
      expect(stats.open).toBe(1);
    });

    it("refuses a lead marked converted with nothing to show for it", async () => {
      // `leads_conversion_pair` and `leads_conversion_made_a_party` together:
      // converted needs a date AND the party the conversion created.
      const l = await lead();
      await failsWith(
        () =>
          inA((tx) =>
            tx.execute(sql`
              UPDATE leads SET status = 'converted' WHERE id = ${l.id}::uuid`),
          ),
        /conversion_pair|not allowed/i,
      );
    });

    it("stamps party, opportunity and date together", async () => {
      const l = await lead();
      const d = await deal();
      const stamped = await inA((tx) =>
        crm.stampLeadConverted(tx, l.id, customer, d.id, actor),
      );
      expect(stamped.status).toBe("converted");
      expect(stamped.convertedAt).not.toBeNull();

      const read = await inA((tx) => crm.getLead(tx, l.id));
      expect(read.convertedTo.partyId).toBe(customer);
      expect(read.convertedTo.opportunityId).toBe(d.id);
    });

    it("carries the lead's provenance onto the deal", async () => {
      const l = await lead();
      const d = await inA((tx) =>
        crm.createOpportunity(tx, {
          companyId: companyA,
          name: "From a lead",
          accountPartyId: customer,
          accountName: "Cabro City Ltd",
          leadId: l.id,
          leadNumber: l.leadNumber,
          createdByName: "Seed",
        }),
      );
      const read = await inA((tx) => crm.getOpportunity(tx, d.id));
      expect(read.leadRef).toMatchObject({ leadId: l.id, leadNumber: l.leadNumber });
    });

    it("numbers leads and deals on their own counters", async () => {
      const l = await lead();
      const d = await deal();
      expect(l.leadNumber).toMatch(/^LEAD-\d{5}$/);
      expect(d.opportunityNumber).toMatch(/^OPP-\d{5}$/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the activity trail", () => {
    it("reads back newest first, for one target", async () => {
      const l = await lead();
      const other = await lead({ name: "Someone else" });
      await inA((tx) =>
        crm.logActivity(tx, {
          companyId: companyA, type: "call", targetType: "lead",
          targetId: l.id, subject: "Called", byName: "The Rep",
        }),
      );
      await inA((tx) =>
        crm.logActivity(tx, {
          companyId: companyA, type: "note", targetType: "lead",
          targetId: other.id, subject: "Not this one", byName: "The Rep",
        }),
      );

      const trail = await inA((tx) => crm.listActivities(tx, "lead", l.id));
      expect(trail).toHaveLength(1);
      expect(trail[0].subject).toBe("Called");
    });

    it("tolerates a target that no longer exists", async () => {
      // Six target types make a foreign key impossible, so this is the
      // documented cost of that and readers must survive it.
      const l = await lead();
      await inA((tx) =>
        crm.logActivity(tx, {
          companyId: companyA, type: "note", targetType: "lead",
          targetId: l.id, body: "Left a note", byName: "The Rep",
        }),
      );
      await inA((tx) => crm.deleteLead(tx, l.id));

      const trail = await inA((tx) => crm.listActivities(tx, "lead", l.id));
      expect(trail).toHaveLength(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the executive overview's one CRM read", () => {
    it("totals open pipeline and ignores closed deals", async () => {
      await deal({ amount: 1000000 });
      const won = await deal({ amount: 500000 });
      await inA((tx) => crm.setOpportunityStage(tx, won.id, "closed_won", actor));

      const total = await inA((tx) => crm.getPipelineTotal(tx));
      expect(total).toMatchObject({ total: 1000000, count: 1 });
    });
  });
});
