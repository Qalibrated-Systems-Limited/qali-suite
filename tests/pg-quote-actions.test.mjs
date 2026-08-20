/**
 * The quote write path, end to end through the server action.
 *
 * The layer above the repository — session to tenant, ROLE GATE, shape
 * validation, and the conversion that produces a Postgres invoice (§9E).
 *
 * The role gate is the part worth testing hardest: the Mongo actions had none
 * at all, so any signed-in user could raise a quote, accept it on the
 * customer's behalf, or turn it into an invoice.
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
const quoteActions = await import("@/app/db/actions/quote-actions");

/** The form posts one JSON blob under `data`, with a flat items array. */
function form({ customerId, quoteDate = "2026-08-20", validUntil, items = [], ...rest }) {
  const fd = new FormData();
  fd.set("data", JSON.stringify({ customerId, quoteDate, validUntil, items, ...rest }));
  fd.set("customerName", "Acme Ltd");
  return fd;
}

suite("quote actions (end to end)", () => {
  let admin;
  let companyUuid, mongoCompanyId, customerId, widgetId;

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await admin`TRUNCATE companies CASCADE`;
    await admin`TRUNCATE _migration_id_map, entry_counters`;

    companyUuid = randomUUID();
    mongoCompanyId = randomUUID().replace(/-/g, "").slice(0, 24);
    customerId = randomUUID();
    widgetId = randomUUID();

    await admin`INSERT INTO companies (id, name, slug)
                VALUES (${companyUuid}, 'Pilot', ${"p-" + companyUuid.slice(0, 8)})`;
    await admin`INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
                VALUES ('companies', ${mongoCompanyId}, ${companyUuid})`;
    await admin.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${companyUuid}, true)`;
      await tx`INSERT INTO parties (id, company_id, primary_type, is_customer, name)
               VALUES (${customerId}, ${companyUuid}, 'customer', true, 'Acme Ltd')`;
      await tx`INSERT INTO products (id, company_id, sku, name, cost_price, selling_price, quantity_on_hand)
               VALUES (${widgetId}, ${companyUuid}, 'WID-1', 'Widget', 40, 250, 100)`;
      await tx`INSERT INTO accounts (id, company_id, account_code, account_name, account_type, system_account) VALUES
               (${randomUUID()}, ${companyUuid}, '1200', 'AR',    'asset',   'accounts_receivable'),
               (${randomUUID()}, ${companyUuid}, '4000', 'Sales', 'revenue', 'sales_revenue')`;
    });

    asRole("Sales Manager");
  });

  function asRole(role) {
    getTenantContext.mockResolvedValue({
      user: { id: randomUUID(), name: "A User", role },
      companyId: mongoCompanyId,
    });
  }

  const serviceItem = {
    itemType: "service",
    serviceCategory: "labor",
    description: "Install",
    quantity: 10,
    unitPrice: 100,
    discountPercentage: 10,
    taxRate: 16,
  };

  async function createSent() {
    const created = await quoteActions.createQuotePg(null, form({ customerId, items: [serviceItem] }));
    await quoteActions.sendQuotePg(created.quoteId, { recipient: "buyer@acme.co" });
    return created;
  }

  it("creates a quote from the form's payload, with the database owning the money", async () => {
    const res = await quoteActions.createQuotePg(
      null,
      form({ customerId, items: [serviceItem], commissionRate: 5 }),
    );
    expect(res.success).toBe(true);
    expect(res.quoteNumber).toMatch(/^QT/);

    const [row] = await admin`SELECT subtotal, tax_total, total, commission_amount, status
                                FROM quotes WHERE id = ${res.quoteId}`;
    expect(row.subtotal).toBe("900.0000");
    expect(row.tax_total).toBe("144.0000");
    expect(row.total).toBe("1044.0000");
    expect(row.commission_amount).toBe("45.0000");
    expect(row.status).toBe("draft");
  });

  it("refuses a payload the schema rejects, with errors on the fields", async () => {
    const res = await quoteActions.createQuotePg(null, form({ customerId, items: [] }));
    expect(res.success).toBe(false);
    expect(res.fieldErrors?.items).toBeTruthy();
  });

  it("refuses a product line that names no product", async () => {
    const res = await quoteActions.createQuotePg(
      null,
      form({ customerId, items: [{ itemType: "product", quantity: 1, unitPrice: 10 }] }),
    );
    expect(res.success).toBe(false);
  });

  describe("the role gate the Mongo actions did not have", () => {
    it("lets a Sales Manager raise and convert a quote", async () => {
      asRole("Sales Manager");
      const created = await createSent();
      expect(created.success).toBe(true);

      const converted = await quoteActions.convertQuoteToInvoicePg(created.quoteId, {
        invoiceDate: "2026-08-21",
      });
      expect(converted.success).toBe(true);
      expect(converted.invoiceId).toBeTruthy();
    });

    it("refuses a Storekeeper", async () => {
      asRole("Storekeeper");
      const res = await quoteActions.createQuotePg(null, form({ customerId, items: [serviceItem] }));
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/permission/i);
    });

    it("refuses an Employee to convert somebody else's quote", async () => {
      asRole("Sales Manager");
      const created = await createSent();

      asRole("Employee");
      const res = await quoteActions.convertQuoteToInvoicePg(created.quoteId, {
        invoiceDate: "2026-08-21",
      });
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/permission/i);
    });
  });

  describe("converting (§9E)", () => {
    it("produces an invoice in POSTGRES, which is what the invoice pages read", async () => {
      const created = await createSent();
      const res = await quoteActions.convertQuoteToInvoicePg(created.quoteId, {
        invoiceDate: "2026-08-21",
      });
      expect(res.success).toBe(true);

      // The row exists in Postgres under the id the action returned — the Mongo
      // path returned a Mongo _id to a Postgres-backed page.
      const [inv] = await admin`SELECT invoice_number, total FROM invoices WHERE id = ${res.invoiceId}`;
      expect(inv.invoice_number).toMatch(/^INV/);
      expect(inv.total).toBe("1044.0000");

      const [q] = await admin`SELECT status FROM quotes WHERE id = ${created.quoteId}`;
      expect(q.status).toBe("converted");
    });

    it("carries the line discount, prorated, when only part is invoiced", async () => {
      const created = await createSent();
      const [line] = await admin`SELECT id FROM quote_lines WHERE quote_id = ${created.quoteId}`;

      // 4 of 10 at 100 with 10% off: gross 400, discount 40, VAT 16% of 360 =
      // 57.60, total 417.60. Dropping the discount would give 464.
      const res = await quoteActions.convertQuoteToInvoicePg(created.quoteId, {
        invoiceDate: "2026-08-21",
        selection: [{ quoteLineId: line.id, quantity: "4.0000" }],
      });
      const [inv] = await admin`SELECT total FROM invoices WHERE id = ${res.invoiceId}`;
      expect(inv.total).toBe("417.6000");
    });

    it("says what is left when only part is invoiced", async () => {
      const created = await createSent();
      const [line] = await admin`SELECT id FROM quote_lines WHERE quote_id = ${created.quoteId}`;

      const res = await quoteActions.convertQuoteToInvoicePg(created.quoteId, {
        invoiceDate: "2026-08-21",
        selection: [{ quoteLineId: line.id, quantity: "4.0000" }],
      });
      expect(res.success).toBe(true);
      expect(res.message).toMatch(/still to invoice/i);

      const [q] = await admin`SELECT status FROM quotes WHERE id = ${created.quoteId}`;
      expect(q.status).toBe("sent");
    });

    it("explains, rather than throws, when the quote is a draft", async () => {
      const created = await quoteActions.createQuotePg(
        null,
        form({ customerId, items: [serviceItem] }),
      );
      const res = await quoteActions.convertQuoteToInvoicePg(created.quoteId, {
        invoiceDate: "2026-08-21",
      });
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/send it first/i);
    });
  });

  describe("who sees which quotes", () => {
    it("shows a rep only their own, and a Sales Manager everyone's", async () => {
      // Two quotes, raised by two different people.
      asRole("Sales Manager");
      const mine = await quoteActions.createQuotePg(null, form({ customerId, items: [serviceItem] }));
      const repId = randomUUID();
      getTenantContext.mockResolvedValue({
        user: { id: repId, name: "Rep", role: "Sales Manager" },
        companyId: mongoCompanyId,
      });
      const theirs = await quoteActions.createQuotePg(null, form({ customerId, items: [serviceItem] }));
      expect(theirs.success).toBe(true);

      // A Sales Manager may write invoices, so they see the floor's.
      const all = await quoteActions.searchQuotesPg({});
      expect(all.total).toBe(2);

      // An Employee is outside INVOICE_WRITE_ROLES, so the list narrows to
      // their own — and they raised none.
      getTenantContext.mockResolvedValue({
        user: { id: randomUUID(), name: "Someone", role: "Employee" },
        companyId: mongoCompanyId,
      });
      const employeeView = await quoteActions.searchQuotesPg({});
      expect(employeeView.total).toBe(0);

      // The rep who raised one sees exactly that one.
      getTenantContext.mockResolvedValue({
        user: { id: repId, name: "Rep", role: "Employee" },
        companyId: mongoCompanyId,
      });
      const repView = await quoteActions.searchQuotesPg({});
      expect(repView.total).toBe(1);
      expect(repView.rows[0].id).toBe(theirs.quoteId);
      expect(mine.quoteId).not.toBe(theirs.quoteId);
    });

    it("searches by number and by customer, and pages", async () => {
      asRole("Sales Manager");
      const a = await quoteActions.createQuotePg(null, form({ customerId, items: [serviceItem] }));
      await quoteActions.createQuotePg(null, form({ customerId, items: [serviceItem] }));

      const [row] = await admin`SELECT quote_number FROM quotes WHERE id = ${a.quoteId}`;
      const byNumber = await quoteActions.searchQuotesPg({ query: row.quote_number });
      expect(byNumber.total).toBe(1);

      const byCustomer = await quoteActions.searchQuotesPg({ query: "Acme" });
      expect(byCustomer.total).toBe(2);

      const paged = await quoteActions.searchQuotesPg({ page: 1 });
      expect(paged.pages).toBe(1);
      expect(paged.rows).toHaveLength(2);
    });

    it("lists only quotes with something left to invoice", async () => {
      asRole("Sales Manager");
      const created = await createSent();
      let available = await quoteActions.getQuotesWithAvailableItemsPg(customerId);
      expect(available).toHaveLength(1);
      expect(available[0].remaining).toBe("10.0000");

      await quoteActions.convertQuoteToInvoicePg(created.quoteId, { invoiceDate: "2026-08-21" });
      available = await quoteActions.getQuotesWithAvailableItemsPg(customerId);
      expect(available).toHaveLength(0);
    });
  });

  describe("the form's pickers", () => {
    it("offers only the acting company's customers, even to a SuperAdmin", async () => {
      // A second tenant with a customer of its own.
      const otherCompany = randomUUID();
      const otherCustomer = randomUUID();
      await admin`INSERT INTO companies (id, name, slug)
                  VALUES (${otherCompany}, 'Elsewhere', ${"e-" + otherCompany.slice(0, 8)})`;
      await admin.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${otherCompany}, true)`;
        await tx`INSERT INTO parties (id, company_id, primary_type, is_customer, name)
                 VALUES (${otherCustomer}, ${otherCompany}, 'customer', true, 'Not Yours Ltd')`;
      });

      // Platform staff, acting in the pilot company.
      getTenantContext.mockResolvedValue({
        user: { id: randomUUID(), name: "Platform", role: "SuperAdmin" },
        companyId: mongoCompanyId,
        isSuperAdmin: true,
      });

      const { customers } = await quoteActions.getQuoteFormData();
      const names = customers.map((c) => c.name);

      // The Mongo picker read through withTenantScope, which returns the query
      // UNSCOPED for a SuperAdmin — this listed both.
      expect(names).toContain("Acme Ltd");
      expect(names).not.toContain("Not Yours Ltd");
      expect(customers.every((c) => c._id !== otherCustomer)).toBe(true);
    });
  });

  it("records a failed send as an attempt and leaves the quote a draft", async () => {
    const created = await quoteActions.createQuotePg(
      null,
      form({ customerId, items: [serviceItem] }),
    );
    const res = await quoteActions.sendQuotePg(created.quoteId, {
      recipient: "bad@acme.co",
      status: "failed",
      error: "mailbox full",
    });
    expect(res.success).toBe(true);
    expect(res.message).toMatch(/delivery failed/i);

    const [q] = await admin`SELECT status FROM quotes WHERE id = ${created.quoteId}`;
    expect(q.status).toBe("draft");
    const rows = await admin`SELECT error FROM document_deliveries WHERE document_id = ${created.quoteId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].error).toBe("mailbox full");
  });
});
