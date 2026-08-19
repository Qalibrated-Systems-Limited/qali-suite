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
const {
  syncCompanyRecord,
  setCompanyActive,
  resetCompanyBooks,
} = await import("@/app/db/companyAdmin");
const billActions = await import("@/app/db/actions/bill-actions");
const { withUserScope } = await import("@/app/db/client");
const access = await import("@/app/db/repositories/companyAccess");
const accessAdmin = await import("@/app/db/companyAccessAdmin");
const platform = await import("@/app/db/platform");
const userAdmin = await import("@/app/db/userAdmin");
const usersRepo = await import("@/app/db/repositories/users");

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

  /**
   * Runs a query with the tenant scope set.
   *
   * NOTE: `admin` connects as the owner, which BYPASSES row-level security
   * (§9A). So this sets the scope for anything that reads
   * current_setting('app.company_id') — triggers, generated columns — but it
   * does NOT filter rows. Any assertion that counts rows across a fixture with
   * more than one tenant must say `WHERE company_id = ...` itself.
   */
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

  describe("lifecycle", () => {
    it("keeps the tenant row in step when the company is renamed", async () => {
      const source = sourceId();
      const { companyId } = await provisionCompany({
        sourceCompanyId: source,
        name: "Old Name",
        slug: "old",
        baseCurrency: "KES",
      });

      // Nothing kept these in step, so a renamed company held its old name in
      // Postgres indefinitely.
      await syncCompanyRecord(source, {
        name: "New Name",
        slug: "new",
        baseCurrency: "usd",
      });

      const [row] = await scoped(
        companyId,
        (tx) => tx`SELECT name, slug, base_currency FROM companies WHERE id = ${companyId}`,
      );
      expect(row.name).toBe("New Name");
      expect(row.slug).toBe("new");
      expect(row.base_currency).toBe("USD");
    });

    it("refuses a deactivated tenant at the gate", async () => {
      const source = sourceId();
      await provisionCompany({ sourceCompanyId: source, name: "Pilot" });
      getTenantContext.mockResolvedValue({
        user: { id: "507f1f77bcf86cd799439011", name: "Ada", role: "Manager" },
        companyId: source,
        companyCode: "PILOT",
      });

      // Works while active.
      await expect(billActions.getBillsStats()).resolves.toBeDefined();

      await setCompanyActive(source, false);

      // is_active existed and NOTHING read it, so "deleting" a company left
      // its books readable and writable. Reads now refuse outright rather than
      // returning an empty page — an empty ledger and a closed tenant are very
      // different statements to make to somebody.
      await expect(billActions.listBillsForPage({})).rejects.toThrow(/not active/i);
      const result = await billActions.submitBill(randomUUID());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not active/i);

      await setCompanyActive(source, true);
      await expect(billActions.getBillsStats()).resolves.toBeDefined();
    });

    it("wipes the Postgres books on reset, and keeps the master data", async () => {
      const source = sourceId();
      const { companyId } = await provisionCompany({
        sourceCompanyId: source,
        name: "Pilot",
      });

      const supplierId = randomUUID();
      const productId = randomUUID();
      const [expense] = await scoped(
        companyId,
        (tx) => tx`SELECT id FROM accounts WHERE account_code = '5100' LIMIT 1`,
      );

      await scoped(companyId, async (tx) => {
        await tx`INSERT INTO parties (id, company_id, primary_type, is_supplier, name)
                 VALUES (${supplierId}, ${companyId}, 'supplier', true, 'Shell')`;
        await tx`INSERT INTO products (id, company_id, sku, name, quantity_on_hand)
                 VALUES (${productId}, ${companyId}, 'WID-1', 'Widget', 100)`;
        await tx`
          INSERT INTO journal_entries (company_id, entry_number, entry_date, entry_type, description, status)
          VALUES (${companyId}, 'JE-1', '2026-08-01', 'adjustment', 'Test', 'draft')
        `;
        await tx`
          INSERT INTO entry_counters (company_id, prefix, last_value)
          VALUES (${companyId}, 'INV', 42)
          ON CONFLICT DO NOTHING
        `;
      });

      const before = await resetCompanyBooks(source, { dryRun: true });
      expect(before.totalDeleted).toBeGreaterThan(0);
      // A dry run counts and changes nothing.
      const [stillThere] = await scoped(
        companyId,
        (tx) => tx`SELECT count(*)::int AS n FROM journal_entries`,
      );
      expect(stillThere.n).toBe(1);

      const result = await resetCompanyBooks(source);
      expect(result.totalDeleted).toBeGreaterThan(0);

      const [entries] = await scoped(
        companyId,
        (tx) => tx`SELECT count(*)::int AS n FROM journal_entries`,
      );
      expect(entries.n).toBe(0);

      // Numbering restarts, matching what the reset tells the user.
      const [counters] = await scoped(
        companyId,
        (tx) => tx`SELECT count(*)::int AS n FROM entry_counters`,
      );
      expect(counters.n).toBe(0);

      // Master data survives, and the same keep-policy as the Mongo engine.
      const [accounts] = await scoped(
        companyId,
        (tx) => tx`SELECT count(*)::int AS n FROM accounts`,
      );
      expect(accounts.n).toBe(getStandardChartOfAccounts().length);
      const [periods] = await scoped(
        companyId,
        (tx) => tx`SELECT count(*)::int AS n FROM fiscal_periods`,
      );
      expect(periods.n).toBe(12);
      const [parties] = await scoped(
        companyId,
        (tx) => tx`SELECT count(*)::int AS n FROM parties`,
      );
      expect(parties.n).toBe(1);

      // Catalogue kept, quantities zeroed — as the Mongo engine does.
      const [product] = await scoped(
        companyId,
        (tx) => tx`SELECT quantity_on_hand::text AS q FROM products WHERE id = ${productId}`,
      );
      expect(product.q).toBe("0.0000");
    });

    it("wipes parties too when asked", async () => {
      const source = sourceId();
      const { companyId } = await provisionCompany({ sourceCompanyId: source, name: "Pilot" });
      await scoped(companyId, (tx) =>
        tx`INSERT INTO parties (company_id, primary_type, is_supplier, name)
           VALUES (${companyId}, 'supplier', true, 'Shell')`);

      await resetCompanyBooks(source, { wipeParties: true });

      const [parties] = await scoped(
        companyId,
        (tx) => tx`SELECT count(*)::int AS n FROM parties`,
      );
      expect(parties.n).toBe(0);
    });

    it("leaves another tenant's books alone", async () => {
      const a = sourceId();
      const b = sourceId();
      const A = await provisionCompany({ sourceCompanyId: a, name: "A" });
      const B = await provisionCompany({ sourceCompanyId: b, name: "B" });

      for (const c of [A.companyId, B.companyId]) {
        await scoped(c, (tx) =>
          tx`INSERT INTO journal_entries (company_id, entry_number, entry_date, entry_type, description, status)
             VALUES (${c}, 'JE-1', '2026-08-01', 'adjustment', 'Test', 'draft')`);
      }

      await resetCompanyBooks(a);

      // Counted with an EXPLICIT company_id, not by scope. `admin` connects as
      // the owner and bypasses every policy (§9A), so a scoped count here
      // returns both tenants' rows and reads as "nothing was deleted" — which
      // is how this assertion failed first time round, on correct code.
      const [gone] = await admin`
        SELECT count(*)::int AS n FROM journal_entries WHERE company_id = ${A.companyId}
      `;
      expect(gone.n).toBe(0);

      // TRUNCATE would have taken both — it ignores RLS entirely (§9A.1).
      const [left] = await admin`
        SELECT count(*)::int AS n FROM journal_entries WHERE company_id = ${B.companyId}
      `;
      expect(left.n).toBe(1);
    });
  });

  describe("what a missing or racing tenant does", () => {
    it("refuses a session with no company rather than inventing one", async () => {
      for (const companyId of [null, undefined, "", "null", "undefined"]) {
        getTenantContext.mockResolvedValue({
          user: { id: "507f1f77bcf86cd799439011", name: "Ada", role: "Manager" },
          companyId,
          companyCode: null,
        });

        await expect(
          billActions.getBillsStats(),
          String(companyId),
        ).rejects.toThrow(/No company selected/i);
      }

      // This provisioned a tenant called "Company null" with slug "null" — a
      // real row in the tenant list, created by opening a dashboard page.
      const [n] = await admin`SELECT count(*)::int AS n FROM companies`;
      expect(n.n).toBe(0);
    });

    it("lets a SuperAdmin with no company act as the only one there is", async () => {
      const source = sourceId();
      await provisionCompany({ sourceCompanyId: source, name: "Only Tenant" });

      getTenantContext.mockResolvedValue({
        user: { id: "507f1f77bcf86cd799439011", name: "Root", role: "SuperAdmin" },
        companyId: null,
        companyCode: null,
      });

      // Not an exemption from tenancy — a choice of tenant, with every policy
      // still applied. Mongo returns the query UNSCOPED for a SuperAdmin
      // (tenant-utils.js:116), which is the §2.2 model RLS replaces.
      const stats = await billActions.getBillsStats();
      expect(stats.pendingApproval.count).toBe(0);

      // And it acted as the existing tenant rather than making a second one.
      const [n] = await admin`SELECT count(*)::int AS n FROM companies`;
      expect(n.n).toBe(1);
    });

    it("refuses to guess when a SuperAdmin could mean either of two tenants", async () => {
      await provisionCompany({ sourceCompanyId: sourceId(), name: "A" });
      await provisionCompany({ sourceCompanyId: sourceId(), name: "B" });

      getTenantContext.mockResolvedValue({
        user: { id: "507f1f77bcf86cd799439011", name: "Root", role: "SuperAdmin" },
        companyId: null,
        companyCode: null,
      });

      // Picking one silently would show a platform administrator one
      // customer's books while they believed they were reading another's.
      await expect(billActions.getBillsStats()).rejects.toThrow(
        /You have access to 2\. Choose one/i,
      );
    });

    it("tells a SuperAdmin when there is nothing set up at all", async () => {
      getTenantContext.mockResolvedValue({
        user: { id: "507f1f77bcf86cd799439011", name: "Root", role: "SuperAdmin" },
        companyId: null,
        companyCode: null,
      });
      await expect(billActions.getBillsStats()).rejects.toThrow(
        /No company has been set up/i,
      );
    });

    it("provisions once when parallel requests race for the same tenant", async () => {
      const source = sourceId();

      // Next renders a page's server components in parallel, so the first load
      // of an unprovisioned tenant fires several of these at once. All of them
      // missed, all of them inserted, one won and the rest failed on the
      // slug's unique index.
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          provisionCompany({ sourceCompanyId: source, name: "Racer" }),
        ),
      );

      const ids = new Set(results.map((r) => r.companyId));
      expect(ids.size).toBe(1);
      expect(results.filter((r) => r.created)).toHaveLength(1);

      const [companies] = await admin`SELECT count(*)::int AS n FROM companies`;
      expect(companies.n).toBe(1);
      const accounts = await scoped(
        [...ids][0],
        (tx) => tx`SELECT count(*)::int AS n FROM accounts`,
      );
      // And exactly one chart of accounts, not five overlaid.
      expect(accounts[0].n).toBe(getStandardChartOfAccounts().length);
    });

    it("recovers when the company row is gone but the mapping remains", async () => {
      const source = sourceId();
      const { companyId } = await provisionCompany({
        sourceCompanyId: source,
        name: "Pilot",
      });

      // Point the mapping at a company that is not there. This is the state a
      // developer hit after the test suite truncated the dev database, and it
      // is reproduced this way rather than by deleting the row because a
      // DELETE cannot produce it: the system-account guard from 0001 refuses
      // the cascade ("Cannot delete system account Petty Cash"). Only a
      // TRUNCATE, which does not fire row triggers, gets here — which is
      // exactly what happened.
      const vanished = randomUUID();
      await admin`
        UPDATE _migration_id_map SET new_uuid = ${vanished}
         WHERE collection = 'companies' AND old_object_id = ${source}
      `;

      getTenantContext.mockResolvedValue({
        user: { id: "507f1f77bcf86cd799439011", name: "Ada", role: "Manager" },
        companyId: source,
        companyCode: "PILOT",
      });

      // An ordinary read has to work.
      const stats = await billActions.getBillsStats();
      expect(stats.pendingApproval.count).toBe(0);

      const [row] = await admin`
        SELECT c.id, c.name FROM companies c
          JOIN _migration_id_map m ON m.new_uuid = c.id
         WHERE m.collection = 'companies' AND m.old_object_id = ${source}
      `;
      expect(row).toBeDefined();
      expect(row.id).not.toBe(vanished);
    });
  });

  /**
   * The company record moved to Postgres (0035) — including the settings the
   * books obey, which is the point: a rule read from another store is a rule
   * outside the transaction that has to honour it.
   */
  describe("company record", () => {
    it("creates the rules the books obey along with the company", async () => {
      const { companyId } = await provisionCompany({
        sourceCompanyId: sourceId(),
        name: "Pilot",
      });

      const [settings] = await scoped(
        companyId,
        (tx) => tx`SELECT * FROM company_settings WHERE company_id = ${companyId}`,
      );
      // Defaults, not nothing. A tenant with no settings row would have no VAT
      // rate, no thresholds and no prefixes, and every read of them would have
      // to invent an answer.
      expect(settings).toBeDefined();
      expect(Number(settings.default_vat_rate)).toBe(16);
      expect(settings.invoice_prefix).toBe("INV");
      expect(settings.stock_high_risk_types).toEqual([
        "theft",
        "write_off",
        "expiry",
      ]);
    });

    it("numbers documents with the prefix the tenant configured", async () => {
      const { companyId } = await provisionCompany({
        sourceCompanyId: sourceId(),
        name: "Pilot",
      });

      // The bug this closes: settings.invoicePrefix existed, the UI wrote it,
      // and the ported repository numbered with a hardcoded 'INV'.
      await scoped(
        companyId,
        (tx) => tx`UPDATE company_settings SET invoice_prefix = 'SI'
                    WHERE company_id = ${companyId}`,
      );

      const [{ n }] = await scoped(
        companyId,
        (tx) => tx`SELECT next_entry_number(
                     ${companyId}::uuid,
                     document_prefix(${companyId}::uuid, 'invoice')
                   ) AS n`,
      );
      expect(n).toBe("SI-00001");

      // A kind with no setting still numbers, rather than producing "-00001".
      const [{ p }] = await scoped(
        companyId,
        (tx) => tx`SELECT document_prefix(${companyId}::uuid, 'grn') AS p`,
      );
      expect(p).toBe("GRN");
    });

    it("cannot let is_active drift from status", async () => {
      const source = sourceId();
      const { companyId } = await provisionCompany({
        sourceCompanyId: source,
        name: "Pilot",
      });

      await setCompanyActive(source, false, "suspended");

      const [row] = await scoped(
        companyId,
        (tx) => tx`SELECT status, is_active FROM companies WHERE id = ${companyId}`,
      );
      // Two flags for one fact is a drift waiting to happen, so is_active is
      // GENERATED and cannot be written at all.
      expect(row.status).toBe("suspended");
      expect(row.is_active).toBe(false);

      await expect(
        scoped(
          companyId,
          (tx) => tx`UPDATE companies SET is_active = true WHERE id = ${companyId}`,
        ),
      ).rejects.toThrow(/can only be updated to DEFAULT/i);
    });

    it("carries the whole company document, not three fields", async () => {
      const source = sourceId();
      const { companyId } = await provisionCompany({
        sourceCompanyId: source,
        name: "Pilot",
      });

      await syncCompanyRecord(source, {
        name: "Pilot Traders",
        code: "qsl",
        email: "Books@Pilot.CO.KE",
        taxPin: "p051234567x",
        address: { city: "Nairobi", country: "Kenya" },
        bankName: "Equity",
        status: "active",
        subscription: { plan: "professional", status: "active", maxUsers: 25 },
        settings: {
          currency: "usd",
          defaultVatRate: 0,
          invoicePrefix: "SI",
          approvalThresholds: { billPaymentValue: 250000 },
        },
        features: { multiCurrency: true },
      });

      const [c] = await scoped(
        companyId,
        (tx) => tx`SELECT * FROM companies WHERE id = ${companyId}`,
      );
      expect(c.name).toBe("Pilot Traders");
      // Normalised on the way in, the way Mongo's setters did it.
      expect(c.code).toBe("QSL");
      expect(c.email).toBe("books@pilot.co.ke");
      expect(c.tax_pin).toBe("P051234567X");
      expect(c.base_currency).toBe("USD");
      expect(c.plan).toBe("professional");
      expect(c.max_users).toBe(25);
      expect(c.city).toBe("Nairobi");

      const [s] = await scoped(
        companyId,
        (tx) => tx`SELECT * FROM company_settings WHERE company_id = ${companyId}`,
      );
      // Zero is a real VAT rate, not a missing one — an exempt tenant must not
      // be handed 16% because 0 looked falsy on the way through.
      expect(Number(s.default_vat_rate)).toBe(0);
      expect(s.invoice_prefix).toBe("SI");
      expect(Number(s.bill_payment_value)).toBe(250000);
      expect(s.feature_multi_currency).toBe(true);
      // Untouched keys keep their defaults rather than being blanked by a form
      // that never showed them.
      expect(Number(s.stock_adjustment_value)).toBe(50000);
    });
  });

  /**
   * Logins (0036) — the table 0031 said did not exist yet, which is why 47
   * actor columns are bare text with a name snapshot.
   */
  describe("users", () => {
    const USER_ID = "507f1f77bcf86cd799439055";

    it("keeps the id the rest of the system already uses", async () => {
      const source = sourceId();
      await provisionCompany({ sourceCompanyId: source, name: "Pilot" });

      await userAdmin.syncUser({
        id: USER_ID,
        name: "Jane Wanjiru",
        email: "Jane@Pilot.CO.KE",
        role: "Accountant",
        status: "Active",
        companyId: source,
        tokenVersion: 3,
      });

      const [u] = await admin`SELECT * FROM users WHERE id = ${USER_ID}`;
      // A uuid key here would have meant rewriting 47 actor columns and
      // carrying a second id map forever.
      expect(u.id).toBe(USER_ID);
      // Lowercased in the column, not by a setter that a raw write can skip.
      expect(u.email).toBe("jane@pilot.co.ke");
      // Mongo's "Active" becomes the lowercase the CHECK allows.
      expect(u.status).toBe("active");
      expect(u.token_version).toBe(3);
      expect(u.home_company_id).not.toBeNull();
    });

    it("converges when run twice, and does not blank what it was not told", async () => {
      const source = sourceId();
      await provisionCompany({ sourceCompanyId: source, name: "Pilot" });

      await userAdmin.syncUser({
        id: USER_ID,
        name: "Jane Wanjiru",
        email: "jane@pilot.co.ke",
        department: "Finance",
        companyId: source,
      });
      // A caller that changed a role must not blank a department it never saw.
      await userAdmin.syncUser({ id: USER_ID, role: "CFO" });

      const [u] = await admin`SELECT * FROM users WHERE id = ${USER_ID}`;
      expect(u.role).toBe("CFO");
      expect(u.department).toBe("Finance");
      expect(u.name).toBe("Jane Wanjiru");
    });

    it("shows a user themselves, and their colleagues, and nobody else's", async () => {
      const a = sourceId();
      const b = sourceId();
      const A = await provisionCompany({ sourceCompanyId: a, name: "A" });
      const B = await provisionCompany({ sourceCompanyId: b, name: "B" });

      await userAdmin.syncUser({ id: "user-a1", name: "A One", email: "a1@a.co", companyId: a });
      await userAdmin.syncUser({ id: "user-a2", name: "A Two", email: "a2@a.co", companyId: a });
      await userAdmin.syncUser({ id: "user-b1", name: "B One", email: "b1@b.co", companyId: b });

      for (const [uid, c] of [["user-a1", A], ["user-a2", A], ["user-b1", B]]) {
        await accessAdmin.grantCompanyAccess({
          sourceCompanyId: uid === "user-b1" ? b : a,
          userId: uid,
        });
      }

      // Through app_user, which does NOT bypass RLS — asserting on the owner
      // connection would pass while enforcing nothing (§9A).
      const app = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, {
        max: 1,
        onnotice: () => {},
      });
      try {
        const colleagues = await app.begin(async (tx) => {
          await tx`SELECT set_config('app.user_id', 'user-a1', true)`;
          await tx`SELECT set_config('app.company_id', ${A.companyId}, true)`;
          return tx`SELECT id FROM users ORDER BY id`;
        });
        expect(colleagues.map((r) => r.id)).toEqual(["user-a1", "user-a2"]);

        // Before a company is chosen, a user still sees themselves — which is
        // what the switcher asks.
        const alone = await app.begin(async (tx) => {
          await tx`SELECT set_config('app.user_id', 'user-a1', true)`;
          return tx`SELECT id FROM users`;
        });
        expect(alone.map((r) => r.id)).toEqual(["user-a1"]);

        // And with no scope at all: nothing, rather than every login on the
        // platform.
        const unscoped = await app.begin((tx) => tx`SELECT id FROM users`);
        expect(unscoped).toHaveLength(0);
      } finally {
        await app.end();
      }
    });

    it("refuses a role that is not a role", async () => {
      const source = sourceId();
      await provisionCompany({ sourceCompanyId: source, name: "Pilot" });

      // roleAllowed answers false for anything off the list, so a role saved
      // as "Acountant" is refused by every gate in the product: the person can
      // sign in and can do nothing, with no error anywhere that says why.
      const err = await userAdmin
        .syncUser({
          id: "typo-user",
          name: "Typo",
          email: "typo@p.co",
          role: "Acountant",
          companyId: source,
        })
        .catch((e) => e);
      // Drizzle wraps the driver error, so the constraint name is on the
      // cause rather than in the message.
      expect(err?.cause?.constraint_name).toBe("users_role_valid");

      await expect(
        userAdmin.syncUser({
          id: "good-user",
          name: "Fine",
          email: "fine@p.co",
          role: "Accountant",
          companyId: source,
        }),
      ).resolves.toBeDefined();
    });

    it("refuses the roles that were retired", async () => {
      const source = sourceId();
      await provisionCompany({ sourceCompanyId: source, name: "Pilot" });

      // A role says what you may do, not what you do all day (0039).
      for (const dead of ["Technician", "CEO", "User", "HR"]) {
        const err = await userAdmin
          .syncUser({
            id: `dead-${dead}`,
            name: dead,
            email: `${dead}@p.co`,
            role: dead,
            companyId: source,
          })
          .catch((e) => e);
        expect(err?.cause?.constraint_name).toBe("users_role_valid");
      }

      // And what they became is accepted.
      for (const live of ["Employee", "Viewer", "HR Manager"]) {
        await expect(
          userAdmin.syncUser({
            id: `live-${live}`,
            name: live,
            email: `${live.replace(" ", "")}@p.co`,
            role: live,
            companyId: source,
          }),
        ).resolves.toBeDefined();
      }
    });

    it("defaults to a role that exists", async () => {
      const source = sourceId();
      const { companyId } = await provisionCompany({ sourceCompanyId: source, name: "P" });

      // The column default has to satisfy the column's own CHECK — it was left
      // as the retired 'User' and every insert that omitted a role would have
      // failed on a value the schema itself supplied (0040).
      await admin`INSERT INTO users (id, name, email, home_company_id)
                  VALUES ('defaulted', 'No Role', 'nr@p.co', ${companyId})`;
      const [u] = await admin`SELECT role FROM users WHERE id = 'defaulted'`;
      expect(u.role).toBe("Employee");
    });

    it("allows a grant with no role of its own", async () => {
      const source = sourceId();
      await provisionCompany({ sourceCompanyId: source, name: "Pilot" });
      await userAdmin.syncUser({ id: "u-null", name: "N", email: "n@p.co", companyId: source });

      // Null means "use the user's global role", which is what every grant
      // carried over from the single-company model says.
      await expect(
        accessAdmin.grantCompanyAccess({
          sourceCompanyId: source,
          userId: "u-null",
          role: null,
        }),
      ).resolves.toMatchObject({ granted: true });

      const err = await accessAdmin
        .grantCompanyAccess({
          sourceCompanyId: source,
          userId: "u-null",
          // A retired role is refused like any other non-role (0039).
          role: "Technician",
        })
        .catch((e) => e);
      expect(err?.cause?.constraint_name).toBe("user_company_access_role_valid");
    });

    it("links a login to its party, per company", async () => {
      const source = sourceId();
      const { companyId } = await provisionCompany({
        sourceCompanyId: source,
        name: "Pilot",
      });
      await userAdmin.syncUser({ id: USER_ID, name: "Jane", email: "j@p.co", companyId: source });
      await accessAdmin.grantCompanyAccess({ sourceCompanyId: source, userId: USER_ID });

      const partyId = randomUUID();
      await scoped(companyId, (tx) =>
        tx`INSERT INTO parties (id, company_id, primary_type, is_employee, name)
           VALUES (${partyId}, ${companyId}, 'employee', true, 'Jane Wanjiru')`);
      await admin`INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
                  VALUES ('parties', 'mongo-party-1', ${partyId})`;

      const result = await userAdmin.linkUserToParty({
        userId: USER_ID,
        sourceCompanyId: source,
        sourcePartyId: "mongo-party-1",
      });
      expect(result.linked).toBe(true);

      const linked = await withUserScope(USER_ID, (tx) =>
        usersRepo.getUserParty(tx, USER_ID, companyId),
      );
      expect(linked).toBe(partyId);
    });

    it("reports a missing grant rather than a silent no-op", async () => {
      const source = sourceId();
      const { companyId } = await provisionCompany({
        sourceCompanyId: source,
        name: "No Grant Ltd",
      });
      await userAdmin.syncUser({ id: USER_ID, name: "Jane", email: "j@p.co", companyId: source });

      const partyId = randomUUID();
      await scoped(companyId, (tx) =>
        tx`INSERT INTO parties (id, company_id, primary_type, is_employee, name)
           VALUES (${partyId}, ${companyId}, 'employee', true, 'Jane Wanjiru')`);
      await admin`INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
                  VALUES ('parties', 'mongo-party-nograft', ${partyId})`;

      // grantCompanyAccess was never called, so the UPDATE matches no row. The
      // link is not written, and the caller is told so — the ordering bug is
      // the call site's, and it is only visible if this says something.
      const result = await userAdmin.linkUserToParty({
        userId: USER_ID,
        sourceCompanyId: source,
        sourcePartyId: "mongo-party-nograft",
      });
      expect(result.linked).toBe(false);
      expect(result.reason).toBe("no-grant");
    });

    it("refuses a party from another company", async () => {
      const a = sourceId();
      const A = await provisionCompany({ sourceCompanyId: a, name: "A" });
      const B = await provisionCompany({ sourceCompanyId: sourceId(), name: "B" });

      await userAdmin.syncUser({ id: USER_ID, name: "Jane", email: "j@p.co", companyId: a });
      await accessAdmin.grantCompanyAccess({ sourceCompanyId: a, userId: USER_ID });

      // A party belonging to B.
      const strayParty = randomUUID();
      await scoped(B.companyId, (tx) =>
        tx`INSERT INTO parties (id, company_id, primary_type, is_customer, name)
           VALUES (${strayParty}, ${B.companyId}, 'customer', true, 'Elsewhere')`);

      // The composite foreign key on (party_id, company_id) makes this
      // impossible rather than merely wrong — a plain reference to parties(id)
      // would allow it, and RLS would not catch it because this path runs
      // privileged.
      await expect(
        admin`UPDATE user_company_access SET party_id = ${strayParty}
               WHERE user_id = ${USER_ID} AND company_id = ${A.companyId}`,
      ).rejects.toThrow(/foreign key|violates/i);
    });
  });

  /**
   * The platform's cross-tenant surface. The ONE place that reads across
   * companies, which is why it runs on the privileged connection.
   */
  describe("platform view", () => {
    it("lists, filters and pages tenants", async () => {
      await provisionCompany({ sourceCompanyId: sourceId(), name: "Alpha Ltd" });
      const b = sourceId();
      await provisionCompany({ sourceCompanyId: b, name: "Beta Traders" });
      await setCompanyActive(b, false, "suspended");

      const all = await platform.searchCompanies();
      expect(all.map((c) => c.name).sort()).toEqual(["Alpha Ltd", "Beta Traders"]);
      // Both ids, because the admin routes still carry the Mongo one.
      expect(all.every((c) => c.id && c.sourceId)).toBe(true);

      const active = await platform.searchCompanies("", 1, { status: "active" });
      expect(active.map((c) => c.name)).toEqual(["Alpha Ltd"]);

      // The Mongo version built { $regex: searchTerm } straight from the query
      // string, so a user typing "(" got a driver error. Here it is data.
      await expect(platform.searchCompanies("(")).resolves.toEqual([]);
      const found = await platform.searchCompanies("beta");
      expect(found.map((c) => c.name)).toEqual(["Beta Traders"]);
    });

    it("counts by status and plan in one pass", async () => {
      const a = sourceId();
      await provisionCompany({ sourceCompanyId: a, name: "Alpha" });
      const b = sourceId();
      await provisionCompany({ sourceCompanyId: b, name: "Beta" });
      await setCompanyActive(b, false, "suspended");
      await syncCompanyRecord(a, { subscription: { plan: "enterprise" } });

      const stats = await platform.getCompanyStats();
      expect(stats.totalCompanies).toBe(2);
      expect(stats.activeCompanies).toBe(1);
      expect(stats.suspendedCompanies).toBe(1);
      expect(stats.enterpriseCount).toBe(1);
      // Provisioned tenants start on trial, which is what the admin header
      // counts as "On Trial".
      expect(stats.trialCount).toBe(2);
    });

    it("reads one company whole, by either id", async () => {
      const source = sourceId();
      const { companyId } = await provisionCompany({
        sourceCompanyId: source,
        name: "Alpha",
      });
      await syncCompanyRecord(source, {
        address: { street: "12 Kenyatta Ave", city: "Nairobi", country: "Kenya" },
        settings: { invoicePrefix: "SI" },
      });

      const byMongoId = await platform.getCompanyRecord(source);
      const byUuid = await platform.getCompanyRecord(companyId);
      expect(byMongoId.id).toBe(companyId);
      expect(byUuid.sourceId).toBe(source);

      // Composed on read, never stored — Mongo kept a fullAddress and a
      // pre-save hook to rebuild it, which is a hook that exists because the
      // value should not have been stored (§8.4).
      expect(byMongoId.fullAddress).toBe("12 Kenyatta Ave, Nairobi, Kenya");
      expect(byMongoId.settings.invoicePrefix).toBe("SI");
      // The transition alias the eighteen ported pages read.
      expect(byMongoId._id).toBe(source);
    });

    it("returns null rather than throwing for a company that is not there", async () => {
      await expect(platform.getCompanyRecord("nope")).resolves.toBeNull();
      await expect(
        platform.getCompanyRecord("00000000-0000-0000-0000-000000000000"),
      ).resolves.toBeNull();
    });
  });

  /**
   * Authorisation is a SET; operating context is ONE of it (0033).
   */
  describe("company access", () => {
    const USER = "507f1f77bcf86cd799439011";
    const asUser = (companyId, role = "Manager") =>
      getTenantContext.mockResolvedValue({
        user: { id: USER, name: "Ada", role },
        companyId,
        companyCode: "PILOT",
        activeCompanyId: null,
      });

    it("seeds a grant from what the system already believed", async () => {
      const source = sourceId();
      await provisionCompany({ sourceCompanyId: source, name: "Pilot" });
      asUser(source);

      await billActions.getBillsStats();

      const grants = await withUserScope(USER, (tx) =>
        access.listAllowedCompanies(tx, USER),
      );
      expect(grants).toHaveLength(1);
      expect(grants[0].name).toBe("Pilot");
    });

    it("shows a user only their own grants, through the application role", async () => {
      const a = sourceId();
      const b = sourceId();
      const A = await provisionCompany({ sourceCompanyId: a, name: "A" });
      const B = await provisionCompany({ sourceCompanyId: b, name: "B" });

      await withUserScope(USER, (tx) =>
        access.grantAccess(tx, { userId: USER, companyId: A.companyId }),
      );
      await withUserScope("other-user", (tx) =>
        access.grantAccess(tx, { userId: "other-user", companyId: B.companyId }),
      );

      // Through app_user, which does NOT bypass RLS — asserting this on the
      // owner connection would pass while enforcing nothing (§9A).
      const app = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, {
        max: 1,
        onnotice: () => {},
      });
      try {
        const mine = await app.begin(async (tx) => {
          await tx`SELECT set_config('app.user_id', ${USER}, true)`;
          return tx`SELECT company_id FROM user_company_access`;
        });
        expect(mine.map((r) => r.company_id)).toEqual([A.companyId]);

        // And with no user scope at all: nothing, rather than everything.
        const unscoped = await app.begin(
          (tx) => tx`SELECT company_id FROM user_company_access`,
        );
        expect(unscoped).toHaveLength(0);
      } finally {
        await app.end();
      }
    });

    it("refuses a company the user does not hold, without swapping in one they do", async () => {
      const a = sourceId();
      const A = await provisionCompany({ sourceCompanyId: a, name: "A" });
      const B = await provisionCompany({ sourceCompanyId: sourceId(), name: "B" });

      getTenantContext.mockResolvedValue({
        user: { id: USER, name: "Ada", role: "Manager" },
        companyId: a,
        companyCode: "A",
        // Asking for B while only holding A.
        activeCompanyId: B.companyId,
      });
      await withUserScope(USER, (tx) =>
        access.grantAccess(tx, { userId: USER, companyId: A.companyId }),
      );

      await expect(billActions.getBillsStats()).rejects.toThrow(
        /do not have access to that company/i,
      );
    });

    it("honours the active choice among several grants", async () => {
      const A = await provisionCompany({ sourceCompanyId: sourceId(), name: "A" });
      const B = await provisionCompany({ sourceCompanyId: sourceId(), name: "B" });
      for (const c of [A, B]) {
        await withUserScope(USER, (tx) =>
          access.grantAccess(tx, { userId: USER, companyId: c.companyId }),
        );
      }

      // A bill in B only.
      await scoped(B.companyId, (tx) =>
        tx`INSERT INTO parties (id, company_id, primary_type, is_supplier, name)
           VALUES (${randomUUID()}, ${B.companyId}, 'supplier', true, 'Shell')`);

      getTenantContext.mockResolvedValue({
        user: { id: USER, name: "Ada", role: "Manager" },
        companyId: null,
        companyCode: null,
        activeCompanyId: A.companyId,
      });
      // Operating on A: B's data is invisible, because RLS is scoped to the
      // ACTIVE company and not to the set the user is authorised for.
      const onA = await billActions.getBillsStats();
      expect(onA.pendingApproval.count).toBe(0);

      getTenantContext.mockResolvedValue({
        user: { id: USER, name: "Ada", role: "Manager" },
        companyId: null,
        companyCode: null,
        activeCompanyId: B.companyId,
      });
      await expect(billActions.getBillsStats()).resolves.toBeDefined();
    });

    it("refuses to guess between two grants with nothing active", async () => {
      const A = await provisionCompany({ sourceCompanyId: sourceId(), name: "A" });
      const B = await provisionCompany({ sourceCompanyId: sourceId(), name: "B" });
      for (const c of [A, B]) {
        await withUserScope(USER, (tx) =>
          access.grantAccess(tx, { userId: USER, companyId: c.companyId }),
        );
      }
      asUser(null);

      await expect(billActions.getBillsStats()).rejects.toThrow(
        /You have access to 2\. Choose one/i,
      );
    });

    it("revokes immediately, without waiting for a token refresh", async () => {
      const source = sourceId();
      const { companyId } = await provisionCompany({
        sourceCompanyId: source,
        name: "Pilot",
      });
      asUser(source);
      await billActions.getBillsStats();

      await withUserScope(USER, (tx) =>
        access.revokeAccess(tx, USER, companyId),
      );

      // The grants are re-read every request rather than trusted from the
      // session, so this takes effect now rather than at the next refresh.
      await expect(billActions.getBillsStats()).rejects.toThrow(
        /do not have access to any company/i,
      );
    });

    it("grants the creator when a company is created", async () => {
      const source = sourceId();
      const { companyId } = await provisionCompany({
        sourceCompanyId: source,
        name: "Pilot",
        ownerUserId: USER,
        ownerName: "Ada",
        ownerRole: "Manager",
      });

      // Not lazily, on their first request — at creation. A company nobody
      // holds is a company nobody can open.
      const grants = await withUserScope(USER, (tx) =>
        access.listAllowedCompanies(tx, USER),
      );
      expect(grants.map((g) => g.id)).toEqual([companyId]);
    });

    it("gives every existing SuperAdmin the NEXT company too", async () => {
      const ROOT = "507f1f77bcf86cd799439099";

      // First company, created by platform staff.
      await provisionCompany({
        sourceCompanyId: sourceId(),
        name: "A",
        ownerUserId: ROOT,
        ownerName: "Root",
        ownerRole: "SuperAdmin",
      });

      // Second, created later and by nobody in particular. Before the fan-out
      // existed this was invisible to Root: lazy seeding only fires for a user
      // holding NO grant at all, and Root already held one.
      const B = await provisionCompany({ sourceCompanyId: sourceId(), name: "B" });

      const grants = await withUserScope(ROOT, (tx) =>
        access.listAllowedCompanies(tx, ROOT),
      );
      expect(grants.map((g) => g.id)).toContain(B.companyId);
      expect(grants).toHaveLength(2);
    });

    it("tops a SuperAdmin up rather than locking them out", async () => {
      // A company that predates this person being made platform staff: no row
      // for them, and standing access means they still get in.
      const A = await provisionCompany({ sourceCompanyId: sourceId(), name: "A" });
      const B = await provisionCompany({ sourceCompanyId: sourceId(), name: "B" });

      await withUserScope(USER, (tx) =>
        access.grantAccess(tx, { userId: USER, companyId: A.companyId }),
      );

      getTenantContext.mockResolvedValue({
        user: { id: USER, name: "Root", role: "SuperAdmin" },
        companyId: null,
        companyCode: null,
        activeCompanyId: B.companyId,
      });
      await expect(billActions.getBillsStats()).resolves.toBeDefined();

      const grants = await withUserScope(USER, (tx) =>
        access.listAllowedCompanies(tx, USER),
      );
      // Written down, not waved through: the access is a row on B, which is
      // what a later audit of B reads.
      expect(grants.map((g) => g.id).sort()).toEqual(
        [A.companyId, B.companyId].sort(),
      );
    });

    it("does NOT top up anyone else", async () => {
      const A = await provisionCompany({ sourceCompanyId: sourceId(), name: "A" });
      const B = await provisionCompany({ sourceCompanyId: sourceId(), name: "B" });

      await withUserScope(USER, (tx) =>
        access.grantAccess(tx, { userId: USER, companyId: A.companyId }),
      );

      getTenantContext.mockResolvedValue({
        user: { id: USER, name: "Ada", role: "Manager" },
        companyId: null,
        companyCode: null,
        activeCompanyId: B.companyId,
      });
      await expect(billActions.getBillsStats()).rejects.toThrow(
        /do not have access to that company/i,
      );
    });

    it("administers access from outside the tenant, and the gate obeys it", async () => {
      const source = sourceId();
      const { companyId } = await provisionCompany({
        sourceCompanyId: source,
        name: "Pilot",
      });

      // A SuperAdmin granting somebody else cannot go through that person's
      // own scope — the grants policy only lets a user write their OWN rows.
      await accessAdmin.grantCompanyAccess({
        sourceCompanyId: source,
        userId: USER,
        grantedById: "root",
        grantedByName: "Root",
      });

      getTenantContext.mockResolvedValue({
        user: { id: USER, name: "Ada", role: "Manager" },
        companyId: null,
        companyCode: null,
        activeCompanyId: companyId,
      });
      await expect(billActions.getBillsStats()).resolves.toBeDefined();

      const members = await accessAdmin.listCompanyMembers(source);
      expect(members).toHaveLength(1);
      expect(members[0].grantedByName).toBe("Root");

      await accessAdmin.revokeCompanyAccess(source, USER);
      await expect(billActions.getBillsStats()).rejects.toThrow(
        /do not have access to that company/i,
      );

      // Suspended, not deleted: "removed in March" is a question somebody
      // will ask, and a row that is gone cannot answer it.
      const after = await accessAdmin.listCompanyMembers(source);
      expect(after).toHaveLength(1);
      expect(after[0].status).toBe("suspended");
    });

    it("gives a SuperAdmin a grant per company, not a bypass", async () => {
      const A = await provisionCompany({ sourceCompanyId: sourceId(), name: "A" });
      const B = await provisionCompany({ sourceCompanyId: sourceId(), name: "B" });

      getTenantContext.mockResolvedValue({
        user: { id: USER, name: "Root", role: "SuperAdmin" },
        companyId: null,
        companyCode: null,
        activeCompanyId: A.companyId,
      });
      await billActions.getBillsStats();

      const grants = await withUserScope(USER, (tx) =>
        access.listAllowedCompanies(tx, USER),
      );
      // Rows, not a role check — which is what answers "who could see this
      // company in March".
      expect(grants.map((g) => g.id).sort()).toEqual(
        [A.companyId, B.companyId].sort(),
      );
    });
  });
});
