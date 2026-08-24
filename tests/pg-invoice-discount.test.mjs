/**
 * The header discount, reconciled against the MongoDB implementation.
 *
 * Mongo had this right and the port lost it. `CreateInvoiceForm` computes a
 * discount, shows the discounted total, and posts `discountPercentage`;
 * `invoiceDataSchema` had no such field, so it was dropped at parse and the
 * lines went through at full price. On 2 x 500 with 10% off the form showed
 * 1044.00 and the database stored 1160.00.
 *
 * The rule under test is Mongo's, from `app/models/invoice.js:767-800`:
 *
 *     discount = subtotal x pct/100
 *     factor   = (subtotal - discount) / subtotal
 *     tax      = sum(line tax) x factor      (line tax is stored PRE-discount)
 *     total    = subtotal - discount + tax
 *
 * The expected numbers below are computed by hand from that rule, not read off
 * the implementation — otherwise this only tests that the code does what it
 * does.
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

const invoicesRepo = await import("@/app/db/repositories/invoices");
const { invoiceDataSchema, toRepositoryInput } = await import(
  "@/app/db/validation/invoices"
);

suite("invoice header discount", () => {
  let admin, client, db, companyA, customer, widget;

  const asTenant = (c, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${c}, true)`);
      return fn(tx);
    });

  const totalsOf = async (invoiceId) => {
    const [r] = await admin`
      SELECT subtotal::text, discount_percentage::text, discount_total::text,
             tax_amount::text, total::text
        FROM invoices WHERE id = ${invoiceId}::uuid`;
    return r;
  };

  /** What the form posts, in its own field names. */
  const payload = (extra = {}) => ({
    customerId: customer,
    invoiceDate: "2026-08-10",
    stockItems: [
      { productId: widget, quantity: 2, sellingPrice: 500, taxRate: 16, name: "Rebar" },
    ],
    serviceItems: [],
    ...extra,
  });

  const create = async (data) => {
    const parsed = invoiceDataSchema.safeParse(data);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
    return asTenant(companyA, (tx) =>
      invoicesRepo.createInvoice(tx, {
        companyId: companyA,
        ...toRepositoryInput(parsed.data),
      }),
    );
  };

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
    customer = randomUUID();
    widget = randomUUID();
    await admin`INSERT INTO companies (id, name, slug)
      VALUES (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)})`;
    await asTenant(companyA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO parties (id, company_id, primary_type, is_customer, name)
        VALUES (${customer}::uuid, ${companyA}::uuid, 'customer', true, 'Acme Builders')`);
      await tx.execute(sql`
        INSERT INTO products (id, company_id, sku, name, cost_price, selling_price, quantity_on_hand)
        VALUES (${widget}::uuid, ${companyA}::uuid, 'RB-12', 'Rebar 12mm', 100, 500, 500)`);
      for (const [code, name, type, sys] of [
        ["1100", "AR", "asset", "accounts_receivable"],
        ["4000", "Sales", "revenue", "sales_revenue"],
        ["2200", "VAT", "liability", "vat_output"],
        ["1200", "Inventory", "asset", "inventory"],
        ["5000", "COGS", "expense", "cogs"],
      ]) {
        await tx.execute(sql`
          INSERT INTO accounts (id, company_id, account_code, account_name, account_type, can_post, system_account)
          VALUES (${randomUUID()}::uuid, ${companyA}::uuid, ${code}, ${name}, ${type}, true, ${sys})`);
      }
    });
  });

  it("stores what the form showed the user", async () => {
    // 2 x 500 = 1000 net. 16% = 160 tax, pre-discount.
    // 10% off:  discount 100, factor 0.9, tax 160 x 0.9 = 144
    //           total 1000 - 100 + 144 = 1044
    const invoice = await create(payload({ discountPercentage: 10 }));
    const t = await totalsOf(invoice.id);

    expect(Number(t.subtotal)).toBe(1000);
    expect(Number(t.discount_percentage)).toBe(10);
    expect(Number(t.discount_total)).toBe(100);
    expect(Number(t.tax_amount)).toBe(144);
    // The figure the form has been quoting all along.
    expect(Number(t.total)).toBe(1044);
  });

  it("with no discount, nothing changes", async () => {
    const invoice = await create(payload());
    const t = await totalsOf(invoice.id);
    expect(Number(t.discount_total)).toBe(0);
    expect(Number(t.tax_amount)).toBe(160);
    expect(Number(t.total)).toBe(1160);
  });

  it("scales tax proportionally, exactly — no float drift", async () => {
    // A third off is the case that breaks JavaScript. factor = 2/3, and
    // 160 x 2/3 = 106.666... Mongo rounds to 2dp per step; NUMERIC(19,4)
    // keeps 4 and the total still reconciles to subtotal - discount + tax.
    const invoice = await create(payload({ discountPercentage: 33.3333 }));
    const t = await totalsOf(invoice.id);

    const subtotal = Number(t.subtotal);
    const discount = Number(t.discount_total);
    const tax = Number(t.tax_amount);
    expect(Number(t.total)).toBeCloseTo(subtotal - discount + tax, 4);
    // 1000 x 33.3333% = 333.333
    expect(discount).toBeCloseTo(333.333, 3);
    // 160 x (1000 - 333.333)/1000
    expect(tax).toBeCloseTo(106.6667, 3);
  });

  it("a full discount zeroes the invoice without going negative", async () => {
    const invoice = await create(payload({ discountPercentage: 100 }));
    const t = await totalsOf(invoice.id);
    expect(Number(t.discount_total)).toBe(1000);
    expect(Number(t.tax_amount)).toBe(0);
    expect(Number(t.total)).toBe(0);
  });

  it("a discount over 100% is refused by the schema", async () => {
    const parsed = invoiceDataSchema.safeParse(payload({ discountPercentage: 150 }));
    expect(parsed.success).toBe(false);
  });

  it("the database refuses a discount larger than the subtotal", async () => {
    // Belt and braces under the action's cap: whoever writes the row, the
    // discount cannot exceed what is being discounted.
    await expect(
      asTenant(companyA, (tx) =>
        tx.execute(sql`
          INSERT INTO invoices
            (company_id, invoice_number, invoice_date, customer_id,
             subtotal, discount_total, total)
          VALUES (${companyA}::uuid, 'INV-X', '2026-08-10', ${customer}::uuid,
                  100, 500, 0)`),
      ),
    ).rejects.toThrow();
  });

  it("the edit form gets its discount back, so a save does not strip it", async () => {
    // EditInvoiceForm pre-fills from invoice.discountPercentage. If the read
    // path omits it the box reads 0, and the next save silently removes a
    // discount the invoice already carried.
    const invoice = await create(payload({ discountPercentage: 10 }));
    const detail = await asTenant(companyA, (tx) =>
      invoicesRepo.getInvoiceDetail(tx, invoice.id),
    );
    expect(detail.discountPercentage).toBe(10);
  });

  it("editing a draft recomputes the discount rather than keeping the old one", async () => {
    const invoice = await create(payload({ discountPercentage: 10 }));
    expect(Number((await totalsOf(invoice.id)).total)).toBe(1044);

    const parsed = invoiceDataSchema.safeParse(payload({ discountPercentage: 0 }));
    await asTenant(companyA, (tx) =>
      invoicesRepo.updateInvoice(tx, invoice.id, toRepositoryInput(parsed.data)),
    );

    const t = await totalsOf(invoice.id);
    expect(Number(t.discount_total)).toBe(0);
    expect(Number(t.total)).toBe(1160);
  });
});
