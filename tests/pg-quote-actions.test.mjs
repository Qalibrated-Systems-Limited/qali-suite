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
