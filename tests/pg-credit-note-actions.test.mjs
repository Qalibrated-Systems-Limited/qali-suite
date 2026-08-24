/**
 * The credit note write path, end to end through the server action.
 *
 * Ported rules-first from app/mongodb/actions/credit-note-actions.js, so these
 * assert its guards as well as the ledger.
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
const cnActions = await import("@/app/db/actions/credit-note-actions");

suite("credit note actions (end to end)", () => {
  let admin, companyUuid, mongoCompanyId, customerId, widgetId;
  let ar, revenue, vat, cogs, inventory;

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, _migration_id_map, entry_counters CASCADE`;

    companyUuid = randomUUID();
    mongoCompanyId = randomUUID().replace(/-/g, "").slice(0, 24);
    customerId = randomUUID();
    widgetId = randomUUID();
    ar = randomUUID(); revenue = randomUUID(); vat = randomUUID();
    cogs = randomUUID(); inventory = randomUUID();

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
          (${ar},        ${companyUuid}, '1200', 'AR',         'asset',     'accounts_receivable'),
          (${revenue},   ${companyUuid}, '4000', 'Sales',      'revenue',   'sales_revenue'),
          (${vat},       ${companyUuid}, '2300', 'VAT Output', 'liability', 'vat_output'),
          (${cogs},      ${companyUuid}, '5000', 'COGS',       'expense',   'cogs'),
          (${inventory}, ${companyUuid}, '1300', 'Inventory',  'asset',     'inventory')
      `;
      await tx`
        INSERT INTO parties (id, company_id, primary_type, is_customer, name)
        VALUES (${customerId}, ${companyUuid}, 'customer', true, 'Acme Ltd')
      `;
      await tx`
        INSERT INTO products (id, company_id, sku, name, cost_price, selling_price, quantity_on_hand)
        VALUES (${widgetId}, ${companyUuid}, 'WID-1', 'Widget', 40, 100, 100)
      `;
    });

    getTenantContext.mockResolvedValue({
      user: { id: randomUUID(), name: "Finance User", role: "Accountant" },
      companyId: mongoCompanyId,
    });
  });

  async function completedInvoice(qty = 10, price = 100, taxRate = 0) {
    const fd = new FormData();
    fd.set("invoiceData", JSON.stringify({
      customerId, invoiceDate: "2026-08-01",
      stockItems: [{ productId: widgetId, quantity: qty, sellingPrice: price, taxRate }],
      serviceItems: [],
    }));
    const created = await invoiceActions.createInvoicePg(null, fd);
    await invoiceActions.completeInvoicePg(created.invoiceId);
    return invoiceActions.getInvoiceDetailPg(created.invoiceId);
  }

  /** The indexed fields IssueCreditNoteDialog posts. */
  function cnForm({ invoiceId, items, issueImmediately = false, reason = "return" }) {
    const fd = new FormData();
    fd.set("invoiceId", invoiceId);
    fd.set("creditNoteDate", "2026-08-10T00:00:00.000Z");
    fd.set("reason", reason);
    fd.set("reasonDescription", "Goods returned");
    fd.set("issueImmediately", String(issueImmediately));
    items.forEach((it, i) => {
      for (const [k, v] of Object.entries(it)) {
        fd.set(`items[${i}].${k}`, String(v ?? ""));
      }
    });
    return fd;
  }

  it("creates a draft credit note from the dialog's fields", async () => {
    const inv = await completedInvoice();
    const line = inv.items[0];

    const r = await cnActions.createCreditNotePg(
      null,
      cnForm({
        invoiceId: inv.id,
        items: [{
          itemType: "product", productId: widgetId,
          originalInvoiceLineId: line._id,
          description: "Widget", unit: "pcs",
          quantity: "3", unitPrice: "100.0000", taxRate: "0",
          restoreInventory: "false",
        }],
      }),
    );

    expect(r.success).toBe(true);
    expect(r.creditNoteNumber).toMatch(/^CN-/);

    const [note] = await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      return tx`SELECT status::text, total::text FROM credit_notes`;
    });
    expect(note.status).toBe("draft");
    expect(note.total).toBe("300.0000");
  });

  it("ignores lines the user left at zero", async () => {
    const inv = await completedInvoice();
    const line = inv.items[0];
    const r = await cnActions.createCreditNotePg(
      null,
      cnForm({
        invoiceId: inv.id,
        items: [
          { itemType: "product", productId: widgetId, originalInvoiceLineId: line._id,
            description: "Widget", quantity: "0", unitPrice: "100.0000", taxRate: "0" },
          { itemType: "product", productId: widgetId, originalInvoiceLineId: line._id,
            description: "Widget", quantity: "2", unitPrice: "100.0000", taxRate: "0" },
        ],
      }),
    );
    expect(r.success).toBe(true);
    const lines = await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      return tx`SELECT quantity::text FROM credit_note_lines`;
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe("2.0000");
  });

  it("issues immediately, reversing revenue and the receivable", async () => {
    const inv = await completedInvoice(10, 100, 16);
    const line = inv.items[0];

    const r = await cnActions.createCreditNotePg(
      null,
      cnForm({
        invoiceId: inv.id,
        issueImmediately: true,
        items: [{
          itemType: "product", productId: widgetId,
          originalInvoiceLineId: line._id,
          description: "Widget", quantity: "5",
          unitPrice: "100.0000", taxRate: "16",
          restoreInventory: "false",
        }],
      }),
    );
    expect(r.success).toBe(true);
    expect(r.message).toMatch(/issued/i);

    const led = await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      const bal = async (id) =>
        (await tx`SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS b
                    FROM journal_lines l WHERE l.account_id = ${id}`)[0].b;
      const [n] = await tx`SELECT status::text FROM credit_notes`;
      return { ar: await bal(ar), rev: await bal(revenue), vat: await bal(vat), status: n.status };
    });

    // Invoice: AR 1160, Sales -1000, VAT -160.
    // Credit of 500 + 80 tax reverses exactly that much.
    expect(led.status).toBe("issued");
    expect(led.ar).toBe("580.0000");
    expect(led.rev).toBe("-500.0000");
    expect(led.vat).toBe("-80.0000");
  });

  it("puts stock back at the cost the sale took out", async () => {
    const inv = await completedInvoice(10, 100, 0);
    const line = inv.items[0];

    // Re-cost the product between the sale and the return.
    await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      await tx`UPDATE products SET cost_price = 90 WHERE id = ${widgetId}`;
    });

    await cnActions.createCreditNotePg(
      null,
      cnForm({
        invoiceId: inv.id,
        issueImmediately: true,
        items: [{
          itemType: "product", productId: widgetId,
          originalInvoiceLineId: line._id,
          description: "Widget", quantity: "4",
          unitPrice: "100.0000", taxRate: "0",
          restoreInventory: "true",
        }],
      }),
    );

    const led = await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      const bal = async (id) =>
        (await tx`SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS b
                    FROM journal_lines l WHERE l.account_id = ${id}`)[0].b;
      const [p] = await tx`SELECT quantity_on_hand::text AS h FROM products WHERE id = ${widgetId}`;
      return { inv: await bal(inventory), cogs: await bal(cogs), onHand: p.h };
    });

    // These are CUMULATIVE account balances, so they carry the sale as well as
    // the credit:
    //   sale   CR Inventory 400  (10 x 40),  DR COGS 400
    //   credit DR Inventory 160  ( 4 x 40),  CR COGS 160
    // Net: Inventory -240, COGS 240.
    //
    // The 160 is the point: 4 x 40, the cost frozen on the invoice line, not
    // 4 x 90. Valuing a return at today's cost would put back a different
    // amount than the sale took out, and the difference lands in COGS.
    expect(led.inv).toBe("-240.0000");
    expect(led.cogs).toBe("240.0000");
    expect(led.onHand).toBe("94.0000");
  });

  it("refuses to credit a draft invoice", async () => {
    const fd = new FormData();
    fd.set("invoiceData", JSON.stringify({
      customerId, invoiceDate: "2026-08-01",
      stockItems: [{ productId: widgetId, quantity: 1, sellingPrice: 100 }],
      serviceItems: [],
    }));
    const draft = await invoiceActions.createInvoicePg(null, fd);

    const r = await cnActions.createCreditNotePg(
      null,
      cnForm({
        invoiceId: draft.invoiceId,
        items: [{ itemType: "product", productId: widgetId, description: "Widget",
                  quantity: "1", unitPrice: "100.0000", taxRate: "0" }],
      }),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/completed invoice/i);
  });

  it("refuses to credit more than the invoice was worth", async () => {
    const inv = await completedInvoice(10, 100, 0);
    const line = inv.items[0];
    const r = await cnActions.createCreditNotePg(
      null,
      cnForm({
        invoiceId: inv.id,
        items: [{ itemType: "product", productId: widgetId,
                  originalInvoiceLineId: line._id, description: "Widget",
                  quantity: "11", unitPrice: "100.0000", taxRate: "0" }],
      }),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/over-credited/i);
  });

  it("refuses a role that may not touch finance", async () => {
    const inv = await completedInvoice();
    getTenantContext.mockResolvedValue({
      user: { id: randomUUID(), name: "Clerk", role: "Storekeeper" },
      companyId: mongoCompanyId,
    });
    const r = await cnActions.createCreditNotePg(
      null,
      cnForm({
        invoiceId: inv.id,
        items: [{ itemType: "product", productId: widgetId, description: "Widget",
                  quantity: "1", unitPrice: "100.0000", taxRate: "0" }],
      }),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/permission/i);
  });
});
