/**
 * Petty cash STATEMENT — the return is derived from the GL, not typed.
 *
 * buildStatement aggregates the float account's activity over a date
 * range: CR = every Expense paid from the float, DR = posted JE lines that debit
 * the float (top-ups). This proves the core logic (rows, DR/CR split, running
 * balance, project/category labels).
 *
 * POSTGRES on both halves: the expenses half moved in 0059 and the returns in
 * 0060, and that pairing is the point.
 * This function is why the plan said expenses had to move BEFORE petty cash:
 * it takes the float's opening and closing position from the GL and the spend
 * rows from expenses, so moving one without the other would have split the
 * statement across two stores — balances from one, spend from the other,
 * disagreeing about the same tin.
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

let companyId, db;

// buildStatement takes a `tx`, so there is no tenant helper to stub — the
// test opens its own transaction with app.company_id set, exactly as
// withAuthorizedTenant does, and RLS is live.
const pettyCash = await import("@/app/db/repositories/pettyCash");
const expensesRepo = await import("@/app/db/repositories/expenses");

suite("petty cash statement", () => {
  let admin, client;
  let floatId, bankId, fuelAcct, userId;

  const asTenant = (fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });

  /** A posted entry that moves money between two accounts. */
  const postEntry = async (date, description, debitAcct, creditAcct, amount) => {
    const entryId = randomUUID();
    await asTenant(async (tx) => {
      await tx.execute(sql`
        INSERT INTO journal_entries
          (id, company_id, entry_number, entry_date, entry_type, description, status, posted_at)
        VALUES (${entryId}::uuid, ${companyId}::uuid,
                ${"JE-" + entryId.slice(0, 8)}, ${date}::date, 'transfer',
                ${description}, 'posted', now())`);
      await tx.execute(sql`
        INSERT INTO journal_lines (company_id, entry_id, account_id, line_number, debit, credit)
        VALUES
          (${companyId}::uuid, ${entryId}::uuid, ${debitAcct}::uuid,  1, ${amount}, 0),
          (${companyId}::uuid, ${entryId}::uuid, ${creditAcct}::uuid, 2, 0, ${amount})`);
    });
    return entryId;
  };

  const spend = (over = {}) =>
    asTenant((tx) =>
      expensesRepo.createAndPostExpense(tx, {
        companyId,
        expenseDate: "2026-02-10",
        category: "transport",
        accountId: fuelAcct,
        amount: "2000.0000",
        payeeName: "Tom",
        description: "Fuel",
        paymentMethod: "cash",
        paidFromAccountId: floatId,
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
    await admin`TRUNCATE companies, entry_counters CASCADE`;
    companyId = randomUUID();
    floatId = randomUUID();
    bankId = randomUUID();
    fuelAcct = randomUUID();
    userId = randomUUID();

    await admin`INSERT INTO companies (id, name, slug)
      VALUES (${companyId}, 'Acme Ltd', ${"a-" + companyId.slice(0, 8)})`;
    await admin`INSERT INTO users (id, home_company_id, name, email, role)
      VALUES (${userId}, ${companyId}, 'Tom', ${userId + "@x.test"}, 'Accountant')`;

    await asTenant(async (tx) => {
      await tx.execute(sql`
        INSERT INTO accounts
          (id, company_id, account_code, account_name, account_type, sub_type, can_post, system_account)
        VALUES
          (${floatId}::uuid,  ${companyId}::uuid, '1000', 'Petty Cash',       'asset',     'cash', true, 'petty_cash'),
          (${bankId}::uuid,   ${companyId}::uuid, '1010', 'KCB',              'asset',     'bank', true, NULL),
          (${fuelAcct}::uuid, ${companyId}::uuid, '6200', 'Transport & Fuel', 'expense',   NULL,   true, NULL),
          (${randomUUID()}::uuid, ${companyId}::uuid, '2170', 'Accrued Expenses', 'liability', NULL, true, 'accrued_expenses')`);
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

  it("lists float top-ups (DR) + expenses paid from the float (CR) with running balance", async () => {
    await postEntry("2026-02-01", "Float received", floatId, bankId, 50000);

    // Two spends actually PAID from the float — one project-tagged, one
    // category overhead.
    await spend({
      total: undefined,
      projectId: "65f0000000000000000000aa",
      projectName: "Tom Project",
    });
    await spend({
      amount: "780.0000",
      category: "office_supplies",
      description: "Kitchen",
      payeeName: "Sophie",
    });
    // An unpaid accrual against the float, in range — NOT cash out.
    await spend({
      amount: "5000.0000",
      description: "Accrued, unpaid",
      payeeName: "Z",
      paymentMethod: null,
      paidFromAccountId: null,
    });
    // Out of range, and paid from a different account — neither may appear.
    await spend({ expenseDate: "2026-03-05", amount: "999.0000", description: "Next month" });
    await spend({
      amount: "888.0000",
      description: "Paid from bank",
      paymentMethod: "bank_transfer",
      paidFromAccountId: bankId,
    });

    const { rows, totals } = await asTenant((tx) =>
      pettyCash.buildStatement(tx, floatId, {
        from: "2026-02-01",
        to: "2026-02-28",
        openingOverride: "0",
      }),
    );

    expect(rows).toHaveLength(3); // 1 top-up + 2 in-range PAID float expenses
    expect(totals.debits).toBe(50000);
    expect(totals.credits).toBe(2780); // 2000 + 780 — the 5000 accrual is excluded
    expect(totals.closing).toBe(47220);
    expect(rows.some((r) => r.amount === 5000)).toBe(false);

    const topup = rows.find((r) => r.direction === "debit");
    expect(topup.amount).toBe(50000);

    const fuel = rows.find((r) => r.amount === 2000);
    // The project NAME is snapshotted on the expense, so labelling a row no
    // longer means loading every project in the company.
    expect(fuel.projectLabel).toBe("Tom Project");
    const kitchen = rows.find((r) => r.amount === 780);
    expect(kitchen.projectLabel).toBe("office_supplies"); // category fallback

    expect(rows[rows.length - 1].balance).toBe(47220);
  });

  it("opens at the float's GL balance (incl. a pre-period opening-balance entry)", async () => {
    await postEntry("2026-01-15", "Opening balance", floatId, bankId, 10000);
    await postEntry("2026-02-05", "Float top-up", floatId, bankId, 5000);
    await spend(); // 2,000 from the float, in period

    // No explicit opening passed → GL-derived.
    const { rows, openingBalance, totals } = await asTenant((tx) =>
      pettyCash.buildStatement(tx, floatId, { from: "2026-02-01", to: "2026-02-28" }),
    );

    expect(openingBalance).toBe(10000); // the Jan opening entry, not zero
    expect(rows).toHaveLength(2); // only in-period top-up + expense
    expect(totals.debits).toBe(5000);
    expect(totals.credits).toBe(2000);
    expect(totals.closing).toBe(13000); // 10,000 + 5,000 - 2,000
  });

  it("reconciles: the GL closing and the accounted closing agree", async () => {
    // The variance exists to catch cash movements the expense list does not
    // capture. With none, it must be exactly zero — and it is exact, because
    // both sides are summed in the database rather than accumulated in a float.
    await postEntry("2026-02-01", "Float received", floatId, bankId, 50000);
    await spend({ amount: "1333.3300", description: "Odd amount" });
    await spend({ amount: "666.6700", description: "Another" });

    const { totals } = await asTenant((tx) =>
      pettyCash.buildStatement(tx, floatId, { from: "2026-02-01", to: "2026-02-28" }),
    );

    expect(totals.credits).toBe(2000);
    expect(totals.variance).toBe(0);
    expect(totals.glClosing).toBe(totals.closing);
  });

  it("a voided expense stops being money out of the tin", async () => {
    await postEntry("2026-02-01", "Float received", floatId, bankId, 50000);
    const { expense } = await spend();

    await asTenant((tx) =>
      expensesRepo.voidExpense(tx, expense.id, {
        reason: "Entered twice",
        voidedById: userId,
      }),
    );

    const { rows, totals } = await asTenant((tx) =>
      pettyCash.buildStatement(tx, floatId, { from: "2026-02-01", to: "2026-02-28" }),
    );

    // Off the statement, and off the GL too — the void reversed the posting,
    // so the accounted and GL closings still agree.
    expect(rows.filter((r) => r.kind === "expense")).toHaveLength(0);
    expect(totals.credits).toBe(0);
    expect(totals.variance).toBe(0);
  });
});
