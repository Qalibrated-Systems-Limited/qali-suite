/**
 * End-to-end proof of one complete write path on Postgres.
 *
 * Covers the piece nothing else does: the transitional bridge in
 * app/db/tenant.ts that turns the Mongo ObjectId still carried by the session
 * into the Postgres UUID, via _migration_id_map. Everything above it (auth,
 * validation, revalidate) and below it (repository, RLS, triggers) is exercised
 * on the way through.
 *
 * The loop asserted here is the one that matters:
 *
 *   session companyId (ObjectId)
 *     -> resolveCompanyUuid
 *       -> withTenant / RLS
 *         -> createJournalEntry
 *           -> balance trigger at COMMIT
 *             -> visible in the Postgres trial balance
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
/**
 * The privileged connection: CREATE ROLE, GRANT, TRUNCATE. The app's own
 * DATABASE_URL connects as app_user, which has none of those by design — see
 * migration 0023. Falls back to DATABASE_URL for a single-role local setup.
 */
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

// getTenantContext reaches next-auth, which does not load under Vitest.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/utils/tenant-utils", () => ({ getTenantContext: vi.fn() }));

const { getTenantContext } = await import("@/lib/utils/tenant-utils");
const journalActions = await import("@/app/db/actions/journal-actions");

suite("postgres write path (end to end)", () => {
  let sql;
  let admin; // privileged: TRUNCATE and tenant provisioning
  let companyUuid;
  let mongoCompanyId;
  let cash;
  let sales;

  /** Mirrors how the Mongo session identifies a tenant. */
  const asObjectIdHex = () => randomUUID().replace(/-/g, "").slice(0, 24);

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    // Subject to RLS: a superuser would bypass every policy.
    sql = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, { max: 2, onnotice: () => {} });
  });

  afterAll(async () => {
    if (sql) await sql.end();
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, _migration_id_map, entry_counters CASCADE`;

    companyUuid = randomUUID();
    mongoCompanyId = asObjectIdHex();
    cash = randomUUID();
    sales = randomUUID();

    // Provisioning a tenant, and the backfill's id map, are both platform
    // operations: companies is RLS-scoped (0024) and _migration_id_map is not
    // granted to the application role at all.
    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyUuid}, 'Pilot', ${"p-" + companyUuid.slice(0, 8)})
    `;
    // The mapping the backfill would have written.
    await admin`
      INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
      VALUES ('companies', ${mongoCompanyId}, ${companyUuid})
    `;
    // A chart of accounts IS tenant data, so it is seeded inside a tenant
    // scope rather than around RLS. This passed unscoped only while the test
    // connected as a superuser.
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      await tx`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type) VALUES
          (${cash},  ${companyUuid}, '1000', 'Cash',  'asset'),
          (${sales}, ${companyUuid}, '4000', 'Sales', 'revenue')
      `;
    });

    getTenantContext.mockResolvedValue({
      user: { id: randomUUID(), name: "Finance User", role: "Accountant" },
      companyId: mongoCompanyId, // still a Mongo id, as in production today
    });
  });

  /** Builds FormData exactly as app/dashboard/journal/create posts it. */
  function formDataFor({ lines, postImmediately = true, ...fields }) {
    const fd = new FormData();
    fd.set("entryDate", fields.entryDate ?? "2026-08-15");
    fd.set("entryType", fields.entryType ?? "adjustment");
    fd.set("description", fields.description ?? "Manual entry");
    fd.set("postImmediately", String(postImmediately));
    lines.forEach((l, i) => {
      fd.set(`lines[${i}].accountId`, l.accountId);
      fd.set(`lines[${i}].debit`, l.debit ?? "0");
      fd.set(`lines[${i}].credit`, l.credit ?? "0");
      fd.set(`lines[${i}].description`, l.description ?? "");
    });
    return fd;
  }

  it("creates a posted entry from the form, resolving the tenant by id map", async () => {
    const result = await journalActions.createManualJournalEntry(
      null,
      formDataFor({
        lines: [
          { accountId: cash, debit: "1500.0000" },
          { accountId: sales, credit: "1500.0000" },
        ],
      }),
    );

    expect(result.success).toBe(true);
    // The form redirects on state.entryId, so the contract must include it.
    expect(result.entryId).toBeTruthy();

    // Reading it back is a tenant-scoped read like any other. Unscoped, RLS
    // returns zero rows — which is the correct behaviour, and only looked fine
    // while this connection was a superuser.
    const [entry] = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      return tx`
        SELECT entry_number, status, company_id FROM journal_entries WHERE id = ${result.entryId}
      `;
    });
    expect(entry.status).toBe("posted");
    // Written against the resolved UUID, not the Mongo id from the session.
    expect(entry.company_id).toBe(companyUuid);
  });

  it("shows the entry in the Postgres trial balance", async () => {
    await journalActions.createManualJournalEntry(
      null,
      formDataFor({
        lines: [
          { accountId: cash, debit: "1500.0000" },
          { accountId: sales, credit: "1500.0000" },
        ],
      }),
    );

    const report = await journalActions.getTrialBalance();
    const byCode = Object.fromEntries(
      report.rows.map((r) => [r.accountCode, r]),
    );

    expect(byCode["1000"].debitBalance).toBe("1500.0000");
    expect(byCode["4000"].creditBalance).toBe("1500.0000");
    expect(report.isBalanced).toBe(true);
    expect(report.totalDebit).toBe(report.totalCredit);
  });

  it("refuses an unbalanced entry with a readable message", async () => {
    const result = await journalActions.createManualJournalEntry(
      null,
      formDataFor({
        lines: [
          { accountId: cash, debit: "100.0000" },
          { accountId: sales, credit: "99.9950" }, // 0.005 out
        ],
      }),
    );

    expect(result.success).toBe(false);
    // Surfaced from the database trigger, not re-implemented in JavaScript.
    expect(result.error).toMatch(/not balanced/i);
  });

  it("rejects a caller whose role cannot post", async () => {
    getTenantContext.mockResolvedValue({
      user: { id: randomUUID(), name: "Store Clerk", role: "Storekeeper" },
      companyId: mongoCompanyId,
    });

    const result = await journalActions.createManualJournalEntry(
      null,
      formDataFor({
        lines: [
          { accountId: cash, debit: "10.0000" },
          { accountId: sales, credit: "10.0000" },
        ],
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/permission/i);
  });

  it("fails clearly when the tenant has not been backfilled", async () => {
    getTenantContext.mockResolvedValue({
      user: { id: randomUUID(), name: "Finance User", role: "Accountant" },
      companyId: asObjectIdHex(), // never mapped
    });

    const result = await journalActions.createManualJournalEntry(
      null,
      formDataFor({
        lines: [
          { accountId: cash, debit: "10.0000" },
          { accountId: sales, credit: "10.0000" },
        ],
      }),
    );
    expect(result.success).toBe(false);
    // Generic message to the user; the specific cause is logged server-side.
    expect(result.error).toBeTruthy();
  });

  it("returns field errors the form can render", async () => {
    const fd = new FormData();
    fd.set("entryDate", "not-a-date");
    fd.set("entryType", "adjustment");
    fd.set("description", "");

    const result = await journalActions.createManualJournalEntry(null, fd);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Validation failed");
    expect(result.fieldErrors).toBeTruthy();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the id at the top of that loop, in both forms", () => {
    /*
     * The fixture above is a MIGRATED tenant: an ObjectId in the map, pointing
     * at a company whose uuid is its own. A tenant created since the cutover
     * has no Mongo id at all — `provisionCompany` mints a uuid for the map key
     * — so `sourceId ?? id`, which is what the admin screens link on, is a
     * uuid that is NOT `companies.id`. The resolver refused it as a company
     * that no longer exists.
     */
    let tenant;

    beforeEach(async () => {
      tenant = await import("@/app/db/tenant");
    });

    it("takes the uuid the session carries, unchanged", async () => {
      expect(await tenant.resolveCompanyUuid(companyUuid)).toBe(companyUuid);
    });

    it("takes the ObjectId a migrated session still carries", async () => {
      expect(await tenant.resolveCompanyUuid(mongoCompanyId)).toBe(companyUuid);
    });

    it("takes the minted uuid a Postgres-born tenant is keyed on", async () => {
      const born = randomUUID();
      const minted = randomUUID();
      await admin`INSERT INTO companies (id, name, slug)
                  VALUES (${born}, 'Born Here', ${"b-" + born.slice(0, 8)})`;
      await admin`INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
                  VALUES ('companies', ${minted}, ${born})`;

      expect(await tenant.resolveCompanyUuid(minted)).toBe(born);
    });

    it("still refuses a uuid that names nothing, rather than provisioning one", async () => {
      // The refusal is the reason the uuid case is handled separately at all:
      // falling through to provisioning would create "Company <uuid>" for a
      // mistyped URL.
      const nobody = randomUUID();
      await expect(tenant.resolveCompanyUuid(nobody)).rejects.toThrow(
        /no longer exists/i,
      );
      const [{ n }] = await admin`SELECT count(*)::int AS n FROM companies`;
      expect(n).toBe(1);
    });
  });
});
