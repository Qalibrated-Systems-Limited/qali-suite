/**
 * The API-key door into Postgres.
 *
 * withAuthorizedTenant covers the session path; this is the other one — a
 * machine-to-machine caller with no session, which is how the /api/v1 routes
 * reach the repositories. What has to hold is that it is not a WEAKER door:
 * the tenant is resolved from the key's own company, row-level security is in
 * force inside the callback, and the actor written to the row is a person
 * rather than the key.
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
// tenant.ts reaches next-auth for the SESSION path, which does not load under
// Vitest. This bridge never uses it — that is the point of it — but the module
// graph still pulls it in.
vi.mock("@/lib/utils/tenant-utils", () => ({ getTenantContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/integrations/middleware/apiKeyAuth", () => ({
  apiKeyAuth: vi.fn(),
}));

const { apiKeyAuth } = await import("@/lib/integrations/middleware/apiKeyAuth");
const { withApiKeyTenant } = await import("@/app/db/apiTenant");
const invoicesRepo = await import("@/app/db/repositories/invoices");

suite("api key tenant bridge", () => {
  let admin;
  let companyUuid;
  let otherUuid;
  let mongoCompanyId;
  let customerId;
  let widgetId;
  const KEY_OWNER = "owner-user-1";

  const request = new Request("https://example.test/api/v1/invoices");

  function keyContext(overrides = {}) {
    return {
      ok: true,
      companyId: mongoCompanyId,
      keyId: "key-1",
      keyName: "Coffee Coop Connector",
      connectorType: "custom",
      scopes: ["invoices:read", "invoices:write"],
      environment: "test",
      key: { createdBy: { id: KEY_OWNER, name: "Key Owner" } },
      ...overrides,
    };
  }

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await admin`TRUNCATE companies, _migration_id_map, entry_counters CASCADE`;

    companyUuid = randomUUID();
    otherUuid = randomUUID();
    mongoCompanyId = randomUUID().replace(/-/g, "").slice(0, 24);
    customerId = randomUUID();
    widgetId = randomUUID();

    await admin`
      INSERT INTO companies (id, name, slug) VALUES
        (${companyUuid}, 'Pilot',     ${"p-" + companyUuid.slice(0, 8)}),
        (${otherUuid},   'Elsewhere', ${"e-" + otherUuid.slice(0, 8)})
    `;
    await admin`
      INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
      VALUES ('companies', ${mongoCompanyId}, ${companyUuid})
    `;
    await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      await tx`
        INSERT INTO parties (id, company_id, primary_type, is_customer, name)
        VALUES (${customerId}, ${companyUuid}, 'customer', true, 'Acme Ltd')
      `;
      await tx`
        INSERT INTO products (id, company_id, sku, name, cost_price, selling_price, quantity_on_hand)
        VALUES (${widgetId}, ${companyUuid}, 'WID-1', 'Widget', 40, 250, 100)
      `;
    });
    // A customer belonging to the OTHER tenant, to prove the scope holds.
    await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${otherUuid}, true)`;
      await tx`
        INSERT INTO parties (id, company_id, primary_type, is_customer, name)
        VALUES (${randomUUID()}, ${otherUuid}, 'customer', true, 'Not Yours Ltd')
      `;
    });
  });

  it("resolves the key's company and scopes the transaction to it", async () => {
    apiKeyAuth.mockResolvedValue(keyContext());

    let seen;
    const res = await withApiKeyTenant(request, {}, async (tx, ctx) => {
      seen = ctx;
      const rows = await tx.execute(`SELECT name FROM parties ORDER BY name`);
      return Response.json({ names: rows.map((r) => r.name) });
    });

    expect(seen.companyId).toBe(companyUuid);
    expect(seen.sourceCompanyId).toBe(mongoCompanyId);
    // The other tenant's customer is not visible, and nothing in the callback
    // filtered it out — the policy did.
    const body = await res.json();
    expect(body.names).toEqual(["Acme Ltd"]);
  });

  it("passes the middleware's own response straight through when auth fails", async () => {
    const denied = Response.json({ success: false }, { status: 401 });
    apiKeyAuth.mockResolvedValue({ ok: false, response: denied });

    const ran = vi.fn();
    const res = await withApiKeyTenant(request, { requireScope: "invoices:read" }, ran);

    expect(res).toBe(denied);
    // The callback must not run, and no transaction should have been opened.
    expect(ran).not.toHaveBeenCalled();
  });

  it("acts as the person who created the key, not as the key", async () => {
    apiKeyAuth.mockResolvedValue(keyContext());

    const created = await withApiKeyTenant(request, {}, async (tx, ctx) => {
      const inv = await invoicesRepo.createInvoice(tx, {
        companyId: ctx.companyId,
        customerId,
        invoiceDate: "2026-08-20",
        lines: [
          {
            itemType: "product",
            productId: widgetId,
            quantity: "2.0000",
            unitPrice: "250.0000",
            taxRate: "0.0000",
            fulfilmentSource: "inventory",
          },
        ],
        createdById: ctx.actorId,
        createdByName: ctx.actorName,
        createdByRole: "api",
      });
      return Response.json({ id: inv.id });
    });

    const { id } = await created.json();
    const [row] = await admin`
      SELECT created_by_id, created_by_role FROM invoices WHERE id = ${id}
    `;
    // A user id, so the foreign key 0036 defers still lands cleanly later.
    expect(row.created_by_id).toBe(KEY_OWNER);
    expect(row.created_by_role).toBe("api");
  });

  it("records no actor rather than inventing one, for a key with no creator", async () => {
    apiKeyAuth.mockResolvedValue(keyContext({ key: {} }));

    let seen;
    await withApiKeyTenant(request, {}, async (tx, ctx) => {
      seen = ctx;
      return Response.json({});
    });

    expect(seen.actorId).toBeNull();
  });

  it("turns a broken invariant into a 409, not a 500", async () => {
    apiKeyAuth.mockResolvedValue(keyContext());

    const res = await withApiKeyTenant(request, {}, async (tx) => {
      // Two parties with the same id — a unique violation, class 23.
      await tx.execute(
        `INSERT INTO parties (id, company_id, primary_type, is_customer, name)
         VALUES ('${customerId}', '${companyUuid}', 'customer', true, 'Dup')`,
      );
      return Response.json({});
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("CONSTRAINT_VIOLATION");
  });

  it("refuses a company id that maps to no tenant, without inventing one", async () => {
    apiKeyAuth.mockResolvedValue(keyContext({ companyId: "" }));

    const res = await withApiKeyTenant(request, {}, async () => Response.json({}));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("TENANT_UNAVAILABLE");
  });
});
