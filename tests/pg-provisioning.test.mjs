/**
 * Tenant provisioning.
 *
 * Every Postgres-backed page depends on the tenant existing in Postgres, so
 * this is the thing that has to work before anything else does. A company is
 * provisioned as part of being created; a company that predates that is
 * provisioned the first time it is used.
 *
 * Provisioning is NOT data migration. It creates the tenant, its chart of
 * accounts and its fiscal periods — an empty set of books. Moving historical
 * documents across is a separate, deliberate operation (app/db/backfill).
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
vi.mock("@/lib/utils/tenant-utils", () => ({ getTenantContext: vi.fn() }));

const { getTenantContext } = await import("@/lib/utils/tenant-utils");
const { provisionCompany, isCompanyProvisioned } = await import(
  "@/app/db/provisioning"
);
const { getStandardChartOfAccounts } = await import("@/lib/chart-of-accounts");
const billActions = await import("@/app/db/actions/bill-actions");

/** A Mongo-shaped id, which is what a session carries during the transition. */
const sourceId = () => randomUUID().replace(/-/g, "").slice(0, 24);

suite("tenant provisioning", () => {
  let admin;

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies CASCADE`;
    await admin`TRUNCATE _migration_id_map, entry_counters`;
  });

  const scoped = (companyId, fn) =>
    admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyId}, true)`;
      return fn(tx);
    });

  it("creates the tenant, its accounts and its periods", async () => {
    const source = sourceId();
    const { companyId, created } = await provisionCompany({
      sourceCompanyId: source,
      name: "Pilot Tenant",
      slug: "pilot",
      baseCurrency: "kes",
      fiscalYearStart: new Date(2026, 0, 1),
    });

    expect(created).toBe(true);

    const [company] = await scoped(
      companyId,
      (tx) => tx`SELECT name, slug, base_currency FROM companies WHERE id = ${companyId}`,
    );
    expect(company.name).toBe("Pilot Tenant");
    // The column is uppercase by convention; "kes" would fail a later lookup.
    expect(company.base_currency).toBe("KES");

    const accounts = await scoped(
      companyId,
      (tx) => tx`SELECT count(*)::int AS n FROM accounts`,
    );
    expect(accounts[0].n).toBe(getStandardChartOfAccounts().length);

    const periods = await scoped(
      companyId,
      (tx) => tx`SELECT period_code, status::text FROM fiscal_periods ORDER BY period_code`,
    );
    expect(periods).toHaveLength(12);
    expect(periods[0].period_code).toBe("2026-01");
    expect(periods[11].period_code).toBe("2026-12");
    // Only the first is open: opening all twelve lets a posting land in a
    // month nobody has reached, which is the control a period exists for.
    expect(periods[0].status).toBe("open");
    expect(periods.slice(1).every((p) => p.status === "future")).toBe(true);
  });

  it("maps the source id so the session can resolve it", async () => {
    const source = sourceId();
    expect(await isCompanyProvisioned(source)).toBe(false);

    const { companyId } = await provisionCompany({
      sourceCompanyId: source,
      name: "Pilot",
    });

    expect(await isCompanyProvisioned(source)).toBe(true);
    const [row] = await admin`
      SELECT new_uuid FROM _migration_id_map
       WHERE collection = 'companies' AND old_object_id = ${source}
    `;
    expect(row.new_uuid).toBe(companyId);
  });

  it("is idempotent: provisioning twice adopts the first tenant", async () => {
    const source = sourceId();
    const first = await provisionCompany({ sourceCompanyId: source, name: "Pilot" });
    const second = await provisionCompany({ sourceCompanyId: source, name: "Pilot" });

    expect(second.companyId).toBe(first.companyId);
    expect(second.created).toBe(false);

    const [companies] = await admin`SELECT count(*)::int AS n FROM companies`;
    expect(companies.n).toBe(1);
    const accounts = await scoped(
      first.companyId,
      (tx) => tx`SELECT count(*)::int AS n FROM accounts`,
    );
    expect(accounts[0].n).toBe(getStandardChartOfAccounts().length);
  });

  it("builds the account hierarchy and makes parents unpostable", async () => {
    const { companyId } = await provisionCompany({
      sourceCompanyId: sourceId(),
      name: "Pilot",
    });

    const [assets] = await scoped(
      companyId,
      (tx) => tx`SELECT id, can_post, level FROM accounts WHERE account_code = '1000'`,
    );
    // 1000 "Assets" is a header with children, so nothing posts to it.
    expect(assets.can_post).toBe(false);

    const [current] = await scoped(
      companyId,
      (tx) => tx`SELECT parent_id, level FROM accounts WHERE account_code = '1100'`,
    );
    expect(current.parent_id).toBe(assets.id);
    expect(current.level).toBe(1);

    // Nothing is left orphaned: every parentCode in the definition resolved.
    const orphans = await scoped(
      companyId,
      (tx) => tx`SELECT count(*)::int AS n FROM accounts WHERE parent_id IS NULL`,
    );
    const roots = getStandardChartOfAccounts().filter((a) => !a.parentCode).length;
    expect(orphans[0].n).toBe(roots);
  });

  it("gives the tenant the system accounts the posting paths look up", async () => {
    const { companyId } = await provisionCompany({
      sourceCompanyId: sourceId(),
      name: "Pilot",
    });

    // Every role a ported posting path resolves. A tenant missing one of these
    // cannot complete an invoice or approve a bill, and would find out at the
    // moment of posting rather than at provisioning.
    const required = [
      "accounts_receivable",
      "accounts_payable",
      "sales_revenue",
      "vat_output",
      "vat_input",
      "wht_payable",
      "cogs",
      "inventory",
    ];
    const rows = await scoped(
      companyId,
      (tx) => tx`
        SELECT system_account FROM accounts WHERE system_account IS NOT NULL
      `,
    );
    const present = new Set(rows.map((r) => r.system_account));
    for (const role of required) {
      expect(present.has(role), `missing system account: ${role}`).toBe(true);
    }
  });

  it("provisions a tenant that predates provisioning, on first use", async () => {
    // No company, no mapping — a session from before any of this existed.
    const source = sourceId();
    getTenantContext.mockResolvedValue({
      user: { id: randomUUID(), name: "Ada", role: "Manager" },
      companyId: source,
      companyCode: "ACME",
    });

    // An ordinary read. It must work, not explain a migration to whoever
    // happened to open the page.
    const { bills, pagination } = await billActions.listBillsForPage({});
    expect(bills).toEqual([]);
    expect(pagination.total).toBe(0);

    expect(await isCompanyProvisioned(source)).toBe(true);
    const [company] = await admin`
      SELECT c.name, c.slug FROM companies c
        JOIN _migration_id_map m ON m.new_uuid = c.id
       WHERE m.collection = 'companies' AND m.old_object_id = ${source}
    `;
    // Labelled from what the session actually knows.
    expect(company.name).toBe("ACME");

    // And it is a usable tenant, not just a row: the books are there.
    const stats = await billActions.getBillsStats();
    expect(stats.pendingApproval.count).toBe(0);
  });

  it("keeps tenants apart", async () => {
    const a = await provisionCompany({ sourceCompanyId: sourceId(), name: "A" });
    const b = await provisionCompany({ sourceCompanyId: sourceId(), name: "B" });
    expect(a.companyId).not.toBe(b.companyId);

    // Through the APPLICATION role, which is the one that must not bypass RLS.
    const app = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, {
      max: 1,
      onnotice: () => {},
    });
    try {
      const seen = await app.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${a.companyId}, true)`;
        return tx`SELECT count(*)::int AS n FROM companies`;
      });
      // Since 0024, companies is itself under RLS keyed on its own id: a
      // tenant sees itself and no one else, so a customer list is not
      // readable by every connection on the platform.
      expect(seen[0].n).toBe(1);

      const accounts = await app.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${a.companyId}, true)`;
        return tx`SELECT count(*)::int AS n FROM accounts`;
      });
      expect(accounts[0].n).toBe(getStandardChartOfAccounts().length);
    } finally {
      await app.end();
    }
  });
});
