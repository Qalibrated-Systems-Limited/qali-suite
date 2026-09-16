/**
 * QMS repository against a real PostgreSQL — 0114.
 *
 * Pins the quality lifecycle: NC → CAPA → effectiveness check → close; per-tenant
 * NC/CAPA/AUD/MR numbering; the derived stats (open NCs, overdue CAPA, awaiting
 * effectiveness, planned audits); CAPA cascade from its NC; RLS isolation.
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

const repo = await import("@/app/db/repositories/qms");

const DAY = 86_400_000;
const iso = (ms = 0) => new Date(Date.now() + ms).toISOString().slice(0, 10);

suite("the QMS", () => {
  let admin, client, db, companyA, companyB;
  const actor = { id: null, name: "QM" };

  const asTenant = (id, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${id}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);
  const inB = (fn) => asTenant(companyB, fn);

  const nc = (over = {}) =>
    inA((tx) =>
      repo.createNonconformance(tx, {
        companyId: companyA,
        title: over.title ?? "Calibration record incomplete",
        source: over.source ?? "internal_audit",
        severity: over.severity ?? "major",
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

  it("numbers NCs per tenant and starts open", async () => {
    const a = await nc();
    expect(a.ncNumber).toBe("NC-00001");
    expect(a.status).toBe("open");
    const b = await inB((tx) => repo.createNonconformance(tx, { companyId: companyB, title: "B", createdByName: "s" }));
    expect(b.ncNumber).toBe("NC-00001");
  });

  it("drives NC status through the CAPA lifecycle", async () => {
    const n = await nc();
    // Raise CAPA → NC moves to capa_in_progress.
    const capa = await inA((tx) =>
      repo.upsertCapa(tx, { companyId: companyA, nonconformanceId: n.id, action: "Re-train + checklist", status: "in_progress", actor }),
    );
    expect(capa.capaNumber).toBe("CAPA-00001");
    let [read] = await inA((tx) => repo.listNonconformances(tx));
    expect(read.status).toBe("capa_in_progress");
    expect(read.capa.capaNumber).toBe("CAPA-00001");

    // Complete CAPA → NC awaits effectiveness check.
    await inA((tx) => repo.upsertCapa(tx, { companyId: companyA, nonconformanceId: n.id, capaId: capa.id, status: "completed", actor }));
    [read] = await inA((tx) => repo.listNonconformances(tx));
    expect(read.status).toBe("effectiveness_check");

    // Verify effective → NC closes.
    await inA((tx) => repo.upsertCapa(tx, { companyId: companyA, nonconformanceId: n.id, capaId: capa.id, status: "verified", effectivenessResult: "effective", actor }));
    [read] = await inA((tx) => repo.listNonconformances(tx));
    expect(read.status).toBe("closed");
  });

  it("derives the dashboard stats", async () => {
    // An NC with an overdue CAPA and one awaiting effectiveness.
    const n1 = await nc();
    await inA((tx) => repo.upsertCapa(tx, { companyId: companyA, nonconformanceId: n1.id, status: "in_progress", dueDate: iso(-2 * DAY), actor }));
    const n2 = await nc({ title: "Late certificate" });
    await inA((tx) => repo.upsertCapa(tx, { companyId: companyA, nonconformanceId: n2.id, status: "completed", effectivenessResult: "pending", actor }));
    await inA((tx) => repo.createAudit(tx, { companyId: companyA, title: "Internal Audit", status: "planned", createdByName: "s" }));

    const stats = await inA((tx) => repo.getQmsStats(tx));
    expect(stats.openNcs).toBe(2); // neither closed
    expect(stats.overdueCapa).toBe(1);
    expect(stats.awaitingEffectiveness).toBe(1);
    expect(stats.auditsPlanned).toBe(1);
  });

  it("numbers audits and reviews per tenant", async () => {
    const a = await inA((tx) => repo.createAudit(tx, { companyId: companyA, title: "Audit", createdByName: "s" }));
    const r = await inA((tx) => repo.createReview(tx, { companyId: companyA, chairedBy: "MD", createdByName: "s" }));
    expect(a.auditNumber).toBe("AUD-00001");
    expect(r.reviewNumber).toBe("MR-00001");
  });

  it("isolates tenants", async () => {
    await nc();
    expect(await inB((tx) => repo.listNonconformances(tx))).toHaveLength(0);
  });
});
