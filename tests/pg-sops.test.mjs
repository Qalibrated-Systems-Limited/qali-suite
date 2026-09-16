/**
 * SOP Library repository against a real PostgreSQL — 0115.
 *
 * Pins: per-tenant SOP-#### codes; "review due" derived from status +
 * next_review; mark-reviewed stamps last_reviewed, sets next review a year out
 * and approves; RLS isolation.
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

const repo = await import("@/app/db/repositories/sops");
const iso = (ms = 0) => new Date(Date.now() + ms).toISOString().slice(0, 10);
const DAY = 86_400_000;

suite("the SOP library", () => {
  let admin, client, db, companyA, companyB;
  const actor = { id: null, name: "QM" };

  const asTenant = (id, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${id}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);
  const inB = (fn) => asTenant(companyB, fn);

  const sop = (over = {}) =>
    inA((tx) => repo.createSop(tx, { companyId: companyA, title: over.title ?? "Goods Receiving", createdByName: "s", ...over }));

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

  it("numbers SOPs per tenant", async () => {
    const a = await sop();
    expect(a.code).toBe("SOP-00001");
    const b = await inB((tx) => repo.createSop(tx, { companyId: companyB, title: "B", createdByName: "s" }));
    expect(b.code).toBe("SOP-00001");
  });

  it("derives review-due and drafts in the stats", async () => {
    await sop({ status: "approved", nextReview: iso(-1 * DAY) }); // review overdue
    await sop({ status: "approved", nextReview: iso(200 * DAY) }); // fine
    await sop({ status: "draft" });
    const stats = await inA((tx) => repo.getSopStats(tx));
    expect(stats.total).toBe(3);
    expect(stats.approved).toBe(2);
    expect(stats.drafts).toBe(1);
    expect(stats.reviewDue).toBe(1);
  });

  it("mark-reviewed approves, stamps last review and schedules the next", async () => {
    const a = await sop({ status: "in_review", nextReview: iso(-1 * DAY) });
    const r = await inA((tx) => repo.markReviewed(tx, a.id, iso(), null, actor));
    expect(r.status).toBe("approved");
    expect(r.lastReviewed).toBeTruthy();
    expect(new Date(r.nextReview).getTime()).toBeGreaterThan(Date.now());
  });

  it("isolates tenants", async () => {
    await sop();
    expect(await inB((tx) => repo.listSops(tx))).toHaveLength(0);
  });
});
