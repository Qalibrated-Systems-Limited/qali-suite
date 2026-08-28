/**
 * `getCompanyThresholds` accepts both forms of company id.
 *
 * It resolves a MONGO id through `_migration_id_map` — the form the session
 * carries and the Mongo actions pass. Every POSTGRES caller reads its company
 * from `withAuthorizedTenant`, where `ctx.companyId` is `acting.companyUuid`,
 * and a UUID has no row in that map: it resolved to null and threw "This
 * company has no ledger tenant yet" on a company that plainly exists.
 *
 * Four call sites did it, three of them shipped — the invoice discount cap,
 * the bill-payment threshold, the expense-payment threshold, and stock
 * adjustments. Three are financial CONTROLS, and this module is deliberately
 * written to fail CLOSED, so the control did not silently pass: it took the
 * action down.
 *
 * It survived because the two threshold suites mock this module entirely, so
 * the id that reaches the resolver in a test was never the one production
 * sends. That is what this file exists to stop.
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
// `companyConfig` reaches `tenant.ts`, which pulls NextAuth in through the
// session helper. Nothing here needs a session — the id is passed in.
vi.mock("@/lib/utils/tenant-utils", () => ({ getTenantContext: vi.fn() }));

const { getCompanyThresholds } = await import("@/app/db/companyConfig");

suite("company thresholds", () => {
  let admin;
  let companyUuid;
  let mongoCompanyId;

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, users, _migration_id_map, entry_counters CASCADE`;
    companyUuid = randomUUID();
    mongoCompanyId = randomUUID().replace(/-/g, "").slice(0, 24);

    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyUuid}, 'Pilot', ${"p-" + companyUuid.slice(0, 8)})`;
    await admin`
      INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
      VALUES ('companies', ${mongoCompanyId}, ${companyUuid})`;
    await admin`
      INSERT INTO company_settings (company_id, stock_adjustment_value)
      VALUES (${companyUuid}, 12345)`;
  });

  it("takes the Mongo id the session carries", async () => {
    // This one failed for a SECOND reason: `lookupCompanyUuid` joined
    // `companies`, which is RLS'd, on a connection with no tenant context —
    // so the map row was found and the join threw it away, for every id.
    const t = await getCompanyThresholds(mongoCompanyId);
    expect(t.stockAdjustmentValue).toBe(12345);
  });

  it("takes the UUID every Postgres action holds", async () => {
    // This is the one that threw. `ctx.companyId` is a uuid, and a uuid has no
    // row in `_migration_id_map`.
    const t = await getCompanyThresholds(companyUuid);
    expect(t.stockAdjustmentValue).toBe(12345);
  });

  it("writes through the same resolver, in either form", async () => {
    const { saveCompanyThresholds } = await import("@/app/db/companyConfig");

    await saveCompanyThresholds(companyUuid, { stockAdjustmentValue: 777 });
    const [byUuid] = await admin`
      SELECT stock_adjustment_value::float8 AS v FROM company_settings
      WHERE company_id = ${companyUuid}`;
    expect(byUuid.v).toBe(777);

    await saveCompanyThresholds(mongoCompanyId, { stockAdjustmentValue: 888 });
    const [byMongo] = await admin`
      SELECT stock_adjustment_value::float8 AS v FROM company_settings
      WHERE company_id = ${companyUuid}`;
    expect(byMongo.v).toBe(888);
  });

  it("still fails CLOSED on an id that names no company", async () => {
    // The point of the module: no silent fallback to platform defaults. A
    // control that fails open is worse than one that fails.
    await expect(getCompanyThresholds(randomUUID())).rejects.toThrow();
    await expect(getCompanyThresholds("nosuchcompanyid000000000")).rejects.toThrow(
      /no ledger tenant/i,
    );
  });
});
