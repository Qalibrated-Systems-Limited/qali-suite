/**
 * What the Roles & Permissions page saves is what the server enforces.
 *
 * The page stored each role's ticked permissions, but no check read them:
 * unticking "Finance write" from Accountant left every Accountant able to post.
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

const { permittedBySavedRoles, gateKeysFor } = await import("@/app/db/permissionGate");
const permRepo = await import("@/app/db/repositories/rolePermissions");
const gates = await import("@/lib/utils/role-gates");
const userAdmin = await import("@/app/db/userAdmin");

const FINANCE_WRITE = [...gates.FINANCE_WRITE_ROLES];
const HR_GATE = [...gates.HR_WRITE_ROLES];

suite("saved role permissions are enforced", () => {
  let admin, client, db, companyA, companyB;
  const people = {};

  const inCo = (co, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${co}, true)`);
      return fn(tx);
    });
  const check = (co, who, role, gate) =>
    inCo(co, (tx) => permittedBySavedRoles(tx, people[who], co, role, gate));

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
    companyB = randomUUID();
    for (const co of [companyA, companyB]) {
      await admin`INSERT INTO companies (id, name, slug) VALUES (${co}, 'C', ${"c-" + co.slice(0, 8)})`;
    }
    for (const [key, role, access] of [
      ["acct", "Accountant", "Accountant"],
      ["qm", "Manager", "Quality Lead"],
    ]) {
      const id = `u-${key}-${randomUUID().slice(0, 6)}`;
      await admin`INSERT INTO users (id, name, email, role, home_company_id)
                  VALUES (${id}, ${key}, ${key + id + "@x.co"}, ${role}, ${companyA})`;
      await admin`INSERT INTO user_company_access (user_id, company_id, role, status, granted_via)
                  VALUES (${id}, ${companyA}, ${access}, 'active', 'manual')`;
      people[key] = id;
    }
  });

  it("recognises a gate by its roles, even passed as a copy", () => {
    expect(gateKeysFor(FINANCE_WRITE)).toContain("FINANCE_WRITE_ROLES");
    expect(gateKeysFor(["Nobody", "Special"])).toEqual([]);
  });

  it("an unedited role follows the code defaults", async () => {
    expect(await check(companyA, "acct", "Accountant", FINANCE_WRITE)).toBeNull();
  });

  it("unticking a permission takes it away", async () => {
    await inCo(companyA, (tx) => permRepo.setRoleKeys(tx, companyA, "Accountant", ["Viewer_NONE"]));
    expect(await check(companyA, "acct", "Accountant", FINANCE_WRITE)).toBe(false);
  });

  it("ticking a permission grants it", async () => {
    expect(gates.HR_WRITE_ROLES.includes("Accountant")).toBe(false);
    await inCo(companyA, (tx) =>
      permRepo.setRoleKeys(tx, companyA, "Accountant", ["FINANCE_WRITE_ROLES", "HR_WRITE_ROLES"]),
    );
    expect(await check(companyA, "acct", "Accountant", HR_GATE)).toBe(true);
    expect(await check(companyA, "acct", "Accountant", FINANCE_WRITE)).toBe(true);
  });

  it("one company's settings do not reach another", async () => {
    await inCo(companyB, (tx) => permRepo.setRoleKeys(tx, companyB, "Accountant", []));
    expect(await check(companyA, "acct", "Accountant", FINANCE_WRITE)).toBeNull();
  });

  it("a custom role never exceeds its base, and its own set narrows it", async () => {
    await admin`INSERT INTO custom_roles (company_id, name, base_role) VALUES (${companyA}, 'Quality Lead', 'Manager')`;
    // Manager is not in FINANCE_WRITE; the custom role ticking it cannot grant it.
    await inCo(companyA, (tx) => permRepo.setRoleKeys(tx, companyA, "Quality Lead", ["FINANCE_WRITE_ROLES"]));
    expect(await check(companyA, "qm", "Manager", FINANCE_WRITE)).toBe(false);
  });

  it("SuperAdmin always passes", async () => {
    await inCo(companyA, (tx) => permRepo.setRoleKeys(tx, companyA, "SuperAdmin", []));
    expect(await check(companyA, "acct", "SuperAdmin", FINANCE_WRITE)).toBe(true);
  });

  it("the session's permission set: null until edited, then the saved keys", async () => {
    expect(await userAdmin.resolvePermissionKeysForCompany(people.acct, companyA)).toBeNull();
    await inCo(companyA, (tx) => permRepo.setRoleKeys(tx, companyA, "Accountant", ["HR_ADMIN_ROLES", "See HR"]));
    const keys = await userAdmin.resolvePermissionKeysForCompany(people.acct, companyA);
    expect(keys?.sort()).toEqual(["HR_ADMIN_ROLES", "See HR"]);
  });

  it("a custom role's session set is its own, narrowed to what its base holds", async () => {
    await admin`INSERT INTO custom_roles (company_id, name, base_role) VALUES (${companyA}, 'Quality Lead', 'Manager')`;
    await inCo(companyA, (tx) => permRepo.setRoleKeys(tx, companyA, "Quality Lead", ["FINANCE_WRITE_ROLES", "See Projects"]));
    const keys = await userAdmin.resolvePermissionKeysForCompany(people.qm, companyA);
    // Manager's defaults include "See Projects" but not FINANCE_WRITE_ROLES.
    expect(keys).toContain("See Projects");
    expect(keys).not.toContain("FINANCE_WRITE_ROLES");
  });
});

