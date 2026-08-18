/**
 * The invoice write path, end to end through the server action.
 *
 * The repository layer has been well covered for some time; almost nothing
 * called it. This exercises the layer above — session to tenant, role gate,
 * shape validation, system-account resolution, posting — which is the part
 * §9.6 means by "one complete write path wired through the real UI".
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

// getTenantContext reaches next-auth, which does not load under Vitest.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/utils/tenant-utils", () => ({ getTenantContext: vi.fn() }));

const { getTenantContext } = await import("@/lib/utils/tenant-utils");
const invoiceActions = await import("@/app/db/actions/invoice-actions");

function form(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) fd.set(k, String(v));
  }
  return fd;
}

suite("invoice actions (end to end)", () => {
  let admin;
  let companyUuid;
  let mongoCompanyId;
  let customerId;
  let widgetId;

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
    // Sessions still carry the Mongo company id during the transition; the
    // action resolves it through _migration_id_map, exactly as in production.
    mongoCompanyId = randomUUID().replace(/-/g, "").slice(0, 24);
    customerId = randomUUID();
    widgetId = randomUUID();
    const ar = randomUUID();
    const revenue = randomUUID();
    const vat = randomUUID();

    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${companyUuid}, 'Pilot', ${"p-" + companyUuid.slice(0, 8)})
    `;
    await admin`
      INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
      VALUES ('companies', ${mongoCompanyId}, ${companyUuid})
    `;
    await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      await tx`
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, system_account) VALUES
          (${ar},      ${companyUuid}, '1200', 'Accounts Receivable', 'asset',     'accounts_receivable'),
          (${revenue}, ${companyUuid}, '4000', 'Sales',               'revenue',   'sales_revenue'),
          (${vat},     ${companyUuid}, '2300', 'VAT Output',          'liability', 'vat_output')
      `;
      await tx`
        INSERT INTO parties (id, company_id, primary_type, is_customer, name)
        VALUES (${customerId}, ${companyUuid}, 'customer', true, 'Acme Ltd')
      `;
      await tx`
        INSERT INTO products (id, company_id, sku, name, cost_price, selling_price, quantity_on_hand)
        VALUES (${widgetId}, ${companyUuid}, 'WID-1', 'Widget', 40, 250, 100)
      `;
    });

    getTenantContext.mockResolvedValue({
      user: { id: randomUUID(), name: "Sales User", role: "Sales Manager" },
      companyId: mongoCompanyId,
    });
  });

  it("creates a product invoice from form data", async () => {
    const result = await invoiceActions.createInvoicePg(
      null,
      form({
        customerId,
        invoiceDate: "2026-08-01",
        "lines[0].productId": widgetId,
        "lines[0].quantity": "4",
        "lines[0].unitPrice": "250.0000",
      }),
    );

    expect(result.success).toBe(true);
    expect(result.invoiceNumber).toMatch(/^INV-/);

    // Stock is reserved while the invoice is a draft.
    const [p] = await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      return tx`SELECT quantity_committed::text AS c FROM products WHERE id = ${widgetId}`;
    });
    expect(p.c).toBe("4.0000");
  });

  it("creates a service invoice, which reserves nothing", async () => {
    const result = await invoiceActions.createInvoicePg(
      null,
      form({
        customerId,
        invoiceDate: "2026-08-01",
        "lines[0].itemType": "service",
        "lines[0].serviceCategory": "installation",
        "lines[0].description": "Installation",
        "lines[0].unit": "hours",
        "lines[0].quantity": "3",
        "lines[0].unitPrice": "2500.0000",
      }),
    );
    expect(result.success).toBe(true);

    const [p] = await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      return tx`SELECT quantity_committed::text AS c FROM products WHERE id = ${widgetId}`;
    });
    expect(p.c).toBe("0.0000");
  });

  it("returns a field error rather than a constraint violation", async () => {
    const result = await invoiceActions.createInvoicePg(
      null,
      form({
        customerId,
        invoiceDate: "2026-08-01",
        // product line with no product
        "lines[0].itemType": "product",
        "lines[0].quantity": "1",
        "lines[0].unitPrice": "10",
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("Validation failed");
    expect(JSON.stringify(result.fieldErrors)).toMatch(/product/i);
  });

  it("refuses a role that may not write invoices", async () => {
    getTenantContext.mockResolvedValue({
      user: { id: randomUUID(), name: "Store Clerk", role: "Storekeeper" },
      companyId: mongoCompanyId,
    });
    const result = await invoiceActions.createInvoicePg(
      null,
      form({
        customerId,
        invoiceDate: "2026-08-01",
        "lines[0].productId": widgetId,
        "lines[0].quantity": "1",
        "lines[0].unitPrice": "10",
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/permission/i);
  });

  it("completes an invoice: posts revenue, issues stock, costs it", async () => {
    const created = await invoiceActions.createInvoicePg(
      null,
      form({
        customerId,
        invoiceDate: "2026-08-01",
        "lines[0].productId": widgetId,
        "lines[0].quantity": "4",
        "lines[0].unitPrice": "250.0000",
      }),
    );
    const done = await invoiceActions.completeInvoicePg(created.invoiceId);
    expect(done.success).toBe(true);

    const rows = await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      const [inv] = await tx`SELECT status::text, total::text FROM invoices WHERE id = ${created.invoiceId}`;
      const [prod] = await tx`SELECT quantity_on_hand::text AS h, quantity_committed::text AS c FROM products WHERE id = ${widgetId}`;
      const [cogs] = await tx`SELECT count(*)::int AS n, COALESCE(SUM(total_cost),0)::text AS cost FROM cogs_postings`;
      const [mv] = await tx`SELECT previous_stock::text AS p, new_stock::text AS n FROM stock_movements`;
      const [je] = await tx`SELECT count(*)::int AS n FROM journal_entries WHERE status = 'posted'`;
      return { inv, prod, cogs, mv, je };
    });

    expect(rows.inv.status).toBe("completed");
    expect(rows.inv.total).toBe("1000.0000");
    // Stock issued and the reservation released.
    expect(rows.prod.h).toBe("96.0000");
    expect(rows.prod.c).toBe("0.0000");
    // Costed once, at the cost frozen on the line: 4 x 40.
    expect(rows.cogs.n).toBe(1);
    expect(rows.cogs.cost).toBe("160.0000");
    // The movement describes the transition that actually happened.
    expect(rows.mv.p).toBe("100.0000");
    expect(rows.mv.n).toBe("96.0000");
    expect(rows.je.n).toBeGreaterThan(0);
  });

  it("surfaces a missing system account instead of a generic failure", async () => {
    await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      await tx`UPDATE accounts SET system_account = NULL WHERE system_account = 'sales_revenue'`;
    });
    const created = await invoiceActions.createInvoicePg(
      null,
      form({
        customerId,
        invoiceDate: "2026-08-01",
        "lines[0].productId": widgetId,
        "lines[0].quantity": "1",
        "lines[0].unitPrice": "10",
      }),
    );
    const done = await invoiceActions.completeInvoicePg(created.invoiceId);
    expect(done.success).toBe(false);
    expect(done.error).toMatch(/system account not configured/i);
  });
});
