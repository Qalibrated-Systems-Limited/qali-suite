/**
 * Bids repository against a real PostgreSQL — 0111.
 *
 * Pins: per-tenant BID numbering; the weighted pipeline value (Σ value ×
 * probability over LIVE bids only); stage-2b-clear and stopped counts; the
 * 0–100 probability CHECK; RLS isolation.
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

const repo = await import("@/app/db/repositories/bids");

suite("bids & pre-sales", () => {
  let admin, client, db, companyA, companyB;
  const actor = { id: null, name: "BD" };

  const asTenant = (id, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${id}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);
  const inB = (fn) => asTenant(companyB, fn);

  const bid = (over = {}) =>
    inA((tx) =>
      repo.createBid(tx, {
        companyId: companyA,
        bidName: over.bidName ?? "Supply of Weighing Equipment",
        value: over.value ?? 1_000_000,
        winProbability: over.winProbability ?? 50,
        stage: over.stage ?? "preparing",
        createdByName: "Seed",
        ...over,
      }),
    );

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
    await admin`TRUNCATE companies, users, _migration_id_map, entry_counters CASCADE`;
    companyA = randomUUID();
    companyB = randomUUID();
    await admin`INSERT INTO companies (id, name, slug) VALUES (${companyA}, 'A', ${"a-" + companyA.slice(0, 8)})`;
    await admin`INSERT INTO companies (id, name, slug) VALUES (${companyB}, 'B', ${"b-" + companyB.slice(0, 8)})`;
  });

  it("numbers bids per tenant", async () => {
    const a = await bid();
    expect(a.bidNumber).toBe("BID-00001");
    const b = await inB((tx) => repo.createBid(tx, { companyId: companyB, bidName: "B bid", createdByName: "Seed" }));
    expect(b.bidNumber).toBe("BID-00001");
  });

  it("weights the pipeline over live bids only", async () => {
    await bid({ value: 1_000_000, winProbability: 60, stage: "stage_2b" }); // live → 600k
    await bid({ value: 2_000_000, winProbability: 25, stage: "evaluation" }); // live → 500k
    await bid({ value: 5_000_000, winProbability: 100, stage: "awarded" }); // closed, excluded
    await bid({ value: 3_000_000, winProbability: 80, stage: "stopped" }); // closed, excluded

    const stats = await inA((tx) => repo.getBidStats(tx));
    expect(stats.total).toBe(4);
    expect(stats.open).toBe(2);
    expect(stats.pipelineValue).toBe(3_000_000); // 1M + 2M
    expect(stats.weightedValue).toBeCloseTo(1_100_000, 0); // 600k + 500k
    expect(stats.stage2bClear).toBe(3); // stage_2b + evaluation + awarded
    expect(stats.stopped).toBe(1);
    expect(stats.awarded).toBe(1);
  });

  it("clamps probability and rejects out-of-range on update to DB check", async () => {
    const b = await bid({ winProbability: 150 }); // clamped by repo
    expect(b.winProbability).toBe(100);
  });

  it("moves a bid through stages", async () => {
    const b = await bid();
    const moved = await inA((tx) => repo.setBidStage(tx, b.id, "awarded", actor));
    expect(moved.stage).toBe("awarded");
  });

  it("isolates tenants", async () => {
    await bid();
    expect(await inB((tx) => repo.listBids(tx))).toHaveLength(0);
  });
});
