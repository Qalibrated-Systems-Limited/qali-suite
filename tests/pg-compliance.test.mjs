/**
 * Compliance repository against a real PostgreSQL — 0116.
 *
 * Pins: certificate current/expiring/expired derived from expiry vs today;
 * open/overdue task counts; task→certificate cascade on cert delete; RLS
 * isolation.
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

const repo = await import("@/app/db/repositories/compliance");
const iso = (ms = 0) => new Date(Date.now() + ms).toISOString().slice(0, 10);
const DAY = 86_400_000;

suite("compliance", () => {
  let admin, client, db, companyA, companyB;
  const actor = { id: null, name: "CO" };

  const asTenant = (id, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${id}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);
  const inB = (fn) => asTenant(companyB, fn);

  const cert = (over = {}) =>
    inA((tx) => repo.createCertificate(tx, { companyId: companyA, name: over.name ?? "Fire Safety", createdByName: "s", ...over }));

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

  it("derives certificate current/expiring/expired from expiry", async () => {
    await cert({ name: "Current", expiryDate: iso(200 * DAY) });
    await cert({ name: "Expiring", expiryDate: iso(30 * DAY) });
    await cert({ name: "Expired", expiryDate: iso(-5 * DAY) });
    await cert({ name: "NoExpiry", expiryDate: null });
    const stats = await inA((tx) => repo.getComplianceStats(tx));
    expect(stats.certificates).toBe(4);
    expect(stats.current).toBe(2); // 200-day + no-expiry
    expect(stats.expiring).toBe(1);
    expect(stats.expired).toBe(1);
  });

  it("counts open and overdue tasks", async () => {
    await inA((tx) => repo.createTask(tx, { companyId: companyA, title: "Overdue", dueDate: iso(-2 * DAY), createdByName: "s" }));
    await inA((tx) => repo.createTask(tx, { companyId: companyA, title: "Upcoming", dueDate: iso(5 * DAY), createdByName: "s" }));
    const done = await inA((tx) => repo.createTask(tx, { companyId: companyA, title: "Done", dueDate: iso(-9 * DAY), createdByName: "s" }));
    await inA((tx) => repo.setTaskStatus(tx, done.id, "done", actor));
    const stats = await inA((tx) => repo.getComplianceStats(tx));
    expect(stats.openTasks).toBe(2);
    expect(stats.overdueTasks).toBe(1);
  });

  it("cascades tasks when their certificate is deleted", async () => {
    const c = await cert();
    await inA((tx) => repo.createTask(tx, { companyId: companyA, title: "Renew", certificateId: c.id, createdByName: "s" }));
    expect(await inA((tx) => repo.listTasks(tx))).toHaveLength(1);
    await inA((tx) => repo.deleteCertificate(tx, c.id));
    expect(await inA((tx) => repo.listTasks(tx))).toHaveLength(0);
  });

  it("isolates tenants", async () => {
    await cert();
    await inA((tx) => repo.createObligation(tx, { companyId: companyA, name: "VAT", createdByName: "s" }));
    expect(await inB((tx) => repo.listCertificates(tx))).toHaveLength(0);
    expect(await inB((tx) => repo.listObligations(tx))).toHaveLength(0);
  });
});
