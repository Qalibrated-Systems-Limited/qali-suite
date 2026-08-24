/**
 * Expenses — the seventh module out of the Mongo ledger (§9J).
 *
 * `app/models/expenses.js:608` and `:695` post through the Mongo JournalEntry
 * model while every ledger screen reads Postgres, and the path is live:
 * ExpenseForm → createExpense → expense.post(). Every expense a user entered
 * went into a ledger no screen reads.
 *
 * What is asserted here is mostly what the Mongo version could NOT guarantee:
 * that `total` and `payment_status` cannot go stale, that a half-posted
 * expense cannot persist, that "paid with no account" is not expressible, and
 * that an expense can be undone at all.
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

const expensesRepo = await import("@/app/db/repositories/expenses");

suite("expenses on postgres", () => {
  let admin, client, db, companyA, companyB;
  let expenseAcct, cashAcct, accruedAcct, vatAcct, headerAcct, revenueAcct;
  let supplier, userId;

  const asTenant = (c, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${c}, true)`);
      return fn(tx);
    });

  const accountNet = async (accountId) => {
    const [r] = await admin`
      SELECT COALESCE(SUM(debit - credit), 0)::float8 AS net
        FROM journal_lines WHERE account_id = ${accountId}::uuid`;
    return r.net;
  };

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
    await admin`TRUNCATE companies, entry_counters CASCADE`;
    companyA = randomUUID();
    companyB = randomUUID();
    expenseAcct = randomUUID();
    cashAcct = randomUUID();
    accruedAcct = randomUUID();
    vatAcct = randomUUID();
    headerAcct = randomUUID();
    revenueAcct = randomUUID();
    supplier = randomUUID();
    userId = randomUUID();

    await admin`INSERT INTO companies (id, name, slug) VALUES
      (${companyA}, 'Acme Ltd',  ${"a-" + companyA.slice(0, 8)}),
      (${companyB}, 'Other Ltd', ${"b-" + companyB.slice(0, 8)})`;
    await admin`INSERT INTO users (id, home_company_id, name, email, role) VALUES
      (${userId}, ${companyA}, 'Ann Mwangi', ${userId + "@x.test"}, 'Accountant')`;

    await asTenant(companyA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO accounts
          (id, company_id, account_code, account_name, account_type, sub_type, can_post, system_account)
        VALUES
          (${expenseAcct}::uuid, ${companyA}::uuid, '6100', 'Office Supplies',  'expense',   NULL,   true, NULL),
          (${cashAcct}::uuid,    ${companyA}::uuid, '1010', 'Petty Cash',       'asset',     'cash', true, NULL),
          (${accruedAcct}::uuid, ${companyA}::uuid, '2170', 'Accrued Expenses', 'liability', NULL,   true, 'accrued_expenses'),
          (${headerAcct}::uuid,  ${companyA}::uuid, '6000', 'Expenses',         'expense',   NULL,   false, NULL),
          (${revenueAcct}::uuid, ${companyA}::uuid, '4000', 'Sales',            'revenue',   NULL,   true, NULL)`);
      await tx.execute(sql`
        INSERT INTO parties (id, company_id, name, primary_type, is_supplier)
        VALUES (${supplier}::uuid, ${companyA}::uuid, 'Text Book Centre', 'supplier', true)`);
      await tx.execute(sql`
        INSERT INTO fiscal_periods
          (company_id, year, month, period_name, period_code, start_date, end_date, status)
        SELECT ${companyA}::uuid, y, m,
               to_char(make_date(y, m, 1), 'FMMonth YYYY'),
               to_char(make_date(y, m, 1), 'YYYY-MM'),
               make_date(y, m, 1),
               (make_date(y, m, 1) + interval '1 month - 1 day')::date, 'open'
          FROM generate_series(2025, 2032) AS y, generate_series(1, 12) AS m`);
    });
  });

  const base = (over = {}) => ({
    companyId: companyA,
    expenseDate: "2026-08-14",
    category: "office_supplies",
    accountId: expenseAcct,
    amount: "1000.0000",
    payeeName: "Text Book Centre",
    payeePartyId: supplier,
    payeeType: "supplier",
    description: "Printer paper",
    createdById: userId,
    ...over,
  });

  const create = (over = {}) =>
    asTenant(companyA, (tx) => expensesRepo.createAndPostExpense(tx, base(over)));

  // ───────────────────────────────────────────────────────────────────────────
  describe("posting", () => {
    it("an unpaid expense debits the expense account and credits accrued", async () => {
      const { expense } = await create();

      expect(expense.status).toBe("posted");
      expect(expense.paymentStatus).toBe("unpaid");
      expect(await accountNet(expenseAcct)).toBe(1000);
      expect(await accountNet(accruedAcct)).toBe(-1000);
    });

    it("a paid expense credits the cash account instead", async () => {
      const { expense } = await create({
        paymentMethod: "cash",
        paidFromAccountId: cashAcct,
      });

      expect(expense.status).toBe("paid");
      expect(expense.paymentStatus).toBe("paid");
      expect(await accountNet(cashAcct)).toBe(-1000);
      expect(await accountNet(accruedAcct)).toBe(0);
    });

    it("splits VAT out of the expense line when input VAT is claimable", async () => {
      await asTenant(companyA, (tx) =>
        tx.execute(sql`
          INSERT INTO accounts (id, company_id, account_code, account_name, account_type, can_post, system_account)
          VALUES (${vatAcct}::uuid, ${companyA}::uuid, '1300', 'VAT Input', 'asset', true, 'vat_input')`),
      );

      await create({ amount: "1000.0000", taxAmount: "160.0000", taxRate: "16.00" });

      // The expense carries the NET; the VAT is an asset, not a cost.
      expect(await accountNet(expenseAcct)).toBe(1000);
      expect(await accountNet(vatAcct)).toBe(160);
      expect(await accountNet(accruedAcct)).toBe(-1160);
    });

    it("debits the gross to the expense account when there is no VAT Input account", async () => {
      // Mongo's behaviour, kept deliberately: with nowhere to put reclaimable
      // VAT, the whole cost is an expense. Changing it would silently change
      // what a company's P&L says.
      await create({ amount: "1000.0000", taxAmount: "160.0000", taxRate: "16.00" });

      expect(await accountNet(expenseAcct)).toBe(1160);
      expect(await accountNet(accruedAcct)).toBe(-1160);
    });

    it("withholding tax reduces what is owed, not what is spent", async () => {
      await create({ amount: "1000.0000", withholdingTax: "50.0000" });

      expect(await accountNet(expenseAcct)).toBe(950);
      expect(await accountNet(accruedAcct)).toBe(-950);
    });

    it("posts an expense whose payee is not on file", async () => {
      // `vendor.name` is required on the Mongo schema and `vendor.id` is not,
      // so a cash purchase from someone with no party record is ordinary. The
      // journal entry then has a party NAME and no party — and
      // `journal_entries_party_pair` requires party_type and party_id to be
      // both set or both null, so tagging it 'supplier' with nothing to point
      // at fails the check. Found by the petty cash statement suite.
      const { expense, entry } = await create({ payeePartyId: null });

      expect(expense.payeeNameAtExpense).toBe("Text Book Centre");
      expect(expense.payeePartyId).toBeNull();
      const [je] = await admin`
        SELECT party_type, party_id FROM journal_entries WHERE id = ${entry.id}`;
      expect(je.party_type).toBeNull();
      expect(je.party_id).toBeNull();
    });

    it("refuses a non-expense account", async () => {
      await expect(create({ accountId: revenueAcct })).rejects.toThrow(
        /must be an expense account/i,
      );
    });

    it("refuses a header account", async () => {
      await expect(create({ accountId: headerAcct })).rejects.toThrow(
        /header account/i,
      );
    });

    it("refuses a payment account that is not cash, bank or mpesa", async () => {
      await expect(
        create({ paymentMethod: "cash", paidFromAccountId: expenseAcct }),
      ).rejects.toThrow(/Invalid payment account type/i);
    });

    it("says so plainly when Accrued Expenses is not configured", async () => {
      // Mongo would ADOPT an account, or CREATE code 2170, or on a duplicate
      // key adopt whatever holds 2170 and retag it — rewriting the chart of
      // accounts from inside an expense posting.
      await admin`UPDATE accounts SET system_account = NULL WHERE id = ${accruedAcct}`;

      await expect(create()).rejects.toThrow(/Accrued Expenses account not configured/);
    });

    it("leaves nothing behind when the posting fails", async () => {
      await admin`UPDATE accounts SET system_account = NULL WHERE id = ${accruedAcct}`;
      await expect(create()).rejects.toThrow();

      const [{ count }] = await admin`SELECT count(*)::int FROM expenses`;
      expect(count).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the columns the model computed by hand", () => {
    it("total is generated, so correcting the amount corrects the total", async () => {
      const { expense } = await create({ amount: "1000.0000", taxAmount: "160.0000" });
      expect(Number(expense.total)).toBe(1160);

      await admin`UPDATE expenses SET amount = 2000 WHERE id = ${expense.id}`;
      const [row] = await admin`SELECT total FROM expenses WHERE id = ${expense.id}`;
      // validateAmounts() is a METHOD in Mongo — a write that skips it leaves
      // `total` at 1160 while `amount` says 2000.
      expect(Number(row.total)).toBe(2160);
    });

    it("total cannot be written directly", async () => {
      const { expense } = await create();
      await expect(
        admin`UPDATE expenses SET total = 1 WHERE id = ${expense.id}`,
      ).rejects.toThrow();
    });

    it("payment_status follows paid_at with no read hook to repair it", async () => {
      const { expense } = await create();
      expect(expense.paymentStatus).toBe("unpaid");

      await admin`UPDATE expenses
                     SET paid_at = now(), payment_method = 'cash',
                         paid_from_account_id = ${cashAcct}
                   WHERE id = ${expense.id}`;
      const [row] = await admin`SELECT payment_status FROM expenses WHERE id = ${expense.id}`;
      expect(row.payment_status).toBe("paid");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("states the Mongo schema allowed", () => {
    it("cannot record a payment method without an account", async () => {
      const { expense } = await create();
      // The exact state postLegacyExpense has a special case for.
      await expect(
        admin`UPDATE expenses SET payment_method = 'cash' WHERE id = ${expense.id}`,
      ).rejects.toThrow(/expenses_payment_is_whole/);
    });

    it("cannot leave a posted expense without a journal entry", async () => {
      const { expense } = await create();
      await expect(
        admin`UPDATE expenses SET journal_entry_id = NULL WHERE id = ${expense.id}`,
      ).rejects.toThrow(/expenses_posted_has_entry/);
    });

    it("cannot hold a clearing entry for an expense that was never paid", async () => {
      const { expense } = await create();
      const [je] = await admin`SELECT id FROM journal_entries LIMIT 1`;
      await expect(
        admin`UPDATE expenses SET clearing_journal_entry_id = ${je.id} WHERE id = ${expense.id}`,
      ).rejects.toThrow(/expenses_clearing_needs_payment/);
    });

    it("cannot record a zero or negative amount", async () => {
      await expect(create({ amount: "0.0000" })).rejects.toThrow();
      await expect(create({ amount: "-5.0000" })).rejects.toThrow();
    });

    it("cannot withhold more than the expense is worth", async () => {
      await expect(
        create({ amount: "100.0000", withholdingTax: "150.0000" }),
      ).rejects.toThrow();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("recording payment against an accrual", () => {
    it("clears the accrual and credits the cash account", async () => {
      const { expense } = await create();

      const { expense: paid } = await asTenant(companyA, (tx) =>
        expensesRepo.recordExpensePayment(tx, expense.id, {
          paymentMethod: "cash",
          paidFromAccountId: cashAcct,
          paidById: userId,
        }),
      );

      expect(paid.status).toBe("paid");
      expect(paid.paymentStatus).toBe("paid");
      expect(await accountNet(accruedAcct)).toBe(0);
      expect(await accountNet(cashAcct)).toBe(-1000);
      // The cost stays where it was: paying an accrual is a balance-sheet move.
      expect(await accountNet(expenseAcct)).toBe(1000);
    });

    it("refuses to pay the same expense twice", async () => {
      const { expense } = await create();
      const pay = () =>
        asTenant(companyA, (tx) =>
          expensesRepo.recordExpensePayment(tx, expense.id, {
            paymentMethod: "cash",
            paidFromAccountId: cashAcct,
            paidById: userId,
          }),
        );

      await pay();
      await expect(pay()).rejects.toThrow(/already paid/i);
    });

    it("refuses to pay an expense that was paid at entry", async () => {
      const { expense } = await create({
        paymentMethod: "cash",
        paidFromAccountId: cashAcct,
      });

      await expect(
        asTenant(companyA, (tx) =>
          expensesRepo.recordExpensePayment(tx, expense.id, {
            paymentMethod: "cash",
            paidFromAccountId: cashAcct,
            paidById: userId,
          }),
        ),
      ).rejects.toThrow(/already paid/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("void", () => {
    // NEW. Mongo carries the `void` status, voidedAt, voidedBy and voidReason
    // and writes none of them, while deleteExpense refuses a posted expense
    // with "void it instead" — and every expense is posted at creation, so
    // there was no way to undo one at all.
    it("reverses the posting and leaves the ledger flat", async () => {
      const { expense } = await create();

      const { expense: voided } = await asTenant(companyA, (tx) =>
        expensesRepo.voidExpense(tx, expense.id, {
          reason: "Duplicate entry",
          voidedById: userId,
        }),
      );

      expect(voided.status).toBe("void");
      expect(voided.voidReason).toBe("Duplicate entry");
      expect(await accountNet(expenseAcct)).toBe(0);
      expect(await accountNet(accruedAcct)).toBe(0);
    });

    it("reverses the clearing entry as well as the posting", async () => {
      const { expense } = await create();
      await asTenant(companyA, (tx) =>
        expensesRepo.recordExpensePayment(tx, expense.id, {
          paymentMethod: "cash",
          paidFromAccountId: cashAcct,
          paidById: userId,
        }),
      );

      await asTenant(companyA, (tx) =>
        expensesRepo.voidExpense(tx, expense.id, {
          reason: "Paid the wrong supplier",
          voidedById: userId,
        }),
      );

      expect(await accountNet(expenseAcct)).toBe(0);
      expect(await accountNet(accruedAcct)).toBe(0);
      expect(await accountNet(cashAcct)).toBe(0);
    });

    it("keeps the original entries — a void is a reversal, not an erasure", async () => {
      const { expense, entry } = await create();
      await asTenant(companyA, (tx) =>
        expensesRepo.voidExpense(tx, expense.id, { reason: "x", voidedById: userId }),
      );

      // Marked `reversed`, not deleted, and its lines are untouched — the
      // reversal is a second entry, so both sides of the correction are on
      // the record.
      const [orig] = await admin`
        SELECT status, reversed_at FROM journal_entries WHERE id = ${entry.id}`;
      expect(orig.status).toBe("reversed");
      expect(orig.reversed_at).not.toBeNull();

      const [{ count }] = await admin`
        SELECT count(*)::int FROM journal_lines WHERE entry_id = ${entry.id}`;
      expect(count).toBe(2);
    });

    it("refuses to void twice", async () => {
      const { expense } = await create();
      const kill = () =>
        asTenant(companyA, (tx) =>
          expensesRepo.voidExpense(tx, expense.id, { reason: "x", voidedById: userId }),
        );
      await kill();
      await expect(kill()).rejects.toThrow(/already void/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("tenant isolation", () => {
    it("another company cannot see the expense", async () => {
      await create();
      const rows = await asTenant(companyB, (tx) => expensesRepo.listExpenses(tx, {}));
      expect(rows.expenses).toHaveLength(0);
      expect(rows.pagination.total).toBe(0);
    });

    it("another company cannot read it by id", async () => {
      const { expense } = await create();
      const found = await asTenant(companyB, (tx) =>
        expensesRepo.getExpense(tx, expense.id),
      );
      expect(found).toBeNull();
    });

    it("expense numbers do not collide across companies", async () => {
      const { expense: a } = await create();
      await admin`INSERT INTO users (id, home_company_id, name, email, role)
                  VALUES (${randomUUID()}, ${companyB}, 'B', ${randomUUID() + "@x.test"}, 'Accountant')`;
      // Same counter prefix, different company — the unique index is on the
      // pair, and next_entry_number is keyed per company.
      expect(a.expenseNumber).toMatch(/^EXP-\d{5}$/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("summary", () => {
    it("counts accruals as cost, which the Mongo breakdown did not", async () => {
      await create({ amount: "1000.0000" });
      await create({
        amount: "500.0000",
        paymentMethod: "cash",
        paidFromAccountId: cashAcct,
      });

      const s = await asTenant(companyA, (tx) =>
        expensesRepo.getExpenseSummary(tx, { startDate: "2026-08-01", endDate: "2026-08-31" }),
      );

      // Mongo's getExpensesByCategory filters `status: "paid"`, so the 1000
      // accrual would be missing from the category breakdown entirely.
      const office = s.byCategory.find((c) => c.category === "office_supplies");
      expect(Number(office.total)).toBe(1500);
      expect(Number(s.totals.totalAmount)).toBe(1500);
      expect(Number(s.totals.totalPaid)).toBe(500);
      expect(Number(s.totals.totalUnpaid)).toBe(1000);
    });

    it("excludes voided expenses from the period totals", async () => {
      const { expense } = await create({ amount: "1000.0000" });
      await create({ amount: "250.0000" });
      await asTenant(companyA, (tx) =>
        expensesRepo.voidExpense(tx, expense.id, { reason: "x", voidedById: userId }),
      );

      const s = await asTenant(companyA, (tx) =>
        expensesRepo.getExpenseSummary(tx, { startDate: "2026-08-01", endDate: "2026-08-31" }),
      );
      expect(Number(s.totals.totalAmount)).toBe(250);
    });
  });
});
