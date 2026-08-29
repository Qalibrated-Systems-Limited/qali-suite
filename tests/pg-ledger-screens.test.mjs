/**
 * The screens that read the ledger: the journal browser, AR/AP aging, cash flow.
 *
 * All three read the MONGO ledger while everything wrote to this one.
 *
 *   - `/dashboard/journal` listed Mongo entries while
 *     `/dashboard/journal/create` wrote Postgres, so a manual entry never
 *     appeared on the page it was raised from and no automatic posting was
 *     visible at all.
 *   - the two aging pages aggregated the Mongo `Invoice` and `Bill`
 *     collections, both of which moved — and the executive tiles that link to
 *     them read the ledger, so tile and page disagreed.
 *   - cash flow went through a categoriser testing for six account sub-types,
 *     three of which this chart has never had.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/utils/tenant-utils", () => ({ getTenantContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const journal = await import("@/app/db/repositories/journal");
const reportQueries = await import("@/app/db/repositories/reportQueries");
const reportsRepo = await import("@/app/db/repositories/reports");

suite("the ledger screens", () => {
  let admin, client, db;
  let companyA, companyB, customer, supplier;
  let cash, bank, mpesa, ar, ap, sales, rent, vehicle, loan, equity;

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);

  const day = (offsetDays = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  };
  const monthStart = (offsetMonths = 0) => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth() + offsetMonths, 1)
      .toISOString()
      .slice(0, 10);
  };

  const post = (input) =>
    inA((tx) =>
      journal.createJournalEntry(tx, {
        companyId: companyA,
        entryType: "sale",
        description: "test",
        postImmediately: true,
        entryDate: day(0),
        ...input,
      }),
    );

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    client = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, {
      max: 1,
      onnotice: () => {},
    });
    db = drizzle(client);
  });
  afterAll(async () => {
    if (client) await client.end();
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, users, _migration_id_map, entry_counters CASCADE`;

    companyA = randomUUID();
    companyB = randomUUID();
    customer = randomUUID();
    supplier = randomUUID();
    [cash, bank, mpesa, ar, ap, sales, rent, vehicle, loan, equity] =
      Array.from({ length: 10 }, () => randomUUID());

    await admin`INSERT INTO companies (id, name, slug) VALUES
      (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)}),
      (${companyB}, 'Rival', ${"r-" + companyB.slice(0, 8)})`;

    await asTenant(companyA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO parties (id, company_id, primary_type, is_customer, is_supplier, name)
        VALUES (${customer}, ${companyA}, 'customer', true, false, 'Kerra'),
               (${supplier}, ${companyA}, 'supplier', false, true, 'Bamburi')`);
      await tx.execute(sql`
        INSERT INTO accounts (id, company_id, account_code, account_name,
                              account_type, sub_type, system_account)
        VALUES (${cash},    ${companyA}, '1111', 'Petty Cash',   'asset',     'cash',        'cash_on_hand'),
               (${bank},    ${companyA}, '1112', 'Bank',         'asset',     'bank',        'cash_at_bank'),
               (${mpesa},   ${companyA}, '1113', 'M-Pesa',       'asset',     'mpesa',       'mpesa'),
               (${ar},      ${companyA}, '1120', 'Receivables',  'asset',     'receivable',  'accounts_receivable'),
               (${ap},      ${companyA}, '2100', 'Payables',     'liability', 'payable',     'accounts_payable'),
               (${sales},   ${companyA}, '4000', 'Sales',        'revenue',   'sales',       NULL),
               (${rent},    ${companyA}, '6300', 'Rent',         'expense',   'occupancy',   NULL),
               (${vehicle}, ${companyA}, '1500', 'Vehicles',     'asset',     'fixed_asset', NULL),
               (${loan},    ${companyA}, '2400', 'Bank Loan',    'liability', 'loan',        NULL),
               (${equity},  ${companyA}, '3100', 'Share Capital','equity',    'capital',     NULL)`);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the journal browser", () => {
    const timeline = (filters = {}, limit = 20, cursor = null) =>
      inA((tx) => journal.listJournalTimeline(tx, filters, limit, cursor));

    it("shows an entry that was posted here, with its lines and totals", async () => {
      // The whole seam in one assertion: this entry exists only in Postgres,
      // and the browser was reading Mongo.
      const entry = await post({
        description: "Sale to Kerra",
        partyType: "customer",
        partyId: customer,
        lines: [
          { accountId: ar, debit: "1160.0000" },
          { accountId: sales, credit: "1000.0000" },
          { accountId: ap, credit: "160.0000" },
        ],
      });

      const { entries } = await timeline();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        id: entry.id,
        description: "Sale to Kerra",
        totalDebits: 1160,
        totalCredits: 1160,
      });
      expect(entries[0].lines).toHaveLength(3);
      expect(entries[0].party).toEqual({ name: "Kerra", type: "customer" });
    });

    it("filters by status, type, period and search", async () => {
      await post({ description: "This month", lines: [
        { accountId: bank, debit: "100.0000" }, { accountId: sales, credit: "100.0000" }] });
      await post({ description: "A draft", postImmediately: false, lines: [
        { accountId: bank, debit: "50.0000" }, { accountId: sales, credit: "50.0000" }] });
      await post({ entryDate: "2020-03-04", description: "Ancient", lines: [
        { accountId: bank, debit: "70.0000" }, { accountId: sales, credit: "70.0000" }] });

      expect((await timeline({ status: "draft" })).entries).toHaveLength(1);
      expect((await timeline({ status: "posted" })).entries).toHaveLength(2);
      expect((await timeline({ period: "this_month" })).entries).toHaveLength(2);
      expect((await timeline({ search: "ancient" })).entries).toHaveLength(1);
      expect((await timeline({ entryType: "payment_made" })).entries).toHaveLength(0);
      // `all` is what the filter bar sends when nothing is chosen.
      expect((await timeline({ status: "all", period: "all" })).entries).toHaveLength(3);
    });

    it("pages on a date-and-id cursor, without skipping or repeating", async () => {
      // Four entries on ONE day. An id-only cursor is not monotonic in date
      // order, which is why the cursor carries both.
      for (const n of [1, 2, 3, 4]) {
        await post({ description: `Entry ${n}`, lines: [
          { accountId: bank, debit: "10.0000" }, { accountId: sales, credit: "10.0000" }] });
      }

      const first = await timeline({}, 2);
      expect(first.entries).toHaveLength(2);
      expect(first.hasMore).toBe(true);
      expect(typeof first.nextCursor).toBe("string");

      const second = await timeline({}, 2, first.nextCursor);
      expect(second.entries).toHaveLength(2);
      expect(second.hasMore).toBe(false);

      const seen = [...first.entries, ...second.entries].map((e) => e.id);
      expect(new Set(seen).size).toBe(4);
    });

    it("starts from the top on a cursor it cannot read", async () => {
      // It arrives from a query string, so it is whatever the caller sent.
      // A 500 on the ledger page is worse than page one.
      await post({ lines: [
        { accountId: bank, debit: "10.0000" }, { accountId: sales, credit: "10.0000" }] });
      expect((await timeline({}, 20, "[object Object]")).entries).toHaveLength(1);
      expect((await timeline({}, 20, "not-a-cursor")).entries).toHaveLength(1);
    });

    it("counts the stats the cards render", async () => {
      await post({ lines: [
        { accountId: bank, debit: "300.0000" }, { accountId: sales, credit: "300.0000" }] });
      await post({ postImmediately: false, lines: [
        { accountId: bank, debit: "50.0000" }, { accountId: sales, credit: "50.0000" }] });
      await post({ entryDate: monthStart(-1), lines: [
        { accountId: bank, debit: "100.0000" }, { accountId: sales, credit: "100.0000" }] });

      const stats = await inA((tx) => journal.getJournalStats(tx));
      expect(stats.totalEntries).toBe(3);
      expect(stats.thisMonthEntries).toBe(1);
      expect(stats.thisMonthVolume).toBe(300);
      expect(stats.draftCount).toBe(1);
      // One this month against one last month is no change.
      expect(stats.trend).toBe(0);
    });

    it("gives the detail page its names and its balance check", async () => {
      const entry = await post({
        description: "Rent",
        partyType: "supplier",
        partyId: supplier,
        lines: [
          { accountId: rent, debit: "5000.0000" },
          { accountId: bank, credit: "5000.0000" },
        ],
      });

      const detail = await inA((tx) => journal.getJournalEntryDetail(tx, entry.id));
      expect(detail.party).toEqual({ name: "Bamburi", type: "supplier" });
      expect(detail.lines).toHaveLength(2);
      expect(detail.lines[0].accountName).toBe("Rent");
      expect(detail.totals).toEqual({ debit: 5000, credit: 5000, isBalanced: true });
    });

    it("does not show one company another's ledger", async () => {
      await post({ lines: [
        { accountId: bank, debit: "10.0000" }, { accountId: sales, credit: "10.0000" }] });
      const seen = await asTenant(companyB, (tx) => journal.listJournalTimeline(tx));
      expect(seen.entries).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("AR and AP aging", () => {
    const open = (side, amount, dueOffset) =>
      post({
        entryDate: day(-120),
        partyType: side === "receivable" ? "customer" : "supplier",
        partyId: side === "receivable" ? customer : supplier,
        dueDate: day(dueOffset),
        lines:
          side === "receivable"
            ? [{ accountId: ar, debit: amount }, { accountId: sales, credit: amount }]
            : [{ accountId: rent, debit: amount }, { accountId: ap, credit: amount }],
      });

    it("buckets by how overdue each item is, and counts them", async () => {
      await open("receivable", "1000.0000", 5);    // not yet due
      await open("receivable", "2000.0000", -10);  // 1–30
      await open("receivable", "4000.0000", -45);  // 31–60
      await open("receivable", "8000.0000", -200); // 90+

      const [row] = await inA((tx) =>
        reportsRepo.getAgingReport(tx, "receivable", day(0)),
      );
      expect(row.partyName).toBe("Kerra");
      expect(Number(row.current)).toBe(1000);
      expect(Number(row.days0_30)).toBe(2000);
      expect(Number(row.days31_60)).toBe(4000);
      expect(Number(row.days90plus)).toBe(8000);
      expect(Number(row.total)).toBe(15000);
      // The count beside the money — four open invoices, not four buckets.
      expect(row.itemCount).toBe(4);
    });

    it("agrees with the executive tile that links to it", async () => {
      // The tile and the page came from different STORES before this. Same
      // predicate now, so they cannot disagree.
      await open("receivable", "1000.0000", -10);
      await open("payable", "600.0000", -10);

      const snapshot = await inA((tx) => reportQueries.getExecutiveSnapshot(tx));
      const arRows = await inA((tx) => reportsRepo.getAgingReport(tx, "receivable", day(0)));
      const apRows = await inA((tx) => reportsRepo.getAgingReport(tx, "payable", day(0)));
      const sum = (rows) => rows.reduce((acc, r) => acc + Number(r.total), 0);

      expect(snapshot.ar.total).toBe(sum(arRows));
      expect(snapshot.ap.total).toBe(sum(apRows));
    });

    it("drops an item once it is settled", async () => {
      const entry = await open("receivable", "1000.0000", -10);
      await admin`UPDATE journal_entries SET is_fully_paid = true WHERE id = ${entry.id}`;
      expect(await inA((tx) => reportsRepo.getAgingReport(tx, "receivable", day(0)))).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("cash flow", () => {
    const cashFlow = () =>
      inA((tx) => reportQueries.getCashFlow(tx, day(-30), day(1)));

    it("splits operating, investing and financing by the contra account", async () => {
      // Cash in from a sale — operating.
      await post({ lines: [
        { accountId: bank, debit: "5000.0000" }, { accountId: sales, credit: "5000.0000" }] });
      // Cash out for a vehicle — investing.
      await post({ lines: [
        { accountId: vehicle, debit: "80000.0000" }, { accountId: bank, credit: "80000.0000" }] });
      // Loan drawn down — financing.
      await post({ lines: [
        { accountId: bank, debit: "50000.0000" }, { accountId: loan, credit: "50000.0000" }] });

      const cf = await cashFlow();
      expect(cf.summary.operatingCashFlow).toBe(5000);
      expect(cf.summary.investingCashFlow).toBe(-80000);
      expect(cf.summary.financingCashFlow).toBe(50000);
      expect(cf.summary.netCashFlow).toBe(-25000);
      expect(cf.operating.transactions).toHaveLength(1);
    });

    it("treats share capital as financing, which the Mongo names missed", async () => {
      // The Mongo categoriser tested for `share_capital`; this chart seeds
      // `capital`. It was caught only by the equity type test beside it.
      await post({ lines: [
        { accountId: bank, debit: "200000.0000" }, { accountId: equity, credit: "200000.0000" }] });
      const cf = await cashFlow();
      expect(cf.summary.financingCashFlow).toBe(200000);
      expect(cf.summary.operatingCashFlow).toBe(0);
    });

    it("ignores a transfer between two cash accounts", async () => {
      await post({ lines: [
        { accountId: mpesa, debit: "1000.0000" }, { accountId: bank, credit: "1000.0000" }] });
      const cf = await cashFlow();
      expect(cf.summary.netCashFlow).toBe(0);
      expect(cf.operating.transactions).toHaveLength(0);
    });

    it("ignores an entry that never touched cash, and one not posted", async () => {
      await post({ lines: [
        { accountId: ar, debit: "900.0000" }, { accountId: sales, credit: "900.0000" }] });
      await post({ postImmediately: false, lines: [
        { accountId: bank, debit: "400.0000" }, { accountId: sales, credit: "400.0000" }] });
      expect((await cashFlow()).summary.netCashFlow).toBe(0);
    });

    it("counts M-Pesa as cash", async () => {
      await post({ lines: [
        { accountId: mpesa, debit: "3000.0000" }, { accountId: sales, credit: "3000.0000" }] });
      expect((await cashFlow()).summary.operatingCashFlow).toBe(3000);
    });
  });
});
