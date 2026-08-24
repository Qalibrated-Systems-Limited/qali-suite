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
    await admin`TRUNCATE companies CASCADE`;
    await admin`TRUNCATE entry_counters`;
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
});
