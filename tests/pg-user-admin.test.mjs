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
    await admin`TRUNCATE companies, users, _migration_id_map, entry_counters CASCADE`;

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

      const result = await userAdmin.adminUpdateUser({
        id,
        role: "Admin",
        companyId: companyA,
      });
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

  // ───────────────────────────────────────────────────────────────────────────
  describe("platform staff are not members", () => {
    const grantVia = (userId, companyId, via, role = null) =>
      admin`INSERT INTO user_company_access (user_id, company_id, role, granted_via)
            VALUES (${userId}, ${companyId}, ${role}, ${via})
            ON CONFLICT (user_id, company_id) DO UPDATE
              SET granted_via = EXCLUDED.granted_via, role = EXCLUDED.role`;

    it("hides a standing SuperAdmin grant from the tenant's user list", async () => {
      const me = await makeUser({ name: "Werner", grantIn: companyA });
      const platform = await makeUser({
        name: "Platform Staff",
        role: "SuperAdmin",
        companyId: null,
        grantIn: null,
      });
      await grantVia(platform, companyA, "superadmin");

      const { rows } = await asTenantUser(companyA, me, (tx) =>
        usersRepo.searchUsers(tx, {}),
      );

      // A support operator holding standing access is not a colleague, and no
      // other ERP shows them as one. 0064.
      expect(rows.map((r) => r.name)).toEqual(["Werner"]);
    });

    it("still shows platform staff THEMSELVES, via own_row", async () => {
      const me = await makeUser({ name: "Werner", grantIn: companyA });
      const platform = await makeUser({
        name: "Platform Staff",
        role: "SuperAdmin",
        companyId: null,
        grantIn: null,
      });
      await grantVia(platform, companyA, "superadmin");

      const { rows } = await asTenantUser(companyA, platform, (tx) =>
        usersRepo.searchUsers(tx, {}),
      );

      // Hiding them from everyone else must not hide them from themselves, or
      // a SuperAdmin cannot operate inside the tenant they just entered.
      expect(rows.map((r) => r.name).sort()).toEqual(["Platform Staff", "Werner"]);
    });

    it("still shows a real membership granted BY platform staff", async () => {
      const me = await makeUser({ name: "Werner", grantIn: companyA });
      const invited = await makeUser({ name: "Invited", grantIn: null });
      await grantVia(invited, companyA, "invite");

      const { rows } = await asTenantUser(companyA, me, (tx) =>
        usersRepo.searchUsers(tx, {}),
      );

      // The test is granted_via, not who did the granting.
      expect(rows.map((r) => r.name).sort()).toEqual(["Invited", "Werner"]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("a role belongs to a membership", () => {
    it("resolves the session's role per company, so the nav matches the grant", async () => {
      // The bug this covers: an admin promotes somebody to HR Manager, which
      // since 0064 writes the GRANT only. The JWT read users.role, so every
      // canSee*Nav gate saw the old role and the HR module stayed hidden.
      const id = await makeUser({ role: "Employee", grantIn: companyA });
      await userAdmin.adminUpdateUser({
        id,
        role: "HR Manager",
        companyId: companyA,
      });

      expect(await userAdmin.resolveRoleForCompany(id, companyA)).toBe(
        "HR Manager",
      );
      // users.role is untouched by a per-company change — that is the point.
      const [u] = await admin`SELECT role FROM users WHERE id = ${id}`;
      expect(u.role).toBe("Employee");
    });

    it("falls back to the global role where there is no grant", async () => {
      const id = await makeUser({ role: "Admin", grantIn: companyA });
      expect(await userAdmin.resolveRoleForCompany(id, companyB)).toBe("Admin");
      expect(await userAdmin.resolveRoleForCompany(id, null)).toBe("Admin");
    });

    it("shows the role for THIS company, not the global one", async () => {
      const me = await makeUser({ name: "Me", role: "Admin", grantIn: companyA });
      const other = await makeUser({ name: "Dual", role: "Employee", grantIn: null });
      await admin`INSERT INTO user_company_access (user_id, company_id, role, granted_via)
                  VALUES (${other}, ${companyA}, 'Accountant', 'invite'),
                         (${other}, ${companyB}, 'Store Manager', 'invite')`;

      const inA = await asTenantUser(companyA, me, (tx) =>
        usersRepo.searchUsers(tx, { query: "Dual" }),
      );
      // Their global role says Employee and it is true in neither company.
      expect(inA.rows[0].role).toBe("Accountant");
      expect(inA.rows[0].globalRole).toBe("Employee");
    });

    it("does not duplicate a user who holds grants in several companies", async () => {
      // own_grants (0033) shows you YOUR OWN grants everywhere, so the join
      // behind the role column matches more than one row for the current user
      // unless it names the company.
      const me = await makeUser({ name: "Me", grantIn: companyA });
      await admin`INSERT INTO user_company_access (user_id, company_id, role, granted_via)
                  VALUES (${me}, ${companyB}, 'CFO', 'invite')`;

      const { rows, total } = await asTenantUser(companyA, me, (tx) =>
        usersRepo.searchUsers(tx, {}),
      );
      expect(rows.filter((r) => r.name === "Me")).toHaveLength(1);
      expect(total).toBe(1);
    });

    it("filters on the role the list displays", async () => {
      const me = await makeUser({ name: "Me", role: "Admin", grantIn: companyA });
      const acct = await makeUser({ name: "Acct", role: "Employee", grantIn: null });
      await admin`INSERT INTO user_company_access (user_id, company_id, role, granted_via)
                  VALUES (${acct}, ${companyA}, 'Accountant', 'invite')`;

      // Filtering on u.role would have found nobody while the column beside
      // the filter plainly said Accountant.
      const hit = await asTenantUser(companyA, me, (tx) =>
        usersRepo.searchUsers(tx, { role: "Accountant" }),
      );
      expect(hit.rows.map((r) => r.name)).toEqual(["Acct"]);

      const miss = await asTenantUser(companyA, me, (tx) =>
        usersRepo.searchUsers(tx, { role: "Employee" }),
      );
      expect(miss.rows.map((r) => r.name)).not.toContain("Acct");
    });

    it("changes the role for the acting company only", async () => {
      const id = await makeUser({ name: "Dual", role: "Employee", grantIn: null });
      await admin`INSERT INTO user_company_access (user_id, company_id, role, granted_via)
                  VALUES (${id}, ${companyA}, 'Accountant', 'invite'),
                         (${id}, ${companyB}, 'Accountant', 'invite')`;

      await userAdmin.adminUpdateUser({ id, role: "CFO", companyId: companyA });

      const rows = await admin`
        SELECT company_id, role FROM user_company_access WHERE user_id = ${id}`;
      const byCompany = Object.fromEntries(rows.map((r) => [r.company_id, r.role]));
      expect(byCompany[companyA]).toBe("CFO");
      // Promoting somebody here is not promoting them everywhere they work.
      expect(byCompany[companyB]).toBe("Accountant");

      const [u] = await admin`SELECT role FROM users WHERE id = ${id}`;
      expect(u.role).toBe("Employee");
    });

    it("treats SuperAdmin as an identity-level change, not a membership one", async () => {
      const id = await makeUser({ name: "Promoted", role: "Admin", grantIn: companyA });

      await userAdmin.adminUpdateUser({ id, role: "SuperAdmin", companyId: companyA });

      const [u] = await admin`SELECT role FROM users WHERE id = ${id}`;
      expect(u.role).toBe("SuperAdmin");
      // Per-company copies would survive the platform role being taken away,
      // which is exactly what tenant.ts:241 warns about.
      const [g] = await admin`
        SELECT role FROM user_company_access
         WHERE user_id = ${id} AND company_id = ${companyA}`;
      expect(g.role).not.toBe("SuperAdmin");
    });

    it("gives the edit form the same role the list showed", async () => {
      const me = await makeUser({ name: "Me", role: "Admin", grantIn: companyA });
      const id = await makeUser({ name: "Dual", role: "Employee", grantIn: null });
      await admin`INSERT INTO user_company_access (user_id, company_id, role, granted_via)
                  VALUES (${id}, ${companyA}, 'Accountant', 'invite')`;

      const row = await asTenantUser(companyA, me, (tx) =>
        usersRepo.getUser(tx, id),
      );

      // The list said Accountant. If this said Employee, opening the form and
      // saving it unchanged would write Employee onto the grant.
      expect(row.role).toBe("Accountant");
      expect(row.globalRole).toBe("Employee");
    });

    it("returns the dates the edit form renders", async () => {
      const me = await makeUser({ name: "Me", grantIn: companyA });
      const row = await asTenantUser(companyA, me, (tx) =>
        usersRepo.getUser(tx, me),
      );
      // shape() dropped both, so "Created" and "Last updated" read N/A for
      // every user on the edit page.
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.updatedAt).toBeInstanceOf(Date);
    });

    it("stores status lowercase, which is what the form must offer", async () => {
      const me = await makeUser({ name: "Me", grantIn: companyA, status: "Active" });
      const row = await asTenantUser(companyA, me, (tx) =>
        usersRepo.getUser(tx, me),
      );
      // The form's Select offered "Active"/"Inactive" and matched neither, so
      // the Status field rendered blank on every user and the schema rejected
      // the row's own value on submit.
      expect(row.status).toBe("active");
    });

    it("refuses a role change with no company rather than dropping it", async () => {
      const id = await makeUser({ role: "Employee", grantIn: companyA });
      await expect(
        userAdmin.adminUpdateUser({ id, role: "Accountant" }),
      ).rejects.toThrow(/granted within a company/i);
    });

    it("refuses a role change for a company the user is not a member of", async () => {
      // Granted in A, edited from B. The UPDATE matches no row, so without the
      // check this reported success and changed nothing.
      const id = await makeUser({ role: "Employee", grantIn: companyA });
      await expect(
        userAdmin.adminUpdateUser({ id, role: "Accountant", companyId: companyB }),
      ).rejects.toThrow(/not a member of this company/i);

      const [g] = await admin`
        SELECT role FROM user_company_access
         WHERE user_id = ${id} AND company_id = ${companyA}`;
      expect(g.role).toBeNull();
    });

    it("refuses to write a role onto a standing platform grant", async () => {
      // A SuperAdmin is hidden from the user list but still sees THEMSELVES
      // via own_row, so their own edit page is reachable inside a tenant.
      const id = await makeUser({ role: "SuperAdmin", grantIn: null });
      await admin`INSERT INTO user_company_access (user_id, company_id, granted_via)
                  VALUES (${id}, ${companyA}, 'superadmin')`;

      await expect(
        userAdmin.adminUpdateUser({ id, role: "Admin", companyId: companyA }),
      ).rejects.toThrow(/platform access, not a membership/i);

      // A per-company copy would outlive the SuperAdmin role being revoked.
      const [g] = await admin`
        SELECT role FROM user_company_access
         WHERE user_id = ${id} AND company_id = ${companyA}`;
      expect(g.role).toBeNull();
      const [u] = await admin`SELECT role FROM users WHERE id = ${id}`;
      expect(u.role).toBe("SuperAdmin");
    });

    it("saves nothing at all when the role is refused", async () => {
      // The name and email of the same edit must not survive a refusal.
      const id = await makeUser({ name: "Original", role: "Employee", grantIn: companyA });
      await expect(
        userAdmin.adminUpdateUser({
          id,
          name: "Renamed",
          role: "Accountant",
          companyId: companyB,
        }),
      ).rejects.toThrow();

      const [u] = await admin`SELECT name FROM users WHERE id = ${id}`;
      expect(u.name).toBe("Original");
    });

    it("puts the invited role on the GRANT, not only on the identity", async () => {
      const inviter = await makeUser({ name: "Inviter", grantIn: companyA });
      const id = randomUUID();

      await userAdmin.createUserFromInvite({
        id,
        name: "Newcomer",
        email: `${id.slice(0, 8)}@example.com`,
        role: "Accountant",
        companyId: companyA,
        invitedById: inviter,
        invitedByName: "Inviter",
      });

      const [g] = await admin`
        SELECT role, granted_via, granted_by_id FROM user_company_access
         WHERE user_id = ${id} AND company_id = ${companyA}`;

      // The invite named a role for THIS company. Landing it only on
      // users.role made it apply everywhere they were ever granted.
      expect(g.role).toBe("Accountant");
      expect(g.granted_via).toBe("invite");
      // A USER id, not the invitation's — that column is where 0036 puts a
      // foreign key, and an invite id would fail it.
      expect(g.granted_by_id).toBe(inviter);

      const [u] = await admin`SELECT created_by_id FROM users WHERE id = ${id}`;
      expect(u.created_by_id).toBe(inviter);
    });

    it("ends sessions when the role changed only on the GRANT", async () => {
      const id = await makeUser({ name: "Dual", role: "Employee", grantIn: null });
      await admin`INSERT INTO user_company_access (user_id, company_id, role, granted_via)
                  VALUES (${id}, ${companyA}, 'Accountant', 'invite')`;
      const before = await userAdmin.getUserStatusAndVersion(id);

      // Employee -> Accountant is no change at all if you compare against
      // users.role, and the demoted session would live out its eight hours.
      const result = await userAdmin.adminUpdateUser({
        id,
        role: "Employee",
        companyId: companyA,
      });

      expect(result.roleChanged).toBe(true);
      const after = await userAdmin.getUserStatusAndVersion(id);
      expect(after.tokenVersion).toBe(before.tokenVersion + 1);
    });
  });
});
