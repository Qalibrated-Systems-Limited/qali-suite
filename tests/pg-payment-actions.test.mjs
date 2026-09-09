/**
 * Payments — the standalone module's action layer.
 *
 * The REPOSITORY has been complete since the payments port, and
 * `invoice-actions` already used three of its functions — which is why
 * receiving a payment against an invoice has been on Postgres all along.
 * What had no action layer was the payments module itself, so
 * `payment-actions.js:656` went on calling `payment.confirm()` and posting
 * into the Mongo ledger from five screens.
 *
 * The thing under test here is the ACTION's guarantee, which the repository
 * does not make: create, allocate, confirm and post happen together or not at
 * all. Confirm and post are separate repository calls and nothing enforced
 * that the second followed the first — a payment confirmed without posting is
 * money the ledger never saw.
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

// The bill-payment approval threshold is pinned out of the way here so these
// tests are about what reaches the LEDGER. The gate's own routing decision —
// who is held and who pays through — is tests/bill-payment-threshold.test.mjs.
// Left unmocked it would open its own connection through companyConfig, which
// is a second database story inside a test about journal lines.
// `getCompanyThresholds` moved to @/app/db/companyConfig; the mock still named
// the Mongo query module, so the threshold was NOT pinned and this file opened
// the very connection the comment above says it is avoiding.
vi.mock("@/app/db/companyConfig", () => ({
  getCompanyThresholds: vi.fn(async () => ({ billPaymentValue: 10_000_000 })),
}));

let companyId, tenantDb, actingRole;
vi.mock("@/app/db/tenant", () => ({
  withAuthorizedTenant: vi.fn(async (roles, fn) => {
    if (roles.length && actingRole && !roles.includes(actingRole)) {
      throw new Error("You don't have permission to perform this action.");
    }
    return tenantDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx, {
        user: { id: "11111111-1111-1111-1111-111111111111", name: "Ann", role: actingRole ?? "Accountant" },
        companyId,
      });
    });
  }),
}));

const actions = await import("@/app/db/actions/payment-actions");

suite("payment actions", () => {
  let admin, client, db;
  let bankAcct, arAcct, apAcct, revenueAcct, customer, supplier, userId, invoiceId;

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

  const form = (fields) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined && v !== null) fd.set(k, String(v));
    }
    return fd;
  };

  const received = (over = {}) =>
    actions.createPaymentPg(
      null,
      form({
        paymentType: "received",
        amount: 5000,
        partyId: customer,
        accountId: bankAcct,
        paymentDate: "2026-03-10",
        paymentMethod: "bank_transfer",
        ...over,
      }),
    );

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    client = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, { max: 1, onnotice: () => {} });
    db = drizzle(client);
    tenantDb = db;
  });
  afterAll(async () => {
    if (client) await client.end();
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, entry_counters CASCADE`;
    companyId = randomUUID();
    actingRole = "Accountant";
    bankAcct = randomUUID(); arAcct = randomUUID(); apAcct = randomUUID();
    revenueAcct = randomUUID(); customer = randomUUID(); supplier = randomUUID();
    invoiceId = randomUUID();
    userId = "11111111-1111-1111-1111-111111111111";

    await admin`INSERT INTO companies (id, name, slug)
      VALUES (${companyId}, 'Acme Ltd', ${"a-" + companyId.slice(0, 8)})`;
    await admin`INSERT INTO users (id, home_company_id, name, email, role)
      VALUES (${userId}, ${companyId}, 'Ann', ${randomUUID() + "@x.test"}, 'Accountant')
      ON CONFLICT (id) DO NOTHING`;
    // The GRANT, not just the row. `users` is behind RLS and the policy that
    // makes a colleague visible reads user_company_access — so without this
    // the audit trail's actor names come back null, which is what production
    // would look like only for a user whose access had been revoked.
    await admin`INSERT INTO user_company_access (user_id, company_id, role, status)
      VALUES (${userId}, ${companyId}, 'Accountant', 'active')`;
    /**
     * A company created by a bare INSERT has no settings row, and provisioning
     * is what normally makes one. `recordPayment` reads the approval threshold
     * — `requestApprovalIfOverThreshold` -> `getCompanyThresholds` ->
     * `getCompanySettings` — which throws "This company has no settings" for
     * such a company, and two tests here died on it rather than on anything
     * about payments.
     *
     * Five other suites already seed this. This one did not.
     */
    await admin`INSERT INTO company_settings (company_id)
      VALUES (${companyId}) ON CONFLICT (company_id) DO NOTHING`;

    await asTenant(async (tx) => {
      await tx.execute(sql`
        INSERT INTO accounts
          (id, company_id, account_code, account_name, account_type, sub_type, can_post, system_account)
        VALUES
          (${bankAcct}::uuid,    ${companyId}::uuid, '1000', 'Bank',                'asset',     'bank', true, NULL),
          (${arAcct}::uuid,      ${companyId}::uuid, '1100', 'Accounts Receivable', 'asset',     NULL,   true, 'accounts_receivable'),
          (${apAcct}::uuid,      ${companyId}::uuid, '2000', 'Accounts Payable',    'liability', NULL,   true, 'accounts_payable'),
          (${revenueAcct}::uuid, ${companyId}::uuid, '4000', 'Sales',               'revenue',   NULL,   true, 'sales_revenue')`);
      await tx.execute(sql`
        INSERT INTO parties (id, company_id, name, primary_type, is_customer, is_supplier)
        VALUES
          (${customer}::uuid, ${companyId}::uuid, 'Mama Njeri', 'customer', true, false),
          (${supplier}::uuid, ${companyId}::uuid, 'Tosha Ltd',  'supplier', false, true)`);
      await tx.execute(sql`
        INSERT INTO invoices
          (id, company_id, invoice_number, invoice_date, customer_id, subtotal, total, status)
        VALUES (${invoiceId}::uuid, ${companyId}::uuid, 'INV-0001', '2026-03-01',
                ${customer}::uuid, 8000, 8000, 'completed')`);
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
  describe("money received", () => {
    it("posts DR Bank / CR Accounts Receivable", async () => {
      const res = await received();

      expect(res.success).toBe(true);
      expect(res.paymentNumber).toBeTruthy();
      expect(await accountNet(bankAcct)).toBe(5000);
      expect(await accountNet(arAcct)).toBe(-5000);
    });

    it("confirms AND posts — never one without the other", async () => {
      // The guarantee this layer exists to make. confirmPayment and
      // postPaymentReceipt are separate repository calls, and a payment
      // confirmed without posting is money the ledger never saw.
      const res = await received();

      const [row] = await admin`
        SELECT status, journal_entry_id FROM payments WHERE id = ${res.paymentId}`;
      expect(row.status).toBe("confirmed");
      expect(row.journal_entry_id).not.toBeNull();
    });

    it("allocates against an invoice and reduces what is owed", async () => {
      await received({
        amount: 3000,
        allocations: JSON.stringify([{ invoiceId, amount: 3000 }]),
      });

      const [inv] = await admin`
        SELECT amount_paid, payment_status FROM invoices WHERE id = ${invoiceId}`;
      expect(Number(inv.amount_paid)).toBe(3000);
      expect(inv.payment_status).toBe("partial");
    });

    it("settles an invoice in full", async () => {
      await received({
        amount: 8000,
        allocations: JSON.stringify([{ invoiceId, amount: 8000 }]),
      });
      const [inv] = await admin`SELECT payment_status FROM invoices WHERE id = ${invoiceId}`;
      expect(inv.payment_status).toBe("paid");
    });

    it("leaves NOTHING behind when an allocation is rejected", async () => {
      // Create, allocate, confirm and post are one transaction. The Mongo path
      // does each in its own write, so a failure between any two leaves a
      // payment that exists, is partly allocated, and has posted nothing.
      const res = await received({
        amount: 5000,
        allocations: JSON.stringify([{ invoiceId, amount: 99999 }]),
      });

      expect(res.success).toBe(false);
      const [{ count: payments }] = await admin`SELECT count(*)::int FROM payments`;
      const [{ count: entries }] = await admin`SELECT count(*)::int FROM journal_entries`;
      expect(payments).toBe(0);
      expect(entries).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("money paid out", () => {
    it("posts DR Accounts Payable / CR Bank", async () => {
      const res = await actions.createPaymentPg(
        null,
        form({
          paymentType: "made",
          amount: 2500,
          partyId: supplier,
          accountId: bankAcct,
          paymentDate: "2026-03-10",
          paymentMethod: "bank_transfer",
        }),
      );

      expect(res.success).toBe(true);
      expect(await accountNet(apAcct)).toBe(2500);
      expect(await accountNet(bankAcct)).toBe(-2500);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("what it refuses", () => {
    it("refuses a zero or negative amount", async () => {
      expect((await received({ amount: 0 })).success).toBe(false);
      expect((await received({ amount: -100 })).success).toBe(false);
    });

    it("refuses a payment that is neither received nor made", async () => {
      const res = await received({ paymentType: "sideways" });
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/received or made/i);
    });

    it("says which control account is missing rather than failing at the driver", async () => {
      await admin`UPDATE accounts SET system_account = NULL WHERE id = ${arAcct}`;
      const res = await received();
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Accounts Receivable account is not configured/i);
    });

    it("refuses a role that may not move money", async () => {
      actingRole = "Employee";
      const res = await received();
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/permission/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the stat tiles", () => {
    it("counts this month from the PAYMENT date, not when it was entered", async () => {
      await received({ amount: 5000, paymentDate: new Date().toISOString().slice(0, 10) });
      await received({ amount: 1000, paymentDate: "2025-01-15" }); // a prior year

      const stats = await actions.getPaymentStatsPg();
      expect(stats.thisMonth.received.count).toBe(1);
      expect(stats.thisMonth.received.total).toBe(5000);
      expect(stats.byStatus.confirmed).toBe(2);
    });

    it("reports pending clearance where Mongo reported unreconciled", async () => {
      // There is no reconciliation column in Postgres; pending_clearance is
      // the analogue — recorded, not yet through the bank.
      const res = await received();
      await admin`UPDATE payments SET status = 'pending_clearance' WHERE id = ${res.paymentId}`;
      const stats = await actions.getPaymentStatsPg();
      expect(stats.unreconciledCount).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("cancelling", () => {
    const cancel = (id, reason = "Paid twice") => {
      const fd = new FormData();
      if (reason !== null) fd.set("reason", reason);
      return actions.cancelPaymentPg(id, null, fd);
    };

    it("reverses the entry rather than deleting it", async () => {
      const res = await received();
      expect(await accountNet(bankAcct)).toBe(5000);

      expect((await cancel(res.paymentId)).success).toBe(true);

      // Net zero because BOTH entries stand — the original and its reversal.
      // A payment that reached the ledger is a fact; withdrawing it is a
      // second fact.
      expect(await accountNet(bankAcct)).toBe(0);
      expect(await accountNet(arAcct)).toBe(0);

      const [{ count }] = await admin`
        SELECT count(*)::int FROM journal_entries WHERE company_id = ${companyId}::uuid`;
      expect(count).toBe(2);
    });

    it("gives the invoice its balance back, by trigger", async () => {
      const res = await actions.createPaymentPg(
        null,
        form({
          paymentType: "received",
          amount: 3000,
          partyId: customer,
          accountId: bankAcct,
          paymentDate: "2026-03-10",
          paymentMethod: "cash",
          allocations: JSON.stringify([
            { documentId: invoiceId, amountAllocated: "3000" },
          ]),
        }),
      );
      expect(res.success).toBe(true);

      const paid = async () => {
        const [r] = await admin`
          SELECT amount_paid::float8 AS p FROM invoices WHERE id = ${invoiceId}::uuid`;
        return r.p;
      };
      expect(await paid()).toBe(3000);

      await cancel(res.paymentId);

      // Nothing in cancelPayment touches amount_paid. Deleting the allocation
      // is what moves it, which is the §8.2 arrangement: one writer, one number.
      expect(await paid()).toBe(0);
    });

    it("records who and why, and refuses a cancellation without a reason", async () => {
      const res = await received();

      const noReason = await cancel(res.paymentId, "   ");
      expect(noReason.success).toBe(false);
      expect(noReason.error).toMatch(/reason is required/i);

      await cancel(res.paymentId, "Duplicate of RCP-0002");

      const detail = await actions.getPaymentPg(res.paymentId);
      expect(detail.status).toBe("cancelled");
      expect(detail.cancellationReason).toBe("Duplicate of RCP-0002");
      expect(detail.cancelledById).toBe(userId);
      expect(detail.cancelledAt).toBeTruthy();
      expect(detail.cancelledByName).toBe("Ann");
    });

    it("refuses to cancel twice", async () => {
      const res = await received();
      expect((await cancel(res.paymentId)).success).toBe(true);

      const again = await cancel(res.paymentId);
      expect(again.success).toBe(false);
      expect(again.error).toMatch(/already cancelled/i);
    });

    it("cannot be left half-cancelled — the status needs all three columns", async () => {
      const res = await received();

      // The pair CHECK from 0063, stated as a conditional on the STATUS. An
      // UPDATE that flips the status and forgets the rest is the case that
      // actually happens, and a CHECK keyed off cancelled_at would allow it.
      await expect(
        admin`UPDATE payments SET status = 'cancelled' WHERE id = ${res.paymentId}`,
      ).rejects.toThrow(/payments_cancellation_pair/);
    });

    it("refuses a role that may not move money", async () => {
      const res = await received();
      actingRole = "Employee";
      const denied = await cancel(res.paymentId);
      expect(denied.success).toBe(false);
      expect(denied.error).toMatch(/permission/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("what a party still owes", () => {
    it("lists the invoice, and drops it once it is settled", async () => {
      const before = await actions.getUnpaidDocumentsPg(customer, "invoice");
      expect(before).toHaveLength(1);
      expect(before[0].documentNumber).toBe("INV-0001");
      expect(Number(before[0].balance)).toBe(8000);

      await actions.createPaymentPg(
        null,
        form({
          paymentType: "received",
          amount: 8000,
          partyId: customer,
          accountId: bankAcct,
          paymentDate: "2026-03-10",
          paymentMethod: "cash",
          allocations: JSON.stringify([
            { documentId: invoiceId, amountAllocated: "8000" },
          ]),
        }),
      );

      // Filtered on the ARITHMETIC, not on a cached payment_status label that
      // can disagree with it.
      expect(await actions.getUnpaidDocumentsPg(customer, "invoice")).toHaveLength(0);
    });

    it("shows the remaining balance after a part payment", async () => {
      await actions.createPaymentPg(
        null,
        form({
          paymentType: "received",
          amount: 3000,
          partyId: customer,
          accountId: bankAcct,
          paymentDate: "2026-03-10",
          paymentMethod: "cash",
          allocations: JSON.stringify([
            { documentId: invoiceId, amountAllocated: "3000" },
          ]),
        }),
      );

      const docs = await actions.getUnpaidDocumentsPg(customer, "invoice");
      expect(docs).toHaveLength(1);
      expect(Number(docs[0].balance)).toBe(5000);
      expect(Number(docs[0].originalAmount)).toBe(8000);
    });

    it("does not show one party's documents to another", async () => {
      expect(await actions.getUnpaidDocumentsPg(supplier, "invoice")).toHaveLength(0);
      expect(await actions.getUnpaidDocumentsPg(customer, "bill")).toHaveLength(0);
    });

    it("returns nothing rather than everything for a missing party", async () => {
      expect(await actions.getUnpaidDocumentsPg("", "invoice")).toEqual([]);
      expect(await actions.getUnpaidDocumentsPg(customer, "quote")).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("allocating", () => {
    it("settles the invoice the FORM's allocation rows name", async () => {
      // `PaymentForm` serialises `amountAllocated`; parseAllocations read only
      // `amount`, so every row coerced to 0 and was filtered out. The payment
      // posted in full and settled nothing, and the page showed it entirely
      // unapplied. Nothing called this action, so nothing caught it.
      const res = await actions.createPaymentPg(
        null,
        form({
          paymentType: "received",
          amount: 4000,
          partyId: customer,
          accountId: bankAcct,
          paymentDate: "2026-03-10",
          paymentMethod: "cash",
          allocations: JSON.stringify([
            {
              documentType: "invoice",
              documentId: invoiceId,
              documentNumber: "INV-0001",
              amountAllocated: "4000",
            },
          ]),
        }),
      );
      expect(res.success).toBe(true);

      const detail = await actions.getPaymentPg(res.paymentId);
      expect(detail.allocations).toHaveLength(1);
      expect(Number(detail.allocations[0].amountAllocated)).toBe(4000);
      expect(Number(detail.balance.unapplied_amount)).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the list", () => {
    it("honours the filters it advertises", async () => {
      await received({ amount: 5000, paymentMethod: "cash" });
      await received({ amount: 1200, paymentMethod: "mpesa", reference: "QGH12" });
      await actions.createPaymentPg(
        null,
        form({
          paymentType: "made",
          amount: 700,
          partyId: supplier,
          accountId: bankAcct,
          paymentDate: "2026-03-10",
          paymentMethod: "cash",
        }),
      );

      // listPayments took only paymentType and silently dropped status and
      // partyId, which the action's own signature advertised — a caller
      // filtering by either got the unfiltered list and no error.
      const byType = await actions.getPaymentsPg({ paymentType: "received" });
      expect(byType.payments).toHaveLength(2);
      expect(byType.pagination.total).toBe(2);

      const byParty = await actions.getPaymentsPg({ partyId: supplier });
      expect(byParty.payments).toHaveLength(1);
      expect(byParty.payments[0].partyName).toBe("Tosha Ltd");

      const byMethod = await actions.getPaymentsPg({ paymentMethod: "mpesa" });
      expect(byMethod.payments).toHaveLength(1);

      const bySearch = await actions.getPaymentsPg({ search: "QGH12" });
      expect(bySearch.payments).toHaveLength(1);
      expect(Number(bySearch.payments[0].amount)).toBe(1200);

      const byStatus = await actions.getPaymentsPg({ status: "cancelled" });
      expect(byStatus.payments).toHaveLength(0);
    });

    it("pages, and reports how many pages there are", async () => {
      for (const amount of [100, 200, 300]) await received({ amount });

      const first = await actions.getPaymentsPg({ limit: 2 });
      expect(first.payments).toHaveLength(2);
      expect(first.pagination).toMatchObject({ page: 1, total: 3, pages: 2 });

      const second = await actions.getPaymentsPg({ limit: 2, page: 2 });
      expect(second.payments).toHaveLength(1);
    });

    it("carries the unapplied amount without a query per row", async () => {
      const res = await received({ amount: 5000 });
      const { payments } = await actions.getPaymentsPg({});
      const row = payments.find((p) => p.id === res.paymentId);
      expect(Number(row.unappliedAmount)).toBe(5000);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("clearing a receipt", () => {
    let clearingAcct;

    beforeEach(async () => {
      clearingAcct = randomUUID();
      await asTenant((tx) =>
        tx.execute(sql`
          INSERT INTO accounts
            (id, company_id, account_code, account_name, account_type, sub_type, can_post, system_account)
          VALUES (${clearingAcct}::uuid, ${companyId}::uuid, '1050', 'Undeposited Funds',
                  'asset', 'bank', true, 'undeposited_funds')`),
      );
    });

    it("parks a cheque in the clearing account, then banks it", async () => {
      const res = await received({ paymentMethod: "cheque", amount: 5000 });
      expect(res.success).toBe(true);

      // The receipt is real but the money is not in the bank yet, and posting
      // it there would claim cash that cannot be demonstrated.
      expect(await accountNet(clearingAcct)).toBe(5000);
      expect(await accountNet(bankAcct)).toBe(0);
      expect((await actions.getPaymentPg(res.paymentId)).status).toBe(
        "pending_clearance",
      );

      // clearPaymentReceipt had NO CALLER — so a payment that landed here
      // could never leave. Sweep question 4, and the same shape as
      // returnCheckout.
      expect((await actions.clearPaymentPg(res.paymentId)).success).toBe(true);

      expect(await accountNet(clearingAcct)).toBe(0);
      expect(await accountNet(bankAcct)).toBe(5000);
      expect((await actions.getPaymentPg(res.paymentId)).status).toBe("confirmed");
    });

    it("puts cash straight in the account — there is nothing to clear", async () => {
      const res = await received({ paymentMethod: "cash", amount: 5000 });
      expect(await accountNet(bankAcct)).toBe(5000);
      expect(await accountNet(clearingAcct)).toBe(0);
      expect((await actions.getPaymentPg(res.paymentId)).status).toBe("confirmed");
    });

    it("refuses to clear a payment that is not awaiting clearance", async () => {
      const res = await received({ paymentMethod: "cash" });
      const again = await actions.clearPaymentPg(res.paymentId);
      expect(again.success).toBe(false);
      expect(again.error).toMatch(/not awaiting clearance/i);
    });
  });
});
