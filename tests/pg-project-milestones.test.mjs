/**
 * The milestone schedule — 0093.
 *
 * A road contract values by REMEASURING a priced bill (0080). An installation
 * contract has no bill to remeasure: it has stages, each worth an agreed part
 * of the sum, and until this table the only way to certify one was to type the
 * figure and mark the certificate `manual`. `billing_model = 'milestone'` had
 * been declared since 0070 with nothing behind it.
 *
 * What is asserted here is mostly the two rules that make a schedule mean
 * something: it may not come to more than the contract, and a stage is
 * achieved on a DATE — because a certificate values what was achieved by ITS
 * valuation date, and a stage signed off in May must not land on a March
 * certificate.
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
const repo = await import("@/app/db/repositories/projects");

const failsWith = async (fn, pattern) => {
  const err = await fn().then(
    () => {
      throw new Error("expected a rejection");
    },
    (e) => e,
  );
  expect(userMessage(err)).toMatch(pattern);
};

suite("the milestone schedule", () => {
  let admin, client, db;
  let companyA, project, otherProject, contract, otherContract;
  const actor = { id: null, name: "The PM" };

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);

  /** KTDA's shape: 20,000,000, billed by stage. */
  const stage = (over = {}) =>
    inA((tx) =>
      repo.createMilestone(tx, {
        companyId: companyA,
        projectId: over.projectId ?? project,
        contractId: over.contractId ?? contract.id,
        name: over.name ?? "Equipment delivered to site",
        value: over.value ?? 6000000,
        sequence: over.sequence ?? 1,
        dueDate: over.dueDate ?? null,
        retentionReleasePercent: over.retentionReleasePercent ?? null,
        createdByName: "Seed",
      }),
    );

  const achieve = (id, on) =>
    inA((tx) => repo.setMilestoneStatus(tx, id, "achieved", actor, on));

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

    project = (
      await inA((tx) =>
        repo.createProject(tx, {
          companyId: companyA,
          name: "KTDA Unmanned Weighbridge",
          createdByName: "Seed",
        }),
      )
    ).id;
    otherProject = (
      await inA((tx) =>
        repo.createProject(tx, {
          companyId: companyA,
          name: "Otho Road",
          createdByName: "Seed",
        }),
      )
    ).id;

    contract = await inA((tx) =>
      repo.createContract(tx, {
        companyId: companyA,
        projectId: project,
        contractSum: "20000000",
        retentionPercent: "10",
        advanceAmount: "0",
        advanceRecoveryPercent: "0",
        createdByName: "Seed",
      }),
    );
    otherContract = await inA((tx) =>
      repo.createContract(tx, {
        companyId: companyA,
        projectId: otherProject,
        contractSum: "5000000",
        createdByName: "Seed",
      }),
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the schedule against the contract", () => {
    it("lets a schedule fall short while it is being built", async () => {
      // The first stage entered is never the whole contract. Refusing this
      // would make the table unusable.
      await stage({ name: "Design approved", value: 4000000 });
      const s = await inA((tx) => repo.getMilestoneSummary(tx, project));
      expect(s.total).toBe(4000000);
      expect(s.unallocated).toBe(16000000);
    });

    it("refuses a schedule that comes to more than the contract", async () => {
      // Stages worth more than the job would certify more than it is worth.
      await stage({ name: "Design approved", value: 4000000 });
      await stage({ name: "Delivered", value: 6000000, sequence: 2 });
      await stage({ name: "Commissioned", value: 8000000, sequence: 3 });
      await stage({ name: "Accepted", value: 2000000, sequence: 4 });

      await failsWith(
        () => stage({ name: "One too many", value: 1, sequence: 5 }),
        /cannot exceed the contract/i,
      );
    });

    it("names both numbers when it refuses", async () => {
      await stage({ value: 19000000 });
      await failsWith(
        () => stage({ name: "Over", value: 2000000, sequence: 2 }),
        /21,000,000.*20,000,000/,
      );
    });

    it("gives a cancelled stage's value back to the schedule", async () => {
      const dropped = await stage({ name: "Dropped", value: 20000000 });
      await inA((tx) => repo.setMilestoneStatus(tx, dropped.id, "cancelled", actor));
      // The whole contract is available again.
      const replacement = await stage({ name: "Replacement", value: 20000000, sequence: 2 });
      expect(replacement.id).toBeTruthy();
    });

    it("refuses a stage against another project's contract", async () => {
      await failsWith(
        () => stage({ contractId: otherContract.id }),
        /different project/i,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("achieving is a date", () => {
    it("will not achieve a stage without one", async () => {
      const m = await stage();
      await failsWith(
        () => inA((tx) => repo.setMilestoneStatus(tx, m.id, "achieved", actor)),
        /achieved on a DATE/i,
      );
    });

    it("values only what was achieved by the valuation date", async () => {
      // The whole reason the date is not a boolean: a stage signed off in May
      // must not appear on a March certificate.
      const march = await stage({ name: "Design approved", value: 4000000 });
      const may = await stage({ name: "Delivered", value: 6000000, sequence: 2 });
      await achieve(march.id, "2026-03-20");
      await achieve(may.id, "2026-05-14");

      const atMarch = await inA((tx) =>
        repo.getMilestoneValueToDate(tx, project, "2026-03-31"),
      );
      const atMay = await inA((tx) =>
        repo.getMilestoneValueToDate(tx, project, "2026-05-31"),
      );

      expect(atMarch.value).toBe(4000000);
      expect(atMarch.stages).toBe(1);
      expect(atMay.value).toBe(10000000);
      expect(atMay.stages).toBe(2);
    });

    it("clears the date when the achievement is taken back", async () => {
      const m = await stage();
      await achieve(m.id, "2026-05-14");
      const back = await inA((tx) =>
        repo.setMilestoneStatus(tx, m.id, "pending", actor),
      );
      expect(back.achievedOn).toBeNull();
      expect(back.achievedByName).toBeNull();
    });

    it("reads nothing at all before the first stage is achieved", async () => {
      await stage();
      expect(await inA((tx) => repo.getMilestoneValueToDate(tx, project))).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the retention release schedule", () => {
    it("carries the percentage each stage releases", async () => {
      const commissioned = await stage({
        name: "Commissioned",
        value: 8000000,
        retentionReleasePercent: 50,
      });
      const accepted = await stage({
        name: "Final acceptance",
        value: 2000000,
        sequence: 2,
        retentionReleasePercent: 50,
      });

      await achieve(commissioned.id, "2026-08-01");
      let at = await inA((tx) => repo.getMilestoneValueToDate(tx, project, "2026-08-31"));
      expect(at.releasePercent).toBe(50);

      await achieve(accepted.id, "2027-02-01");
      at = await inA((tx) => repo.getMilestoneValueToDate(tx, project, "2027-02-28"));
      expect(at.releasePercent).toBe(100);
    });

    it("refuses a schedule releasing more retention than is held", async () => {
      await stage({ name: "A", value: 5000000, retentionReleasePercent: 60 });
      await failsWith(
        () =>
          stage({ name: "B", value: 5000000, sequence: 2, retentionReleasePercent: 60 }),
        /more than is held/i,
      );
    });

    it("refuses a percentage outside 0 and 100", async () => {
      await failsWith(
        () => stage({ retentionReleasePercent: 140 }),
        /release_in_range|not allowed/i,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("what it refuses to change", () => {
    it("will not amend an achieved stage", async () => {
      const m = await stage();
      await achieve(m.id, "2026-05-14");
      // Its value is in a certificate's valuation and in every net since.
      expect(await inA((tx) => repo.updateMilestone(tx, m.id, { value: 9000000 }))).toBeNull();
    });

    it("will not delete an achieved stage", async () => {
      const m = await stage();
      await achieve(m.id, "2026-05-14");
      expect(await inA((tx) => repo.deleteMilestone(tx, m.id))).toBeNull();
    });

    it("refuses a stage with no name", async () => {
      await failsWith(() => stage({ name: "   " }), /needs a name|not allowed/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the summary", () => {
    it("separates achieved from still to come", async () => {
      const one = await stage({ name: "Design approved", value: 4000000 });
      await stage({ name: "Delivered", value: 6000000, sequence: 2 });
      await stage({ name: "Commissioned", value: 8000000, sequence: 3 });
      await achieve(one.id, "2026-03-20");

      const s = await inA((tx) => repo.getMilestoneSummary(tx, project));
      expect(s).toMatchObject({
        achieved: 4000000,
        pending: 14000000,
        total: 18000000,
        unallocated: 2000000,
        count: 3,
        achievedCount: 1,
      });
    });
  });
});
