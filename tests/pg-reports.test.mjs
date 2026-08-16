/**
 * Integration tests for the Postgres report repository.
 *
 * These call the real repository functions (app/db/repositories/reportQueries)
 * against a real PostgreSQL, through a Drizzle transaction with RLS scoped the
 * same way withTenant() does in production.
 *
 * Skipped unless DATABASE_URL is set. See tests/pg-accounting-core.test.mjs for
 * how to start a throwaway server.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
// Safe to import unconditionally: app/db/client.ts connects lazily, so pulling
// in the repository does not require DATABASE_URL at module load.
import {
  getGeneralLedger,
  getTrialBalanceReport,
  getProfitLoss,
  getBalanceSheet,
} from "@/app/db/repositories/reportQueries";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("postgres reports", () => {
  let client;
  let db;
  let companyA;
  let cash;
  let sales;

  /** Mirrors withTenant(): transaction-local RLS scope. */
  async function asTenant(companyId, fn) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  }

  async function postEntry({ number, date, lines }) {
    await asTenant(companyA, async (tx) => {
      const id = randomUUID();
      await tx.execute(sql`
        INSERT INTO journal_entries (id, company_id, entry_number, entry_date, entry_type, description, status)
        VALUES (${id}, ${companyA}, ${number}, ${date}::date, 'sale', ${"entry " + number}, 'posted')
      `);
      let n = 0;
      for (const l of lines) {
        n++;
        await tx.execute(sql`
          INSERT INTO journal_lines (company_id, entry_id, account_id, line_number, debit, credit, description)
          VALUES (${companyA}, ${id}, ${l.account}, ${n}, ${l.debit ?? "0"}, ${l.credit ?? "0"}, ${l.description ?? null})
        `);
      }
    });
  }

  beforeAll(async () => {
    client = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
    db = drizzle(client);
  });

  afterAll(async () => {
    if (client) await client.end();
  });

  beforeEach(async () => {
    await client`TRUNCATE companies CASCADE`;
    await client`TRUNCATE entry_counters`;

    companyA = randomUUID();
    cash = randomUUID();
    sales = randomUUID();

    await client`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Tenant A', ${"a-" + companyA.slice(0, 8)})
    `;
    await asTenant(companyA, (tx) =>
      tx.execute(sql`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type) VALUES
          (${cash},  ${companyA}, '1000', 'Cash',  'asset'),
          (${sales}, ${companyA}, '4000', 'Sales', 'revenue')
      `),
    );
  });

  describe("general ledger", () => {
    it("carries an opening balance into the window", async () => {
      // Before the window.
      await postEntry({
        number: "JE-1", date: "2026-07-10",
        lines: [{ account: cash, debit: "1000.0000" }, { account: sales, credit: "1000.0000" }],
      });
      // Inside the window.
      await postEntry({
        number: "JE-2", date: "2026-08-05",
        lines: [{ account: cash, debit: "500.0000" }, { account: sales, credit: "500.0000" }],
      });

      const report = await asTenant(companyA, (tx) =>
        getGeneralLedger(tx, cash, "2026-08-01", "2026-08-31"),
      );

      expect(report.summary.openingBalance).toBe(1000);
      expect(report.transactions).toHaveLength(1);
      expect(report.transactions[0].entryNumber).toBe("JE-2");
      // Running balance must continue from the opening, not restart at 0.
      expect(report.transactions[0].balance).toBe(1500);
      expect(report.summary.closingBalance).toBe(1500);
    });

    it("signs movement to the account's normal side", async () => {
      await postEntry({
        number: "JE-1", date: "2026-08-05",
        lines: [{ account: cash, debit: "700.0000" }, { account: sales, credit: "700.0000" }],
      });

      const revenue = await asTenant(companyA, (tx) =>
        getGeneralLedger(tx, sales, "2026-08-01", "2026-08-31"),
      );

      // Sales is credit-normal, so a credit increases it.
      expect(revenue.account.normalBalanceSide).toBe("credit");
      expect(revenue.summary.closingBalance).toBe(700);
    });

    it("includes EVERY line hitting the account, not just the first", async () => {
      // One entry, two lines against the same account — e.g. two cost centres.
      // ReportService.generateGeneralLedger uses entry.lines.find(...), which
      // returns only the first match and silently drops the second, leaving the
      // running balance short by that amount for the rest of the report.
      await postEntry({
        number: "JE-1", date: "2026-08-05",
        lines: [
          { account: cash, debit: "300.0000", description: "Branch A" },
          { account: cash, debit: "200.0000", description: "Branch B" },
          { account: sales, credit: "500.0000" },
        ],
      });

      const report = await asTenant(companyA, (tx) =>
        getGeneralLedger(tx, cash, "2026-08-01", "2026-08-31"),
      );

      expect(report.transactions).toHaveLength(2);
      expect(report.transactions.map((t) => t.description)).toEqual([
        "entry JE-1",
        "entry JE-1",
      ]);
      // 300 then 500 — the Mongo report would stop at 300.
      expect(report.transactions.map((t) => t.balance)).toEqual([300, 500]);
      expect(report.summary.closingBalance).toBe(500);
    });

    it("excludes draft entries", async () => {
      await asTenant(companyA, async (tx) => {
        const id = randomUUID();
        await tx.execute(sql`
          INSERT INTO journal_entries (id, company_id, entry_number, entry_date, entry_type, description, status)
          VALUES (${id}, ${companyA}, 'JE-D1', '2026-08-05', 'adjustment', 'wip', 'draft')
        `);
        await tx.execute(sql`
          INSERT INTO journal_lines (company_id, entry_id, account_id, line_number, debit, credit)
          VALUES (${companyA}, ${id}, ${cash}, 1, '999.0000', '0')
        `);
      });

      const report = await asTenant(companyA, (tx) =>
        getGeneralLedger(tx, cash, "2026-08-01", "2026-08-31"),
      );
      expect(report.transactions).toHaveLength(0);
      expect(report.summary.closingBalance).toBe(0);
    });

    it("rejects an unknown account", async () => {
      await expect(
        asTenant(companyA, (tx) => getGeneralLedger(tx, randomUUID())),
      ).rejects.toThrow(/account not found/i);
    });
  });

  describe("trial balance", () => {
    it("ties, and decides isBalanced on exact numerics", async () => {
      await postEntry({
        number: "JE-1", date: "2026-08-05",
        lines: [{ account: cash, debit: "1234.5600" }, { account: sales, credit: "1234.5600" }],
      });

      const report = await asTenant(companyA, (tx) =>
        getTrialBalanceReport(tx, "2026-08-31"),
      );

      expect(report.summary.isBalanced).toBe(true);
      // The exact strings are the reconciliation source of truth.
      expect(report.summary.exact.totalDebits).toBe("1234.5600");
      expect(report.summary.exact.totalCredits).toBe("1234.5600");
      expect(report.summary.exact.difference).toBe("0.0000");
    });

    it("respects the as-of date", async () => {
      await postEntry({
        number: "JE-1", date: "2026-09-05",
        lines: [{ account: cash, debit: "50.0000" }, { account: sales, credit: "50.0000" }],
      });

      const report = await asTenant(companyA, (tx) =>
        getTrialBalanceReport(tx, "2026-08-31"),
      );
      expect(report.accounts).toHaveLength(0);
    });
  });

  describe("profit & loss", () => {
    it("nets revenue against expenses over the window", async () => {
      const rent = randomUUID();
      await asTenant(companyA, (tx) =>
        tx.execute(sql`
          INSERT INTO accounts (id, company_id, account_code, account_name, account_type, sub_type)
          VALUES (${rent}, ${companyA}, '6100', 'Rent', 'expense', 'operating_expense')
        `),
      );

      await postEntry({
        number: "JE-1", date: "2026-08-05",
        lines: [{ account: cash, debit: "1000.0000" }, { account: sales, credit: "1000.0000" }],
      });
      await postEntry({
        number: "JE-2", date: "2026-08-10",
        lines: [{ account: rent, debit: "400.0000" }, { account: cash, credit: "400.0000" }],
      });
      // Outside the window — must not appear.
      await postEntry({
        number: "JE-3", date: "2026-09-02",
        lines: [{ account: rent, debit: "999.0000" }, { account: cash, credit: "999.0000" }],
      });

      const pl = await asTenant(companyA, (tx) =>
        getProfitLoss(tx, "2026-08-01", "2026-08-31"),
      );

      expect(pl.revenue.total).toBe(1000);
      expect(pl.expenses.total).toBe(400);
      expect(pl.summary.netIncome).toBe(600);
      expect(pl.summary.netMargin).toBe("60.00");
    });

    it("omits accounts with no movement", async () => {
      await postEntry({
        number: "JE-1", date: "2026-08-05",
        lines: [{ account: cash, debit: "10.0000" }, { account: sales, credit: "10.0000" }],
      });
      const pl = await asTenant(companyA, (tx) =>
        getProfitLoss(tx, "2026-08-01", "2026-08-31"),
      );
      // Only Sales moved; Cash is not a P&L account at all.
      expect(pl.revenue.accounts).toHaveLength(1);
      expect(pl.expenses.accounts).toHaveLength(0);
    });
  });

  describe("balance sheet", () => {
    it("satisfies assets = liabilities + equity", async () => {
      const payable = randomUUID();
      const rent = randomUUID();
      await asTenant(companyA, (tx) =>
        tx.execute(sql`
          INSERT INTO accounts (id, company_id, account_code, account_name, account_type, sub_type) VALUES
            (${payable}, ${companyA}, '2100', 'Accounts Payable', 'liability', 'accounts_payable'),
            (${rent},    ${companyA}, '6100', 'Rent',             'expense',   'operating_expense')
        `),
      );

      // Sale on cash, then an expense accrued but unpaid.
      await postEntry({
        number: "JE-1", date: "2026-08-05",
        lines: [{ account: cash, debit: "1000.0000" }, { account: sales, credit: "1000.0000" }],
      });
      await postEntry({
        number: "JE-2", date: "2026-08-06",
        lines: [{ account: rent, debit: "250.0000" }, { account: payable, credit: "250.0000" }],
      });

      const bs = await asTenant(companyA, (tx) =>
        getBalanceSheet(tx, "2026-08-31"),
      );

      expect(bs.summary.totalAssets).toBe(1000);
      expect(bs.summary.totalLiabilities).toBe(250);
      // No real equity accounts, so equity is entirely Current Year Earnings:
      // revenue 1000 - expenses 250 = 750.
      expect(bs.summary.totalEquity).toBe(750);
      expect(bs.summary.totalLiabilitiesAndEquity).toBe(1000);
      expect(bs.summary.isBalanced).toBe(true);
      expect(bs.summary.difference).toBe(0);
    });

    it("adds Current Year Earnings as a synthetic equity line", async () => {
      await postEntry({
        number: "JE-1", date: "2026-08-05",
        lines: [{ account: cash, debit: "300.0000" }, { account: sales, credit: "300.0000" }],
      });

      const bs = await asTenant(companyA, (tx) =>
        getBalanceSheet(tx, "2026-08-31"),
      );
      const cye = bs.equity.accounts.find((a) => a.accountCode === "CYE");
      expect(cye).toBeTruthy();
      expect(cye.balance).toBe(300);
    });

    it("groups assets by sub-type", async () => {
      const bank = randomUUID();
      const vehicle = randomUUID();
      await asTenant(companyA, (tx) =>
        tx.execute(sql`
          INSERT INTO accounts (id, company_id, account_code, account_name, account_type, sub_type) VALUES
            (${bank},    ${companyA}, '1010', 'Bank',    'asset', 'bank'),
            (${vehicle}, ${companyA}, '1500', 'Vehicle', 'asset', 'fixed_asset')
        `),
      );
      await postEntry({
        number: "JE-1", date: "2026-08-05",
        lines: [{ account: bank, debit: "800.0000" }, { account: sales, credit: "800.0000" }],
      });
      await postEntry({
        number: "JE-2", date: "2026-08-06",
        lines: [{ account: vehicle, debit: "5000.0000" }, { account: sales, credit: "5000.0000" }],
      });

      const bs = await asTenant(companyA, (tx) =>
        getBalanceSheet(tx, "2026-08-31"),
      );
      expect(bs.assets.current.map((a) => a.accountCode)).toContain("1010");
      expect(bs.assets.fixed.map((a) => a.accountCode)).toContain("1500");
    });
  });
});
