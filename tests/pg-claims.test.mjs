/**
 * Employee claims: advances, their settlement, reimbursements — and the six
 * journal entries that were going into the wrong database.
 *
 * `claim-action.js` posts through the Mongo `JournalEntry` model while every
 * ledger screen reads Postgres, so an advance could be disbursed, an expense
 * recognised and an employee reimbursed without any of it reaching the trial
 * balance. Each posting below asserts the entry exists IN THIS LEDGER and
 * balances; that is the whole point of the port.
 *
 * The rest of the suite is the constraints 0052 added, each named after the
 * thing in the Mongo action it replaces.
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

const { userMessage } = await import("@/app/db/errors");
const claims = await import("@/app/db/repositories/claims");

/** Drizzle wraps a PostgresError in "Failed query: …"; unwrap to the real one. */
const failsWith = async (fn, pattern) => {
  const err = await fn().then(
    () => { throw new Error("expected a rejection"); },
    (e) => e,
  );
  expect(userMessage(err)).toMatch(pattern);
};

suite("employee claims", () => {
  let admin, client, db;
  let companyA, employeeParty, otherParty;
  let bankAcct, advanceAcct, payablesAcct, travelAcct, mealsAcct;

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });

  /** Debits and credits of one entry, as numbers. */
  const entryTotals = async (entryId) => {
    const rows = await admin`
      SELECT COALESCE(SUM(debit),0)::float8 AS d, COALESCE(SUM(credit),0)::float8 AS c
        FROM journal_lines WHERE entry_id = ${entryId}::uuid`;
    return { debits: rows[0].d, credits: rows[0].c };
  };

  const lineFor = async (entryId, accountId) => {
    const rows = await admin`
      SELECT debit::float8 AS debit, credit::float8 AS credit
        FROM journal_lines
       WHERE entry_id = ${entryId}::uuid AND account_id = ${accountId}::uuid`;
    return rows[0] ?? null;
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
    employeeParty = randomUUID();
    otherParty = randomUUID();
    bankAcct = randomUUID();
    advanceAcct = randomUUID();
    payablesAcct = randomUUID();
    travelAcct = randomUUID();
    mealsAcct = randomUUID();

    await admin`INSERT INTO companies (id, name, slug) VALUES
      (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)})`;

    await asTenant(companyA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO parties (id, company_id, primary_type, is_employee, name, email)
        VALUES
          (${employeeParty}::uuid, ${companyA}::uuid, 'employee', true, 'Asha Wanjiru', 'asha@example.com'),
          (${otherParty}::uuid,    ${companyA}::uuid, 'employee', true, 'Brian Otieno', 'brian@example.com')`);
      await tx.execute(sql`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, can_post, system_account)
        VALUES
          (${bankAcct}::uuid,      ${companyA}::uuid, '1010', 'Bank',              'asset',     true, NULL),
          (${advanceAcct}::uuid,   ${companyA}::uuid, '1250', 'Employee Advance',  'asset',     true, 'employee_advance'),
          (${payablesAcct}::uuid,  ${companyA}::uuid, '2200', 'Employee Payables', 'liability', true, 'employee_payables'),
          (${travelAcct}::uuid,    ${companyA}::uuid, '6100', 'Travel',            'expense',   true, NULL),
          (${mealsAcct}::uuid,     ${companyA}::uuid, '6110', 'Meals',             'expense',   true, NULL)`);
      await tx.execute(sql`
        INSERT INTO fiscal_periods
          (company_id, year, month, period_name, period_code, start_date, end_date, status)
        SELECT ${companyA}::uuid, 2026, m,
               to_char(make_date(2026, m, 1), 'FMMonth YYYY'),
               to_char(make_date(2026, m, 1), 'YYYY-MM'),
               make_date(2026, m, 1),
               (make_date(2026, m, 1) + interval '1 month - 1 day')::date,
               'open'
          FROM generate_series(1, 12) AS m`);
    });
  });

  const today = () => new Date().toISOString().slice(0, 10);

  async function approvedAdvance(tx, amount = "50000.0000") {
    const claim = await claims.createAdvanceRequest(tx, {
      companyId: companyA,
      partyId: employeeParty,
      claimDate: today(),
      advanceType: "travel",
      requestedAmount: amount,
      purpose: "Site visit to Nakuru",
      description: "Travel advance",
      submit: true,
      createdById: null,
      createdByName: "Asha Wanjiru",
    });
    return claims.approveClaim(tx, claim.id, { name: "Manager" });
  }

  const receipts = (a, b) => [
    { itemDate: today(), category: "travel", expenseAccountId: travelAcct, description: "Fuel", amount: a },
    { itemDate: today(), category: "meals", expenseAccountId: mealsAcct, description: "Lunch", amount: b },
  ];

  // ───────────────────────────────────────────────────────────────────────────
  // The six postings
  // ───────────────────────────────────────────────────────────────────────────

  it("payAdvance debits Employee Advance and credits the bank, in THIS ledger", async () => {
    const { entry, claim } = await asTenant(companyA, async (tx) => {
      const approved = await approvedAdvance(tx);
      return claims.payAdvance(tx, approved.id, {
        paymentAccountId: bankAcct,
        paymentMethod: "bank",
        paymentReference: "FT-1001",
      });
    });

    expect(claim.status).toBe("paid");
    expect(await entryTotals(entry.id)).toEqual({ debits: 50000, credits: 50000 });
    expect(await lineFor(entry.id, advanceAcct)).toMatchObject({ debit: 50000, credit: 0 });
    expect(await lineFor(entry.id, bankAcct)).toMatchObject({ debit: 0, credit: 50000 });

    const [posted] = await admin`
      SELECT status, entry_type, source_type FROM journal_entries WHERE id = ${entry.id}::uuid`;
    expect(posted).toMatchObject({
      status: "posted",
      entry_type: "advance",
      source_type: "employee_claim",
    });
  });

  it("closeSettlement recognises the expenses and clears only what was spent", async () => {
    const result = await asTenant(companyA, async (tx) => {
      const approved = await approvedAdvance(tx, "50000.0000");
      const { claim: paid } = await claims.payAdvance(tx, approved.id, {
        paymentAccountId: bankAcct,
      });
      const settlement = await claims.openSettlement(tx, paid.id, {
        items: receipts("30000.0000", "5000.0000"),
      });
      await claims.approveClaim(tx, settlement.id, { name: "Manager" });
      return claims.closeSettlement(tx, settlement.id, { name: "Finance" });
    });

    // 35,000 spent out of 50,000 → the employee is holding 15,000.
    expect(result.balance).toBe(15000);
    expect(result.status).toBe("pending_return");
    expect(await entryTotals(result.entry.id)).toEqual({ debits: 35000, credits: 35000 });
    expect(await lineFor(result.entry.id, travelAcct)).toMatchObject({ debit: 30000 });
    expect(await lineFor(result.entry.id, mealsAcct)).toMatchObject({ debit: 5000 });
    // Only what was spent clears; the rest stays with the employee.
    expect(await lineFor(result.entry.id, advanceAcct)).toMatchObject({ credit: 35000 });
    expect(await lineFor(result.entry.id, payablesAcct)).toBeNull();
  });

  it("closeSettlement raises a payable when the employee overspent", async () => {
    const result = await asTenant(companyA, async (tx) => {
      const approved = await approvedAdvance(tx, "50000.0000");
      const { claim: paid } = await claims.payAdvance(tx, approved.id, {
        paymentAccountId: bankAcct,
      });
      const settlement = await claims.openSettlement(tx, paid.id, {
        items: receipts("50000.0000", "8000.0000"),
      });
      await claims.approveClaim(tx, settlement.id, { name: "Manager" });
      return claims.closeSettlement(tx, settlement.id, { name: "Finance" });
    });

    expect(result.balance).toBe(-8000);
    expect(result.status).toBe("pending_payment");
    expect(await entryTotals(result.entry.id)).toEqual({ debits: 58000, credits: 58000 });
    expect(await lineFor(result.entry.id, advanceAcct)).toMatchObject({ credit: 50000 });
    expect(await lineFor(result.entry.id, payablesAcct)).toMatchObject({ credit: 8000 });
  });

  it("an exactly-matched settlement closes both itself and its advance", async () => {
    const { result, advanceStatus } = await asTenant(companyA, async (tx) => {
      const approved = await approvedAdvance(tx, "20000.0000");
      const { claim: paid } = await claims.payAdvance(tx, approved.id, {
        paymentAccountId: bankAcct,
      });
      const settlement = await claims.openSettlement(tx, paid.id, {
        items: receipts("15000.0000", "5000.0000"),
      });
      await claims.approveClaim(tx, settlement.id, { name: "Manager" });
      const result = await claims.closeSettlement(tx, settlement.id, { name: "Finance" });
      const advance = await claims.getClaim(tx, paid.id);
      return { result, advanceStatus: advance.status };
    });

    expect(result.balance).toBe(0);
    expect(result.status).toBe("closed");
    // Mongo leaves the advance on 'paid' forever, so it keeps counting as
    // outstanding. A settled advance is settled.
    expect(advanceStatus).toBe("closed");
  });

  it("recordAdvanceReturn debits the bank and clears the rest of the advance", async () => {
    const { entry, claim } = await asTenant(companyA, async (tx) => {
      const approved = await approvedAdvance(tx, "50000.0000");
      const { claim: paid } = await claims.payAdvance(tx, approved.id, {
        paymentAccountId: bankAcct,
      });
      const settlement = await claims.openSettlement(tx, paid.id, {
        items: receipts("30000.0000", "5000.0000"),
      });
      await claims.approveClaim(tx, settlement.id, { name: "Manager" });
      await claims.closeSettlement(tx, settlement.id, { name: "Finance" });
      return claims.recordAdvanceReturn(tx, settlement.id, {
        paymentAccountId: bankAcct,
        amount: "15000.0000",
        reference: "MPESA-77",
      });
    });

    expect(claim.status).toBe("closed");
    expect(await lineFor(entry.id, bankAcct)).toMatchObject({ debit: 15000 });
    expect(await lineFor(entry.id, advanceAcct)).toMatchObject({ credit: 15000 });
  });

  it("paySettlementBalance clears the payable and pays the employee", async () => {
    const { entry, claim } = await asTenant(companyA, async (tx) => {
      const approved = await approvedAdvance(tx, "50000.0000");
      const { claim: paid } = await claims.payAdvance(tx, approved.id, {
        paymentAccountId: bankAcct,
      });
      const settlement = await claims.openSettlement(tx, paid.id, {
        items: receipts("50000.0000", "8000.0000"),
      });
      await claims.approveClaim(tx, settlement.id, { name: "Manager" });
      await claims.closeSettlement(tx, settlement.id, { name: "Finance" });
      return claims.paySettlementBalance(tx, settlement.id, {
        paymentAccountId: bankAcct,
        amount: "8000.0000",
      });
    });

    expect(claim.status).toBe("closed");
    expect(await lineFor(entry.id, payablesAcct)).toMatchObject({ debit: 8000 });
    expect(await lineFor(entry.id, bankAcct)).toMatchObject({ credit: 8000 });
  });

  /**
   * REPRODUCING "recalled claims cannot be edited".
   *
   * The recall dialog promises "This will move the claim back to draft so you
   * can make changes." `recallClaim` sets status to draft; `updateClaim`
   * accepts draft and rejected. On paper it works, which is exactly why it is
   * worth running rather than reading.
   */
  it("recalls a submitted claim and then edits it", async () => {
    const result = await asTenant(companyA, async (tx) => {
      const created = await claims.createReimbursement(tx, {
        companyId: companyA,
        partyId: employeeParty,
        claimDate: today(),
        description: "Original description",
        items: receipts("2000.0000", "500.0000"),
        submit: true,
      });
      expect(created.status).toBe("submitted");

      const recalled = await claims.recallClaim(tx, created.id);
      expect(recalled.status).toBe("draft");
      expect(recalled.submittedAt).toBeNull();

      const edited = await claims.updateClaim(tx, created.id, {
        description: "Edited after recall",
        items: receipts("2500.0000", "500.0000"),
        lastModifiedById: "u1",
        lastModifiedByName: "Owner",
      });

      /**
       * AND BACK INTO THE QUEUE, which is the half that was missing.
       *
       * `draft` had no exit in the application: the detail page offered Edit
       * and nothing else, the only action reaching `submitted` was for a
       * REJECTED claim, and both create paths pass submit: true — so a recall
       * was one-way and the claim left every approver's list for good.
       *
       * The state machine in 0052 has allowed draft -> submitted since it was
       * written, and `submitClaim` had no caller outside this file. Nothing
       * was missing below the action layer, which is why this passes the
       * moment the button exists.
       */
      const resubmitted = await claims.submitClaim(tx, created.id, {
        id: "u1",
        name: "Owner",
      });
      return { created, edited, resubmitted };
    });

    expect(result.edited.description).toBe("Edited after recall");
    expect(result.resubmitted.status).toBe("submitted");
    expect(result.resubmitted.submittedAt).not.toBeNull();
  });

  it("refuses to push an approved claim back to submitted", async () => {
    // The backstop under the new action's own draft-only check: the 0052
    // transition trigger permits draft -> submitted and rejected -> submitted,
    // and nothing else into that state.
    await failsWith(
      () =>
        asTenant(companyA, async (tx) => {
          const created = await claims.createReimbursement(tx, {
            companyId: companyA,
            partyId: employeeParty,
            claimDate: today(),
            description: "Already blessed",
            items: receipts("1000.0000", "500.0000"),
            submit: true,
          });
          const approved = await claims.approveClaim(tx, created.id, { name: "Manager" });
          return claims.submitClaim(tx, approved.id, { name: "Chancer" });
        }),
      /cannot move from/i,
    );
  });

  it("payReimbursement posts the expense and the payment as two entries", async () => {
    const { expenseEntry, paymentEntry, claim } = await asTenant(companyA, async (tx) => {
      const created = await claims.createReimbursement(tx, {
        companyId: companyA,
        partyId: employeeParty,
        claimDate: today(),
        description: "Client visit costs",
        items: receipts("4000.0000", "1500.0000"),
        submit: true,
      });
      const approved = await claims.approveClaim(tx, created.id, { name: "Manager" });
      return claims.payReimbursement(tx, approved.id, {
        paymentAccountId: bankAcct,
        paymentMethod: "mpesa",
      });
    });

    expect(claim.status).toBe("paid");

    // #1 recognises the expense against a payable...
    expect(await entryTotals(expenseEntry.id)).toEqual({ debits: 5500, credits: 5500 });
    expect(await lineFor(expenseEntry.id, travelAcct)).toMatchObject({ debit: 4000 });
    expect(await lineFor(expenseEntry.id, mealsAcct)).toMatchObject({ debit: 1500 });
    expect(await lineFor(expenseEntry.id, payablesAcct)).toMatchObject({ credit: 5500 });

    // ...#2 settles it. Separate entries, because they are separate events.
    expect(await lineFor(paymentEntry.id, payablesAcct)).toMatchObject({ debit: 5500 });
    expect(await lineFor(paymentEntry.id, bankAcct)).toMatchObject({ credit: 5500 });
  });

  it("the whole flow nets to zero across the ledger", async () => {
    await asTenant(companyA, async (tx) => {
      const approved = await approvedAdvance(tx, "50000.0000");
      const { claim: paid } = await claims.payAdvance(tx, approved.id, { paymentAccountId: bankAcct });
      const settlement = await claims.openSettlement(tx, paid.id, {
        items: receipts("30000.0000", "5000.0000"),
      });
      await claims.approveClaim(tx, settlement.id, { name: "Manager" });
      await claims.closeSettlement(tx, settlement.id, { name: "Finance" });
      await claims.recordAdvanceReturn(tx, settlement.id, {
        paymentAccountId: bankAcct,
        amount: "15000.0000",
      });
    });

    // Employee Advance must be flat: 50,000 out, 35,000 spent, 15,000 back.
    const [adv] = await admin`
      SELECT COALESCE(SUM(debit - credit), 0)::float8 AS net
        FROM journal_lines WHERE account_id = ${advanceAcct}::uuid`;
    expect(adv.net).toBe(0);

    const [all] = await admin`
      SELECT COALESCE(SUM(debit),0)::float8 AS d, COALESCE(SUM(credit),0)::float8 AS c
        FROM journal_lines`;
    expect(all.d).toBe(all.c);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The constraints
  // ───────────────────────────────────────────────────────────────────────────

  it("an advance cannot be settled twice", async () => {
    await expect(
      asTenant(companyA, async (tx) => {
        const approved = await approvedAdvance(tx);
        const { claim: paid } = await claims.payAdvance(tx, approved.id, { paymentAccountId: bankAcct });
        await claims.openSettlement(tx, paid.id, { items: receipts("1000.0000", "500.0000") });
        return claims.openSettlement(tx, paid.id, { items: receipts("2000.0000", "500.0000") });
      }),
    ).rejects.toThrow(/already exists for this advance/i);
  });

  it("a REJECTED settlement does not block a replacement", async () => {
    const replacement = await asTenant(companyA, async (tx) => {
      const approved = await approvedAdvance(tx);
      const { claim: paid } = await claims.payAdvance(tx, approved.id, { paymentAccountId: bankAcct });
      const first = await claims.openSettlement(tx, paid.id, { items: receipts("1000.0000", "500.0000") });
      await claims.rejectClaim(tx, first.id, {
        name: "Manager",
        reason: "Receipts are illegible, please rescan them",
      });
      return claims.openSettlement(tx, paid.id, { items: receipts("2000.0000", "500.0000") });
    });
    expect(replacement.status).toBe("submitted");
  });

  it("an unpaid advance has nothing to settle", async () => {
    await expect(
      asTenant(companyA, async (tx) => {
        const approved = await approvedAdvance(tx);
        return claims.openSettlement(tx, approved.id, { items: receipts("100.0000", "50.0000") });
      }),
    ).rejects.toThrow(/has not been paid out/i);
  });

  it("a settlement cannot be pointed at somebody else's advance", async () => {
    await failsWith(
      () =>
        asTenant(companyA, async (tx) => {
          const approved = await approvedAdvance(tx);
          const { claim: paid } = await claims.payAdvance(tx, approved.id, { paymentAccountId: bankAcct });
          // Reach past the repository to prove the DATABASE refuses it.
          return tx.execute(sql`
            INSERT INTO employee_claims
              (company_id, claim_number, claim_date, claim_type, status, party_id,
               advance_claim_id, advance_amount, description)
            VALUES (${companyA}::uuid, 'CLAIM-X', ${today()}::date, 'advance_return',
                    'submitted', ${otherParty}::uuid, ${paid.id}::uuid, 1000, 'Sneaky')`);
        }),
      /belongs to somebody else/i,
    );
  });

  it("an expense item must name its expense account", async () => {
    // The crash this prevents: both posting paths group by
    // `expenseAccountId || category` and look the group up in a map keyed only
    // by account id, so an accountless item throws TypeError mid-posting.
    await failsWith(
      () =>
        asTenant(companyA, async (tx) => {
          const created = await claims.createReimbursement(tx, {
            companyId: companyA,
            partyId: employeeParty,
            claimDate: today(),
            description: "Client visit costs",
            items: receipts("4000.0000", "1500.0000"),
          });
          return tx.execute(sql`
            INSERT INTO employee_claim_items
              (company_id, claim_id, line_number, item_date, category, description, amount)
            VALUES (${companyA}::uuid, ${created.id}::uuid, 9, ${today()}::date,
                    'travel', 'Fuel with no account', 100)`);
        }),
      /required value is missing/i,
    );
  });

  it("items freeze once the claim is approved", async () => {
    await failsWith(
      () =>
        asTenant(companyA, async (tx) => {
          const created = await claims.createReimbursement(tx, {
            companyId: companyA,
            partyId: employeeParty,
            claimDate: today(),
            description: "Client visit costs",
            items: receipts("4000.0000", "1500.0000"),
            submit: true,
          });
          await claims.approveClaim(tx, created.id, { name: "Manager" });
          return tx.execute(sql`
            UPDATE employee_claim_items SET amount = 999999 WHERE claim_id = ${created.id}::uuid`);
        }),
      /can no longer be changed/i,
    );
  });

  it("a reimbursement cannot be submitted with no receipts", async () => {
    await expect(
      asTenant(companyA, (tx) =>
        claims.createReimbursement(tx, {
          companyId: companyA,
          partyId: employeeParty,
          claimDate: today(),
          description: "Nothing at all",
          items: [],
          submit: true,
        }),
      ),
    ).rejects.toThrow(/no expense items/i);
  });

  it("a claim cannot skip approval on its way to being paid", async () => {
    await expect(
      asTenant(companyA, async (tx) => {
        const created = await claims.createAdvanceRequest(tx, {
          companyId: companyA,
          partyId: employeeParty,
          claimDate: today(),
          advanceType: "travel",
          requestedAmount: "1000.0000",
          purpose: "Trip",
          description: "Travel advance",
          submit: true,
        });
        return claims.payAdvance(tx, created.id, { paymentAccountId: bankAcct });
      }),
    ).rejects.toThrow(/only an approved advance can be paid/i);
  });

  it("an advance cannot be disbursed twice", async () => {
    await expect(
      asTenant(companyA, async (tx) => {
        const approved = await approvedAdvance(tx);
        await claims.payAdvance(tx, approved.id, { paymentAccountId: bankAcct });
        return claims.payAdvance(tx, approved.id, { paymentAccountId: bankAcct });
      }),
    ).rejects.toThrow();
  });

  it("more cannot be returned than the employee is holding", async () => {
    await failsWith(
      () =>
        asTenant(companyA, async (tx) => {
          const approved = await approvedAdvance(tx, "50000.0000");
          const { claim: paid } = await claims.payAdvance(tx, approved.id, { paymentAccountId: bankAcct });
          const settlement = await claims.openSettlement(tx, paid.id, {
            items: receipts("30000.0000", "5000.0000"),
          });
          await claims.approveClaim(tx, settlement.id, { name: "Manager" });
          await claims.closeSettlement(tx, settlement.id, { name: "Finance" });
          // Balance is 15,000; this is a fat finger.
          return claims.recordAdvanceReturn(tx, settlement.id, {
            paymentAccountId: bankAcct,
            amount: "150000.0000",
          });
        }),
      /cannot record a return of/i,
    );
  });

  it("a rejection has to say why", async () => {
    await expect(
      asTenant(companyA, async (tx) => {
        const created = await claims.createReimbursement(tx, {
          companyId: companyA,
          partyId: employeeParty,
          claimDate: today(),
          description: "Client visit costs",
          items: receipts("4000.0000", "1500.0000"),
          submit: true,
        });
        return claims.rejectClaim(tx, created.id, { name: "Manager", reason: "no" });
      }),
    ).rejects.toThrow();
  });

  it("a closed claim cannot be reopened", async () => {
    await failsWith(
      () =>
        asTenant(companyA, async (tx) => {
          const approved = await approvedAdvance(tx, "20000.0000");
          const { claim: paid } = await claims.payAdvance(tx, approved.id, { paymentAccountId: bankAcct });
          const settlement = await claims.openSettlement(tx, paid.id, {
            items: receipts("15000.0000", "5000.0000"),
          });
          await claims.approveClaim(tx, settlement.id, { name: "Manager" });
          await claims.closeSettlement(tx, settlement.id, { name: "Finance" });
          return claims.submitClaim(tx, settlement.id, { name: "Chancer" });
        }),
      /closed and cannot be reopened/i,
    );
  });

  it("an employee cannot hold two open advances at once", async () => {
    await failsWith(
      () =>
        asTenant(companyA, async (tx) => {
          await approvedAdvance(tx, "10000.0000");
          return claims.createAdvanceRequest(tx, {
            companyId: companyA,
            partyId: employeeParty,
            claimDate: today(),
            advanceType: "travel",
            requestedAmount: "5000.0000",
            purpose: "Another trip",
            description: "Second advance",
          });
        }),
      /already has an advance outstanding/i,
    );
  });

  it("...but may draw another once the first is settled", async () => {
    // In Mongo this is impossible: nothing ever moves an advance out of
    // 'paid', and the one-open-advance rule blocks anything not rejected or
    // closed, so the first advance an employee takes is their last.
    const second = await asTenant(companyA, async (tx) => {
      const approved = await approvedAdvance(tx, "20000.0000");
      const { claim: paid } = await claims.payAdvance(tx, approved.id, { paymentAccountId: bankAcct });
      const settlement = await claims.openSettlement(tx, paid.id, {
        items: receipts("15000.0000", "5000.0000"),
      });
      await claims.approveClaim(tx, settlement.id, { name: "Manager" });
      await claims.closeSettlement(tx, settlement.id, { name: "Finance" });

      return claims.createAdvanceRequest(tx, {
        companyId: companyA,
        partyId: employeeParty,
        claimDate: today(),
        advanceType: "travel",
        requestedAmount: "5000.0000",
        purpose: "Next trip",
        description: "Second advance",
      });
    });
    expect(second.status).toBe("draft");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The shape the screens read
  //
  // Thirteen components address claim._id, claim.employee.name,
  // claim.advanceDetails.travelDates.from and claim.returnDetails.balance. If
  // this shape drifts they render blanks, silently — which is the whole class
  // of bug this port keeps finding.
  // ───────────────────────────────────────────────────────────────────────────

  it("the detail page gets a claim in the shape its components read", async () => {
    const view = await asTenant(companyA, async (tx) => {
      const created = await claims.createAdvanceRequest(tx, {
        companyId: companyA,
        partyId: employeeParty,
        claimDate: today(),
        advanceType: "travel",
        requestedAmount: "50000.0000",
        purpose: "Site visit to Nakuru",
        description: "Travel advance",
        destination: "Nakuru",
        travelFrom: "2026-08-10",
        travelTo: "2026-08-14",
        submit: true,
        createdByName: "Asha Wanjiru",
      });
      await claims.approveClaim(tx, created.id, { name: "Manager" });
      await claims.payAdvance(tx, created.id, { paymentAccountId: bankAcct });
      return claims.getClaimForScreen(tx, created.id);
    });

    expect(view._id).toBe(view.id);
    expect(view.employee.name).toBe("Asha Wanjiru");
    expect(view.employee.email).toBe("asha@example.com");
    expect(view.advanceDetails.travelDates).toEqual({
      from: "2026-08-10",
      to: "2026-08-14",
    });
    expect(view.advanceDetails.destination).toBe("Nakuru");
    expect(view.advanceDetails.requestedAmount).toBe(50000);
    // Derived: what actually left the bank, not what was asked for.
    expect(view.advanceDetails.disbursedAmount).toBe(50000);
    expect(view.totalAmount).toBe(50000);
    expect(view.status).toBe("paid");
    expect(view.awaiting).toBe("awaiting settlement");
    // The advance's own entry, addressable from the claim.
    expect(view.journalEntries).toHaveLength(1);
    expect(view.journalEntries[0].purpose).toBe("advance");
    expect(view.journalEntries[0].status).toBe("posted");
  });

  it("a settlement carries its balance, and its advance knows about it", async () => {
    const { settlementView, advanceView } = await asTenant(companyA, async (tx) => {
      const approved = await approvedAdvance(tx, "50000.0000");
      const { claim: paid } = await claims.payAdvance(tx, approved.id, {
        paymentAccountId: bankAcct,
      });
      const settlement = await claims.openSettlement(tx, paid.id, {
        items: receipts("30000.0000", "5000.0000"),
      });
      await claims.approveClaim(tx, settlement.id, { name: "Manager" });
      await claims.closeSettlement(tx, settlement.id, { name: "Finance" });

      return {
        settlementView: await claims.getClaimForScreen(tx, settlement.id),
        advanceView: await claims.getClaimForScreen(tx, paid.id),
      };
    });

    expect(settlementView.returnDetails.advanceAmount).toBe(50000);
    expect(settlementView.returnDetails.totalSpent).toBe(35000);
    expect(settlementView.returnDetails.balance).toBe(15000);
    expect(settlementView.items).toHaveLength(2);
    // The line carries its account, which is what the detail page prints.
    expect(settlementView.items[0].accountCode).toBe("6100");
    expect(settlementView.advance.claimNumber).toBe(advanceView.claimNumber);

    // settlementClaimId is DERIVED from the settlement pointing here — there
    // is no reverse pointer to go out of step (§8.2).
    expect(advanceView.settlementClaimId).toBe(settlementView.id);
    expect(advanceView.settlement.claimNumber).toBe(settlementView.claimNumber);
  });

  it("a reimbursement is not given advance fields it does not have", async () => {
    const view = await asTenant(companyA, async (tx) => {
      const created = await claims.createReimbursement(tx, {
        companyId: companyA,
        partyId: employeeParty,
        claimDate: today(),
        description: "Client visit costs",
        items: receipts("4000.0000", "1500.0000"),
        submit: true,
      });
      return claims.getClaimForScreen(tx, created.id);
    });

    expect(view.totalAmount).toBe(5500);
    expect(view.advanceDetails.requestedAmount).toBeNull();
    // NULL, not 0. "Not applicable" is a different answer from "worth nothing"
    // — the distinction 0051 drew for affected_value.
    expect(view.returnDetails.balance).toBeNull();
    expect(view.returnDetails.totalSpent).toBeNull();
    expect(view.awaiting).toBe("awaiting approval");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Derived totals
  // ───────────────────────────────────────────────────────────────────────────

  it("totals come from the items, so they cannot go stale", async () => {
    const { before, after } = await asTenant(companyA, async (tx) => {
      const created = await claims.createReimbursement(tx, {
        companyId: companyA,
        partyId: employeeParty,
        claimDate: today(),
        description: "Client visit costs",
        items: receipts("4000.0000", "1500.0000"),
      });
      const before = await claims.getClaim(tx, created.id);
      await claims.updateClaim(tx, created.id, {
        items: [
          { itemDate: today(), category: "travel", expenseAccountId: travelAcct, description: "Fuel", amount: "9000.0000" },
        ],
      });
      const after = await claims.getClaim(tx, created.id);
      return { before, after };
    });

    expect(Number(before.totalAmount)).toBe(5500);
    expect(before.itemCount).toBe(2);
    // No recompute step ran. The view is the total.
    expect(Number(after.totalAmount)).toBe(9000);
    expect(after.itemCount).toBe(1);
  });

  it("an advance's total is what was requested, not a sum of receipts", async () => {
    const claim = await asTenant(companyA, async (tx) => {
      const created = await claims.createAdvanceRequest(tx, {
        companyId: companyA,
        partyId: employeeParty,
        claimDate: today(),
        advanceType: "travel",
        requestedAmount: "50000.0000",
        purpose: "Site visit",
        description: "Travel advance",
      });
      return claims.getClaim(tx, created.id);
    });
    expect(Number(claim.totalAmount)).toBe(50000);
    expect(claim.itemCount).toBe(0);
    expect(claim.awaiting).toBe("awaiting submission");
  });

  it("the stats strip counts outstanding advances, and stops when they settle", async () => {
    const { afterPay, afterSettle } = await asTenant(companyA, async (tx) => {
      const approved = await approvedAdvance(tx, "20000.0000");
      const { claim: paid } = await claims.payAdvance(tx, approved.id, { paymentAccountId: bankAcct });
      const afterPay = await claims.getClaimStats(tx);

      const settlement = await claims.openSettlement(tx, paid.id, {
        items: receipts("15000.0000", "5000.0000"),
      });
      await claims.approveClaim(tx, settlement.id, { name: "Manager" });
      await claims.closeSettlement(tx, settlement.id, { name: "Finance" });
      const afterSettle = await claims.getClaimStats(tx);
      return { afterPay, afterSettle };
    });

    expect(Number(afterPay.outstandingAdvances)).toBe(20000);
    expect(Number(afterSettle.outstandingAdvances)).toBe(0);
  });
});
