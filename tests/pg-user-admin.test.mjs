/**
 * Logins: the sign-in lookup, administrative writes, and who may see whom.
 *
 * Shipped without tests during the auth cutover and covered here, because a
 * bug on this path either locks people out or lets the wrong person in — and
 * "I checked it by hand" does not survive the next edit.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/utils/tenant-utils", () => ({ getTenantContext: vi.fn() }));

const userAdmin = await import("@/app/db/userAdmin");
const usersRepo = await import("@/app/db/repositories/users");

suite("logins", () => {
  let admin, client, db;
  let companyA, companyB, mongoA;

  const asTenantUser = (companyId, userId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      return fn(tx);
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
    // users is platform-wide, so truncating companies does not clear it —
    // home_company_id is ON DELETE SET NULL, deliberately (0036).
    await admin`TRUNCATE companies CASCADE`;
    await admin`TRUNCATE users CASCADE`;
    await admin`TRUNCATE _migration_id_map, entry_counters`;

    companyA = randomUUID();
    companyB = randomUUID();
    mongoA = randomUUID().replace(/-/g, "").slice(0, 24);
    await admin`INSERT INTO companies (id, name, slug) VALUES
      (${companyA}, 'Alpha', ${"a-" + companyA.slice(0, 8)}),
      (${companyB}, 'Beta',  ${"b-" + companyB.slice(0, 8)})`;
    await admin`INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
                VALUES ('companies', ${mongoA}, ${companyA})`;
  });

  async function makeUser(over = {}) {
    const id = over.id ?? randomUUID();
    await userAdmin.syncUser({
      id,
      name: over.name ?? "A Person",
      email: over.email ?? `${id.slice(0, 8)}@example.com`,
      role: over.role ?? "Employee",
      status: over.status ?? "Active",
      companyId: over.companyId === null ? null : (over.companyId ?? mongoA),
    });
    if (over.grantIn !== null) {
      await admin`INSERT INTO user_company_access (user_id, company_id, granted_via)
                  VALUES (${id}, ${over.grantIn ?? companyA}, 'manual')
                  ON CONFLICT DO NOTHING`;
    }
    return id;
  }

  describe("the sign-in lookup", () => {
    it("finds a login by email, case-insensitively, with its hash", async () => {
      const id = await makeUser({ email: "Jane@Example.com" });
      await userAdmin.adminSetPassword(id, await bcrypt.hash("s3cret!", 10));

      const found = await userAdmin.findUserForSignIn("JANE@EXAMPLE.COM");
      expect(found?.id).toBe(id);
      expect(found?.status).toBe("active");
      // The hash comes back so auth compares it; the comparison is not here.
      expect(await bcrypt.compare("s3cret!", found.passwordHash)).toBe(true);
      expect(await bcrypt.compare("wrong", found.passwordHash)).toBe(false);
    });

    it("returns a null hash for a Google user rather than an empty string", async () => {
      const id = await makeUser({ email: "g@example.com" });
      const found = await userAdmin.findUserForSignIn("g@example.com");
      expect(found.id).toBe(id);
      // bcrypt.compare against null throws — auth must refuse before comparing.
      expect(found.passwordHash).toBeNull();
    });

    it("finds nobody for an address that is not a login", async () => {
      expect(await userAdmin.findUserForSignIn("nobody@example.com")).toBeNull();
    });
  });

  describe("session revocation", () => {
    it("ends existing sessions when the role changes", async () => {
      const id = await makeUser({ role: "Employee" });
      const before = await userAdmin.getUserStatusAndVersion(id);

      const result = await userAdmin.adminUpdateUser({ id, role: "Admin" });
      const after = await userAdmin.getUserStatusAndVersion(id);

      expect(result.roleChanged).toBe(true);
      // A demotion means nothing while the old JWT still says otherwise, and
      // it lives eight hours. The bump is what makes it seconds.
      expect(after.tokenVersion).toBe(before.tokenVersion + 1);
    });

    it("does not end sessions for a harmless edit", async () => {
      const id = await makeUser();
      const before = await userAdmin.getUserStatusAndVersion(id);
      await userAdmin.adminUpdateUser({ id, name: "New Name" });
      const after = await userAdmin.getUserStatusAndVersion(id);
      expect(after.tokenVersion).toBe(before.tokenVersion);
    });

    it("ends sessions on deactivation and on a password reset", async () => {
      const id = await makeUser();
      const v0 = (await userAdmin.getUserStatusAndVersion(id)).tokenVersion;

      const status = await userAdmin.adminToggleStatus(id);
      expect(status).toBe("inactive");
      const v1 = (await userAdmin.getUserStatusAndVersion(id)).tokenVersion;
      expect(v1).toBe(v0 + 1);

      await userAdmin.adminSetPassword(id, await bcrypt.hash("newpass", 10));
      const v2 = (await userAdmin.getUserStatusAndVersion(id)).tokenVersion;
      expect(v2).toBe(v1 + 1);
    });
  });

  describe("deleting", () => {
    it("refuses to remove the last active SuperAdmin", async () => {
      const only = await makeUser({ role: "SuperAdmin" });
      await expect(userAdmin.adminDeleteUser(only)).rejects.toThrow(
        /last active SuperAdmin/i,
      );

      // With a second one, the first may go.
      await makeUser({ role: "SuperAdmin" });
      await expect(userAdmin.adminDeleteUser(only)).resolves.toMatchObject({
        deleted: true,
      });
    });

    it("does not count a DEACTIVATED SuperAdmin as cover", async () => {
      const active = await makeUser({ role: "SuperAdmin" });
      const spare = await makeUser({ role: "SuperAdmin" });
      await userAdmin.adminToggleStatus(spare); // now inactive

      // Somebody who cannot sign in is not somebody who can administer.
      await expect(userAdmin.adminDeleteUser(active)).rejects.toThrow(
        /last active SuperAdmin/i,
      );
    });
  });

  describe("seats", () => {
    it("counts grants, not home companies", async () => {
      await makeUser({ grantIn: companyA });
      await makeUser({ grantIn: companyA });
      await makeUser({ grantIn: companyB });
      expect(await userAdmin.countCompanyUsers(companyA)).toBe(2);
      expect(await userAdmin.countCompanyUsers(companyB)).toBe(1);
    });

    it("does not count a deactivated login against the seats", async () => {
      const id = await makeUser({ grantIn: companyA });
      await makeUser({ grantIn: companyA });
      expect(await userAdmin.countCompanyUsers(companyA)).toBe(2);
      await userAdmin.adminToggleStatus(id);
      expect(await userAdmin.countCompanyUsers(companyA)).toBe(1);
    });
  });

  describe("who sees whom", () => {
    it("shows colleagues in this company and nobody from another", async () => {
      const me = await makeUser({ name: "Me", grantIn: companyA });
      await makeUser({ name: "Colleague", grantIn: companyA });
      await makeUser({ name: "Stranger", grantIn: companyB });

      // No companyId in the query — 0036's visible_within_company does it.
      const { rows, total } = await asTenantUser(companyA, me, (tx) =>
        usersRepo.searchUsers(tx, {}),
      );
      const names = rows.map((r) => r.name).sort();
      expect(names).toEqual(["Colleague", "Me"]);
      expect(total).toBe(2);
      expect(names).not.toContain("Stranger");
    });

    it("searches by name and by email", async () => {
      const me = await makeUser({ name: "Jane Wanjiru", email: "jane@acme.co", grantIn: companyA });
      await makeUser({ name: "Peter Otieno", email: "peter@acme.co", grantIn: companyA });

      const byName = await asTenantUser(companyA, me, (tx) =>
        usersRepo.searchUsers(tx, { query: "wanjiru" }));
      expect(byName.total).toBe(1);

      const byEmail = await asTenantUser(companyA, me, (tx) =>
        usersRepo.searchUsers(tx, { query: "peter@" }));
      expect(byEmail.total).toBe(1);
    });

    it("filters by status using the values the column actually holds", async () => {
      const me = await makeUser({ grantIn: companyA });
      const other = await makeUser({ grantIn: companyA });
      await userAdmin.adminToggleStatus(other);

      // Lowercase, with a CHECK (0036) — three components compared against
      // "Active" and would have shown everyone as deactivated.
      const active = await asTenantUser(companyA, me, (tx) =>
        usersRepo.searchUsers(tx, { status: "active" }));
      expect(active.total).toBe(1);
      expect(active.rows[0].status).toBe("active");
    });

    it("counts the company's staff, not the platform's", async () => {
      const me = await makeUser({ grantIn: companyA });
      await makeUser({ grantIn: companyA, role: "Admin" });
      await makeUser({ grantIn: companyB });

      const stats = await asTenantUser(companyA, me, (tx) =>
        usersRepo.getUserStats(tx));
      expect(stats.total).toBe(2);
      expect(stats.admins).toBe(1);
    });
  });
});
