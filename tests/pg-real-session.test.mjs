/**
 * Every ported write path, driven with the session a real login produces.
 *
 * THIS FILE EXISTS BECAUSE THE OTHER TESTS WERE MORE CORRECT THAN PRODUCTION.
 * auth.ts sets `session.user.id = dbUser._id.toString()` — a 24-character
 * Mongo ObjectId. Every other suite mocks it with randomUUID(), which happened
 * to satisfy the `uuid` columns the actions write it into. So 391 tests passed
 * while the first real click produced:
 *
 *     invalid input syntax for type uuid: "507f1f77bcf86cd799439011"
 *
 * on createInvoice, createBill, submitBill, approveBill, postJournalEntry and
 * every other write. A test double that cannot fail the way production fails
 * is not covering the thing it appears to cover — see migration 0031.
 *
 * So the rule for this file: the session id is ALWAYS an ObjectId, never a
 * uuid, and every write path is exercised through the action layer.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/utils/tenant-utils", () => ({ getTenantContext: vi.fn() }));

const { getTenantContext } = await import("@/lib/utils/tenant-utils");
const invoiceActions = await import("@/app/db/actions/invoice-actions");
const billActions = await import("@/app/db/actions/bill-actions");
const journalActions = await import("@/app/db/actions/journal-actions");

/** The exact shape auth.ts issues: `dbUser._id.toString()`. */
const objectId = () =>
  Array.from({ length: 24 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

suite("write paths with a real session id", () => {
  let admin;
  let companyUuid;
  let mongoCompanyId;
  let userId;
  let customerId;
  let supplierId;
  let widgetId;
  let acct;

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies CASCADE`;
    await admin`TRUNCATE _migration_id_map, entry_counters`;

    companyUuid = randomUUID();
    mongoCompanyId = objectId();
    userId = objectId();
    customerId = randomUUID();
    supplierId = randomUUID();
    widgetId = randomUUID();
    acct = {
      ar: randomUUID(), ap: randomUUID(), revenue: randomUUID(),
      vatOut: randomUUID(), vatIn: randomUUID(), cogs: randomUUID(),
      inventory: randomUUID(), bank: randomUUID(), expense: randomUUID(),
    };

    await admin`INSERT INTO companies (id, name, slug)
                VALUES (${companyUuid}, 'Pilot', ${"p-" + companyUuid.slice(0, 8)})`;
    await admin`INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
                VALUES ('companies', ${mongoCompanyId}, ${companyUuid})`;

    await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      await tx`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, system_account) VALUES
          (${acct.ar},        ${companyUuid}, '1200', 'Accounts Receivable', 'asset',     'accounts_receivable'),
          (${acct.ap},        ${companyUuid}, '2000', 'Accounts Payable',    'liability', 'accounts_payable'),
          (${acct.revenue},   ${companyUuid}, '4000', 'Sales',               'revenue',   'sales_revenue'),
          (${acct.vatOut},    ${companyUuid}, '2300', 'VAT Output',          'liability', 'vat_output'),
          (${acct.vatIn},     ${companyUuid}, '1400', 'VAT Input',           'asset',     'vat_input'),
          (${acct.cogs},      ${companyUuid}, '5000', 'Cost of Sales',       'expense',   'cogs'),
          (${acct.inventory}, ${companyUuid}, '1300', 'Inventory',           'asset',     'inventory')
      `;
      await tx`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, sub_type) VALUES
          (${acct.bank},    ${companyUuid}, '1000', 'Equity Bank', 'asset',   'bank'),
          (${acct.expense}, ${companyUuid}, '5100', 'Fuel',        'expense', 'operating_expense')
      `;
      await tx`INSERT INTO parties (id, company_id, primary_type, is_customer, name)
               VALUES (${customerId}, ${companyUuid}, 'customer', true, 'Acme Ltd')`;
      await tx`INSERT INTO parties (id, company_id, primary_type, is_supplier, name)
               VALUES (${supplierId}, ${companyUuid}, 'supplier', true, 'Shell Kenya')`;
      await tx`INSERT INTO products (id, company_id, sku, name, cost_price, selling_price, quantity_on_hand)
               VALUES (${widgetId}, ${companyUuid}, 'WID-1', 'Widget', 40, 250, 100)`;
    });

    getTenantContext.mockResolvedValue({
      user: { id: userId, name: "Ada Manager", role: "Admin" },
      companyId: mongoCompanyId,
      companyCode: "PILOT",
    });
  });

  /** The id is an ObjectId, and it is what lands in the column. */
  it("uses an ObjectId, not a uuid — the thing that made this file necessary", () => {
    expect(userId).toMatch(/^[0-9a-f]{24}$/);
    expect(userId).not.toMatch(/-/);
  });

  it("creates and completes an invoice", async () => {
    const fd = new FormData();
    fd.set("invoiceData", JSON.stringify({
      customerId,
      invoiceDate: "2026-08-01",
      stockItems: [{ productId: widgetId, quantity: 2, sellingPrice: 250, taxRate: 16 }],
      serviceItems: [],
    }));

    const created = await invoiceActions.createInvoicePg(null, fd);
    expect(created.success, created.error).toBe(true);

    const completed = await invoiceActions.completeInvoicePg(created.invoiceId);
    expect(completed.success, completed.error).toBe(true);

    const [row] = await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      return tx`SELECT created_by_id, completed_by_id FROM invoices WHERE id = ${created.invoiceId}`;
    });
    // Stored as issued, not mangled into something that fits a uuid.
    expect(row.created_by_id).toBe(userId);
    expect(row.completed_by_id).toBe(userId);
  });

  it("creates, submits, approves and pays a bill", async () => {
    const fd = new FormData();
    fd.set("supplierId", supplierId);
    fd.set("billDate", "2026-08-01");
    fd.set("dueDate", "2026-08-31");
    fd.set("lines[0].description", "Diesel");
    fd.set("lines[0].accountId", acct.expense);
    fd.set("lines[0].quantity", "10");
    fd.set("lines[0].unitPrice", "100");
    fd.set("lines[0].vatRate", "16");

    const created = await billActions.createBill(null, fd);
    expect(created.success, created.error).toBe(true);

    const submitted = await billActions.submitBill(created.billId);
    expect(submitted.success, submitted.error).toBe(true);

    // Admin, so the separation-of-duties override applies.
    const approved = await billActions.approveBill(created.billId);
    expect(approved.success, approved.error).toBe(true);

    const pay = new FormData();
    pay.set("amount", "1160");
    pay.set("paymentMethod", "bank_transfer");
    pay.set("accountId", acct.bank);
    pay.set("paymentDate", "2026-08-20");
    const paid = await billActions.createBillPayment(created.billId, null, pay);
    expect(paid.success, paid.error).toBe(true);

    const [row] = await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      return tx`SELECT created_by_id, submitted_by_id, approved_by_id
                  FROM bills WHERE id = ${created.billId}`;
    });
    expect(row.created_by_id).toBe(userId);
    expect(row.submitted_by_id).toBe(userId);
    expect(row.approved_by_id).toBe(userId);

    const [payment] = await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      return tx`SELECT created_by_id, confirmed_by_id FROM payments`;
    });
    expect(payment.created_by_id).toBe(userId);
    expect(payment.confirmed_by_id).toBe(userId);
  });

  it("rejects and cancels a bill", async () => {
    const make = async () => {
      const fd = new FormData();
      fd.set("supplierId", supplierId);
      fd.set("billDate", "2026-08-01");
      fd.set("dueDate", "2026-08-31");
      fd.set("lines[0].description", "Diesel");
      fd.set("lines[0].accountId", acct.expense);
      fd.set("lines[0].quantity", "1");
      fd.set("lines[0].unitPrice", "100");
      fd.set("lines[0].vatRate", "0");
      return billActions.createBill(null, fd);
    };

    const a = await make();
    await billActions.submitBill(a.billId);
    const reason = new FormData();
    reason.set("reason", "Wrong supplier");
    const rejected = await billActions.rejectBill(a.billId, null, reason);
    expect(rejected.success, rejected.error).toBe(true);

    const b = await make();
    await billActions.submitBill(b.billId);
    await billActions.approveBill(b.billId);
    const cancelled = await billActions.cancelBill(b.billId, null, reason);
    expect(cancelled.success, cancelled.error).toBe(true);

    const rows = await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      return tx`SELECT rejected_by_id, cancelled_by_id FROM bills ORDER BY bill_number`;
    });
    expect(rows[0].rejected_by_id).toBe(userId);
    expect(rows[1].cancelled_by_id).toBe(userId);
  });

  it("creates and posts a journal entry", async () => {
    const fd = new FormData();
    fd.set("entryDate", "2026-08-01");
    fd.set("entryType", "adjustment");
    fd.set("description", "Opening adjustment");
    fd.set("lines[0].accountId", acct.bank);
    fd.set("lines[0].debit", "500");
    fd.set("lines[0].credit", "0");
    fd.set("lines[1].accountId", acct.revenue);
    fd.set("lines[1].debit", "0");
    fd.set("lines[1].credit", "500");

    const created = await journalActions.createManualJournalEntry(null, fd);
    expect(created.success, created.error).toBe(true);

    const posted = await journalActions.postJournalEntry(created.entryId);
    expect(posted.success, posted.error).toBe(true);

    const [row] = await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      return tx`SELECT created_by_id, posted_by_id FROM journal_entries WHERE id = ${created.entryId}`;
    });
    expect(row.created_by_id).toBe(userId);
    expect(row.posted_by_id).toBe(userId);
  });

  it("creates a party inline from the invoice form", async () => {
    const fd = new FormData();
    fd.set("name", "Kisumu Traders");
    fd.set("type", "customer");
    const created = await invoiceActions.quickCreateParty(fd);
    expect(created.success, created.error).toBe(true);

    const [row] = await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      return tx`SELECT created_by_id FROM parties WHERE id = ${created.party._id}`;
    });
    expect(row.created_by_id).toBe(userId);
  });

  it("provisions a tenant whose session carries an ObjectId", async () => {
    // A company with no mapping at all — the self-heal path, driven by the id
    // shape a real session actually carries.
    const freshCompany = objectId();
    getTenantContext.mockResolvedValue({
      user: { id: objectId(), name: "Ada", role: "Admin" },
      companyId: freshCompany,
      companyCode: "NEWCO",
    });

    const { bills } = await billActions.listBillsForPage({});
    expect(bills).toEqual([]);

    const [company] = await admin`
      SELECT c.name FROM companies c
        JOIN _migration_id_map m ON m.new_uuid = c.id
       WHERE m.collection = 'companies' AND m.old_object_id = ${freshCompany}
    `;
    expect(company.name).toBe("NEWCO");
  });
});
