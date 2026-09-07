/**
 * The variation register, and a contract sum that can finally move — 0091.
 *
 * `project_contracts.contract_sum` was typed once with nothing that could ever
 * change it, so from the FIRST variation the sum was wrong and "% of contract
 * certified" — the figure on the page in front of whoever certifies — was
 * wrong with it.
 *
 * What is asserted here is mostly that the originals never move and the
 * current figures are never typed: `contract_sum = original_sum + Σ approved`
 * and `completion_date = original_completion_date + Σ approved days`, both by
 * trigger, so the two cannot disagree however they are written to.
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

suite("variations move the contract", () => {
  let admin, client, db;
  let companyA, project, otherProject, contract, otherContract;
  const actor = { id: null, name: "The QS" };

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);

  const contractRow = (id = contract.id) =>
    inA(async (tx) => {
      const [row] = await tx.execute(sql`
        SELECT original_sum::float8      AS original_sum,
               contract_sum::float8      AS contract_sum,
               original_completion_date  AS original_completion,
               completion_date           AS completion
          FROM project_contracts WHERE id = ${id}::uuid`);
      return row;
    });

  const raise = (over = {}) =>
    inA((tx) =>
      repo.createVariation(tx, {
        companyId: companyA,
        projectId: over.projectId ?? project,
        contractId: over.contractId ?? contract.id,
        title: over.title ?? "Additional culverts at ch. 4+200",
        costEffect: over.costEffect ?? 500000,
        timeEffectDays: over.timeEffectDays ?? 0,
        issuedDate: over.issuedDate ?? "2026-06-01",
        instructionId: over.instructionId ?? null,
        createdByName: "Seed",
      }),
    );

  const approve = (id) =>
    inA((tx) => repo.setVariationStatus(tx, id, "approved", actor));
  const submit = (id) =>
    inA((tx) => repo.setVariationStatus(tx, id, "submitted", actor));

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
          name: "Otho Road",
          createdByName: "Seed",
        }),
      )
    ).id;
    otherProject = (
      await inA((tx) =>
        repo.createProject(tx, {
          companyId: companyA,
          name: "Bridge",
          createdByName: "Seed",
        }),
      )
    ).id;

    contract = await inA((tx) =>
      repo.createContract(tx, {
        companyId: companyA,
        projectId: project,
        reference: "RWC 772",
        title: "Otho–Got Kachola Road",
        contractSum: "10000000.0000",
        retentionPercent: "10",
        completionDate: "2027-03-31",
        createdByName: "Seed",
      }),
    );
    // 0091 derives `completion_date` from the original, and `createContract`
    // predates the column, so set the original the way the migration does.
    await inA((tx) =>
      tx.execute(sql`
        UPDATE project_contracts SET original_completion_date = completion_date
         WHERE id = ${contract.id}::uuid`),
    );

    otherContract = await inA((tx) =>
      repo.createContract(tx, {
        companyId: companyA,
        projectId: otherProject,
        contractSum: "5000000.0000",
        createdByName: "Seed",
      }),
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("what moves the sum", () => {
    it("leaves the contract alone until a variation is approved", async () => {
      const v = await raise({ costEffect: 500000 });
      let row = await contractRow();
      expect(row.contract_sum).toBe(10000000);

      // Submitted is a CLAIM, not a change. The register shows it; the
      // contract does not move.
      await submit(v.id);
      row = await contractRow();
      expect(row.contract_sum).toBe(10000000);

      await approve(v.id);
      row = await contractRow();
      expect(row.contract_sum).toBe(10500000);
    });

    it("keeps the original sum untouched, whatever happens", async () => {
      const v = await raise({ costEffect: 500000 });
      await approve(v.id);
      const row = await contractRow();
      expect(row.original_sum).toBe(10000000);
      expect(row.contract_sum).toBe(10500000);
    });

    it("adds up several approved variations", async () => {
      const a = await raise({ costEffect: 500000, issuedDate: "2026-06-01" });
      const b = await raise({ costEffect: 250000, issuedDate: "2026-07-01" });
      const c = await raise({ costEffect: 125000, issuedDate: "2026-08-01" });
      await approve(a.id);
      await approve(b.id);
      await approve(c.id);
      expect((await contractRow()).contract_sum).toBe(10875000);
    });

    it("lets an omission reduce the sum", async () => {
      // A negative variation is an ordinary one. Refusing it would mean a
      // contract can only ever grow, which is not how a final account works.
      const v = await raise({ costEffect: -750000 });
      await approve(v.id);
      expect((await contractRow()).contract_sum).toBe(9250000);
    });

    it("takes the money back when an approved variation is rejected", async () => {
      const v = await raise({ costEffect: 500000 });
      await approve(v.id);
      expect((await contractRow()).contract_sum).toBe(10500000);

      await inA((tx) => repo.setVariationStatus(tx, v.id, "rejected", actor));
      expect((await contractRow()).contract_sum).toBe(10000000);
    });

    it("takes the money back when one is deleted", async () => {
      const v = await raise({ costEffect: 500000 });
      await approve(v.id);
      await inA((tx) => repo.setVariationStatus(tx, v.id, "rejected", actor));
      await inA((tx) => repo.deleteVariation(tx, v.id));
      expect((await contractRow()).contract_sum).toBe(10000000);
    });

    it("recomputes rather than accumulates when a figure is corrected", async () => {
      // The sum is DERIVED, so amending a variation restates the contract
      // instead of adding the difference to it — which is the failure mode of
      // every hand-maintained running total.
      const v = await raise({ costEffect: 500000 });
      await approve(v.id);

      await inA((tx) =>
        tx.execute(sql`
          UPDATE project_variations SET cost_effect = 800000 WHERE id = ${v.id}::uuid`),
      );
      expect((await contractRow()).contract_sum).toBe(10800000);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("what moves the date", () => {
    it("extends the completion date by the approved days", async () => {
      const v = await raise({ costEffect: 0, timeEffectDays: 28 });
      await approve(v.id);
      const row = await contractRow();
      expect(String(row.completion)).toContain("2027-04-28");
      // And the original is what every delay claim starts from.
      expect(String(row.original_completion)).toContain("2027-03-31");
    });

    it("accepts a variation that moves only the time", async () => {
      // An instruction that adds four weeks and no money is the commonest
      // kind there is.
      const v = await raise({ costEffect: 0, timeEffectDays: 14 });
      await approve(v.id);
      expect((await contractRow()).contract_sum).toBe(10000000);
    });

    it("lets an acceleration pull the date back", async () => {
      const v = await raise({ costEffect: 200000, timeEffectDays: -10 });
      await approve(v.id);
      expect(String((await contractRow()).completion)).toContain("2027-03-21");
    });

    it("does not invent a completion date the contract never had", async () => {
      const v = await raise({
        projectId: otherProject,
        contractId: otherContract.id,
        costEffect: 0,
        timeEffectDays: 30,
      });
      await approve(v.id);
      const row = await contractRow(otherContract.id);
      expect(row.completion).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("what it refuses", () => {
    it("refuses a variation that changes neither money nor time", async () => {
      await failsWith(
        () => raise({ costEffect: 0, timeEffectDays: 0 }),
        /changes the money|has_an_effect|not allowed/i,
      );
    });

    it("refuses a variation against another project's contract", async () => {
      await failsWith(
        () => raise({ contractId: otherContract.id }),
        /different project/i,
      );
    });

    it("will not amend an approved variation", async () => {
      const v = await raise({ costEffect: 500000 });
      await approve(v.id);
      const row = await inA((tx) =>
        repo.updateVariation(tx, v.id, { costEffect: 900000 }),
      );
      // Its figures are in the contract sum and in every certificate since.
      expect(row).toBeNull();
      expect((await contractRow()).contract_sum).toBe(10500000);
    });

    it("will not delete an approved variation", async () => {
      const v = await raise({ costEffect: 500000 });
      await approve(v.id);
      expect(await inA((tx) => repo.deleteVariation(tx, v.id))).toBeNull();
    });

    it("clears the decision when one is sent back to draft", async () => {
      const v = await raise({ costEffect: 500000 });
      await approve(v.id);
      const back = await inA((tx) =>
        repo.setVariationStatus(tx, v.id, "draft", actor),
      );
      expect(back.decidedAt).toBeNull();
      expect(back.decidedByName).toBeNull();
      expect((await contractRow()).contract_sum).toBe(10000000);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the register", () => {
    it("separates what is agreed from what is only claimed", async () => {
      const agreed = await raise({ costEffect: 500000, timeEffectDays: 14 });
      await approve(agreed.id);
      const claimed = await raise({ costEffect: 300000, timeEffectDays: 7 });
      await submit(claimed.id);
      await raise({ costEffect: 999999 }); // a draft, and nobody's business yet

      const s = await inA((tx) => repo.getVariationSummary(tx, project));
      expect(s).toMatchObject({
        approvedCost: 500000,
        approvedDays: 14,
        pendingCost: 300000,
        pendingDays: 7,
        approvedCount: 1,
        pendingCount: 1,
      });
    });

    it("numbers each variation once", async () => {
      const a = await raise({ issuedDate: "2026-06-01" });
      const b = await raise({ issuedDate: "2026-07-01" });
      expect(a.variationNumber).toMatch(/^VO-\d{5}$/);
      expect(b.variationNumber).not.toBe(a.variationNumber);
    });

    it("lists a project's variations, newest first", async () => {
      await raise({ issuedDate: "2026-06-01", title: "Older" });
      await raise({ issuedDate: "2026-09-01", title: "Newer" });
      const rows = await inA((tx) => repo.listVariations(tx, project));
      expect(rows.map((r) => r.title)).toEqual(["Newer", "Older"]);
    });
  });
});
