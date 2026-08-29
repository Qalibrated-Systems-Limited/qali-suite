/**
 * The pickers that used to serve Mongo ObjectIds into Postgres columns.
 *
 * This file began as the record of a trap: bills, invoices and stock requests
 * were on Postgres while PROJECTS and ASSETS were not, so the pickers on those
 * forms handed back 24-character Mongo ObjectIds and any `uuid` column on the
 * receiving end rejected them outright. `employee_claims.project_id` avoided it
 * by being `text` (0052); the rest were typed `text` in 0053/0054 for the same
 * reason.
 *
 * BOTH SIDES HAVE MOVED. Assets ported in 0056 and `bill_lines.asset_id`
 * became a real foreign key in 0057; projects ported in 0070 and all five
 * `project_id` columns went with them. So what this file asserts now is the
 * opposite of what it was written to assert: the id must be a row in the
 * register, and a made-up one is refused.
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

const billsRepo = await import("@/app/db/repositories/bills");
const invoicesRepo = await import("@/app/db/repositories/invoices");
const fulfilmentRepo = await import("@/app/db/repositories/fulfilment");
const { invoiceDataSchema, toRepositoryInput } = await import(
  "@/app/db/validation/invoices"
);

/** What those pickers used to hand back, and what no column accepts now. */
const MONGO_OBJECT_ID = "507f1f77bcf86cd799439011";

