/**
 * Other modules hand their money to finance (other_modules_hand_their_money_to_finance):
 * training costs become draft expenses, finished technical jobs become draft
 * invoices, and the Processes page counts what is waiting.
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
const hr = await import("@/app/db/actions/hr-records-actions");
const handoff = await import("@/app/db/actions/finance-handoff-actions");

suite("finance hand-offs", () => {
  let admin;
  let co;
  let mongo;
  let employeeId;
  let customerId;
  let jobId;

  const asRole = (role) =>
    getTenantContext.mockResolvedValue({ user: { id: randomUUID(), name: `${role} User`, role }, companyId: mongo });

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, users, _migration_id_map, entry_counters CASCADE`;
    co = randomUUID();
    mongo = randomUUID().replace(/-/g, "").slice(0, 24);
    await admin`INSERT INTO companies (id, name, slug) VALUES (${co}, 'Co', ${"f-" + co.slice(0, 8)})`;
    await admin`INSERT INTO _migration_id_map (collection, old_object_id, new_uuid) VALUES ('companies', ${mongo}, ${co})`;
    await admin`INSERT INTO company_settings (company_id) VALUES (${co})`;
    await admin`
      INSERT INTO accounts (id, company_id, account_code, account_name, account_type, system_account) VALUES
        (${randomUUID()}, ${co}, '6400', 'Training & Development', 'expense', NULL),
        (${randomUUID()}, ${co}, '6900', 'Miscellaneous Expenses', 'expense', NULL),
        (${randomUUID()}, ${co}, '1200', 'Accounts Receivable', 'asset', 'accounts_receivable'),
        (${randomUUID()}, ${co}, '4100', 'Service Revenue', 'revenue', 'service_revenue'),
        (${randomUUID()}, ${co}, '2200', 'VAT Output', 'liability', 'vat_output')`;
    const party = randomUUID();
    await admin`INSERT INTO parties (id, company_id, primary_type, name, is_employee) VALUES (${party}, ${co}, 'employee', 'Jane Tech', true)`;
    employeeId = randomUUID();
    await admin`INSERT INTO employees (id, company_id, party_id, employee_number, first_name, last_name, hire_date, national_id, kra_pin)
                VALUES (${employeeId}, ${co}, ${party}, 'E-1', 'Jane', 'Tech', '2025-01-01', '12345678', 'A123456789Z')`;
    customerId = randomUUID();
    await admin`INSERT INTO parties (id, company_id, primary_type, name, is_customer) VALUES (${customerId}, ${co}, 'customer', 'Acme Ltd', true)`;
    jobId = randomUUID();
    await admin`INSERT INTO calibration_jobs (id, company_id, job_number, client_name, service_type, status)
                VALUES (${jobId}, ${co}, 'CAL-1', 'Acme Ltd', 'Pressure', 'approved')`;
    asRole("HR Manager");
  });

  const training = (cost, id = "") => {
    const fd = new FormData();
    if (id) fd.append("id", id);
    fd.append("employeeId", employeeId);
    fd.append("kind", "course");
    fd.append("title", "First aid");
    fd.append("provider", "Red Cross");
    fd.append("status", "completed");
    fd.append("completedOn", "2026-11-01");
    fd.append("cost", String(cost));
    return hr.saveTraining(null, fd);
  };
  const expenseOf = async (trainingId) =>
    (await admin`SELECT e.status::text AS status, e.amount::float8 AS amount, e.account_name_at_expense AS account
                   FROM hr_training_records t JOIN expenses e ON e.id = t.expense_id WHERE t.id = ${trainingId}`)[0];

  it("sends a training cost to finance as a draft expense, and keeps it in step", async () => {
    const r = await training(12000);
    expect(r.success).toBe(true);
    expect(r.message).toMatch(/draft expense/i);
    expect(await expenseOf(r.id)).toMatchObject({ status: "draft", amount: 12000, account: "Training & Development" });

    await training(15000, r.id);
    expect((await expenseOf(r.id)).amount).toBe(15000);
    expect((await admin`SELECT count(*)::int AS n FROM expenses`)[0].n).toBe(1);

    await training(0, r.id);
    expect(await expenseOf(r.id)).toBeUndefined();
    expect((await admin`SELECT count(*)::int AS n FROM expenses`)[0].n).toBe(0);
  });

  it("removes the draft expense with the training record", async () => {
    const r = await training(5000);
    expect((await hr.deleteTraining(r.id)).success).toBe(true);
    expect((await admin`SELECT count(*)::int AS n FROM expenses`)[0].n).toBe(0);
  });

  it("bills a finished calibration job once, as a draft invoice", async () => {
    asRole("Accountant");
    const r = await handoff.billTechnicalJobPg({ kind: "calibration", id: jobId, customerId, amount: 20000, taxRate: 16 });
    expect(r.success).toBe(true);
    const [job] = await admin`SELECT billing_status, invoice_id FROM calibration_jobs WHERE id = ${jobId}`;
    expect(job.billing_status).toBe("invoiced");
    const [inv] = await admin`SELECT status, customer_id::text AS c, total::float8 AS total FROM invoices WHERE id = ${job.invoice_id}`;
    expect(inv).toMatchObject({ status: "draft", c: customerId, total: 23200 });

    const again = await handoff.billTechnicalJobPg({ kind: "calibration", id: jobId, customerId, amount: 1, taxRate: 0 });
    expect(again.success).toBe(false);
    expect(again.error).toMatch(/already been invoiced/i);
  });

  it("will not let a technician raise an invoice", async () => {
    asRole("Employee");
    const r = await handoff.billTechnicalJobPg({ kind: "calibration", id: jobId, customerId, amount: 100, taxRate: 0 });
    expect(r.success).toBe(false);
  });

  it("counts what is waiting at each step", async () => {
    await training(3000);
    asRole("Accountant");
    const c = await handoff.getProcessCounts();
    expect(c.expensesDraft).toBe(1);
    expect(c.jobsToBill).toBe(1);
    expect(c.invoicesDraft).toBe(0);
    // Every count runs; a null would mean its query is wrong.
    expect(Object.entries(c).filter(([, v]) => v === null).map(([k]) => k)).toEqual([]);
  });
});
