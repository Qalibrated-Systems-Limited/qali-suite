/**
 * Opening balances — the cutover (0061).
 *
 * `opening-balance-actions.js:161` posted the lump entry through the Mongo
 * JournalEntry model while every ledger screen reads Postgres, so a company's
 * entire opening position went into a ledger nothing displays.
 *
 * The half that already existed was worse than absent:
 * `createOpeningBalanceBill` sat in the bills repository with no caller and no
 * journal posting behind it. The test named "an opening bill posts" is the one
 * that would have caught that.
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

/**
 * The conversion-window rules live in the ACTION layer, because they read the
 * cutover date off `companies` — outside the tenant-scoped tables. Stubbed to
 * the company under test, with app.company_id set the way the real helper
 * does, so RLS stays live.
 */
let tenantCompanyId, tenantDb;
vi.mock("@/app/db/tenant", () => ({
  withAuthorizedTenant: vi.fn(async (_roles, fn) =>
    tenantDb.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.company_id', ${tenantCompanyId}, true)`,
      );
      return fn(tx, {
        user: { id: "u1", name: "Ann", role: "Accountant" },
        companyId: tenantCompanyId,
      });
    }),
  ),
}));

const ob = await import("@/app/db/repositories/openingBalances");
const obActions = await import("@/app/db/actions/opening-balance-actions");
const invoicesRepo = await import("@/app/db/repositories/invoices");
const billsRepo = await import("@/app/db/repositories/bills");

