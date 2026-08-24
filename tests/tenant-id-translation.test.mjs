/**
 * The uuid -> legacy ObjectId translation every Mongo tenant helper depends on.
 *
 * Companies moved to Postgres (0035), so `session.user.companyId` is a uuid
 * while Mongo documents are still keyed by the ObjectId they were written
 * with. Three helpers threw BSONError on the cast and two matched nothing;
 * all five now translate. See the header of lib/utils/tenant-utils.js.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

// Mocked so importing the module under test does not drag in NextAuth. The
// session shape is the only part of `auth()` that matters here.
const session = { user: {} };
vi.mock("@/auth", () => ({ auth: async () => session }));

const ADMIN_URL = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;

describe.skipIf(!ADMIN_URL)("company id translation", () => {
  let admin;
  let tenantUtils;
  const legacyId = "6a877c626122b9fc7d7bffe8";
  const uuid = randomUUID();

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    await admin`
      INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
      VALUES ('companies', ${legacyId}, ${uuid})
      ON CONFLICT DO NOTHING`;
    tenantUtils = await import("../lib/utils/tenant-utils.js");
  });

  afterAll(async () => {
    if (admin) {
      await admin`DELETE FROM _migration_id_map WHERE new_uuid = ${uuid}`;
      await admin.end();
    }
  });

  it("passes a legacy ObjectId straight through", () => {
    expect(tenantUtils.translateCompanyId(legacyId)).toBe(legacyId);
  });

  it("refuses a uuid it has no mapping for, by name", () => {
    // The old behaviour was `new ObjectId(uuid)` throwing BSONError from
    // wherever the query happened to be, which said nothing about the cause.
    expect(() => tenantUtils.translateCompanyId(randomUUID())).toThrow(
      /No legacy Mongo id for company/,
    );
  });

  describe("once the map is loaded", () => {
    beforeAll(async () => {
      session.user = { companyId: uuid, role: "Accountant" };
      // getTenantContext loads the map; the sync helpers rely on it having run.
      await tenantUtils.getTenantContext();
    });

    it("translates the session uuid to the id documents carry", () => {
      expect(tenantUtils.translateCompanyId(uuid)).toBe(legacyId);
    });

    it("scopes a query with the legacy id, not the uuid", () => {
      const scoped = tenantUtils.withTenantScope({ status: "pending" }, uuid, false);
      expect(scoped.status).toBe("pending");
      expect(String(scoped.companyId)).toBe(legacyId);
    });

    it("builds an aggregation $match the planner can use", () => {
      const [stage] = tenantUtils.withTenantPipeline([{ $count: "n" }], uuid, false);
      expect(String(stage.$match.companyId)).toBe(legacyId);
    });

    it("validates a document whose companyId is the legacy id", () => {
      // This one never threw — it compared a uuid against an ObjectId string
      // and returned false, denying access to the tenant's own rows.
      expect(
        tenantUtils.validateTenantAccess({ companyId: legacyId }, uuid, false),
      ).toBe(true);
    });

    it("still lets SuperAdmin past without translating", () => {
      expect(tenantUtils.withTenantScope({ a: 1 }, uuid, true)).toEqual({ a: 1 });
      expect(tenantUtils.buildTenantMatch(uuid, true)).toEqual({});
    });

    it("is the SAME translation the 84 inline call sites use", async () => {
      // tenant-utils re-exports it rather than keeping a copy. Fixing only
      // tenant-utils left the dashboard still throwing, because
      // erp-dashboard-queries.ts and 24 other files build the filter inline
      // instead of calling the shared helpers.
      const leaf = await import("../lib/utils/legacy-company-id.js");
      expect(leaf.translateCompanyId).toBe(tenantUtils.translateCompanyId);
      expect(leaf.translateCompanyId(uuid)).toBe(legacyId);
    });

    it("imports without pulling in auth, so models can use it", async () => {
      // The reason it is a separate module: app/models/* must not import
      // `@/auth` transitively just to cast an id.
      const src = await import("node:fs").then((fs) =>
        fs.readFileSync("lib/utils/legacy-company-id.js", "utf8"),
      );
      const staticImports = src
        .split("\n")
        .filter((l) => /^import\s/.test(l.trim()));
      expect(staticImports).toEqual([]);
    });
  });
});
