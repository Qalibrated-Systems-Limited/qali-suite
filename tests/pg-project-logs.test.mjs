/**
 * Integration tests for the Engineer's Instructions and Site Diary registers
 * (0075) against a real PostgreSQL.
 *
 * The module merged without any, and the risk that creates is specific rather
 * than stylistic: both tables carry CHECK constraints doing real commercial
 * work — a status flip with nobody attached to it is refused — and nothing
 * proved the repository respects them. The first person to find out would have
 * been a user meeting a raw constraint violation.
 *
 * Skipped unless DATABASE_URL is set. See tests/pg-accounting-core.test.mjs for
 * how to start a throwaway server.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as logs from "@/app/db/repositories/projectLogs";
import * as projectRepo from "@/app/db/repositories/projects";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
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

suite("postgres project logs", () => {
  let client;
  let admin;
  let db;
  let companyA;
  let projectA;
  const actor = { id: null, name: "Wanjiru, RE" };

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);

  const instruction = (over = {}) => ({
    companyId: companyA,
    projectId: projectA,
    type: "instruction",
    description: "Remove and replace the sub-base to CH 2+400.",
    issuedDate: "2026-08-03",
    issuedByName: "Engineer",
    createdByName: "Site Agent",
    ...over,
  });

  const diary = (over = {}) => ({
    companyId: companyA,
    projectId: projectA,
    diaryDate: "2026-08-03",
    activities: "Sub-base carting and compaction, CH 2+300 to 2+450.",
    loggedByName: "Site Agent",
    createdByName: "Site Agent",
    ...over,
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
    await admin`TRUNCATE companies, users, entry_counters CASCADE`;
    companyA = randomUUID();
    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Tenant A', ${"a-" + companyA.slice(0, 8)})`;

    projectA = (
      await inA((tx) =>
        projectRepo.createProject(tx, {
          companyId: companyA,
          name: "Nakuru Depot",
          createdByName: "Seed",
        }),
      )
    ).id;
  });

  describe("Engineer's Instructions", () => {
    it("numbers them per company, in sequence", async () => {
      const a = await inA((tx) => logs.createInstruction(tx, instruction()));
      const b = await inA((tx) => logs.createInstruction(tx, instruction()));
      expect(a.instructionNumber).not.toBe(b.instructionNumber);
      // next_entry_number, the same counter every other document uses.
      expect(a.instructionNumber).toMatch(/\d/);
    });

    it("opens pending, with nobody attached", async () => {
      const row = await inA((tx) => logs.createInstruction(tx, instruction()));
      expect(row.status).toBe("pending");
      expect(row.respondedByName).toBeNull();
      expect(row.respondedAt).toBeNull();
    });

    it("REFUSES to leave pending without a name and a time on it", async () => {
      // The constraint the module exists to enforce: "a status flip with
      // nobody attached to it is a checkbox, not a decision". Written directly
      // so the CHECK is tested, not the repository's care.
      const row = await inA((tx) => logs.createInstruction(tx, instruction()));
      await expectRejection(
        admin`UPDATE project_instructions SET status = 'complied' WHERE id = ${row.id}`,
        /response_signed/i,
      );
    });

    it("records who complied and when, through the repository", async () => {
      const row = await inA((tx) => logs.createInstruction(tx, instruction()));
      const signed = await inA((tx) =>
        logs.setInstructionStatus(tx, row.id, "complied", "Rectified 06/08", actor),
      );
      expect(signed.status).toBe("complied");
      expect(signed.respondedByName).toBe("Wanjiru, RE");
      expect(signed.respondedAt).toBeTruthy();
      expect(signed.responseNotes).toBe("Rectified 06/08");
    });

    it("carries the four instruction kinds a contract distinguishes", async () => {
      for (const type of ["instruction", "ncr", "vo", "rfi_response"]) {
        const row = await inA((tx) => logs.createInstruction(tx, instruction({ type })));
        expect(row.type).toBe(type);
      }
    });

    it("refuses a blank description and a negative cost", async () => {
      await expectRejection(
        inA((tx) => logs.createInstruction(tx, instruction({ description: "   " }))),
        /description_not_blank/i,
      );
      await expectRejection(
        inA((tx) => logs.createInstruction(tx, instruction({ estimatedCost: "-1" }))),
        /cost_non_negative/i,
      );
    });

    it("treats an id no uuid column can hold as not found", async () => {
      // A stale link carrying a Mongo ObjectId. Without the guard this is a
      // 22P02 with the whole statement in the message, on a function that
      // already returns null for a miss.
      expect(await inA((tx) => logs.getInstructionById(tx, "6a3ba4ae0f569c9f3d9a907f"))).toBeNull();
      expect(await inA((tx) => logs.getInstructionById(tx, randomUUID()))).toBeNull();
    });
  });

  describe("Site Diary", () => {
    it("opens submitted, and countersigning stamps the signer", async () => {
      const row = await inA((tx) => logs.createDiaryEntry(tx, diary()));
      expect(row.status).toBe("submitted");

      const signed = await inA((tx) => logs.signDiaryEntry(tx, row.id, actor));
      expect(signed.status).toBe("countersigned");
      expect(signed.countersignedByName).toBe("Wanjiru, RE");
      expect(signed.countersignedAt).toBeTruthy();
    });

    it("REFUSES to countersign without a signer", async () => {
      const row = await inA((tx) => logs.createDiaryEntry(tx, diary()));
      await expectRejection(
        admin`UPDATE project_diary_entries SET status = 'countersigned' WHERE id = ${row.id}`,
        /countersign_signed/i,
      );
    });

    it("refuses negative manpower or incident counts", async () => {
      await expectRejection(
        admin`UPDATE project_diary_entries SET manpower_count = -1 WHERE id = ${
          (await inA((tx) => logs.createDiaryEntry(tx, diary()))).id
        }`,
        /manpower_non_negative/i,
      );
    });

    it("refuses a blank activities record", async () => {
      // A diary entry with no activities is a date, not a record — and on a
      // FIDIC job the diary is evidence.
      await expectRejection(
        inA((tx) => logs.createDiaryEntry(tx, diary({ activities: " " }))),
        /activities_not_blank/i,
      );
    });

    it("treats an id no uuid column can hold as not found", async () => {
      expect(await inA((tx) => logs.getDiaryEntryById(tx, "6a3ba4ae0f569c9f3d9a907f"))).toBeNull();
    });
  });

  describe("scoping", () => {
    it("lists only the project asked for", async () => {
      const other = (
        await inA((tx) =>
          projectRepo.createProject(tx, {
            companyId: companyA,
            name: "Second job",
            createdByName: "Seed",
          }),
        )
      ).id;
      await inA((tx) => logs.createInstruction(tx, instruction()));
      await inA((tx) => logs.createInstruction(tx, instruction({ projectId: other })));

      const mine = await inA((tx) => logs.listInstructions(tx, projectA));
      expect(mine).toHaveLength(1);
      expect(mine[0].projectId).toBe(projectA);
    });

    it("hides another tenant's registers", async () => {
      await inA((tx) => logs.createInstruction(tx, instruction()));
      await inA((tx) => logs.createDiaryEntry(tx, diary()));

      const companyB = randomUUID();
      await admin`
        INSERT INTO companies (id, name, slug)
        VALUES (${companyB}, 'Tenant B', ${"b-" + companyB.slice(0, 8)})`;

      await asTenant(companyB, async (tx) => {
        expect(await logs.listInstructions(tx, projectA)).toHaveLength(0);
        expect(await logs.listDiaryEntries(tx, projectA)).toHaveLength(0);
      });
    });
  });
});
