/**
 * Inter-Company repository against a real PostgreSQL — 0113.
 *
 * Pins the derived-balance behaviour: a contract's collected/outstanding/status
 * is the sum of its COLLECTED transactions against the fee — never stored;
 * transactions cascade from their contract; stats roll up across contracts; and
 * tenants are isolated.
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

const repo = await import("@/app/db/repositories/intercompany");
const iso = () => new Date().toISOString().slice(0, 10);

suite("inter-company", () => {
  let admin, client, db, companyA, companyB;
  const actor = { id: null, name: "Group Finance" };

  const asTenant = (id, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${id}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);
  const inB = (fn) => asTenant(companyB, fn);

  const contract = (over = {}) =>
    inA((tx) =>
      repo.createContract(tx, {
        companyId: companyA,
        sisterCompany: over.sisterCompany ?? "Qalibrated Labs Ltd",
        contractType: over.contractType ?? "mgmt_fee",
        fee: over.fee ?? 900000,
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

  it("numbers contracts per tenant and starts outstanding", async () => {
    const c = await contract();
    expect(c.contractNumber).toBe("IC-00001");
    const [read] = await inA((tx) => repo.listContracts(tx));
    expect(read.collected).toBe(0);
    expect(read.outstanding).toBe(900000);
    expect(read.status).toBe("outstanding");
  });

  it("derives partial and settled from collected transactions only", async () => {
    const c = await contract({ fee: 900000 });
    // Invoiced but not collected → still outstanding.
    await inA((tx) => repo.createTransaction(tx, { companyId: companyA, contractId: c.id, txnDate: iso(), amount: 300000, status: "invoiced", createdByName: "s" }));
    let [r] = await inA((tx) => repo.listContracts(tx));
    expect(r.collected).toBe(0);
    expect(r.status).toBe("outstanding");

    // Collect 300k → partial.
    await inA((tx) => repo.createTransaction(tx, { companyId: companyA, contractId: c.id, txnDate: iso(), amount: 300000, status: "collected", createdByName: "s" }));
    [r] = await inA((tx) => repo.listContracts(tx));
    expect(r.collected).toBe(300000);
    expect(r.outstanding).toBe(600000);
    expect(r.status).toBe("partial");

    // Collect the rest → settled.
    await inA((tx) => repo.createTransaction(tx, { companyId: companyA, contractId: c.id, txnDate: iso(), amount: 600000, status: "collected", createdByName: "s" }));
    [r] = await inA((tx) => repo.listContracts(tx));
    expect(r.status).toBe("settled");
    expect(r.outstanding).toBe(0);
  });

  it("rolls up stats and cascades transactions on contract delete", async () => {
    const c1 = await contract({ sisterCompany: "Labs", fee: 900000 });
    const c2 = await contract({ sisterCompany: "Instruments", fee: 480000 });
    await inA((tx) => repo.createTransaction(tx, { companyId: companyA, contractId: c1.id, txnDate: iso(), amount: 900000, status: "collected", createdByName: "s" }));
    await inA((tx) => repo.createTransaction(tx, { companyId: companyA, contractId: c2.id, txnDate: iso(), amount: 300000, status: "collected", createdByName: "s" }));

    const stats = await inA((tx) => repo.getICStats(tx));
    expect(stats.totalFees).toBe(1380000);
    expect(stats.collected).toBe(1200000);
    expect(stats.outstanding).toBe(180000);
    expect(stats.transactions).toBe(2);

    await inA((tx) => repo.deleteContract(tx, c1.id));
    expect(await inA((tx) => repo.listTransactions(tx))).toHaveLength(1);
  });

  it("isolates tenants", async () => {
    await contract();
    expect(await inB((tx) => repo.listContracts(tx))).toHaveLength(0);
  });
});
