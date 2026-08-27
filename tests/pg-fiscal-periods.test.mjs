/**
 * Fiscal periods on Postgres.
 *
 * Most of the Mongo service's guards are already in the database — overlapping
 * periods, duplicate codes, dates out of order, and posting into a closed
 * period, which a trigger refuses outright. What is tested here is the part
 * SQL cannot state: that a period with unposted work in it is not finished,
 * and that closing one takes the income statement back to zero.
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
const fiscal = await import("@/app/db/actions/fiscal-period-actions");

suite("fiscal periods", () => {
  let admin;
  let companyUuid;
  let mongoCompanyId;
  let revenueAcct;
  let expenseAcct;
  let bankAcct;
  let retainedAcct;
  let entrySeq = 0;

  const asRole = (role) =>
    getTenantContext.mockResolvedValue({
      user: { id: randomUUID(), name: `${role} User`, role },
      companyId: mongoCompanyId,
    });

  /** A posted entry inside the period. Draft, then lines, then post. */
  async function post({ date, lines, leaveDraft = false }) {
    const id = randomUUID();
    entrySeq += 1;
    await admin`
      INSERT INTO journal_entries (id, company_id, entry_number, entry_date,
                                   entry_type, description, status)
      VALUES (${id}, ${companyUuid}, ${"JE-" + entrySeq}, ${date},
              'adjustment', 'Test', 'draft')`;
    let n = 0;
    for (const l of lines) {
      n += 1;
      await admin`
        INSERT INTO journal_lines (company_id, entry_id, account_id, line_number, debit, credit)
        VALUES (${companyUuid}, ${id}, ${l.account}, ${n}, ${l.debit ?? 0}, ${l.credit ?? 0})`;
    }
    if (!leaveDraft) {
      await admin`UPDATE journal_entries SET status='posted', posted_at=now() WHERE id = ${id}`;
    }
    return id;
  }

  const makePeriod = (over = {}) =>
    fiscal.createFiscalPeriod({
      startDate: over.startDate ?? "2026-03-01",
      endDate: over.endDate ?? "2026-03-31",
      ...over,
    });

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
    revenueAcct = randomUUID();
    expenseAcct = randomUUID();
    bankAcct = randomUUID();
    retainedAcct = randomUUID();
    entrySeq = 0;

    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyUuid}, 'Pilot', ${"p-" + companyUuid.slice(0, 8)})`;
    await admin`
      INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
      VALUES ('companies', ${mongoCompanyId}, ${companyUuid})`;
    await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      await tx`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, system_account) VALUES
          (${revenueAcct},  ${companyUuid}, '4000', 'Sales',             'revenue', NULL),
          (${expenseAcct},  ${companyUuid}, '5000', 'Rent',              'expense', NULL),
          (${bankAcct},     ${companyUuid}, '1000', 'Bank',              'asset',   NULL),
          (${retainedAcct}, ${companyUuid}, '3200', 'Retained Earnings', 'equity',  'retained_earnings')`;
    });

    asRole("Admin");
  });

  describe("creating", () => {
    it("derives the code and name from the dates", async () => {
      const r = await makePeriod();
      expect(r.success).toBe(true);
      expect(r.period.periodCode).toBe("2026-03");
      expect(r.period.periodName).toBe("March 2026");
      expect(r.period.status).toBe("open");
    });

    it("refuses a second period for the same month", async () => {
      await makePeriod();
      const again = await makePeriod({ startDate: "2026-03-15", endDate: "2026-03-20" });
      // The unique index on (company, year, month) does this, not the app.
      expect(again.success).toBe(false);
    });

    it("refuses an end date before the start", async () => {
      const r = await makePeriod({ startDate: "2026-03-31", endDate: "2026-03-01" });
      expect(r.success).toBe(false);
    });

    it("builds a whole year, and adds only what is missing on a second run", async () => {
      const first = await fiscal.createYearPeriods(2027);
      expect(first.created).toBe(12);

      const second = await fiscal.createYearPeriods(2027);
      // Not an error, and not twelve duplicates.
      expect(second.success).toBe(true);
      expect(second.created).toBe(0);
      expect(second.message).toMatch(/already has/i);
    });
  });

  describe("closing", () => {
    it("refuses while unposted entries remain", async () => {
      const { period } = await makePeriod();
      await post({
        date: "2026-03-10",
        leaveDraft: true,
        lines: [
          { account: bankAcct, debit: 100 },
          { account: revenueAcct, credit: 100 },
        ],
      });

      const r = await fiscal.closeFiscalPeriod(period.id);
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/unposted journal entry/i);
    });

    it("takes revenue and expenses to retained earnings", async () => {
      const { period } = await makePeriod();
      await post({
        date: "2026-03-10",
        lines: [
          { account: bankAcct, debit: 1000 },
          { account: revenueAcct, credit: 1000 },
        ],
      });
      await post({
        date: "2026-03-12",
        lines: [
          { account: expenseAcct, debit: 400 },
          { account: bankAcct, credit: 400 },
        ],
      });

      const r = await fiscal.closeFiscalPeriod(period.id);
      expect(r.success).toBe(true);
      expect(r.period.status).toBe("closed");

      const lines = await admin`
        SELECT l.account_id, l.debit, l.credit
          FROM journal_lines l
          JOIN journal_entries e ON e.id = l.entry_id
         WHERE e.entry_type = 'closing' AND e.company_id = ${companyUuid}`;

      // Revenue is debited back to zero, expense credited back to zero, and
      // the 600 difference lands in retained earnings.
      const rev = lines.find((l) => l.account_id === revenueAcct);
      const exp = lines.find((l) => l.account_id === expenseAcct);
      const ret = lines.find((l) => l.account_id === retainedAcct);
      expect(Number(rev.debit)).toBe(1000);
      expect(Number(exp.credit)).toBe(400);
      expect(Number(ret.credit)).toBe(600);
    });

    it("posts no closing entry for a period with no trading", async () => {
      const { period } = await makePeriod();
      const r = await fiscal.closeFiscalPeriod(period.id);
      expect(r.success).toBe(true);
      expect(r.closingEntryId).toBeNull();

      const entries = await admin`
        SELECT id FROM journal_entries
         WHERE entry_type = 'closing' AND company_id = ${companyUuid}`;
      expect(entries).toHaveLength(0);
    });

    it("leaves the income statement at zero for the period", async () => {
      const { period } = await makePeriod();
      await post({
        date: "2026-03-10",
        lines: [
          { account: bankAcct, debit: 1000 },
          { account: revenueAcct, credit: 1000 },
        ],
      });
      await fiscal.closeFiscalPeriod(period.id);

      const [row] = await admin`
        SELECT COALESCE(SUM(l.credit - l.debit), 0) AS net
          FROM journal_entries e
          JOIN journal_lines l ON l.entry_id = e.id
         WHERE e.status = 'posted' AND l.account_id = ${revenueAcct}
           AND e.entry_date BETWEEN '2026-03-01' AND '2026-03-31'`;
      // That is what closing a period means.
      expect(Number(row.net)).toBe(0);
    });

    it("will not close a period twice", async () => {
      const { period } = await makePeriod();
      await fiscal.closeFiscalPeriod(period.id);
      const again = await fiscal.closeFiscalPeriod(period.id);
      expect(again.success).toBe(false);
      expect(again.error).toMatch(/closed/i);
    });
  });

  describe("the database refuses what the app should not have to check", () => {
    it("blocks a posting into a closed period", async () => {
      const { period } = await makePeriod();
      await fiscal.closeFiscalPeriod(period.id);

      // trg_resolve_fiscal_period (0001) does this, not the action layer.
      await expect(
        post({
          date: "2026-03-15",
          lines: [
            { account: bankAcct, debit: 50 },
            { account: revenueAcct, credit: 50 },
          ],
        }),
      ).rejects.toThrow();
    });
  });

  describe("reopening and locking", () => {
    it("lets Finance Manager reopen but not an Accountant", async () => {
      const { period } = await makePeriod();
      await fiscal.closeFiscalPeriod(period.id);

      asRole("Accountant");
      const refused = await fiscal.reopenFiscalPeriod(period.id, "correction");
      expect(refused.success).toBe(false);

      asRole("Finance Manager");
      const allowed = await fiscal.reopenFiscalPeriod(period.id, "correction");
      expect(allowed.success).toBe(true);
      expect(allowed.period.status).toBe("open");
    });

    it("locks only a closed period, and never unlocks", async () => {
      const { period } = await makePeriod();

      const tooEarly = await fiscal.lockFiscalPeriod(period.id);
      expect(tooEarly.success).toBe(false);

      await fiscal.closeFiscalPeriod(period.id);
      const locked = await fiscal.lockFiscalPeriod(period.id);
      expect(locked.success).toBe(true);
      expect(locked.period.status).toBe("locked");

      const reopen = await fiscal.reopenFiscalPeriod(period.id, "no");
      expect(reopen.success).toBe(false);
      expect(reopen.error).toMatch(/locked/i);
    });
  });

  describe("statistics and checklist", () => {
    it("counts an open period past its end date as overdue", async () => {
      await fiscal.createFiscalPeriod({
        startDate: "2020-01-01",
        endDate: "2020-01-31",
      });
      const { stats } = await fiscal.fetchFiscalPeriodStats();
      expect(stats.total).toBe(1);
      expect(stats.open).toBe(1);
      // Open, and its end date is long past — the month somebody forgot.
      expect(stats.overdue).toBe(1);
      // 2020 does not contain today, so there is no current period.
      expect(stats.currentPeriod).toBeNull();
    });

    it("names the period containing today, as the dashboard prints it", async () => {
      const today = new Date();
      const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
      await fiscal.createFiscalPeriod({
        startDate: first.toISOString().slice(0, 10),
        endDate: last.toISOString().slice(0, 10),
      });

      const { stats } = await fiscal.fetchFiscalPeriodStats();
      // `name`, not `periodName` — the dashboard renders currentPeriod.name.
      expect(stats.currentPeriod).not.toBeNull();
      expect(typeof stats.currentPeriod.name).toBe("string");
      expect(stats.currentPeriod.status).toBe("open");
    });

    it("blocks the checklist on unposted entries", async () => {
      const { period } = await makePeriod();
      await post({
        date: "2026-03-10",
        leaveDraft: true,
        lines: [
          { account: bankAcct, debit: 10 },
          { account: revenueAcct, credit: 10 },
        ],
      });

      const { checklist } = await fiscal.fetchClosingChecklist(period.id);
      const drafts = checklist.find((c) => c.id === "drafts");
      expect(drafts.done).toBe(false);
      expect(drafts.blocking).toBe(true);
      expect(drafts.detail).toMatch(/1 draft entry/);
    });
  });
});