suite("Mongo picker ids reaching Postgres columns", () => {
  let admin, client, db;
  let companyA, supplier, customer, widget, expenseAcct, apAcct;

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
    await admin`TRUNCATE companies, entry_counters CASCADE`;

    companyA = randomUUID();
    supplier = randomUUID();
    customer = randomUUID();
    widget = randomUUID();
    expenseAcct = randomUUID();
    apAcct = randomUUID();

    await admin`INSERT INTO companies (id, name, slug) VALUES
      (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)})`;

    await asTenant(companyA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO parties (id, company_id, primary_type, is_supplier, is_customer, name)
        VALUES
          (${supplier}::uuid, ${companyA}::uuid, 'supplier', true,  false, 'Steel Supplies Ltd'),
          (${customer}::uuid, ${companyA}::uuid, 'customer', false, true,  'Acme Builders')`);
      await tx.execute(sql`
        INSERT INTO products (id, company_id, sku, name, cost_price, selling_price, quantity_on_hand)
        VALUES (${widget}::uuid, ${companyA}::uuid, 'RB-12', 'Rebar 12mm', 100, 500, 50)`);
      await tx.execute(sql`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, can_post, system_account)
        VALUES
          (${expenseAcct}::uuid, ${companyA}::uuid, '6200', 'Repairs',          'expense',   true, NULL),
          (${apAcct}::uuid,      ${companyA}::uuid, '2100', 'Accounts Payable', 'liability', true, 'accounts_payable'),
          (${randomUUID()}::uuid, ${companyA}::uuid, '1100', 'Accounts Receivable', 'asset', true, 'accounts_receivable'),
          (${randomUUID()}::uuid, ${companyA}::uuid, '4000', 'Sales Revenue',    'revenue',   true, 'sales_revenue'),
          (${randomUUID()}::uuid, ${companyA}::uuid, '2200', 'VAT Payable',      'liability', true, 'vat_payable'),
          (${randomUUID()}::uuid, ${companyA}::uuid, '1200', 'Inventory',        'asset',     true, 'inventory'),
          (${randomUUID()}::uuid, ${companyA}::uuid, '5000', 'COGS',             'expense',   true, 'cogs')`);
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

  const billInput = (extra = {}) => ({
    companyId: companyA,
    supplierId: supplier,
    billDate: "2026-08-10",
    dueDate: "2026-09-09",
    lines: [
      {
        description: "Hilux service",
        accountId: expenseAcct,
        quantity: "1",
        unitPrice: "15000.0000",
        ...(extra.line ?? {}),
      },
    ],
    ...(extra.header ?? {}),
  });

  /** A real project, since the columns are foreign keys now. */
  const seedProject = async () => {
    const id = randomUUID();
    await asTenant(companyA, (tx) =>
      tx.execute(sql`
        INSERT INTO projects (id, company_id, project_number, name)
        VALUES (${id}::uuid, ${companyA}::uuid, 'PRJ-00001', 'Otho Road')`),
    );
    return id;
  };

  it("an invoice tagged to a project keeps the link", async () => {
    // CreateInvoiceForm puts projectId in the JSON payload it posts. Until
    // 0054 there was no column and no schema field, so the link was dropped
    // in silence — the save succeeded and the project was simply gone.
    const project = await seedProject();
    const parsed = invoiceDataSchema.safeParse({
      customerId: customer,
      invoiceDate: "2026-08-10",
      projectId: project,
      stockItems: [
        {
          productId: widget,
          quantity: 2,
          sellingPrice: 500,
          taxRate: 16,
          name: "Rebar 12mm",
        },
      ],
      serviceItems: [],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data.projectId).toBe(project);

    const invoice = await asTenant(companyA, (tx) =>
      invoicesRepo.createInvoice(tx, {
        companyId: companyA,
        ...toRepositoryInput(parsed.data),
      }),
    );

    const [row] = await admin`
      SELECT project_id FROM invoices WHERE id = ${invoice.id}::uuid`;
    expect(row.project_id).toBe(project);
  });

  it("a stock request tagged to a project keeps the link", async () => {
    // The column has existed since 0020 and mapRequest already reads it back
    // out; nothing ever wrote it, so it rendered NULL from the day it shipped.
    const project = await seedProject();
    const request = await asTenant(companyA, (tx) =>
      fulfilmentRepo.createStockRequest(tx, {
        companyId: companyA,
        requestType: "internal",
        requesterName: "Sam Stores",
        requesterDepartment: "Technical",
        projectId: project,
        items: [{ productId: widget, requestedQuantity: "3.0000", unitPrice: "0.0000" }],
      }),
    );

    const [row] = await admin`
      SELECT project_id FROM stock_requests WHERE id = ${request.id}::uuid`;
    expect(row.project_id).toBe(project);
  });

  it("a bill tagged to a project saves", async () => {
    const project = await seedProject();
    const bill = await asTenant(companyA, (tx) =>
      billsRepo.createBill(tx, billInput({ header: { projectId: project } })),
    );
    expect(bill.projectId).toBe(project);
  });

  it("refuses a Mongo ObjectId where a project used to be accepted", async () => {
    // 0053's own words: "a uuid column rejected every bill the project picker
    // touched", which is why these were text. The picker serves uuids now, so
    // the column says what the value is and the old id cannot get in.
    await expect(
      asTenant(companyA, (tx) =>
        billsRepo.createBill(tx, billInput({ header: { projectId: MONGO_OBJECT_ID } })),
      ),
    ).rejects.toThrow();
  });

  it("refuses a project that is not in the register", async () => {
    await expect(
      asTenant(companyA, (tx) =>
        billsRepo.createBill(tx, billInput({ header: { projectId: randomUUID() } })),
      ),
    ).rejects.toThrow();
  });

  it("a bill line tagged to a fixed asset points at the register", async () => {
    // Assets moved to Postgres in 0056 and bill_lines.asset_id became a real
    // foreign key in 0057 — so this is no longer a Mongo picker at all. The
    // id must be a register row, and a made-up one is refused.
    const asset = randomUUID();
    await asTenant(companyA, (tx) =>
      tx.execute(sql`
        INSERT INTO assets (id, company_id, asset_number, name, category,
                            acquisition_date, acquisition_cost, depreciation_start_date)
        VALUES (${asset}::uuid, ${companyA}::uuid, 'AST-0001', 'Toyota Hilux',
                'vehicle', '2026-01-01', 1200000, '2026-01-01')`),
    );

    const bill = await asTenant(companyA, (tx) =>
      billsRepo.createBill(
        tx,
        billInput({
          line: {
            assetId: asset,
            assetNumber: "AST-0001",
            assetName: "Toyota Hilux",
          },
        }),
      ),
    );

    const [line] = await admin`
      SELECT asset_id, asset_number_at_bill FROM bill_lines
       WHERE bill_id = ${bill.id}::uuid`;
    expect(line.asset_id).toBe(asset);
    expect(line.asset_number_at_bill).toBe("AST-0001");
  });

  it("a bill line cannot be tagged to an asset that does not exist", async () => {
    await expect(
      asTenant(companyA, (tx) =>
        billsRepo.createBill(
          tx,
          billInput({ line: { assetId: randomUUID(), assetNumber: "AST-9999" } }),
        ),
      ),
    ).rejects.toThrow();
  });
});
