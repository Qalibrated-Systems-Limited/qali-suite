/**
 * The quotes repository.
 *
 * Covers the things the port changed rather than carried: totals and
 * commission that the database maintains, a status machine instead of six
 * scattered guards, expiry that is interpreted rather than flipped, delivery as
 * a log, and — the reason quotes went first — a conversion that produces a
 * POSTGRES invoice (§9E).
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

const quotesRepo = await import("@/app/db/repositories/quotes");

suite("quotes repository", () => {
  let admin, client, db;
  let companyA, otherCompany, customer, widget;

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
    otherCompany = randomUUID();
    customer = randomUUID();
    widget = randomUUID();

    await admin`INSERT INTO companies (id, name, slug) VALUES
      (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)}),
      (${otherCompany}, 'Elsewhere', ${"e-" + otherCompany.slice(0, 8)})`;

    await asTenant(companyA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO parties (id, company_id, primary_type, is_customer, name)
        VALUES (${customer}::uuid, ${companyA}::uuid, 'customer', true, 'Acme Ltd')`);
      await tx.execute(sql`
        INSERT INTO products (id, company_id, sku, name, cost_price, selling_price, quantity_on_hand)
        VALUES (${widget}::uuid, ${companyA}::uuid, 'WID-1', 'Widget', 40, 250, 100)`);
    });
  });

  function baseInput(overrides = {}) {
    return {
      companyId: companyA,
      customerId: customer,
      customerName: "Acme Ltd",
      quoteDate: "2026-08-20",
      lines: [
        { itemType: "service", serviceCategory: "labor", description: "Install",
          quantity: "10.0000", unitPrice: "100.0000", discountPercentage: "10.0000", taxRate: "16.0000" },
      ],
      ...overrides,
    };
  }

  describe("creating", () => {
    it("numbers from the tenant's configured prefix and derives every total", async () => {
      const quote = await asTenant(companyA, (tx) => quotesRepo.createQuote(tx, baseInput()));

      // 0035's document_prefix, defaulting to QT — not a literal in the repository.
      expect(quote.quoteNumber).toMatch(/^QT/);
      // 10 x 100 = 1000, less 10% = 900, VAT 16% of 900 = 144.
      expect(quote.subtotal).toBe("900.0000");
      expect(quote.discountTotal).toBe("100.0000");
      expect(quote.taxTotal).toBe("144.0000");
      expect(quote.total).toBe("1044.0000");
      expect(quote.status).toBe("draft");
    });

    it("derives commission from the subtotal, and moves it when the lines move", async () => {
      const quote = await asTenant(companyA, (tx) =>
        quotesRepo.createQuote(tx, baseInput({ commissionRate: "5.0000" })));
      expect(quote.commissionAmount).toBe("45.0000"); // 5% of 900

      const updated = await asTenant(companyA, (tx) =>
        quotesRepo.updateQuote(tx, quote.id, {
          lines: [
            ...baseInput().lines,
            { itemType: "service", serviceCategory: "other", quantity: "1.0000",
              unitPrice: "100.0000", taxRate: "0.0000" },
          ],
        }));
      // Nothing recomputed it. The generated column followed the subtotal.
      expect(updated.subtotal).toBe("1000.0000");
      expect(updated.commissionAmount).toBe("50.0000");
    });

    it("refuses a quote with no lines", async () => {
      await expect(
        asTenant(companyA, (tx) => quotesRepo.createQuote(tx, baseInput({ lines: [] }))),
      ).rejects.toThrow(/at least one line/i);
    });
  });

  describe("status", () => {
    it("walks draft to sent to accepted", async () => {
      const q = await asTenant(companyA, (tx) => quotesRepo.createQuote(tx, baseInput()));
      const sent = await asTenant(companyA, (tx) =>
        quotesRepo.sendQuote(tx, q.id, { recipient: "buyer@acme.co" }));
      expect(sent.status).toBe("sent");
      expect(sent.sentAt).not.toBeNull();

      const accepted = await asTenant(companyA, (tx) =>
        quotesRepo.acceptQuote(tx, q.id, { acceptedByName: "Buyer" }));
      expect(accepted.status).toBe("accepted");
    });

    it("refuses a transition the machine does not allow", async () => {
      const q = await asTenant(companyA, (tx) => quotesRepo.createQuote(tx, baseInput()));
      await asTenant(companyA, (tx) => quotesRepo.cancelQuote(tx, q.id, "changed mind"));

      // Cancelled is terminal. The source guarded this in each action separately.
      await expect(
        asTenant(companyA, (tx) => quotesRepo.acceptQuote(tx, q.id)),
      ).rejects.toThrow(/cancelled quote cannot become accepted/i);
    });

    it("reads a past-validity quote as expired without anything having run", async () => {
      const q = await asTenant(companyA, (tx) =>
        quotesRepo.createQuote(tx, baseInput({ quoteDate: "2020-01-01", validUntil: "2020-02-01" })));
      await asTenant(companyA, (tx) => quotesRepo.sendQuote(tx, q.id, { recipient: "b@acme.co" }));

      const detail = await asTenant(companyA, (tx) => quotesRepo.getQuoteDetail(tx, q.id));
      // Status is still 'sent' — no job flipped it — but it reads as expired.
      expect(detail.status).toBe("sent");
      expect(detail.isExpired).toBe(true);
    });
  });

  describe("delivery", () => {
    it("keeps one row per attempt, and a failure does not move the quote on", async () => {
      const q = await asTenant(companyA, (tx) => quotesRepo.createQuote(tx, baseInput()));

      const afterFailure = await asTenant(companyA, (tx) =>
        quotesRepo.sendQuote(tx, q.id, {
          recipient: "bad@acme.co", status: "failed", error: "mailbox full",
        }));
      // Nobody received it, so it is still a draft.
      expect(afterFailure.status).toBe("draft");

      await asTenant(companyA, (tx) =>
        quotesRepo.sendQuote(tx, q.id, { recipient: "buyer@acme.co", status: "delivered" }));

      const detail = await asTenant(companyA, (tx) => quotesRepo.getQuoteDetail(tx, q.id));
      // Both attempts survive — the source overwrote the first with the second.
      expect(detail.delivery.attempts).toBe(2);
      expect(detail.delivery.lastError).toBe("mailbox full");
      expect(detail.delivery.deliveredAt).not.toBeNull();
      expect(detail.status).toBe("sent");
    });
  });

  describe("editing", () => {
    it("edits a draft and refuses a sent one", async () => {
      const q = await asTenant(companyA, (tx) => quotesRepo.createQuote(tx, baseInput()));
      const edited = await asTenant(companyA, (tx) =>
        quotesRepo.updateQuote(tx, q.id, { title: "Revised" }));
      expect(edited.title).toBe("Revised");

      await asTenant(companyA, (tx) => quotesRepo.sendQuote(tx, q.id, { recipient: "b@acme.co" }));
      await expect(
        asTenant(companyA, (tx) => quotesRepo.updateQuote(tx, q.id, { title: "Again" })),
      ).rejects.toThrow(/only a draft quote can be edited/i);
    });

    it("deletes a draft and refuses to delete a sent one", async () => {
      const q = await asTenant(companyA, (tx) => quotesRepo.createQuote(tx, baseInput()));
      await asTenant(companyA, (tx) => quotesRepo.sendQuote(tx, q.id, { recipient: "b@acme.co" }));
      await expect(
        asTenant(companyA, (tx) => quotesRepo.deleteQuote(tx, q.id)),
      ).rejects.toThrow(/cancel it instead/i);

      const draft = await asTenant(companyA, (tx) => quotesRepo.createQuote(tx, baseInput()));
      const res = await asTenant(companyA, (tx) => quotesRepo.deleteQuote(tx, draft.id));
      expect(res.deleted).toBe(true);
    });

    it("clones to a new draft with its own number", async () => {
      const q = await asTenant(companyA, (tx) => quotesRepo.createQuote(tx, baseInput()));
      const clone = await asTenant(companyA, (tx) => quotesRepo.cloneQuote(tx, q.id));
      expect(clone.id).not.toBe(q.id);
      expect(clone.quoteNumber).not.toBe(q.quoteNumber);
      expect(clone.status).toBe("draft");
      expect(clone.total).toBe(q.total);
    });
  });

  describe("converting to an invoice (§9E)", () => {
    it("creates a POSTGRES invoice and records the flow", async () => {
      const q = await asTenant(companyA, (tx) => quotesRepo.createQuote(tx, baseInput()));
      await asTenant(companyA, (tx) => quotesRepo.sendQuote(tx, q.id, { recipient: "b@acme.co" }));
      await asTenant(companyA, (tx) => quotesRepo.acceptQuote(tx, q.id));

      const { invoice } = await asTenant(companyA, (tx) =>
        quotesRepo.convertQuoteToInvoice(tx, q.id, { invoiceDate: "2026-08-21" }));

      // The row is in Postgres, which is what the invoice list reads.
      const [row] = await admin`SELECT invoice_number, customer_id FROM invoices WHERE id = ${invoice.id}`;
      expect(row.invoice_number).toMatch(/^INV/);
      expect(row.customer_id).toBe(customer);

      const flow = await admin`SELECT predecessor_type, successor_type, quantity
                                 FROM document_flow WHERE predecessor_id = ${q.id}`;
      expect(flow).toHaveLength(1);
      expect(flow[0].successor_type).toBe("invoice");

      const detail = await asTenant(companyA, (tx) => quotesRepo.getQuoteDetail(tx, q.id));
      expect(detail.status).toBe("converted");
      expect(detail.lines[0].invoicedQuantity).toBe("10.0000");
    });

    it("invoices in stages, and refuses more than is left", async () => {
      const q = await asTenant(companyA, (tx) => quotesRepo.createQuote(tx, baseInput()));
      // Sent, because a draft may not be invoiced — canConvertToInvoice.
      await asTenant(companyA, (tx) => quotesRepo.sendQuote(tx, q.id, { recipient: "b@acme.co" }));
      const lineId = (await asTenant(companyA, (tx) => quotesRepo.getQuoteDetail(tx, q.id))).lines[0].id;

      const first = await asTenant(companyA, (tx) =>
        quotesRepo.convertQuoteToInvoice(tx, q.id, {
          invoiceDate: "2026-08-21",
          selection: [{ quoteLineId: lineId, quantity: "4.0000" }],
        }));
      expect(Number(first.remaining)).toBe(6);

      // Still open, because six remain.
      let detail = await asTenant(companyA, (tx) => quotesRepo.getQuoteDetail(tx, q.id));
      // Still open, because six remain — a partial conversion does not close it.
      expect(detail.status).toBe("sent");
      expect(detail.lines[0].invoicedQuantity).toBe("4.0000");

      await expect(
        asTenant(companyA, (tx) =>
          quotesRepo.convertQuoteToInvoice(tx, q.id, {
            invoiceDate: "2026-08-21",
            selection: [{ quoteLineId: lineId, quantity: "7.0000" }],
          })),
      ).rejects.toThrow(/exceeds the 6/i);

      await asTenant(companyA, (tx) =>
        quotesRepo.convertQuoteToInvoice(tx, q.id, {
          invoiceDate: "2026-08-21",
          selection: [{ quoteLineId: lineId, quantity: "6.0000" }],
        }));
      detail = await asTenant(companyA, (tx) => quotesRepo.getQuoteDetail(tx, q.id));
      expect(detail.status).toBe("converted");

      // TWO invoices, from one quote. Partial conversion is the point: a
      // customer accepts ten and is billed for four now and six later, and both
      // invoices are real documents descended from the same quote.
      const invoices = await admin`
        SELECT i.invoice_number, i.total
          FROM document_flow f
          JOIN invoices i ON i.id = f.successor_id
         WHERE f.predecessor_id = ${q.id} AND f.successor_type = 'invoice'
         ORDER BY i.invoice_number`;
      expect(invoices).toHaveLength(2);
      // 4 and 6 of the same line, each carrying its share of the discount.
      expect(invoices.map((i) => i.total)).toEqual(["417.6000", "626.4000"]);
      // And they add up to the quote.
      const sum = invoices.reduce((t, i) => t + Number(i.total), 0);
      expect(sum.toFixed(4)).toBe(detail.total);
    });

    it("refuses to invoice a draft, and an expired one", async () => {
      const draft = await asTenant(companyA, (tx) => quotesRepo.createQuote(tx, baseInput()));
      await expect(
        asTenant(companyA, (tx) =>
          quotesRepo.convertQuoteToInvoice(tx, draft.id, { invoiceDate: "2026-08-21" })),
      ).rejects.toThrow(/send it first/i);

      const stale = await asTenant(companyA, (tx) =>
        quotesRepo.createQuote(tx, baseInput({ quoteDate: "2020-01-01", validUntil: "2020-02-01" })));
      await asTenant(companyA, (tx) => quotesRepo.sendQuote(tx, stale.id, { recipient: "b@acme.co" }));
      await expect(
        asTenant(companyA, (tx) =>
          quotesRepo.convertQuoteToInvoice(tx, stale.id, { invoiceDate: "2026-08-21" })),
      ).rejects.toThrow(/expired/i);
    });

    it("refuses to cancel a quote that has invoices against it", async () => {
      const q = await asTenant(companyA, (tx) => quotesRepo.createQuote(tx, baseInput()));
      await asTenant(companyA, (tx) => quotesRepo.sendQuote(tx, q.id, { recipient: "b@acme.co" }));
      const lineId = (await asTenant(companyA, (tx) => quotesRepo.getQuoteDetail(tx, q.id))).lines[0].id;

      // Part-invoice it, so the quote is still open but has produced something.
      await asTenant(companyA, (tx) =>
        quotesRepo.convertQuoteToInvoice(tx, q.id, {
          invoiceDate: "2026-08-21",
          selection: [{ quoteLineId: lineId, quantity: "4.0000" }],
        }));

      // The source's canCancel: no cancelling once invoices exist, or they
      // would descend from a cancelled document.
      await expect(
        asTenant(companyA, (tx) => quotesRepo.cancelQuote(tx, q.id, "changed mind")),
      ).rejects.toThrow(/invoice\(s\) against it/i);

      // A quote that produced nothing still cancels.
      const clean = await asTenant(companyA, (tx) => quotesRepo.createQuote(tx, baseInput()));
      const cancelled = await asTenant(companyA, (tx) => quotesRepo.cancelQuote(tx, clean.id));
      expect(cancelled.status).toBe("cancelled");
    });

    it("refuses to invoice a cancelled quote", async () => {
      const q = await asTenant(companyA, (tx) => quotesRepo.createQuote(tx, baseInput()));
      await asTenant(companyA, (tx) => quotesRepo.cancelQuote(tx, q.id));
      await expect(
        asTenant(companyA, (tx) =>
          quotesRepo.convertQuoteToInvoice(tx, q.id, { invoiceDate: "2026-08-21" })),
      ).rejects.toThrow(/cancelled quote cannot be invoiced/i);
    });
  });

  /**
   * The shape the screens actually read.
   *
   * This is the layer the quotes port stopped short of: the repository and its
   * actions landed and nothing was pointed at them, so the screens kept
   * writing to Mongo while the list page counted Postgres. These assertions
   * are against the field names the detail page, the update form and the PDF
   * dereference — if one drifts, the page renders blank rather than failing.
   */
  describe("the shape the pages render", () => {
    it("gives the detail page every field it dereferences", async () => {
      const quote = await asTenant(companyA, (tx) =>
        quotesRepo.createQuote(tx, baseInput({
          title: "Fit-out",
          terms: "30 days",
          notes: "Deliver to gate 2",
          commissionRate: "5.0000",
          salespersonPartyId: null,
        })));

      const shaped = await asTenant(companyA, (tx) =>
        quotesRepo.getQuoteForDisplay(tx, quote.id));

      // `_id` alongside `id`: every component passes `quote._id` into the
      // actions and the PDF button.
      expect(shaped._id).toBe(quote.id);
      expect(shaped.quoteNumber).toBe(quote.quoteNumber);
      expect(shaped.termsAndConditions).toBe("30 days");

      // The page reads quote.customer.*, not quote.customerName.
      expect(shaped.customer.name).toBe("Acme Ltd");
      expect(shaped.customer.partyId).toBe(customer);

      // ...and quote.items[], not quote.lines[].
      expect(shaped.items).toHaveLength(1);
      expect(shaped.items[0].description).toBe("Install");

      // Totals are numbers here; the page formats them with formatCurrency.
      expect(shaped.subtotal).toBe(900);
      expect(shaped.taxAmount).toBe(144);
      expect(shaped.total).toBe(1044);
      expect(shaped.totalDiscount).toBe(100);
    });

    it("carries the product snapshot the duplicate form reads", async () => {
      const quote = await asTenant(companyA, (tx) =>
        quotesRepo.createQuote(tx, baseInput({
          lines: [{
            itemType: "product", productId: widget,
            productName: "Widget", productSku: "WID-1",
            description: "Widget", quantity: "2.0000",
            unitPrice: "250.0000", taxRate: "16.0000",
          }],
        })));

      const shaped = await asTenant(companyA, (tx) =>
        quotesRepo.getQuoteForDisplay(tx, quote.id));

      // initStockItems() matches on item.product.id and reads .name and .sku.
      expect(shaped.items[0].product).toEqual({
        id: widget, _id: widget, name: "Widget", sku: "WID-1",
      });
    });

    it("leaves product null on a service line rather than an empty object", async () => {
      const quote = await asTenant(companyA, (tx) =>
        quotesRepo.createQuote(tx, baseInput()));
      const shaped = await asTenant(companyA, (tx) =>
        quotesRepo.getQuoteForDisplay(tx, quote.id));

      // The form filters on itemType, but the PDF reads item.product?.name —
      // an empty object would print an empty cell instead of the description.
      expect(shaped.items[0].product).toBeNull();
      expect(shaped.items[0].itemType).toBe("service");
    });

    it("reports commission as rate and amount, both derived", async () => {
      const quote = await asTenant(companyA, (tx) =>
        quotesRepo.createQuote(tx, baseInput({ commissionRate: "5.0000" })));
      const shaped = await asTenant(companyA, (tx) =>
        quotesRepo.getQuoteForDisplay(tx, quote.id));

      // The page reads salesPerson.commission.rate — null when nobody is named,
      // which is the case the optional chain in the markup covers.
      expect(shaped.salesPerson).toBeNull();

      const withRep = await asTenant(companyA, (tx) =>
        quotesRepo.updateQuote(tx, quote.id, {
          salespersonPartyId: customer,
          salespersonName: "Rep",
        }));
      const shapedRep = await asTenant(companyA, (tx) =>
        quotesRepo.getQuoteForDisplay(tx, withRep.id));
      expect(shapedRep.salesPerson.commission.rate).toBe(5);
      expect(shapedRep.salesPerson.commission.amount).toBe(45);
    });

    it("returns null for a quote that is not this tenant's", async () => {
      const quote = await asTenant(companyA, (tx) =>
        quotesRepo.createQuote(tx, baseInput()));
      const shaped = await asTenant(otherCompany, (tx) =>
        quotesRepo.getQuoteForDisplay(tx, quote.id));
      expect(shaped).toBeNull();
    });
  });

  describe("tenant isolation", () => {
    it("shows a tenant only its own quotes, with nothing filtering them", async () => {
      await asTenant(companyA, (tx) => quotesRepo.createQuote(tx, baseInput()));

      const otherCustomer = randomUUID();
      await asTenant(otherCompany, async (tx) => {
        await tx.execute(sql`
          INSERT INTO parties (id, company_id, primary_type, is_customer, name)
          VALUES (${otherCustomer}::uuid, ${otherCompany}::uuid, 'customer', true, 'Not Yours')`);
        await quotesRepo.createQuote(tx, {
          ...baseInput(), companyId: otherCompany, customerId: otherCustomer, customerName: "Not Yours",
        });
      });

      // listQuotes has no companyId argument. The policy is the filter.
      const mine = await asTenant(companyA, (tx) => quotesRepo.listQuotes(tx, {}));
      expect(mine).toHaveLength(1);
      expect(mine[0].customerName).toBe("Acme Ltd");
    });
  });
});
