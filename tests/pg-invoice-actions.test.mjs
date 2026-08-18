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

/**
 * The form submits one JSON blob under `invoiceData`, with products and
 * services in separate lists. Building it the same way here keeps the test
 * honest about the real contract.
 */
function form({ customerId, invoiceDate, dueDate, title, notes, stockItems = [], serviceItems = [] }) {
  const fd = new FormData();
  fd.set(
    "invoiceData",
    JSON.stringify({ customerId, invoiceDate, dueDate, title, notes, stockItems, serviceItems }),
  );
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
          stockItems: [{ productId: widgetId, quantity: 4, sellingPrice: 250.0000 }],
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
        serviceItems: [
          {
            name: "Installation",
            serviceCategory: "installation",
            unit: "hours",
            quantity: 3,
            unitPrice: 2500,
          },
        ],
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
        // a stock item with no product at all
        stockItems: [{ productId: "", quantity: 1, sellingPrice: 10 }],
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
          stockItems: [{ productId: widgetId, quantity: 1, sellingPrice: 10 }],
        }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/permission/i);
  });

  it("computes tax from the rate in exact decimal, not from a browser float", async () => {
    // 3 x 333.33 = 999.99 at 16% is 159.9984. Computed in float64 the way the
    // form does it, this is where the fourth decimal goes wrong.
    const created = await invoiceActions.createInvoicePg(
      null,
      form({
        customerId,
        invoiceDate: "2026-08-01",
        stockItems: [
          { productId: widgetId, quantity: 3, sellingPrice: 333.33, taxRate: 16 },
        ],
      }),
    );
    expect(created.success).toBe(true);

    const [line] = await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      return tx`
        SELECT tax_amount::text AS tax, line_total::text AS total
          FROM invoice_lines WHERE invoice_id = ${created.invoiceId}
      `;
    });
    expect(line.tax).toBe("159.9984");
    expect(line.total).toBe("1159.9884");
  });

  it("maps a checkout-sourced item to its fulfilment source (§8.1)", async () => {
    const checkoutId = randomUUID();
    await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      await tx`
        INSERT INTO item_checkouts (
          id, company_id, checkout_number, product_id, quantity,
          checked_out_to_name_at_checkout, checked_out_by_name_at_checkout,
          purpose, expected_return_date
        ) VALUES (
          ${checkoutId}, ${companyUuid}, 'CHK-1', ${widgetId}, 5,
          'Tech', 'Store', 'installation', '2026-09-01'
        )
      `;
    });

    const created = await invoiceActions.createInvoicePg(
      null,
      form({
        customerId,
        invoiceDate: "2026-08-01",
        stockItems: [
          { productId: widgetId, quantity: 2, sellingPrice: 100, checkoutId },
        ],
      }),
    );
    expect(created.success).toBe(true);

    const [line] = await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      return tx`
        SELECT fulfilment_source::text AS src, checkout_id
          FROM invoice_lines WHERE invoice_id = ${created.invoiceId}
      `;
    });
    // Single-valued and mandatory, rather than inferred from which nullable
    // field happens to exist.
    expect(line.src).toBe("checkout");
    expect(line.checkout_id).toBe(checkoutId);
  });

  it("returns the detail shape the page renders, products and services alike", async () => {
    const created = await invoiceActions.createInvoicePg(
      null,
      form({
        customerId,
        invoiceDate: "2026-08-01",
        title: "August works",
        notes: "Thanks",
        stockItems: [
          { productId: widgetId, quantity: 2, sellingPrice: 100, taxRate: 16 },
        ],
        serviceItems: [
          {
            name: "Installation",
            serviceCategory: "installation",
            unit: "hours",
            quantity: 3,
            unitPrice: 500,
            taxRate: 16,
          },
        ],
      }),
    );
    expect(created.success).toBe(true);

    const inv = await invoiceActions.getInvoiceDetailPg(created.invoiceId);

    expect(inv.invoiceNumber).toBe(created.invoiceNumber);
    expect(inv.title).toBe("August works");
    expect(inv.customer.name).toBe("Acme Ltd");
    // Snapshotted at creation — there is no users table to join to (0026).
    expect(inv.createdBy.name).toBe("Sales User");
    expect(inv.createdBy.role).toBe("Sales Manager");

    expect(inv.items).toHaveLength(2);
    const product = inv.items.find((i) => i.type === "product");
    const service = inv.items.find((i) => i.type === "service");

    expect(product.SKU).toBe("WID-1");
    expect(product.name).toBe("Widget");
    expect(product.amount).toBe("232.0000"); // 200 + 16%

    // A service has no product, so its description stands in as its name.
    expect(service.SKU).toBeNull();
    expect(service.name).toBe("Installation");
    expect(service.unit).toBe("hours");
    expect(service.serviceCategory).toBe("installation");
    expect(service.amount).toBe("1740.0000"); // 1500 + 16%

    expect(inv.total).toBe("1972.0000");
  });

  it("returns null for an invoice in another tenant", async () => {
    const created = await invoiceActions.createInvoicePg(
      null,
      form({
        customerId,
        invoiceDate: "2026-08-01",
        stockItems: [{ productId: widgetId, quantity: 1, sellingPrice: 10 }],
      }),
    );

    const otherUuid = randomUUID();
    const otherMongo = randomUUID().replace(/-/g, "").slice(0, 24);
    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${otherUuid}, 'Other', ${"o-" + otherUuid.slice(0, 8)})
    `;
    await admin`
      INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
      VALUES ('companies', ${otherMongo}, ${otherUuid})
    `;
    getTenantContext.mockResolvedValue({
      user: { id: randomUUID(), name: "Other", role: "Sales Manager" },
      companyId: otherMongo,
    });

    // Not "forbidden" — invisible. RLS filters it before the query sees it.
    expect(await invoiceActions.getInvoiceDetailPg(created.invoiceId)).toBeNull();
  });

  it("completes an invoice: posts revenue, issues stock, costs it", async () => {
    const created = await invoiceActions.createInvoicePg(
      null,
      form({
          customerId,
          invoiceDate: "2026-08-01",
          stockItems: [{ productId: widgetId, quantity: 4, sellingPrice: 250.0000 }],
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

  it("cancels a draft and gives back the reserved stock", async () => {
    const created = await invoiceActions.createInvoicePg(
      null,
      form({
        customerId,
        invoiceDate: "2026-08-01",
        stockItems: [{ productId: widgetId, quantity: 4, sellingPrice: 100 }],
      }),
    );

    const cancelled = await invoiceActions.cancelInvoicePg(created.invoiceId, "Duplicate");
    expect(cancelled.success).toBe(true);

    const [p] = await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      return tx`SELECT quantity_committed::text AS c, quantity_on_hand::text AS h FROM products WHERE id = ${widgetId}`;
    });
    // The reservation is released; nothing physically moved, so on-hand stands.
    expect(p.c).toBe("0.0000");
    expect(p.h).toBe("100.0000");
  });

  it("refuses to cancel a completed invoice and points at a credit note", async () => {
    const created = await invoiceActions.createInvoicePg(
      null,
      form({
        customerId,
        invoiceDate: "2026-08-01",
        stockItems: [{ productId: widgetId, quantity: 1, sellingPrice: 100 }],
      }),
    );
    await invoiceActions.completeInvoicePg(created.invoiceId);

    const result = await invoiceActions.cancelInvoicePg(created.invoiceId, "Oops");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/credit note/i);
  });

  it("records a payment, and the invoice settles itself", async () => {
    const [bank] = await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      return tx`SELECT id FROM accounts WHERE account_code = '1200'`;
    });

    const created = await invoiceActions.createInvoicePg(
      null,
      form({
        customerId,
        invoiceDate: "2026-08-01",
        stockItems: [{ productId: widgetId, quantity: 2, sellingPrice: 100 }],
      }),
    );
    await invoiceActions.completeInvoicePg(created.invoiceId);

    const fd = new FormData();
    fd.set("amount", "120.0000");
    fd.set("accountId", bank.id);
    fd.set("paymentMethod", "mpesa");
    fd.set("paymentDate", "2026-08-02");
    const paid = await invoiceActions.recordInvoicePaymentPg(created.invoiceId, null, fd);
    expect(paid.success).toBe(true);

    const inv = await invoiceActions.getInvoiceDetailPg(created.invoiceId);
    // Nothing in the action updated these: the allocation trigger did (0017).
    expect(inv.amountPaid).toBe("120.0000");
    expect(inv.amountDue).toBe("80.0000");
    expect(inv.paymentStatus).toBe("partial");
  });

  it("names an over-payment rather than rounding it down to paid", async () => {
    const [bank] = await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      return tx`SELECT id FROM accounts WHERE account_code = '1200'`;
    });
    const created = await invoiceActions.createInvoicePg(
      null,
      form({
        customerId,
        invoiceDate: "2026-08-01",
        stockItems: [{ productId: widgetId, quantity: 1, sellingPrice: 100 }],
      }),
    );
    await invoiceActions.completeInvoicePg(created.invoiceId);

    const fd = new FormData();
    fd.set("amount", "100.0100");
    fd.set("accountId", bank.id);
    const result = await invoiceActions.recordInvoicePaymentPg(created.invoiceId, null, fd);

    // Deliberately ALLOWED, unlike a bill. A customer can genuinely overpay —
    // a deposit, a rounded-up transfer — so bills carry CHECK (balance >= 0)
    // and invoices do not. 0017 added the 'overpaid' state for exactly this:
    // surfacing the cent beats collapsing it to 'paid' as Mongo did.
    expect(result.success).toBe(true);

    const inv = await invoiceActions.getInvoiceDetailPg(created.invoiceId);
    expect(inv.amountPaid).toBe("100.0100");
    expect(inv.amountDue).toBe("-0.0100");
    expect(inv.paymentStatus).toBe("overpaid");
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
          stockItems: [{ productId: widgetId, quantity: 1, sellingPrice: 10 }],
        }),
    );
    const done = await invoiceActions.completeInvoicePg(created.invoiceId);
    expect(done.success).toBe(false);
    expect(done.error).toMatch(/system account not configured/i);
  });
});

suite("invoice list page queries", () => {
  // Same fixture path as above; these cover what the list page renders.
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
    mongoCompanyId = randomUUID().replace(/-/g, "").slice(0, 24);
    customerId = randomUUID();
    widgetId = randomUUID();
    const bank = randomUUID();

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
        INSERT INTO accounts (id, company_id, account_code, account_name, account_type, sub_type)
        VALUES (${bank}, ${companyUuid}, '1000', 'Equity Bank', 'asset', 'bank')
      `;
      await tx`
        INSERT INTO parties (id, company_id, primary_type, is_customer, name, email)
        VALUES (${customerId}, ${companyUuid}, 'customer', true, 'Acme Ltd', 'ap@acme.co')
      `;
      await tx`
        INSERT INTO products (id, company_id, sku, name, cost_price, selling_price, quantity_on_hand)
        VALUES (${widgetId}, ${companyUuid}, 'WID-1', 'Widget', 40, 250, 1000)
      `;
    });

    getTenantContext.mockResolvedValue({
      user: { id: randomUUID(), name: "Sales User", role: "Sales Manager" },
      companyId: mongoCompanyId,
    });

    for (const [date, qty] of [["2026-08-01", "1"], ["2026-08-05", "2"], ["2026-07-01", "3"]]) {
      await invoiceActions.createInvoicePg(
        null,
        form({
          customerId,
          invoiceDate: date,
          stockItems: [{ productId: widgetId, quantity: Number(qty), sellingPrice: 100 }],
        }),
      );
    }
  });

  it("lists newest first, with the customer joined and a total in one query", async () => {
    const r = await invoiceActions.searchInvoicesPg({});
    expect(r.total).toBe(3);
    expect(r.totalPages).toBe(1);
    expect(r.invoices).toHaveLength(3);
    expect(r.invoices[0].invoiceDate).toBe("2026-08-05");
    expect(r.invoices[0].customer.name).toBe("Acme Ltd");
    expect(r.invoices[0].customer.email).toBe("ap@acme.co");
    // Money stays a string all the way to the component.
    expect(r.invoices[0].total).toBe("200.0000");
  });

  it("filters by date range", async () => {
    const r = await invoiceActions.searchInvoicesPg({
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    expect(r.total).toBe(2);
  });

  it("filters by status and payment status", async () => {
    const drafts = await invoiceActions.searchInvoicesPg({ status: "draft" });
    expect(drafts.total).toBe(3);
    const completed = await invoiceActions.searchInvoicesPg({ status: "completed" });
    expect(completed.total).toBe(0);
    const unpaid = await invoiceActions.searchInvoicesPg({ paymentStatus: "unpaid" });
    expect(unpaid.total).toBe(3);
  });

  it("searches by invoice number and by customer name", async () => {
    const all = await invoiceActions.searchInvoicesPg({});
    const number = all.invoices[0].invoiceNumber;

    const byNumber = await invoiceActions.searchInvoicesPg({ query: number });
    expect(byNumber.total).toBe(1);

    const byCustomer = await invoiceActions.searchInvoicesPg({ query: "acme" });
    expect(byCustomer.total).toBe(3);

    const miss = await invoiceActions.searchInvoicesPg({ query: "nobody" });
    expect(miss.total).toBe(0);
    expect(miss.totalPages).toBe(1);
  });

  it("paginates", async () => {
    const p1 = await invoiceActions.searchInvoicesPg({ perPage: 2, page: 1 });
    expect(p1.invoices).toHaveLength(2);
    expect(p1.total).toBe(3);
    expect(p1.totalPages).toBe(2);
    const p2 = await invoiceActions.searchInvoicesPg({ perPage: 2, page: 2 });
    expect(p2.invoices).toHaveLength(1);
  });

  it("reports stats in the shape the cards render", async () => {
    const s = await invoiceActions.getInvoiceStatsPg({});
    expect(s.totalInvoices).toBe(3);
    expect(s.totalRevenue).toBe("600.0000");
    expect(s.totalAmountPaid).toBe("0.0000");
    expect(s.balanceDue).toBe("600.0000");
    expect(s.totalUnpaid).toBe(3);
    expect(s.totalPaid).toBe(0);
  });

  it("offers cash, bank and M-Pesa accounts to the payment dialog", async () => {
    const accts = await invoiceActions.getPaymentAccountsPg();
    expect(accts).toHaveLength(1);
    expect(accts[0].name).toBe("Equity Bank");
    expect(accts[0].subType).toBe("bank");
  });

  it("shows another tenant nothing", async () => {
    const otherUuid = randomUUID();
    const otherMongo = randomUUID().replace(/-/g, "").slice(0, 24);
    await admin`
      INSERT INTO companies (id, name, slug)
      VALUES (${otherUuid}, 'Other', ${"o-" + otherUuid.slice(0, 8)})
    `;
    await admin`
      INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
      VALUES ('companies', ${otherMongo}, ${otherUuid})
    `;
    getTenantContext.mockResolvedValue({
      user: { id: randomUUID(), name: "Other User", role: "Sales Manager" },
      companyId: otherMongo,
    });
    const r = await invoiceActions.searchInvoicesPg({});
    expect(r.total).toBe(0);
  });
});
