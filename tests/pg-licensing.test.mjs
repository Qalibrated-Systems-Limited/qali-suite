/**
 * Licensing repository against a real PostgreSQL — 0108.
 *
 * The license spine ported from the Lante ERP License microservice. These pin
 * the behaviour the .NET service guaranteed and this port has to keep: a key is
 * issued as a signed token with a LIC number, validation applies the same
 * checks in the same order (unknown → revoked → wrong_app → expired →
 * machine_mismatch), revoke and renew are atomic and each writes an audit row,
 * and the tenant that issued a key is the only one that can list it.
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

const lic = await import("@/app/db/repositories/licensing");

const YEAR = 365 * 86_400_000;

suite("the license spine", () => {
  let admin, client, db;
  let companyA, companyB;
  const actor = { id: null, name: "The Operator" };

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);
  const inB = (fn) => asTenant(companyB, fn);

  const issue = (over = {}) =>
    inA((tx) =>
      lic.issueLicense(tx, {
        companyId: companyA,
        customerId: over.customerId ?? "CUST-1",
        customerName: over.customerName ?? "Acme Weighbridge Ltd",
        appId: over.appId ?? "qalitrack-kiosk",
        features: over.features ?? ["kiosk", "reports"],
        machineId: over.machineId ?? null,
        expiresAt: over.expiresAt ?? new Date(Date.now() + YEAR),
        createdByName: "Seed",
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
    await admin`INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Reseller A', ${"a-" + companyA.slice(0, 8)})`;
    await admin`INSERT INTO companies (id, name, slug)
      VALUES (${companyB}, 'Reseller B', ${"b-" + companyB.slice(0, 8)})`;
  });

  describe("issue", () => {
    it("mints a numbered, signed key and records it", async () => {
      const row = await issue();
      expect(row.licenseNumber).toMatch(/^LIC-\d{5}$/);
      expect(row.token.split(".")).toHaveLength(3);
      expect(row.features).toBe("kiosk,reports");
      expect(row.revoked).toBe(false);

      const list = await inA((tx) => lic.listLicenses(tx));
      expect(list).toHaveLength(1);

      const stats = await inA((tx) => lic.getLicenseStats(tx));
      expect(stats).toMatchObject({ total: 1, active: 1, revoked: 0, expired: 0 });

      const audit = await inA((tx) => lic.getLicenseAudit(tx, row.id));
      expect(audit.map((a) => a.action)).toContain("issued");
    });

    it("numbers keys per tenant", async () => {
      const a1 = await issue();
      const b1 = await inB((tx) =>
        lic.issueLicense(tx, {
          companyId: companyB,
          customerId: "CUST-B",
          appId: "qalitrack-frontend",
          features: [],
          expiresAt: new Date(Date.now() + YEAR),
          createdByName: "Seed",
        }),
      );
      expect(a1.licenseNumber).toBe("LIC-00001");
      expect(b1.licenseNumber).toBe("LIC-00001");
    });
  });

  describe("validate — same checks, same order as the .NET service", () => {
    it("accepts a good key and stamps the check-in", async () => {
      const row = await issue({ machineId: null });
      const res = await lic.validateByToken({
        token: row.token,
        appId: "qalitrack-kiosk",
        machineId: "MID-1",
      });
      expect(res).toMatchObject({ valid: true, customerId: "CUST-1", appId: "qalitrack-kiosk" });
      expect(res.features).toEqual(["kiosk", "reports"]);

      const [after] = await inA((tx) => lic.listLicenses(tx));
      expect(after.lastSeen).not.toBeNull();
      expect(after.lastMachineId).toBe("MID-1");
    });

    it("rejects unknown, wrong_app, expired and machine_mismatch", async () => {
      expect(await lic.validateByToken({ token: "nope", appId: "qalitrack-kiosk" })).toMatchObject({
        valid: false,
        reason: "unknown_key",
      });

      const good = await issue();
      expect(await lic.validateByToken({ token: good.token, appId: "qalitrack-mobile" })).toMatchObject({
        valid: false,
        reason: "wrong_app",
      });

      const past = await issue({ customerId: "CUST-OLD", expiresAt: new Date(Date.now() - 1000) });
      expect(await lic.validateByToken({ token: past.token, appId: "qalitrack-kiosk" })).toMatchObject({
        valid: false,
        reason: "expired",
      });

      const bound = await issue({ customerId: "CUST-BOUND", machineId: "MID-A" });
      expect(await lic.validateByToken({ token: bound.token, appId: "qalitrack-kiosk", machineId: "MID-B" })).toMatchObject({
        valid: false,
        reason: "machine_mismatch",
      });
    });
  });

  describe("revoke", () => {
    it("is idempotent and audited, and validation then fails", async () => {
      const row = await issue();
      const revoked = await inA((tx) => lic.revokeLicense(tx, row.id, "contract ended", actor));
      expect(revoked.revoked).toBe(true);

      // A second revoke touches nothing.
      expect(await inA((tx) => lic.revokeLicense(tx, row.id, "again", actor))).toBeNull();

      expect(await lic.validateByToken({ token: row.token, appId: "qalitrack-kiosk" })).toMatchObject({
        valid: false,
        reason: "revoked",
      });

      const audit = await inA((tx) => lic.getLicenseAudit(tx, row.id));
      expect(audit.map((a) => a.action)).toContain("revoked");
    });
  });

  describe("renew", () => {
    it("extends forward only, and never a revoked key", async () => {
      const row = await issue({ expiresAt: new Date(Date.now() + YEAR) });

      const back = await inA((tx) =>
        lic.renewLicense(tx, row.id, new Date(Date.now() + 86_400_000), actor),
      );
      expect(back).toMatchObject({ ok: false, reason: "not_after_current" });

      const forward = await inA((tx) =>
        lic.renewLicense(tx, row.id, new Date(Date.now() + 2 * YEAR), actor),
      );
      expect(forward.ok).toBe(true);

      await inA((tx) => lic.revokeLicense(tx, row.id, "x", actor));
      const afterRevoke = await inA((tx) =>
        lic.renewLicense(tx, row.id, new Date(Date.now() + 3 * YEAR), actor),
      );
      expect(afterRevoke).toMatchObject({ ok: false, reason: "revoked" });
    });
  });

  describe("tenant isolation", () => {
    it("a reseller sees only its own keys", async () => {
      await issue(); // company A
      const bList = await inB((tx) => lic.listLicenses(tx));
      expect(bList).toHaveLength(0);
    });
  });
});
