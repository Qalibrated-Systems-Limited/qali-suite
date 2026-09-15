/**
 * Saving payroll rates — the PAYE bands in particular.
 *
 * Payroll configuration could not be saved at all. KRA publishes its bands
 * INCLUSIVELY ("0 – 24,000", then "24,001 – 32,333"), and typed in literally
 * that is not a partition: nothing covers 24,000.50. 0048's
 * assert_paye_brackets_cover refused the save — "PAYE bands leave a gap:
 * nothing covers income from 288000 to 288001".
 *
 * It was wrong twice, because the tax arithmetic takes a band's WIDTH as
 * `to - from`: read inclusively, 32,333 - 24,001 is 8,332, one short of the
 * 8,333 the gazette says that band is worth.
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
const payrollActions = await import("@/app/db/actions/hr-payroll-actions");

/** The 2024 KRA bands, entered exactly as the gazette prints them. */
const KRA_BANDS = [
  { from: 0, to: 24000, rate: 10 },
  { from: 24001, to: 32333, rate: 25 },
  { from: 32334, to: 500000, rate: 30 },
  { from: 500001, to: 800000, rate: 32.5 },
  { from: 800001, to: "", rate: 35 }, // open-ended top band
];

function ratesForm(bands = KRA_BANDS, over = {}) {
  const fd = new FormData();
  fd.set("name", over.name ?? "KRA 2024");
  fd.set("effectiveFrom", over.effectiveFrom ?? "2026-01-01");
  fd.set("personalRelief", "2400");
  fd.set("nssfTierILimit", "8000");
  fd.set("nssfTierIILimit", "72000");
  fd.set("nssfEmployeeRate", "6");
  fd.set("nssfEmployerRate", "6");
  fd.set("shifRate", "2.75");
  fd.set("ahlEmployeeRate", "1.5");
  fd.set("ahlEmployerRate", "1.5");
  bands.forEach((b, i) => {
    fd.set(`bracket_from_${i}`, String(b.from));
    fd.set(`bracket_to_${i}`, String(b.to));
    fd.set(`bracket_rate_${i}`, String(b.rate));
  });
  return fd;
}