suite("opening balances", () => {
  let admin, client, db;
  let companyId, cashAcct, loanAcct, arAcct, apAcct, obeAcct, revenueAcct;
  let customer, supplier, userId;

  const asTenant = (fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });

  const accountNet = async (accountId) => {
    const [r] = await admin`
      SELECT COALESCE(SUM(debit - credit), 0)::float8 AS net
        FROM journal_lines WHERE account_id = ${accountId}::uuid`;
    return r.net;
  };

  const postLump = (lines, over = {}) =>
    asTenant((tx) =>
      ob.postOpeningBalances(tx, {
        companyId,
        entryDate: "2026-01-01",
        lines,
        openingEquityAccountId: obeAcct,
        createdById: userId,
        ...over,
      }),
    );

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
    companyId = randomUUID();
    tenantCompanyId = companyId;
    tenantDb = db;
    cashAcct = randomUUID(); loanAcct = randomUUID(); arAcct = randomUUID();
    apAcct = randomUUID(); obeAcct = randomUUID(); revenueAcct = randomUUID();
    customer = randomUUID(); supplier = randomUUID(); userId = randomUUID();

    await admin`INSERT INTO companies (id, name, slug)
      VALUES (${companyId}, 'Acme Ltd', ${"a-" + companyId.slice(0, 8)})`;
    await admin`INSERT INTO users (id, home_company_id, name, email, role)
      VALUES (${userId}, ${companyId}, 'Ann', ${userId + "@x.test"}, 'Accountant')`;

    await asTenant(async (tx) => {
      await tx.execute(sql`
        INSERT INTO accounts
          (id, company_id, account_code, account_name, account_type, sub_type, can_post, system_account)
        VALUES
          (${cashAcct}::uuid,    ${companyId}::uuid, '1000', 'Cash',                   'asset',     'cash', true, NULL),
          (${arAcct}::uuid,      ${companyId}::uuid, '1100', 'Accounts Receivable',    'asset',     NULL,   true, 'accounts_receivable'),
          (${loanAcct}::uuid,    ${companyId}::uuid, '2100', 'Bank Loan',              'liability', NULL,   true, NULL),
          (${apAcct}::uuid,      ${companyId}::uuid, '2000', 'Accounts Payable',       'liability', NULL,   true, 'accounts_payable'),
          (${obeAcct}::uuid,     ${companyId}::uuid, '3900', 'Opening Balance Equity', 'equity',    NULL,   true, 'opening_balance_equity'),
          (${revenueAcct}::uuid, ${companyId}::uuid, '4000', 'Sales',                  'revenue',   NULL,   true, 'sales_revenue')`);
      await tx.execute(sql`
        INSERT INTO parties (id, company_id, name, primary_type, is_customer, is_supplier)
        VALUES
          (${customer}::uuid, ${companyId}::uuid, 'Mama Njeri', 'customer', true, false),
          (${supplier}::uuid, ${companyId}::uuid, 'Tosha Ltd',  'supplier', false, true)`);
      await tx.execute(sql`
        INSERT INTO fiscal_periods
          (company_id, year, month, period_name, period_code, start_date, end_date, status)
        SELECT ${companyId}::uuid, y, m,
               to_char(make_date(y, m, 1), 'FMMonth YYYY'),
               to_char(make_date(y, m, 1), 'YYYY-MM'),
               make_date(y, m, 1),
               (make_date(y, m, 1) + interval '1 month - 1 day')::date, 'open'
          FROM generate_series(2025, 2032) AS y, generate_series(1, 12) AS m`);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the lump entry", () => {
    it("plugs the difference to Opening Balance Equity", async () => {
      // Cash 100,000 in; loan 40,000 owed. The 60,000 difference is equity.
      const { openingBalanceEquity } = await postLump([
        { accountId: cashAcct, debit: "100000.0000", credit: "0.0000" },
        { accountId: loanAcct, debit: "0.0000", credit: "40000.0000" },
      ]);

      expect(await accountNet(cashAcct)).toBe(100000);
      expect(await accountNet(loanAcct)).toBe(-40000);
      // OBE is credit-normal, so a net of -60000 in debit-minus-credit terms.
      expect(await accountNet(obeAcct)).toBe(-60000);
      expect(openingBalanceEquity).toBe(60000);
    });

    it("needs no plug when the entered balances already agree", async () => {
      await postLump([
        { accountId: cashAcct, debit: "50000.0000", credit: "0.0000" },
        { accountId: loanAcct, debit: "0.0000", credit: "50000.0000" },
      ]);
      expect(await accountNet(obeAcct)).toBe(0);
    });

    it("refuses to book a second lump", async () => {
      await postLump([
        { accountId: cashAcct, debit: "100.0000", credit: "0.0000" },
      ]);
      await expect(
        postLump([{ accountId: cashAcct, debit: "200.0000", credit: "0.0000" }]),
      ).rejects.toThrow(/already posted/i);
    });

    it("refuses a line carrying both a debit and a credit", async () => {
      await expect(
        postLump([
          { accountId: cashAcct, debit: "100.0000", credit: "100.0000" },
        ]),
      ).rejects.toThrow(/cannot have both/i);
    });

    it("refuses a header account by name", async () => {
      const header = randomUUID();
      await asTenant((tx) =>
        tx.execute(sql`
          INSERT INTO accounts (id, company_id, account_code, account_name, account_type, can_post)
          VALUES (${header}::uuid, ${companyId}::uuid, '1999', 'Current Assets', 'asset', false)`),
      );
      await expect(
        postLump([{ accountId: header, debit: "100.0000", credit: "0.0000" }]),
      ).rejects.toThrow(/Current Assets/);
    });

    it("refuses an empty set", async () => {
      await expect(
        postLump([{ accountId: cashAcct, debit: "0.0000", credit: "0.0000" }]),
      ).rejects.toThrow(/at least one/i);
    });

    it("is the entry with no source — that is what makes it the lump", async () => {
      const { entry } = await postLump([
        { accountId: cashAcct, debit: "100.0000", credit: "0.0000" },
      ]);
      const [row] = await admin`
        SELECT source_type, entry_type FROM journal_entries WHERE id = ${entry.id}`;
      expect(row.source_type).toBeNull();
      expect(row.entry_type).toBe("opening_balance");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("opening documents", () => {
    it("an opening invoice posts DR Accounts Receivable / CR Opening Balance Equity", async () => {
      await asTenant((tx) =>
        invoicesRepo.createOpeningBalanceInvoice(tx, {
          companyId,
          customerId: customer,
          invoiceDate: "2026-01-01",
          dueDate: "2026-01-31",
          amount: "25000.0000",
          arAccountId: arAcct,
          openingEquityAccountId: obeAcct,
          createdById: userId,
        }),
      );

      expect(await accountNet(arAcct)).toBe(25000);
      expect(await accountNet(obeAcct)).toBe(-25000);
      // No revenue: an opening receivable is not a sale in the new period.
      expect(await accountNet(revenueAcct)).toBe(0);
    });

    it("an opening bill posts DR Opening Balance Equity / CR Accounts Payable", async () => {
      // THE TEST THAT WOULD HAVE CAUGHT IT. createOpeningBalanceBill has
      // existed since the bills port, with no caller and no posting — so an
      // opening payable made through it seeded nothing at all.
      await asTenant((tx) =>
        billsRepo.createOpeningBalanceBill(tx, {
          companyId,
          supplierId: supplier,
          billDate: "2026-01-01",
          dueDate: "2026-01-31",
          amount: "18000.0000",
          apAccountId: apAcct,
          openingEquityAccountId: obeAcct,
          createdById: userId,
        }),
      );

      expect(await accountNet(apAcct)).toBe(-18000);
      expect(await accountNet(obeAcct)).toBe(18000);
    });

    it("marks the documents as opening balances", async () => {
      await asTenant((tx) =>
        invoicesRepo.createOpeningBalanceInvoice(tx, {
          companyId, customerId: customer, invoiceDate: "2026-01-01",
          dueDate: "2026-01-31", amount: "100.0000",
          arAccountId: arAcct, openingEquityAccountId: obeAcct, createdById: userId,
        }),
      );
      const [inv] = await admin`SELECT is_opening_balance FROM invoices`;
      expect(inv.is_opening_balance).toBe(true);
    });

    it("refuses an amount of zero", async () => {
      await expect(
        asTenant((tx) =>
          invoicesRepo.createOpeningBalanceInvoice(tx, {
            companyId, customerId: customer, invoiceDate: "2026-01-01",
            dueDate: "2026-01-31", amount: "0.0000",
            arAccountId: arAcct, openingEquityAccountId: obeAcct, createdById: userId,
          }),
        ),
      ).rejects.toThrow(/greater than zero/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("reversal", () => {
    const openInvoice = () =>
      asTenant((tx) =>
        invoicesRepo.createOpeningBalanceInvoice(tx, {
          companyId, customerId: customer, invoiceDate: "2026-01-01",
          dueDate: "2026-01-31", amount: "25000.0000",
          arAccountId: arAcct, openingEquityAccountId: obeAcct, createdById: userId,
        }),
      );

    it("reverses the entry and cancels the document", async () => {
      const { invoice } = await openInvoice();
      const updated = await asTenant((tx) =>
        ob.reverseOpeningInvoice(tx, invoice.id, { reversedById: userId }),
      );

      expect(updated.status).toBe("cancelled");
      expect(await accountNet(arAcct)).toBe(0);
      expect(await accountNet(obeAcct)).toBe(0);
    });

    it("refuses a document that is not an opening balance, and says so", async () => {
      // The Mongo version filtered isOpeningBalance out of the query, so a
      // plain invoice id reported "not found" rather than naming the rule.
      const plain = randomUUID();
      await asTenant((tx) =>
        tx.execute(sql`
          INSERT INTO invoices (id, company_id, invoice_number, invoice_date, customer_id, subtotal, status)
          VALUES (${plain}::uuid, ${companyId}::uuid, 'INV-9999', '2026-02-01',
                  ${customer}::uuid, 500, 'completed')`),
      );

      await expect(
        asTenant((tx) => ob.reverseOpeningInvoice(tx, plain, { reversedById: userId })),
      ).rejects.toThrow(/not an opening-balance invoice/i);
    });

    it("refuses to reverse twice", async () => {
      const { invoice } = await openInvoice();
      const kill = () =>
        asTenant((tx) => ob.reverseOpeningInvoice(tx, invoice.id, { reversedById: userId }));
      await kill();
      await expect(kill()).rejects.toThrow(/already reversed/i);
    });

    it("frees the period for a new lump once the old one is reversed", async () => {
      const { entry } = await postLump([
        { accountId: cashAcct, debit: "100.0000", credit: "0.0000" },
      ]);
      await admin`UPDATE journal_entries SET status = 'reversed' WHERE id = ${entry.id}`;

      const again = await postLump([
        { accountId: cashAcct, debit: "200.0000", credit: "0.0000" },
      ]);
      expect(again.entry.id).not.toBe(entry.id);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the conversion window", () => {
    // These two rules were LOST in the port and restored only because the
    // Mongo suite they came from still asserted them. resolveConversionWindow
    // enforced both; the first draft of the Postgres action enforced neither.
    const setCutover = (date) =>
      admin`UPDATE companies SET conversion_date = ${date} WHERE id = ${companyId}`;

    it("refuses an opening document before a cutover date is set", async () => {
      const res = await obActions.createOpeningInvoicePg({
        customerId: customer,
        invoiceDate: "2026-01-01",
        amount: 5000,
      });
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/conversion \(cutover\) date/i);
    });

    it("refuses a document dated after the cutover", async () => {
      await setCutover("2026-01-31");
      const res = await obActions.createOpeningInvoicePg({
        customerId: customer,
        invoiceDate: "2026-02-15",
        amount: 5000,
      });
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/on or before the conversion date/i);
    });

    it("accepts a document dated on the cutover itself", async () => {
      await setCutover("2026-01-31");
      const res = await obActions.createOpeningInvoicePg({
        customerId: customer,
        invoiceDate: "2026-01-31",
        amount: 5000,
      });
      expect(res.success).toBe(true);
      expect(await accountNet(arAcct)).toBe(5000);
    });

    it("applies the same rule to opening bills", async () => {
      await setCutover("2026-01-31");
      const res = await obActions.createOpeningBillPg({
        supplierId: supplier,
        billDate: "2026-03-01",
        amount: 5000,
      });
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/on or before the conversion date/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the setup screen's data", () => {
    it("opening documents do NOT block the lump", async () => {
      // The lump is the entry with no source; opening documents set one. If
      // the guard could not tell them apart, entering an opening invoice would
      // lock the trial-balance grid.
      await asTenant((tx) =>
        invoicesRepo.createOpeningBalanceInvoice(tx, {
          companyId, customerId: customer, invoiceDate: "2026-01-01",
          dueDate: "2026-01-31", amount: "25000.0000",
          arAccountId: arAcct, openingEquityAccountId: obeAcct, createdById: userId,
        }),
      );

      const setup = await asTenant((tx) => ob.getOpeningBalanceSetup(tx));
      expect(setup.alreadyPosted).toBeNull();

      // And the lump still books.
      const { entry } = await postLump([
        { accountId: cashAcct, debit: "100.0000", credit: "0.0000" },
      ]);
      expect(entry.entryNumber).toBeTruthy();
    });

    it("reports the live lock once a real transaction has posted", async () => {
      let setup = await asTenant((tx) => ob.getOpeningBalanceSetup(tx));
      expect(setup.liveLocked).toBe(false);

      // A real sale — not an opening balance, not a reversal.
      const entryId = randomUUID();
      await asTenant(async (tx) => {
        await tx.execute(sql`
          INSERT INTO journal_entries
            (id, company_id, entry_number, entry_date, entry_type, description, status, posted_at)
          VALUES (${entryId}::uuid, ${companyId}::uuid, 'JE-1', '2026-03-01', 'sale',
                  'A real sale', 'posted', now())`);
        await tx.execute(sql`
          INSERT INTO journal_lines (company_id, entry_id, account_id, line_number, debit, credit)
          VALUES
            (${companyId}::uuid, ${entryId}::uuid, ${arAcct}::uuid,      1, 500, 0),
            (${companyId}::uuid, ${entryId}::uuid, ${revenueAcct}::uuid, 2, 0, 500)`);
      });

      setup = await asTenant((tx) => ob.getOpeningBalanceSetup(tx));
      expect(setup.liveLocked).toBe(true);
    });

    it("reports the lump and the running OBE balance", async () => {
      await postLump([
        { accountId: cashAcct, debit: "100000.0000", credit: "0.0000" },
        { accountId: loanAcct, debit: "0.0000", credit: "40000.0000" },
      ]);

      const setup = await asTenant((tx) => ob.getOpeningBalanceSetup(tx));
      expect(setup.alreadyPosted).not.toBeNull();
      expect(setup.openingBalanceEquity).toBe(60000);
      expect(setup.obeAccountId).toBe(obeAcct);
    });

    it("lists opening documents with their totals", async () => {
      await asTenant((tx) =>
        invoicesRepo.createOpeningBalanceInvoice(tx, {
          companyId, customerId: customer, invoiceDate: "2026-01-01",
          dueDate: "2026-01-31", amount: "25000.0000",
          arAccountId: arAcct, openingEquityAccountId: obeAcct, createdById: userId,
        }),
      );
      await asTenant((tx) =>
        billsRepo.createOpeningBalanceBill(tx, {
          companyId, supplierId: supplier, billDate: "2026-01-01",
          dueDate: "2026-01-31", amount: "18000.0000",
          apAccountId: apAcct, openingEquityAccountId: obeAcct, createdById: userId,
        }),
      );

      const setup = await asTenant((tx) => ob.getOpeningBalanceSetup(tx));
      expect(setup.receivablesTotal).toBe(25000);
      expect(setup.payablesTotal).toBe(18000);
      expect(setup.openingReceivables[0].customer.name).toBe("Mama Njeri");
      expect(setup.openingPayables[0].supplier.name).toBe("Tosha Ltd");
    });

    it("a cancelled opening document drops off the list", async () => {
      const { invoice } = await asTenant((tx) =>
        invoicesRepo.createOpeningBalanceInvoice(tx, {
          companyId, customerId: customer, invoiceDate: "2026-01-01",
          dueDate: "2026-01-31", amount: "25000.0000",
          arAccountId: arAcct, openingEquityAccountId: obeAcct, createdById: userId,
        }),
      );
      await asTenant((tx) =>
        ob.reverseOpeningInvoice(tx, invoice.id, { reversedById: userId }),
      );

      const setup = await asTenant((tx) => ob.getOpeningBalanceSetup(tx));
      expect(setup.openingReceivables).toHaveLength(0);
      expect(setup.receivablesTotal).toBe(0);
    });
  });
});
