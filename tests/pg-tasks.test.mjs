/**
 * Tasks repository against a real PostgreSQL — 0109.
 *
 * Pins the behaviour the dummy page only pretended to have: a task is numbered
 * from TSK, "overdue" and "critical" are derived from status + due date rather
 * than stored, completing a task stamps completed_at (and reopening clears it),
 * and one tenant never sees another's tasks.
 *
 * Skipped unless DATABASE_URL is set. See tests/pg-accounting-core.test.mjs for
 * how to start a throwaway server.
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

const repo = await import("@/app/db/repositories/tasks");

const DAY = 86_400_000;
const iso = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 10);

suite("the task spine", () => {
  let admin, client, db;
  let companyA, companyB;
  const actor = { id: null, name: "The Lead" };

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);
  const inB = (fn) => asTenant(companyB, fn);

  const make = (over = {}) =>
    inA((tx) =>
      repo.createTask(tx, {
        companyId: companyA,
        title: over.title ?? "Reconcile the bank feed",
        department: over.department ?? "Finance",
        priority: over.priority ?? "medium",
        dueDate: over.dueDate ?? iso(3 * DAY),
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

  it("numbers tasks per tenant and defaults to open", async () => {
    const a = await make();
    expect(a.taskNumber).toBe("TSK-00001");
    expect(a.status).toBe("open");
    const b = await inB((tx) =>
      repo.createTask(tx, { companyId: companyB, title: "B task", createdByName: "Seed" }),
    );
    expect(b.taskNumber).toBe("TSK-00001");
  });

  it("derives overdue and critical in the stats", async () => {
    await make({ dueDate: iso(-2 * DAY) }); // overdue, medium
    await make({ priority: "critical", dueDate: iso(5 * DAY) }); // critical, not overdue
    const done = await make();
    await inA((tx) => repo.setTaskStatus(tx, done.id, "completed", actor));

    const stats = await inA((tx) => repo.getTaskStats(tx));
    expect(stats.total).toBe(3);
    expect(stats.overdue).toBe(1);
    expect(stats.critical).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.open).toBe(2);
  });

  it("stamps completed_at on completion and clears it on reopen", async () => {
    const t = await make();
    const done = await inA((tx) => repo.setTaskStatus(tx, t.id, "completed", actor));
    expect(done.completedAt).not.toBeNull();
    const reopened = await inA((tx) => repo.setTaskStatus(tx, t.id, "open", actor));
    expect(reopened.completedAt).toBeNull();
  });

  it("updates fields and reassigns", async () => {
    const t = await make();
    const upd = await inA((tx) =>
      repo.updateTask(tx, t.id, { priority: "high", assigneeName: "A. Mwangi", department: "Accounts" }, actor),
    );
    expect(upd.priority).toBe("high");
    expect(upd.assigneeName).toBe("A. Mwangi");
    expect(upd.department).toBe("Accounts");
  });

  it("isolates tenants", async () => {
    await make();
    const bList = await inB((tx) => repo.listTasks(tx));
    expect(bList).toHaveLength(0);
  });
});
