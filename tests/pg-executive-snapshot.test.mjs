/**
 * The executive overview — the CEO's home screen, and what it was reporting.
 *
 * `cExecutiveSnapshot` summed the Mongo `Invoice`, `Bill` and `Account`
 * collections. All three are on Postgres, so five of the eight headline
 * numbers — revenue, AR, AP, cash and the net that is derived from two of
 * them — had read ZERO since those modules ported. Nothing errored; the page
 * rendered, with the business at a standstill on it.
 *
 * The port is not a transcription. Every figure now comes from the LEDGER, so
 * the tile and the report it links to are the same number, which the document
 * sums were not: revenue counted `sent` invoices, and a sent invoice posts
 * nothing.
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

const reportQueries = await import("@/app/db/repositories/reportQueries");
const reportsRepo = await import("@/app/db/repositories/reports");
const journal = await import("@/app/db/repositories/journal");

suite("the executive snapshot", () => {
  let admin, client, db;
  let companyA, companyB, customer, supplier;
  let cashAcct, bankAcct, mpesaAcct, arAcct, apAcct, salesAcct, rentAcct;

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);

  const day = (offsetMonths = 0, dayOfMonth = 15) => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() + offsetMonths, dayOfMonth);
    return d.toISOString().slice(0, 10);
  };

  /** A posted entry, which is the only kind the snapshot counts. */
  const post = (input) =>
    inA((tx) =>
      journal.createJournalEntry(tx, {
        companyId: companyA,
        entryType: "sale",
        description: "test",
        postImmediately: true,
        ...input,
      }),
    );

  const snapshot = () => inA((tx) => reportQueries.getExecutiveSnapshot(tx));

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
    [cashAcct, bankAcct, mpesaAcct, arAcct, apAcct, salesAcct, rentAcct] =
      Array.from({ length: 7 }, () => randomUUID());

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
        VALUES (${cashAcct},  ${companyA}, '1111', 'Petty Cash',      'asset',   'cash',       'cash_on_hand'),
               (${bankAcct},  ${companyA}, '1112', 'Bank',            'asset',   'bank',       'cash_at_bank'),
               (${mpesaAcct}, ${companyA}, '1113', 'M-Pesa',          'asset',   'mpesa',      'mpesa'),
               (${arAcct},    ${companyA}, '1120', 'Accounts Receivable', 'asset', 'receivable', 'accounts_receivable'),
               (${apAcct},    ${companyA}, '2100', 'Accounts Payable', 'liability', 'payable',  'accounts_payable'),
               (${salesAcct}, ${companyA}, '4000', 'Sales',           'revenue', 'operating',  NULL),
               (${rentAcct},  ${companyA}, '6300', 'Rent',            'expense', 'operating',  NULL)`);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the flows", () => {
    it("reports this month's revenue against last month's", async () => {
      await post({
        entryDate: day(0),
        lines: [
          { accountId: arAcct, debit: "100000.0000" },
          { accountId: salesAcct, credit: "100000.0000" },
        ],
      });
      await post({
        entryDate: day(-1),
        lines: [
          { accountId: arAcct, debit: "60000.0000" },
          { accountId: salesAcct, credit: "60000.0000" },
        ],
      });

      const s = await snapshot();
      expect(s.revenue.total).toBe(100000);
      expect(s.revenue.prev).toBe(60000);
      expect(s.revenue.count).toBe(1);
    });

    it("nets a credit note off revenue without being told to", async () => {
      // A ledger read gets this free: a credit note DEBITS revenue, and the
      // figure is SUM(credit - debit). The document sum it replaces had no
      // arm for credit notes at all.
      await post({
        entryDate: day(0),
        lines: [
          { accountId: arAcct, debit: "100000.0000" },
          { accountId: salesAcct, credit: "100000.0000" },
        ],
      });
      await post({
        entryDate: day(0),
        entryType: "credit_note",
        lines: [
          { accountId: salesAcct, debit: "15000.0000" },
          { accountId: arAcct, credit: "15000.0000" },
        ],
      });

      expect((await snapshot()).revenue.total).toBe(85000);
    });

    it("ignores an entry that has not been posted", async () => {
      // The headline defect in one line: the Mongo version counted invoices
      // with status `sent`, and a sent invoice posts NOTHING — so the card
      // reported a bigger month than the P&L it drills into.
      await post({
        entryDate: day(0),
        postImmediately: false,
        lines: [
          { accountId: arAcct, debit: "500000.0000" },
          { accountId: salesAcct, credit: "500000.0000" },
        ],
      });

      expect((await snapshot()).revenue.total).toBe(0);
    });

    it("agrees with the profit and loss for the same month", async () => {
      await post({
        entryDate: day(0),
        lines: [
          { accountId: arAcct, debit: "100000.0000" },
          { accountId: salesAcct, credit: "100000.0000" },
        ],
      });
      await post({
        entryDate: day(0),
        lines: [
          { accountId: rentAcct, debit: "30000.0000" },
          { accountId: bankAcct, credit: "30000.0000" },
        ],
      });

      const s = await snapshot();
      const pl = await inA((tx) =>
        reportQueries.getProfitLoss(tx, day(0, 1), day(0, 28)),
      );

      // The whole point of reading the ledger: the tile IS the report's number.
      expect(s.revenue.total).toBe(Number(pl.revenue.total));
      expect(s.expenses.total).toBe(Number(pl.expenses.total));
      expect(s.revenue.total - s.expenses.total).toBe(Number(pl.summary.netIncome));
    });

    it("separates expenses by month too", async () => {
      await post({
        entryDate: day(0),
        lines: [
          { accountId: rentAcct, debit: "30000.0000" },
          { accountId: bankAcct, credit: "30000.0000" },
        ],
      });
      await post({
        entryDate: day(-1),
        lines: [
          { accountId: rentAcct, debit: "25000.0000" },
          { accountId: bankAcct, credit: "25000.0000" },
        ],
      });

      const s = await snapshot();
      expect(s.expenses.total).toBe(30000);
      expect(s.expenses.prev).toBe(25000);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the position", () => {
    it("counts M-Pesa as cash", async () => {
      // The chart seeds 1113 for it and both the old snapshot's replacement
      // and getFinancialOverview counted `cash` and `bank` only, so the money
      // position was short by the whole float.
      await post({
        entryDate: day(0),
        lines: [
          { accountId: cashAcct, debit: "1000.0000" },
          { accountId: bankAcct, debit: "5000.0000" },
          { accountId: mpesaAcct, debit: "4000.0000" },
          { accountId: salesAcct, credit: "10000.0000" },
        ],
      });

      const s = await snapshot();
      expect(s.cash.cashOnly).toBe(1000);
      expect(s.cash.bankOnly).toBe(5000);
      expect(s.cash.mpesaOnly).toBe(4000);
      expect(s.cash.total).toBe(10000);
      // The count is a fact about the CHART — an account opened and not yet
      // used still exists.
      expect(s.cash.count).toBe(3);
    });

    it("takes AR and AP from the control accounts, open items only", async () => {
      await post({
        entryDate: day(0),
        partyType: "customer",
        partyId: customer,
        dueDate: day(0, 28),
        lines: [
          { accountId: arAcct, debit: "80000.0000" },
          { accountId: salesAcct, credit: "80000.0000" },
        ],
      });
      await post({
        entryDate: day(0),
        partyType: "supplier",
        partyId: supplier,
        dueDate: day(0, 28),
        lines: [
          { accountId: rentAcct, debit: "20000.0000" },
          { accountId: apAcct, credit: "20000.0000" },
        ],
      });

      const s = await snapshot();
      expect(s.ar.total).toBe(80000);
      expect(s.ar.count).toBe(1);
      expect(s.ap.total).toBe(20000);
      expect(s.ap.count).toBe(1);
    });

    it("drops an item once it is settled", async () => {
      const entry = await post({
        entryDate: day(0),
        partyType: "customer",
        partyId: customer,
        lines: [
          { accountId: arAcct, debit: "80000.0000" },
          { accountId: salesAcct, credit: "80000.0000" },
        ],
      });
      expect((await snapshot()).ar.total).toBe(80000);

      await admin`
        UPDATE journal_entries SET is_fully_paid = true WHERE id = ${entry.id}`;

      const s = await snapshot();
      expect(s.ar.total).toBe(0);
      expect(s.ar.count).toBe(0);
    });

    it("agrees with the aging report it links to", async () => {
      // Same predicate, so the tile and the page cannot disagree. That was not
      // true of the document sums: AR came off `Invoice.amountDue` while the
      // aging report came off the ledger.
      for (const amount of ["80000.0000", "12500.0000"]) {
        await post({
          entryDate: day(0),
          partyType: "customer",
          partyId: customer,
          dueDate: day(0, 28),
          lines: [
            { accountId: arAcct, debit: amount },
            { accountId: salesAcct, credit: amount },
          ],
        });
      }

      const s = await snapshot();
      const aging = await inA((tx) =>
        reportsRepo.getAgingReport(tx, "receivable", day(0, 28)),
      );
      const agingTotal = aging.reduce((acc, r) => acc + Number(r.total), 0);

      expect(s.ar.total).toBe(agingTotal);
      expect(s.ar.total).toBe(92500);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the edges", () => {
    it("returns zeros for a tenant with no ledger, not null", async () => {
      // The screen renders "could not load the snapshot" on a falsy result, so
      // a brand-new company must get numbers rather than an error card.
      const s = await snapshot();
      expect(s).toMatchObject({
        revenue: { total: 0, prev: 0 },
        expenses: { total: 0, prev: 0 },
        ar: { total: 0, count: 0 },
        ap: { total: 0, count: 0 },
      });
      expect(s.cash.total).toBe(0);
      // Three money accounts exist even with nothing posted to them.
      expect(s.cash.count).toBe(3);
    });

    it("does not show one company another's position", async () => {
      await post({
        entryDate: day(0),
        lines: [
          { accountId: bankAcct, debit: "50000.0000" },
          { accountId: salesAcct, credit: "50000.0000" },
        ],
      });

      const seen = await asTenant(companyB, (tx) =>
        reportQueries.getExecutiveSnapshot(tx),
      );
      expect(seen.revenue.total).toBe(0);
      expect(seen.cash.total).toBe(0);
      expect(seen.cash.count).toBe(0);
    });
  });
});
