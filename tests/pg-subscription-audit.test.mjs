/**
 * The history of a subscription — 0099.
 *
 * `lib/subscription-helpers.js` carried a note from 0035: "The subscription
 * state lives in Postgres since 0035. The audit LOG is still a Mongo
 * collection … Moving SubscriptionAuditLog is its own migration." This is that
 * migration, and it takes the last SuperAdmin screen off Mongo.
 *
 * The seat check went with it, and that one was a bug rather than a move:
 * `updateCompanyPlan` counted MONGO users, which nothing has written since
 * users ported, so the guard against downgrading a full company onto a
 * three-seat plan passed everything.
 *
 * PRIVILEGED, cross-company reads — the same shape as pg-platform-actions:
 * the platform surface has no session and no tenant scope, because its whole
 * job is to look across tenants.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const platform = await import("@/app/db/platform");

suite("the history of a subscription", () => {
  let admin, appUser;
  let companyA, companyB;

  const makeCompany = async (name) => {
    const id = randomUUID();
    await admin`INSERT INTO companies (id, name, slug)
                VALUES (${id}, ${name}, ${"s-" + id.slice(0, 8)})`;
    return id;
  };

  /*
   * A member of a company is a USER plus a GRANT. `users` has no company
   * column — 0036 keyed "who is in this company" through
   * `user_company_access` so the answer is the same rows the tenant gate
   * reads, and the seat count follows it.
   */
  const addUser = async (companyId, over = {}) => {
    const id = randomUUID();
    await admin`INSERT INTO users (id, name, email, role, status)
                VALUES (${id}, 'Somebody',
                        ${randomUUID().slice(0, 8) + "@test.local"}, 'Viewer',
                        ${over.userStatus ?? "active"})`;
    await admin`INSERT INTO user_company_access
                  (user_id, company_id, role, status, granted_via, granted_by_name)
                VALUES (${id}, ${companyId}, 'Viewer',
                        ${over.grantStatus ?? "active"},
                        ${over.grantedVia ?? "primary"}, 'Seed')`;
    return id;
  };

  const rowCount = async (companyId) => {
    const [r] = await admin`SELECT COUNT(*)::int AS n FROM subscription_audit_log
                             WHERE company_id = ${companyId}`;
    return r.n;
  };

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    // The APPLICATION role, to prove what it may and may not do.
    if (DATABASE_URL !== ADMIN_URL) {
      appUser = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
    }
  });
  afterAll(async () => {
    if (admin) await admin.end();
    if (appUser) await appUser.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, users, _migration_id_map, entry_counters CASCADE`;
    companyA = await makeCompany("Pilot");
    companyB = await makeCompany("Rival");
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("recording what changed", () => {
    it("writes one row per change, which is what the helper asks for", async () => {
      // A single form submission that moves the plan AND extends the trial
      // produces two rows, so "when did the plan change" is answerable without
      // parsing a combined one.
      const { written } = await platform.recordSubscriptionAudit(companyA, [
        {
          action: "plan_changed",
          previous: { plan: "free", status: "trial", maxUsers: 3 },
          updated: { plan: "pro", status: "active", maxUsers: 25 },
          changedBy: { id: "u1", name: "The Admin" },
          reason: "upgraded",
        },
        {
          action: "trial_extended",
          previous: { trialEndsAt: "2026-01-31T00:00:00Z" },
          updated: { trialEndsAt: "2026-02-28T00:00:00Z" },
          changedBy: { id: "u1", name: "The Admin" },
        },
      ]);

      expect(written).toBe(2);
      expect(await rowCount(companyA)).toBe(2);
    });

    it("reads back in the shape the admin screen renders", async () => {
      await platform.recordSubscriptionAudit(companyA, [
        {
          action: "plan_changed",
          previous: { plan: "free", status: "trial", maxUsers: 3 },
          updated: { plan: "pro", status: "active", maxUsers: 25 },
          changedBy: { id: "u1", name: "The Admin" },
          reason: "they paid",
        },
      ]);

      const [log] = await platform.listSubscriptionAudit(companyA);
      expect(log._id).toBeTruthy();
      expect(log.action).toBe("plan_changed");
      expect(log.previous.plan).toBe("free");
      expect(log.previous.maxUsers).toBe(3);
      expect(log.updated.plan).toBe("pro");
      expect(log.updated.maxUsers).toBe(25);
      expect(log.changedBy.name).toBe("The Admin");
      expect(log.reason).toBe("they paid");
      expect(new Date(log.createdAt).toString()).not.toBe("Invalid Date");
    });

    it("orders newest first", async () => {
      for (const plan of ["a", "b", "c"]) {
        await platform.recordSubscriptionAudit(companyA, [
          { action: "plan_changed", updated: { plan }, changedBy: { name: "x" } },
        ]);
      }
      const logs = await platform.listSubscriptionAudit(companyA);
      expect(logs.map((l) => l.updated.plan)).toEqual(["c", "b", "a"]);
    });

    it("keeps a name for somebody who left, and defaults when there was none", async () => {
      await platform.recordSubscriptionAudit(companyA, [
        { action: "auto_expired", updated: { status: "expired" } },
      ]);
      const [log] = await platform.listSubscriptionAudit(companyA);
      expect(log.changedBy.name).toBe("System");
      expect(log.changedBy.id).toBeNull();
    });

    it("does not mix one company's history into another's", async () => {
      await platform.recordSubscriptionAudit(companyA, [
        { action: "plan_changed", updated: { plan: "pro" }, changedBy: { name: "a" } },
      ]);
      expect(await platform.listSubscriptionAudit(companyB)).toHaveLength(0);
    });

    it("accepts the pre-migration ObjectId the admin routes still carry", async () => {
      // /dashboard/admin/companies/[id] is built on the old id, so every
      // function on this surface has to resolve either form.
      const legacy = "6a3ba4ae0f569c9f3d9a907f";
      await admin`INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
                  VALUES ('companies', ${legacy}, ${companyA})`;

      await platform.recordSubscriptionAudit(legacy, [
        { action: "renewed", updated: { plan: "pro" }, changedBy: { name: "a" } },
      ]);

      expect(await rowCount(companyA)).toBe(1);
      expect(await platform.listSubscriptionAudit(legacy)).toHaveLength(1);
    });

    it("writes nothing for a company that does not exist, rather than throwing", async () => {
      const result = await platform.recordSubscriptionAudit(randomUUID(), [
        { action: "plan_changed", updated: { plan: "pro" } },
      ]);
      expect(result.written).toBe(0);
      expect(await platform.listSubscriptionAudit(randomUUID())).toEqual([]);
    });

    it("goes with the company when the company goes", async () => {
      await platform.recordSubscriptionAudit(companyA, [
        { action: "plan_changed", updated: { plan: "pro" }, changedBy: { name: "a" } },
      ]);
      await admin`DELETE FROM companies WHERE id = ${companyA}`;
      const [r] = await admin`SELECT COUNT(*)::int AS n FROM subscription_audit_log`;
      expect(r.n).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the seat check counts the right store", () => {
    it("counts active users for the company being changed", async () => {
      await addUser(companyA);
      await addUser(companyA);
      await addUser(companyB);

      expect(await platform.countActiveUsersForCompany(companyA)).toBe(2);
      expect(await platform.countActiveUsersForCompany(companyB)).toBe(1);
    });

    it("does not count somebody who has been deactivated", async () => {
      await addUser(companyA);
      await addUser(companyA, { userStatus: "inactive" });
      expect(await platform.countActiveUsersForCompany(companyA)).toBe(1);
    });

    it("does not count a suspended grant", async () => {
      await addUser(companyA);
      await addUser(companyA, { grantStatus: "suspended" });
      expect(await platform.countActiveUsersForCompany(companyA)).toBe(1);
    });

    it("does NOT count platform staff visiting the company", async () => {
      // 0064: a SuperAdmin's standing access is `granted_via = 'superadmin'`
      // and is not membership. Counting it would bill a customer for every
      // support visit — and where grantAllTenants tops up standing access for
      // every tenant, bill every customer for every operator.
      await addUser(companyA);
      await addUser(companyA, { grantedVia: "superadmin" });
      expect(await platform.countActiveUsersForCompany(companyA)).toBe(1);
    });

    it("agrees with the user list, which is the point", async () => {
      await addUser(companyA);
      await addUser(companyA);
      await addUser(companyA, { grantedVia: "superadmin" });

      const [visible] = await admin`
        SELECT COUNT(DISTINCT u.id)::int AS n
          FROM users u
          JOIN user_company_access a ON a.user_id = u.id
         WHERE a.company_id = ${companyA}
           AND a.status = 'active'
           AND a.granted_via IS DISTINCT FROM 'superadmin'`;
      expect(await platform.countActiveUsersForCompany(companyA)).toBe(visible.n);
    });

    it("is zero for a company with nobody in it", async () => {
      expect(await platform.countActiveUsersForCompany(companyA)).toBe(0);
    });

    it("resolves a legacy company id, like everything else on this surface", async () => {
      const legacy = "6a3ba4ae0f569c9f3d9a9080";
      await admin`INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
                  VALUES ('companies', ${legacy}, ${companyA})`;
      await addUser(companyA);
      expect(await platform.countActiveUsersForCompany(legacy)).toBe(1);
    });

    it("is zero, not a throw, for a company id that does not resolve", async () => {
      expect(await platform.countActiveUsersForCompany("not-an-id")).toBe(0);
      expect(await platform.countActiveUsersForCompany("")).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("a tenant cannot write its own billing history", () => {
    it("grants the application role SELECT and nothing else", async () => {
      const rows = await admin`
        SELECT privilege_type FROM information_schema.role_table_grants
         WHERE table_name = 'subscription_audit_log' AND grantee = 'app_user'
         ORDER BY privilege_type`;
      expect(rows.map((r) => r.privilege_type)).toEqual(["SELECT"]);
    });

    it("refuses an INSERT on the application connection", async () => {
      // 0023 grants full DML on every new table by default, so this only holds
      // because 0099 revokes it back. Without the REVOKE a tenant could forge
      // a row saying they were on enterprise all along.
      if (!appUser) return; // single-role local setup: nothing to prove
      const err = await appUser`
        INSERT INTO subscription_audit_log (company_id, action)
        VALUES (${companyA}, 'plan_changed')`.then(
        () => null,
        (e) => e,
      );
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/permission denied|denied for table/i);
    });
  });
});
