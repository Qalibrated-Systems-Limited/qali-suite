/**
 * Creating a company, on Postgres only.
 *
 * The tenant ONBOARDING path — the last screen to move, and the one worth
 * being careful with, because everything else depends on a company existing
 * correctly. There is no Mongo in the deployment, so `Company.create()`,
 * `seedChartOfAccounts()` and `initializeFiscalPeriods()` are gone from it and
 * `provisionCompany` is the whole of the work.
 *
 * These drive the REPOSITORY-level provisioning rather than the server action,
 * because the action reads a NextAuth session. What they pin is the thing the
 * port changed: that a company created with no Mongo id is complete —
 * chart of accounts, fiscal periods, a settings row, and somebody able to open
 * it — and that the id it gets resolves everywhere.
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

const { provisionCompany } = await import("@/app/db/provisioning");
const { syncCompanyRecord } = await import("@/app/db/companyAdmin");
const { getCompanyRecord } = await import("@/app/db/platform");
const { getStandardChartOfAccounts } = await import("@/lib/chart-of-accounts");

suite("creating a company with no Mongo", () => {
  let admin;

  const provision = (over = {}) =>
    provisionCompany({
      // The map key. It stood for the Mongo `_id`; nothing reads it as one.
      sourceCompanyId: over.sourceCompanyId ?? randomUUID(),
      name: over.name ?? "Kerra Contractors",
      slug: over.slug ?? "kerra-" + randomUUID().slice(0, 8),
      baseCurrency: over.baseCurrency ?? "KES",
      fiscalYearStart: over.fiscalYearStart ?? new Date(2026, 0, 1),
      ownerUserId: over.ownerUserId ?? null,
      ownerName: over.ownerName ?? null,
      ownerRole: over.ownerRole ?? null,
    });

  const makeUser = async (role = "SuperAdmin") => {
    const id = randomUUID();
    await admin`INSERT INTO users (id, name, email, role, status)
                VALUES (${id}, 'The Operator',
                        ${randomUUID().slice(0, 8) + "@test.local"}, ${role}, 'active')`;
    return id;
  };

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, users, _migration_id_map, entry_counters CASCADE`;
  }, 300_000);

  // ═══════════════════════════════════════════════════════════════════════════
  describe("a new company is complete", () => {
    it("exists, with the name and currency it was given", async () => {
      const { companyId, created } = await provision({ name: "Kerra Ltd" });
      expect(created).toBe(true);

      const [row] = await admin`SELECT name, base_currency FROM companies
                                 WHERE id = ${companyId}`;
      expect(row.name).toBe("Kerra Ltd");
      expect(row.base_currency).toBe("KES");
    });

    it("has the whole standard chart of accounts", async () => {
      const { companyId } = await provision();
      const [{ n }] = await admin`SELECT COUNT(*)::int AS n FROM accounts
                                   WHERE company_id = ${companyId}`;
      expect(n).toBe(getStandardChartOfAccounts().length);
    });

    it("has its chart WIRED — parents, levels and ltree paths", async () => {
      // `getDescendants()` walks `path <@ path`, and a NULL path matches
      // nothing. Every company provisioned before this was fixed had a chart
      // that could not be walked at all.
      const { companyId } = await provision();
      const [{ n }] = await admin`SELECT COUNT(*)::int AS n FROM accounts
                                   WHERE company_id = ${companyId} AND path IS NULL`;
      expect(n).toBe(0);

      const [child] = await admin`SELECT parent_id, level, path::text AS path
                                    FROM accounts
                                   WHERE company_id = ${companyId}
                                     AND system_account = 'accounts_receivable'`;
      expect(child.parent_id).toBeTruthy();
      expect(child.level).toBeGreaterThan(0);
      expect(child.path).toBeTruthy();
    });

    it("has twelve fiscal periods, only the first of them open", async () => {
      // Opening all twelve would let a posting land in a month nobody has
      // reached yet, which is the control a fiscal period exists to provide.
      const { companyId } = await provision();
      const rows = await admin`SELECT status FROM fiscal_periods
                                WHERE company_id = ${companyId}`;
      expect(rows).toHaveLength(12);
      expect(rows.filter((r) => r.status === "open")).toHaveLength(1);
    });

    it("has a settings row, so nothing has to invent a VAT rate", async () => {
      const { companyId } = await provision();
      const [s] = await admin`SELECT invoice_prefix, sales_order_prefix,
                                     expense_payment_value
                                FROM company_settings WHERE company_id = ${companyId}`;
      expect(s).toBeTruthy();
      expect(s.invoice_prefix).toBe("INV");
      expect(s.sales_order_prefix).toBe("SO");
    });

    it("gives its creator a grant, so it is not born unopenable", async () => {
      const owner = await makeUser("Admin");
      const { companyId } = await provision({
        ownerUserId: owner,
        ownerName: "The Owner",
        ownerRole: "Admin",
      });

      const [grant] = await admin`SELECT role, status, granted_via
                                    FROM user_company_access
                                   WHERE user_id = ${owner} AND company_id = ${companyId}`;
      expect(grant).toBeTruthy();
      expect(grant.status).toBe("active");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the id resolves both ways", () => {
    it("is findable by the tenant uuid, which is what the session carries", async () => {
      const { companyId } = await provision({ name: "By Uuid Ltd" });
      const found = await getCompanyRecord(companyId);
      expect(found).toBeTruthy();
      expect(found.id).toBe(companyId);
      expect(found.name).toBe("By Uuid Ltd");
    });

    it("is findable by the source id the map was keyed on", async () => {
      const sourceId = randomUUID();
      const { companyId } = await provision({ sourceCompanyId: sourceId });
      const found = await getCompanyRecord(sourceId);
      expect(found.id).toBe(companyId);
    });

    it("is findable by a legacy ObjectId, for anything created before", async () => {
      const legacy = "6a3ba4ae0f569c9f3d9a907f";
      const { companyId } = await provision({ sourceCompanyId: legacy });
      const found = await getCompanyRecord(legacy);
      expect(found.id).toBe(companyId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("provisioning is idempotent, because onboarding gets retried", () => {
    it("returns the same tenant for the same source id, adding nothing", async () => {
      const sourceId = randomUUID();
      const first = await provision({ sourceCompanyId: sourceId });
      const second = await provision({ sourceCompanyId: sourceId });

      expect(second.companyId).toBe(first.companyId);
      expect(second.created).toBe(false);

      const [{ n }] = await admin`SELECT COUNT(*)::int AS n FROM companies`;
      expect(n).toBe(1);
    });

    it("survives two requests racing for the same tenant", async () => {
      // Next renders a page's server components in PARALLEL, so the first load
      // of an unprovisioned tenant fires several of these at once. The
      // advisory lock plus the re-check inside is what makes one win and the
      // rest adopt rather than collide on the slug's unique index.
      const sourceId = randomUUID();
      const results = await Promise.all([
        provision({ sourceCompanyId: sourceId }),
        provision({ sourceCompanyId: sourceId }),
        provision({ sourceCompanyId: sourceId }),
      ]);

      const ids = new Set(results.map((r) => r.companyId));
      expect(ids.size).toBe(1);
      const [{ n }] = await admin`SELECT COUNT(*)::int AS n FROM companies`;
      expect(n).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the rest of the form lands on the record", () => {
    it("writes branding, tax, bank and settings after provisioning", async () => {
      // Provisioning creates the tenant with a name, a slug and a currency.
      // Everything else the form collected lands through syncCompanyRecord, so
      // the record is complete from the moment the company exists rather than
      // at its first edit.
      const { companyId } = await provision({ name: "Full Ltd" });

      await syncCompanyRecord(companyId, {
        code: "FULL",
        tagline: "We build things",
        email: "hello@full.test",
        phone: "+254700000000",
        address: { street: "1 Ngong Rd", city: "Nairobi", country: "Kenya" },
        taxPin: "P051234567X",
        bankName: "Equity",
        accountNumber: "0123456789",
        settings: {
          currency: "KES",
          defaultVatRate: 16,
          defaultPaymentTermsDays: 45,
          capitalizationThreshold: 50000,
          requireGRN: true,
        },
      });

      const [c] = await admin`SELECT code, tagline, email, phone, city, country,
                                     tax_pin, bank_name, account_number
                                FROM companies WHERE id = ${companyId}`;
      expect(c.code).toBe("FULL");
      expect(c.tagline).toBe("We build things");
      expect(c.city).toBe("Nairobi");
      expect(c.tax_pin).toBe("P051234567X");
      expect(c.account_number).toBe("0123456789");

      const [s] = await admin`SELECT default_vat_rate::float8 AS vat,
                                     default_payment_terms_days AS terms,
                                     capitalization_threshold::float8 AS cap,
                                     require_grn
                                FROM company_settings WHERE company_id = ${companyId}`;
      expect(s.vat).toBe(16);
      expect(s.terms).toBe(45);
      expect(s.cap).toBe(50000);
      expect(s.require_grn).toBe(true);
    });

    it("leaves alone what the caller did not supply", async () => {
      // Every column is COALESCEd, so a partial update is a partial update.
      const { companyId } = await provision();
      await syncCompanyRecord(companyId, { code: "AAA", tagline: "First" });
      await syncCompanyRecord(companyId, { tagline: "Second" });

      const [c] = await admin`SELECT code, tagline FROM companies WHERE id = ${companyId}`;
      expect(c.code).toBe("AAA");
      expect(c.tagline).toBe("Second");
    });

    it("can turn the three-way match back OFF", async () => {
      // An unchecked HTML checkbox submits nothing, so the action coerces both
      // states to an explicit boolean — otherwise "unticked" and "untouched"
      // are the same value and the setting can never be cleared.
      const { companyId } = await provision();
      await syncCompanyRecord(companyId, { settings: { requireGRN: true } });
      await syncCompanyRecord(companyId, { settings: { requireGRN: false } });

      const [s] = await admin`SELECT require_grn FROM company_settings
                               WHERE company_id = ${companyId}`;
      expect(s.require_grn).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("a second company", () => {
    it("is visible to platform staff who were seeded on the first", async () => {
      // The lazy seeding in tenant.ts only fires for a user holding NO grant
      // at all, so once a SuperAdmin has one the NEXT company would have been
      // invisible to them — the switcher would not list it and the gate would
      // refuse it. Found by asking what happens on the second company.
      const staff = await makeUser("SuperAdmin");
      const first = await provision({
        name: "First Ltd",
        ownerUserId: staff,
        ownerName: "Staff",
        ownerRole: "SuperAdmin",
      });
      const second = await provision({ name: "Second Ltd" });

      const rows = await admin`SELECT company_id FROM user_company_access
                                WHERE user_id = ${staff}`;
      const ids = rows.map((r) => r.company_id);
      expect(ids).toContain(first.companyId);
      expect(ids).toContain(second.companyId);
    });

    it("numbers its documents from one, not from the first company's", async () => {
      const a = await provision({ name: "A Ltd" });
      const b = await provision({ name: "B Ltd" });

      const [x] = await admin`SELECT next_entry_number(${a.companyId}::uuid, 'INV') AS n`;
      const [y] = await admin`SELECT next_entry_number(${b.companyId}::uuid, 'INV') AS n`;
      expect(x.n).toBe("INV-00001");
      expect(y.n).toBe("INV-00001");
    });
  });
});
