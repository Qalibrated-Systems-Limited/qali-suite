/**
 * Petty cash returns — the LAST module out of the Mongo ledger (0060).
 *
 * `petty-cash-actions.js:101` posted the float top-up through the Mongo
 * JournalEntry model while every ledger screen read Postgres. One posting, and
 * with it gone no Mongo module holds a journal entry.
 *
 * Most of what is asserted here is what the Mongo version could not promise:
 * that a signed statement stays signed, that `rejected` means rejected, and
 * that one period cannot be signed off twice.
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

const pettyCash = await import("@/app/db/repositories/pettyCash");
const expensesRepo = await import("@/app/db/repositories/expenses");

suite("petty cash returns", () => {
  let admin, client, db;
  let companyId, floatId, bankId, fuelAcct, revenueAcct, userId;

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

  const openReturn = (over = {}) =>
    asTenant((tx) =>
      pettyCash.createReturn(tx, {
        companyId,
        floatAccountId: floatId,
        from: "2026-02-01",
        to: "2026-02-28",
        custodianUserId: userId,
        custodianName: "Tom",
        createdById: userId,
        ...over,
      }),
    );

  const fund = (returnId, amount = "50000.0000", over = {}) =>
    asTenant((tx) =>
      pettyCash.fundFloat(tx, returnId, {
        sourceAccountId: bankId,
        amount,
        date: "2026-02-01",
        fundedById: userId,
        ...over,
      }),
    );

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
    await admin`TRUNCATE companies CASCADE`;
    await admin`TRUNCATE entry_counters`;
    companyId = randomUUID();
    floatId = randomUUID();
    bankId = randomUUID();
    fuelAcct = randomUUID();
    revenueAcct = randomUUID();
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
          (${floatId}::uuid,   ${companyId}::uuid, '1000', 'Petty Cash',       'asset',     'cash', true, 'petty_cash'),
          (${bankId}::uuid,    ${companyId}::uuid, '1010', 'KCB',              'asset',     'bank', true, NULL),
          (${fuelAcct}::uuid,  ${companyId}::uuid, '6200', 'Transport & Fuel', 'expense',   NULL,   true, NULL),
          (${revenueAcct}::uuid, ${companyId}::uuid, '4000', 'Sales',          'revenue',   NULL,   true, NULL),
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

  // ───────────────────────────────────────────────────────────────────────────
  describe("opening a return", () => {
    it("numbers it and starts as an unfrozen draft", async () => {
      const ret = await openReturn();
      expect(ret.documentNumber).toMatch(/^PCRF-\d{5}$/);
      expect(ret.status).toBe("draft");
      // A draft has no frozen figure — not a frozen zero.
      expect(ret.frozenAt).toBeNull();
      expect(ret.openingBalance).toBeNull();
      expect(ret.closingBalance).toBeNull();
    });

    it("refuses an account that cannot hold cash", async () => {
      // The Mongo version checked only that the account existed, so a return
      // could be opened against a revenue account and its "statement" would be
      // that account's ledger.
      await expect(openReturn({ floatAccountId: revenueAcct })).rejects.toThrow(
        /not a cash account/i,
      );
    });

    it("refuses a period that ends before it starts", async () => {
      await expect(
        openReturn({ from: "2026-03-31", to: "2026-03-01" }),
      ).rejects.toThrow();
    });

    // Finding 3 in 0060: the same spend could be put on two statements and
    // signed off twice.
    it("refuses a second return overlapping the same float and period", async () => {
      await openReturn();
      // Drizzle wraps the driver error, so the constraint name is on the
      // cause rather than the message — which is exactly why the action layer
      // walks the cause chain before translating it.
      await expect(
        openReturn({ from: "2026-02-15", to: "2026-03-15" }),
      ).rejects.toThrow();

      const [{ count }] = await admin`
        SELECT count(*)::int FROM petty_cash_returns WHERE company_id = ${companyId}`;
      expect(count).toBe(1);
    });

    it("allows the adjacent period", async () => {
      await openReturn();
      const next = await openReturn({ from: "2026-03-01", to: "2026-03-31" });
      expect(next.status).toBe("draft");
    });

    it("allows the same period on a DIFFERENT float", async () => {
      const otherFloat = randomUUID();
      await asTenant((tx) =>
        tx.execute(sql`
          INSERT INTO accounts (id, company_id, account_code, account_name, account_type, sub_type, can_post)
          VALUES (${otherFloat}::uuid, ${companyId}::uuid, '1001', 'Site Tin', 'asset', 'cash', true)`),
      );
      await openReturn();
      const second = await openReturn({ floatAccountId: otherFloat });
      expect(second.status).toBe("draft");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("funding the float", () => {
    it("posts DR Petty Cash / CR Bank", async () => {
      const ret = await openReturn();
      const entry = await fund(ret.id, "50000.0000");

      expect(entry.status).toBe("posted");
      expect(await accountNet(floatId)).toBe(50000);
      expect(await accountNet(bankId)).toBe(-50000);
    });

    it("links the entry back to the return", async () => {
      const ret = await openReturn();
      const entry = await fund(ret.id);
      const [je] = await admin`
        SELECT source_type, source_id FROM journal_entries WHERE id = ${entry.id}`;
      expect(je.source_type).toBe("petty_cash_return");
      expect(je.source_id).toBe(ret.id);
    });

    it("refuses to fund the tin from itself", async () => {
      const ret = await openReturn();
      await expect(fund(ret.id, "1000.0000", { sourceAccountId: floatId })).rejects.toThrow(
        /must differ/i,
      );
    });

    it("refuses a zero or negative amount", async () => {
      const ret = await openReturn();
      await expect(fund(ret.id, "0.0000")).rejects.toThrow(/greater than zero/i);
      await expect(fund(ret.id, "-100.0000")).rejects.toThrow(/greater than zero/i);
    });

    it("refuses to fund a return that is no longer a draft", async () => {
      const ret = await openReturn();
      await fund(ret.id);
      await asTenant((tx) => pettyCash.submitReturn(tx, ret.id, { preparedById: userId }));
      await expect(fund(ret.id, "1000.0000")).rejects.toThrow(/only be added to a draft/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the signed statement stays signed", () => {
    // The finding this whole table exists for. Mongo freezes the totals and
    // then getPettyCashReturnById overwrites them with a live recomputation,
    // so an approved return displays figures nobody approved.
    it("freezes the figures at submission", async () => {
      const ret = await openReturn();
      await fund(ret.id, "50000.0000");
      await spend({ amount: "2000.0000" });

      const submitted = await asTenant((tx) =>
        pettyCash.submitReturn(tx, ret.id, { preparedById: userId }),
      );

      expect(Number(submitted.totalDebits)).toBe(50000);
      expect(Number(submitted.totalCredits)).toBe(2000);
      expect(Number(submitted.closingBalance)).toBe(48000);
      expect(submitted.frozenAt).not.toBeNull();
    });

    it("does NOT move when an expense is booked into the period afterwards", async () => {
      const ret = await openReturn();
      await fund(ret.id, "50000.0000");
      await spend({ amount: "2000.0000" });
      await asTenant((tx) => pettyCash.submitReturn(tx, ret.id, { preparedById: userId }));
      await asTenant((tx) => pettyCash.approveReturn(tx, ret.id, { approvedById: userId }));

      // A late expense, dated inside the signed period.
      await spend({ amount: "750.0000", description: "Late claim" });

      const shown = await asTenant((tx) => pettyCash.getReturnForDisplay(tx, ret.id));

      // What was approved.
      expect(shown.frozen.credits).toBe(2000);
      expect(shown.frozen.closing).toBe(48000);
      // What the ledger says now.
      expect(shown.live.totals.credits).toBe(2750);
      // And the difference is REPORTED rather than silently substituted.
      expect(shown.drift).toBe(-750);
    });

    it("reports no drift when nothing has moved", async () => {
      const ret = await openReturn();
      await fund(ret.id, "50000.0000");
      await spend();
      await asTenant((tx) => pettyCash.submitReturn(tx, ret.id, { preparedById: userId }));

      const shown = await asTenant((tx) => pettyCash.getReturnForDisplay(tx, ret.id));
      expect(shown.drift).toBe(0);
    });

    it("has no drift to report while it is a draft", async () => {
      const ret = await openReturn();
      await fund(ret.id);
      const shown = await asTenant((tx) => pettyCash.getReturnForDisplay(tx, ret.id));
      expect(shown.frozen).toBeNull();
      expect(shown.drift).toBeNull();
      // A draft still shows a live statement — it just is not a signed one.
      expect(shown.live.totals.debits).toBe(50000);
    });

    it("a frozen figure cannot be half-written", async () => {
      const ret = await openReturn();
      await fund(ret.id);
      await asTenant((tx) => pettyCash.submitReturn(tx, ret.id, { preparedById: userId }));

      await expect(
        admin`UPDATE petty_cash_returns SET total_credits = NULL WHERE id = ${ret.id}`,
      ).rejects.toThrow(/freeze_is_whole/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("sign-off", () => {
    const submitted = async () => {
      const ret = await openReturn();
      await fund(ret.id);
      await spend();
      return asTenant((tx) => pettyCash.submitReturn(tx, ret.id, { preparedById: userId }));
    };

    it("approval posts nothing — it is a signature", async () => {
      const ret = await submitted();
      const [{ count: before }] = await admin`SELECT count(*)::int FROM journal_entries`;

      await asTenant((tx) => pettyCash.approveReturn(tx, ret.id, { approvedById: userId }));

      const [{ count: after }] = await admin`SELECT count(*)::int FROM journal_entries`;
      expect(after).toBe(before);
    });

    it("rejection means rejected, and carries the reason", async () => {
      // Mongo set the status to "draft", so a rejected return was
      // indistinguishable from one never submitted — while carrying a
      // rejectionReason for a state it claimed not to be in.
      const ret = await submitted();
      const sentBack = await asTenant((tx) =>
        pettyCash.rejectReturn(tx, ret.id, {
          reason: "Receipts missing for the fuel line",
          reviewedById: userId,
        }),
      );

      expect(sentBack.status).toBe("rejected");
      expect(sentBack.rejectionReason).toMatch(/Receipts missing/);
    });

    it("refuses a rejection with no reason", async () => {
      const ret = await submitted();
      await expect(
        asTenant((tx) =>
          pettyCash.rejectReturn(tx, ret.id, { reason: "  ", reviewedById: userId }),
        ),
      ).rejects.toThrow(/Say why/i);
    });

    it("the custodian resubmits from rejected, and the old reason clears", async () => {
      const ret = await submitted();
      await asTenant((tx) =>
        pettyCash.rejectReturn(tx, ret.id, { reason: "Missing receipts", reviewedById: userId }),
      );

      const again = await asTenant((tx) =>
        pettyCash.submitReturn(tx, ret.id, { preparedById: userId }),
      );

      expect(again.status).toBe("submitted");
      // The reason belonged to the version that was sent back.
      expect(again.rejectionReason).toBeNull();
    });

    it("only a submitted return can be approved or rejected", async () => {
      const ret = await openReturn();
      await expect(
        asTenant((tx) => pettyCash.approveReturn(tx, ret.id, { approvedById: userId })),
      ).rejects.toThrow(/Only a submitted/i);
      await expect(
        asTenant((tx) =>
          pettyCash.rejectReturn(tx, ret.id, { reason: "no", reviewedById: userId }),
        ),
      ).rejects.toThrow(/Only a submitted/i);
    });

    it("a rejected period can be re-opened; a live one cannot", async () => {
      const ret = await submitted();
      await asTenant((tx) =>
        pettyCash.rejectReturn(tx, ret.id, { reason: "Wrong period", reviewedById: userId }),
      );

      // The overlap constraint skips rejected returns, or a mistake would lock
      // the custodian out of the days it covered.
      const replacement = await openReturn();
      expect(replacement.status).toBe("draft");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("what the person is told", () => {
    // A constraint that fires and a message nobody can read is half a guard.
    // drizzle wraps the driver error as "Failed query: insert into ..." and
    // hangs the PostgresError carrying `constraint_name` off `cause`, so a
    // check against err.message alone matches nothing — which is how the
    // friendly text below came to exist and never fire.
    it("translates the overlap constraint", async () => {
      const { userMessage } = await import("@/app/db/errors");
      await openReturn();

      let caught;
      try {
        await openReturn({ from: "2026-02-15", to: "2026-03-15" });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect(userMessage(caught)).toMatch(/already covers part of that period/i);
      // And never the statement itself.
      expect(userMessage(caught)).not.toMatch(/Failed query/);
    });

    it("translates a half-written freeze", async () => {
      const { userMessage } = await import("@/app/db/errors");
      const ret = await openReturn();
      await fund(ret.id);
      await asTenant((tx) => pettyCash.submitReturn(tx, ret.id, { preparedById: userId }));

      let caught;
      try {
        await admin`UPDATE petty_cash_returns SET total_credits = NULL WHERE id = ${ret.id}`;
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect(userMessage(caught)).toMatch(/move together or not at all/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("tenant isolation", () => {
    it("another company cannot see the return", async () => {
      const ret = await openReturn();
      const other = randomUUID();
      await admin`INSERT INTO companies (id, name, slug)
        VALUES (${other}, 'Other Ltd', ${"o-" + other.slice(0, 8)})`;

      const rows = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.company_id', ${other}, true)`);
        return pettyCash.listReturns(tx, {});
      });
      expect(rows).toHaveLength(0);

      const found = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.company_id', ${other}, true)`);
        return pettyCash.getReturn(tx, ret.id);
      });
      expect(found).toBeNull();
    });
  });
});
