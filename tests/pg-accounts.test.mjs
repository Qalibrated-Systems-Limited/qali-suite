/**
 * The chart of accounts.
 *
 * Shipped without tests when the module was converted. The rules worth holding
 * are the two the port introduced: a posted account's code and type are frozen,
 * and a balance is derived rather than cached.
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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/utils/tenant-utils", () => ({ getTenantContext: vi.fn() }));

const accountsRepo = await import("@/app/db/repositories/accounts");

suite("chart of accounts", () => {
  let admin, client, db, companyA, companyB;

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    client = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, { max: 1, onnotice: () => {} });
    db = drizzle(client);
  });
  afterAll(async () => {
    if (client) await client.end();
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies CASCADE`;
    await admin`TRUNCATE entry_counters`;
    companyA = randomUUID();
    companyB = randomUUID();
    await admin`INSERT INTO companies (id, name, slug) VALUES
      (${companyA}, 'Alpha', ${"a-" + companyA.slice(0, 8)}),
      (${companyB}, 'Beta',  ${"b-" + companyB.slice(0, 8)})`;
  });

  /**
   * A posted entry and its lines, in ONE transaction.
   *
   * The balance trigger is deferred to commit, so writing the entry and its
   * lines as separate autocommit statements trips "must have at least 2 lines"
   * on the first of them.
   */
  async function postEntry({ number, date, debitAcct, creditAcct, amount }) {
    const id = randomUUID();
    await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyA}, true)`;
      await tx`INSERT INTO journal_entries (id, company_id, entry_number, entry_date,
                                            entry_type, description, status)
               VALUES (${id}, ${companyA}, ${number}, ${date}, 'sale', 'test', 'posted')`;
      await tx`INSERT INTO journal_lines (company_id, entry_id, account_id, line_number, debit, credit) VALUES
               (${companyA}, ${id}, ${debitAcct},  1, ${amount}, 0),
               (${companyA}, ${id}, ${creditAcct}, 2, 0,        ${amount})`;
    });
    return id;
  }

  const mk = (over = {}) => ({
    companyId: companyA,
    accountCode: "4000",
    accountName: "Sales",
    accountType: "revenue",
    ...over,
  });

  describe("creating", () => {
    it("upper-cases the code and starts postable", async () => {
      const a = await asTenant(companyA, (tx) =>
        accountsRepo.createAccount(tx, mk({ accountCode: "4a10" })));
      expect(a.accountCode).toBe("4A10");
      expect(a.isActive).toBe(true);
    });

    it("refuses a parent of a different type", async () => {
      const header = await asTenant(companyA, (tx) =>
        accountsRepo.createAccount(tx, mk({ accountCode: "1000", accountName: "Assets", accountType: "asset", subType: "header" })));
      // A revenue account under an asset header would misclassify every entry
      // that rolls up through it.
      await expect(
        asTenant(companyA, (tx) =>
          accountsRepo.createAccount(tx, mk({ parentId: header.id }))),
      ).rejects.toThrow(/must match/i);
    });

    it("refuses a parent that is not a header", async () => {
      const leaf = await asTenant(companyA, (tx) =>
        accountsRepo.createAccount(tx, mk({ accountCode: "4000" })));
      await expect(
        asTenant(companyA, (tx) =>
          accountsRepo.createAccount(tx, mk({ accountCode: "4010", parentId: leaf.id }))),
      ).rejects.toThrow(/header/i);
    });
  });

  describe("editing", () => {
    it("renames freely while nothing has posted", async () => {
      const a = await asTenant(companyA, (tx) => accountsRepo.createAccount(tx, mk()));
      const up = await asTenant(companyA, (tx) =>
        accountsRepo.updateAccount(tx, a.id, { accountName: "Sales Revenue", accountType: "expense" }));
      expect(up.accountName).toBe("Sales Revenue");
      expect(up.accountType).toBe("expense");
    });

    it("freezes the code and type once a line has posted", async () => {
      const a = await asTenant(companyA, (tx) => accountsRepo.createAccount(tx, mk()));
      const b = await asTenant(companyA, (tx) =>
        accountsRepo.createAccount(tx, mk({ accountCode: "1200", accountName: "AR", accountType: "asset" })));

      await postEntry({ number: "JE-1", date: "2026-08-20", debitAcct: b.id, creditAcct: a.id, amount: 100 });

      // Turning a revenue account into an expense reclassifies every entry
      // already posted to it, and rewrites every report that has run.
      await expect(
        asTenant(companyA, (tx) =>
          accountsRepo.updateAccount(tx, a.id, { accountType: "expense" })),
      ).rejects.toThrow(/posted line/i);

      await expect(
        asTenant(companyA, (tx) =>
          accountsRepo.updateAccount(tx, a.id, { accountCode: "4999" })),
      ).rejects.toThrow(/posted line/i);

      // The NAME is still free — it describes, it does not classify.
      const renamed = await asTenant(companyA, (tx) =>
        accountsRepo.updateAccount(tx, a.id, { accountName: "Trading Revenue" }));
      expect(renamed.accountName).toBe("Trading Revenue");
    });
  });

  describe("balances are derived, not cached", () => {
    it("moves with the journal, with nothing asked to recalculate", async () => {
      const ar = await asTenant(companyA, (tx) =>
        accountsRepo.createAccount(tx, mk({ accountCode: "1200", accountName: "AR", accountType: "asset" })));
      const rev = await asTenant(companyA, (tx) => accountsRepo.createAccount(tx, mk()));

      let acct = await asTenant(companyA, (tx) => accountsRepo.getAccount(tx, ar.id));
      expect(acct.cachedBalance).toBe(0);

      await postEntry({ number: "JE-1", date: "2026-08-20", debitAcct: ar.id, creditAcct: rev.id, amount: 250 });

      // No cache to refresh — the view IS the balance.
      acct = await asTenant(companyA, (tx) => accountsRepo.getAccount(tx, ar.id));
      expect(acct.cachedBalance).toBe(250);
      expect(acct.totalDebit).toBe(250);
    });

    it("builds a ledger with a running balance in SQL", async () => {
      const ar = await asTenant(companyA, (tx) =>
        accountsRepo.createAccount(tx, mk({ accountCode: "1200", accountName: "AR", accountType: "asset" })));
      const rev = await asTenant(companyA, (tx) => accountsRepo.createAccount(tx, mk()));

      for (const [i, amt] of [100, 50, 25].entries()) {
        await postEntry({
          number: `JE-${i + 1}`, date: `2026-08-${20 + i}`,
          debitAcct: ar.id, creditAcct: rev.id, amount: amt,
        });
      }

      const rows = await asTenant(companyA, (tx) => accountsRepo.getAccountLedger(tx, ar.id));
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.runningBalance)).toEqual([100, 150, 175]);
    });
  });

  describe("grouping and isolation", () => {
    it("groups roots by type and nests the children", async () => {
      const header = await asTenant(companyA, (tx) =>
        accountsRepo.createAccount(tx, mk({ accountCode: "1000", accountName: "Assets", accountType: "asset", subType: "header" })));
      await asTenant(companyA, (tx) =>
        accountsRepo.createAccount(tx, mk({ accountCode: "1100", accountName: "Cash", accountType: "asset", parentId: header.id })));
      await asTenant(companyA, (tx) => accountsRepo.createAccount(tx, mk()));

      const grouped = await asTenant(companyA, (tx) => accountsRepo.getAccountsGrouped(tx));
      expect(Object.keys(grouped).sort()).toEqual(["asset", "revenue"]);
      expect(grouped.asset).toHaveLength(1);
      expect(grouped.asset[0].children.map((c) => c.accountName)).toEqual(["Cash"]);
      // Plain values only — this is handed to a client component.
      expect(typeof grouped.asset[0]._id).toBe("string");
      expect(typeof grouped.asset[0].cachedBalance).toBe("number");
    });

    it("shows a tenant only its own chart", async () => {
      await asTenant(companyA, (tx) => accountsRepo.createAccount(tx, mk({ accountName: "Alpha Sales" })));
      await asTenant(companyB, (tx) =>
        accountsRepo.createAccount(tx, mk({ companyId: companyB, accountName: "Beta Sales" })));

      const grouped = await asTenant(companyA, (tx) => accountsRepo.getAccountsGrouped(tx));
      const names = Object.values(grouped).flat().map((a) => a.accountName);
      expect(names).toEqual(["Alpha Sales"]);
    });

    it("counts only this tenant's accounts", async () => {
      await asTenant(companyA, (tx) => accountsRepo.createAccount(tx, mk()));
      await asTenant(companyB, (tx) =>
        accountsRepo.createAccount(tx, mk({ companyId: companyB })));
      const stats = await asTenant(companyA, (tx) => accountsRepo.getAccountStats(tx));
      expect(stats.total).toBe(1);
    });
  });
});