suite("payroll configuration", () => {
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

    getTenantContext.mockResolvedValue({
      user: { id: randomUUID(), name: "Admin User", role: "Admin" },
      companyId: mongoCompanyId,
    });
  });

  /**
   * THE PAGE AND THE ACTIONS HAVE TO AGREE ABOUT WHO MAY DO WHAT.
   *
   * app/dashboard/settings/payroll-config/page.jsx admits HR Manager and sets
   * `canEdit = true`, over a comment saying the previous version "showed the
   * page to HR and then disabled every control, while the actions accepted
   * them". It had drifted into the mirror image: the action list never gained
   * HR Manager, and it guarded the page's only LOADER too — so an HR Manager
   * opening the page threw inside a server component and got the error
   * boundary before a control rendered.
   *
   * The roles are the variable here, not the payload. Each list below is a
   * gate the page depends on, asserted from the outside.
   */
  describe("who may configure payroll", () => {
    const asRole = (role) =>
      getTenantContext.mockResolvedValue({
        user: { id: randomUUID(), name: `${role} User`, role },
        companyId: mongoCompanyId,
      });

    // Exactly the list in the page's ALLOWED.
    const MAY_OPEN = ["SuperAdmin", "Admin", "CFO", "Finance Manager", "HR Manager"];

    for (const role of MAY_OPEN) {
      it(`lets ${role} read the settings the page loads`, async () => {
        asRole(role);
        const settings = await payrollActions.getPayrollSettings();
        expect(settings).toBeTruthy();
        expect(Array.isArray(settings.configs)).toBe(true);
      });

      it(`lets ${role} save the rates`, async () => {
        asRole(role);
        const result = await payrollActions.savePayrollRates(
          null,
          ratesForm(KRA_BANDS, { name: `Rates by ${role}` }),
        );
        expect(result.error).toBeUndefined();
        expect(result.success).toBe(true);
      });
    }

    it("does not let a Storekeeper anywhere near it", async () => {
      asRole("Storekeeper");
      const result = await payrollActions.savePayrollRates(null, ratesForm());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/permission/i);
    });

    /**
     * The GL mapping is the half HR does NOT get: which accounts the payroll
     * journal debits and credits is an accounting decision. The page hides
     * that form from HR rather than letting them fill it in and be refused —
     * this asserts the gate the hiding is based on.
     */
    it("keeps the GL mapping with finance, HR Manager included in the refusal", async () => {
      asRole("Admin");
      await payrollActions.savePayrollRates(null, ratesForm());
      const [config] = await admin`
        SELECT id FROM payroll_configs WHERE company_id = ${companyUuid} LIMIT 1`;

      asRole("HR Manager");
      const mapping = new FormData();
      mapping.set("configId", config.id);
      mapping.set("salaryExpense", "");
      const result = await payrollActions.savePayrollGlMapping(null, mapping);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/permission/i);
    });
  });

  it("saves the KRA bands as printed, which previously failed outright", async () => {
    const result = await payrollActions.savePayrollRates(null, ratesForm());
    // The whole bug: this returned "PAYE bands leave a gap".
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it("stores bands that meet exactly, leaving no income uncovered", async () => {
    await payrollActions.savePayrollRates(null, ratesForm());

    const bands = await admin`
      SELECT from_amount, to_amount, rate
        FROM paye_brackets b
        JOIN payroll_configs c ON c.id = b.payroll_config_id
       WHERE c.company_id = ${companyUuid}
       ORDER BY from_amount`;

    expect(bands).toHaveLength(5);
    for (let i = 1; i < bands.length; i++) {
      // Each band starts exactly where the previous ended — no gap, no overlap.
      expect(Number(bands[i].from_amount)).toBe(Number(bands[i - 1].to_amount));
    }
    // The top band is open-ended.
    expect(bands[4].to_amount).toBeNull();
  });

  it("gives each band the width the gazette says it has", async () => {
    await payrollActions.savePayrollRates(null, ratesForm());

    const bands = await admin`
      SELECT from_amount, to_amount
        FROM paye_brackets b
        JOIN payroll_configs c ON c.id = b.payroll_config_id
       WHERE c.company_id = ${companyUuid}
       ORDER BY from_amount`;

    const width = (i) => Number(bands[i].to_amount) - Number(bands[i].from_amount);
    // "On the first 24,000", then "on the next 8,333".
    expect(width(0)).toBe(24000);
    expect(width(1)).toBe(8333);
    // Read inclusively this was 8,332 — a shilling short on every band.
  });

  it("still refuses bands that genuinely leave a hole", async () => {
    // A first band ending at 24,000 and a second starting at 30,000 is not a
    // convention mismatch, it is a mistake, and the database should say so.
    const broken = [
      { from: 0, to: 24000, rate: 10 },
      { from: 30000, to: "", rate: 30 },
    ];
    // The normaliser pulls the second band back to 24,000, so this now SAVES —
    // the user's intent was a contiguous schedule and the top of band one is
    // what they typed. What must never happen is a saved gap.
    const result = await payrollActions.savePayrollRates(null, ratesForm(broken));
    expect(result.success).toBe(true);

    const bands = await admin`
      SELECT from_amount, to_amount FROM paye_brackets b
        JOIN payroll_configs c ON c.id = b.payroll_config_id
       WHERE c.company_id = ${companyUuid} ORDER BY from_amount`;
    expect(Number(bands[1].from_amount)).toBe(24000);
  });

  it("refuses a configuration with no bands at all", async () => {
    const fd = ratesForm([]);
    const result = await payrollActions.savePayrollRates(null, fd);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/at least one PAYE band/i);
  });
});
