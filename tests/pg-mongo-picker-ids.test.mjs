/**
 * The pickers that still serve Mongo ObjectIds into Postgres uuid columns.
 *
 * Bills, invoices and stock requests are on Postgres. PROJECTS and ASSETS are
 * not — so the pickers on those forms are fed by `getActiveProjects()` and an
 * `Asset.find()`, both of which return 24-character Mongo ObjectIds. Any
 * column typed `uuid` on the receiving end rejects them outright.
 *
 * This is the same trap `employee_claims.project_id` avoided by being `text`
 * (0052). These are the ones that did not.
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

/** What `getActiveProjects()` and the asset picker actually hand back. */
const MONGO_OBJECT_ID = "507f1f77bcf86cd799439011";

suite("Mongo picker ids reaching Postgres columns", () => {
  let admin, client, db;
  let companyA, supplier, expenseAcct, apAcct;

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
    supplier = randomUUID();
    expenseAcct = randomUUID();
    apAcct = randomUUID();

    await admin`INSERT INTO companies (id, name, slug) VALUES
      (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)})`;

    await asTenant(companyA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO parties (id, company_id, primary_type, is_supplier, name)
        VALUES (${supplier}::uuid, ${companyA}::uuid, 'supplier', true, 'Steel Supplies Ltd')`);
      await tx.execute(sql`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, can_post, system_account)
        VALUES
          (${expenseAcct}::uuid, ${companyA}::uuid, '6200', 'Repairs',          'expense',   true, NULL),
          (${apAcct}::uuid,      ${companyA}::uuid, '2100', 'Accounts Payable', 'liability', true, 'accounts_payable')`);
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

  it("a bill tagged to a project saves", async () => {
    // The bill form ships a ProjectPicker fed by getActiveProjects(), which
    // returns Mongo ObjectIds. bills.project_id must accept one.
    const bill = await asTenant(companyA, (tx) =>
      billsRepo.createBill(tx, billInput({ header: { projectId: MONGO_OBJECT_ID } })),
    );
    expect(bill.projectId).toBe(MONGO_OBJECT_ID);
  });

  it("a bill line tagged to a fixed asset saves", async () => {
    // Same form, AssetCombobox, fed by an Asset.find() on Mongo.
    const bill = await asTenant(companyA, (tx) =>
      billsRepo.createBill(
        tx,
        billInput({
          line: {
            assetId: MONGO_OBJECT_ID,
            assetNumber: "FA-0007",
            assetName: "Toyota Hilux",
          },
        }),
      ),
    );

    const [line] = await admin`
      SELECT asset_id, asset_number_at_bill FROM bill_lines
       WHERE bill_id = ${bill.id}::uuid`;
    expect(line.asset_id).toBe(MONGO_OBJECT_ID);
    expect(line.asset_number_at_bill).toBe("FA-0007");
  });
});
