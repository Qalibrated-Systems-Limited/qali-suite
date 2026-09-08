/**
 * The order between the quote and the bill — 0098.
 *
 * `lib/unported-modules.js` had this module switched OFF, the only feature in
 * the app that was deliberately dark. Four failures were listed, one loud and
 * three quiet: an ObjectId check on a uuid, a read of the Mongo Quote
 * collection, a stock commitment against Mongo Product counters, and an
 * `Invoice.create` that wrote a Mongo invoice while every invoice screen read
 * Postgres.
 *
 * What is asserted here is mostly not the transcription. It is the three
 * things the Postgres shape does differently and the reasons they had to:
 * lineage through `document_flow` rather than two ref columns, a reservation
 * that IS the status rather than a flag beside it, and a conversion that must
 * release before it commits or a non-deferred CHECK fires on the last unit.
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

const { userMessage } = await import("@/app/db/errors");
const orders = await import("@/app/db/repositories/salesOrders");
const quotesRepo = await import("@/app/db/repositories/quotes");
const invoicesRepo = await import("@/app/db/repositories/invoices");

const failsWith = async (fn, pattern) => {
  const err = await fn().then(
    () => {
      throw new Error("expected a rejection");
    },
    (e) => e,
  );
  expect(userMessage(err)).toMatch(pattern);
};

suite("the order between the quote and the bill", () => {
  let admin, client, db;
  let companyA, companyB, customer, rep, widget, gadget;
  const actor = { id: null, name: "The Rep" };
  const TODAY = "2026-04-15";

  const asTenant = (companyId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });
  const inA = (fn) => asTenant(companyA, fn);

  /** Stock on hand for a product, and what is reserved against it. */
  const stock = (productId) =>
    inA(async (tx) => {
      const [r] = await tx.execute(sql`
        SELECT quantity_on_hand::float8 AS on_hand,
               quantity_committed::float8 AS committed,
               quantity_available::float8 AS available
          FROM products WHERE id = ${productId}::uuid`);
      return r;
    });

  /** A sent quote, ready to become an order. */
  const sentQuote = (over = {}) =>
    inA(async (tx) => {
      const q = await quotesRepo.createQuote(tx, {
        companyId: companyA,
        customerId: customer,
        customerName: "Kerra Ltd",
        quoteDate: TODAY,
        validUntil: "2026-12-31",
        salespersonPartyId: over.salespersonPartyId ?? rep,
        salespersonName: over.salespersonName ?? "Achieng Odhiambo",
        lines: over.lines ?? [
          {
            itemType: "product",
            productId: widget,
            productName: "Widget",
            productSku: "WID-1",
            description: "Widget",
            quantity: "10.0000",
            unitPrice: "1000.0000",
            discountPercentage: "10.0000",
            taxRate: "16.0000",
          },
        ],
        createdByName: "Seed",
      });
      if (over.status === "draft") return q;
      await quotesRepo.sendQuote(tx, q.id, { recipient: "buyer@kerra.test" });
      if (over.status === "accepted") await quotesRepo.acceptQuote(tx, q.id);
      return (await quotesRepo.getQuote(tx, q.id));
    });

  const order = async (over = {}) => {
    const q = over.quote ?? (await sentQuote(over));
    return inA((tx) => orders.createFromQuote(tx, q.id, actor));
  };

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    client = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, {
      max: 1,
      onnotice: () => {},
    });
    db = drizzle(client);
  });
  afterAll(async () => {
    if (client) await client.end();
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies, users, _migration_id_map, entry_counters CASCADE`;

    companyA = randomUUID();
    companyB = randomUUID();
    customer = randomUUID();
    rep = randomUUID();
    widget = randomUUID();
    gadget = randomUUID();

    await admin`INSERT INTO companies (id, name, slug) VALUES
      (${companyA}, 'Pilot', ${"p-" + companyA.slice(0, 8)}),
      (${companyB}, 'Rival', ${"r-" + companyB.slice(0, 8)})`;

    await asTenant(companyA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO parties (id, company_id, primary_type, is_customer, name)
        VALUES (${customer}, ${companyA}, 'customer', true, 'Kerra Ltd')`);
      await tx.execute(sql`
        INSERT INTO parties (id, company_id, primary_type, is_employee, name)
        VALUES (${rep}, ${companyA}, 'employee', true, 'Achieng Odhiambo')`);
      await tx.execute(sql`
        INSERT INTO products (id, company_id, name, sku, quantity_on_hand,
                              selling_price, cost_price)
        VALUES (${widget}, ${companyA}, 'Widget', 'WID-1', 100, 1000, 600),
               (${gadget}, ${companyA}, 'Gadget', 'GAD-1', 3,   500,  300)`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("a quote becomes a draft order", () => {
    it("numbers it from the tenant's configured prefix, not upper(kind)", async () => {
      // document_prefix() falls through to upper(p_kind) for a kind it does
      // not know, so 'sales_order' would have produced SALES_ORDER-00001.
      const so = await order();
      expect(so.orderNumber).toBe("SO-00001");
    });

    it("honours a company that chose its own prefix", async () => {
      // INSERT rather than UPDATE: a company created straight into the table
      // has no settings row, and an UPDATE that matched nothing would have
      // left the default in place and passed for the wrong reason.
      const [settings] = await admin`
        INSERT INTO company_settings (company_id, sales_order_prefix)
        VALUES (${companyA}, 'ORD')
        ON CONFLICT (company_id) DO UPDATE SET sales_order_prefix = 'ORD'
        RETURNING sales_order_prefix`;
      expect(settings.sales_order_prefix).toBe("ORD");

      const so = await order();
      expect(so.orderNumber).toBe("ORD-00001");
    });

    it("carries the customer, the lines and the money across unchanged", async () => {
      const so = await order();
      expect(so.customer.name).toBe("Kerra Ltd");
      expect(so.items).toHaveLength(1);
      // 10 x 1000 = 10,000; less 10% = 9,000; plus 16% VAT = 10,440.
      expect(so.subtotal).toBe(9000);
      expect(so.totalDiscount).toBe(1000);
      expect(so.taxAmount).toBe(1440);
      expect(so.total).toBe(10440);
    });

    it("re-derives the amounts rather than copying them", async () => {
      // The percentage crosses, not the amount: the order's own generated
      // columns compute it with the identical expression, so a JavaScript
      // round in between cannot change a total. Assert the order and the
      // quote agree to the cent.
      const q = await sentQuote();
      const so = await inA((tx) => orders.createFromQuote(tx, q.id, actor));
      const quote = await inA((tx) => quotesRepo.getQuote(tx, q.id));
      expect(so.total).toBe(Number(quote.total));
      expect(so.subtotal).toBe(Number(quote.subtotal));
    });

    it("carries WHO SOLD IT, so the chain does not drop the rep", async () => {
      const so = await order();
      expect(so.salesPerson).toEqual({ name: "Achieng Odhiambo" });
    });

    it("starts as a draft and reserves NOTHING", async () => {
      const so = await order();
      expect(so.status).toBe("draft");
      const s = await stock(widget);
      expect(s.committed).toBe(0);
      expect(s.available).toBe(100);
      expect(so.items[0].stockCommitted).toBe(false);
    });

    it("refuses a draft quote — send it first", async () => {
      const q = await sentQuote({ status: "draft" });
      await failsWith(
        () => inA((tx) => orders.createFromQuote(tx, q.id, actor)),
        /draft quote cannot become an order/i,
      );
    });

    it("refuses a second open order for the same quote", async () => {
      const q = await sentQuote();
      const first = await inA((tx) => orders.createFromQuote(tx, q.id, actor));
      await failsWith(
        () => inA((tx) => orders.createFromQuote(tx, q.id, actor)),
        new RegExp(`${first.orderNumber} is already open`, "i"),
      );
    });

    it("allows a new order once the first was cancelled", async () => {
      const q = await sentQuote();
      const first = await inA((tx) => orders.createFromQuote(tx, q.id, actor));
      await inA((tx) => orders.cancelSalesOrder(tx, first._id, "wrong spec", actor));
      const second = await inA((tx) => orders.createFromQuote(tx, q.id, actor));
      expect(second._id).not.toBe(first._id);
    });

    it("treats an id a uuid column cannot hold as not found", async () => {
      expect(await inA((tx) => orders.getSalesOrder(tx, "6a3ba4ae0f569c9f3d9a907f"))).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the lineage is document_flow, not two ref columns", () => {
    it("shows the quote it came from, read back through the flow", async () => {
      const q = await sentQuote();
      const so = await inA((tx) => orders.createFromQuote(tx, q.id, actor));
      expect(so.quoteRef).toEqual({
        quoteId: q.id,
        quoteNumber: q.quoteNumber,
      });
      expect(so.invoiceRef).toBeNull();
    });

    it("shows the invoice it became, once it becomes one", async () => {
      const so = await order();
      await inA((tx) => orders.confirmSalesOrder(tx, so._id, actor));
      const { invoiceId, invoiceNumber } = await inA((tx) =>
        orders.convertToInvoice(tx, so._id, { actorName: "The Rep" }),
      );
      const read = await inA((tx) => orders.getSalesOrder(tx, so._id));
      expect(read.invoiceRef).toEqual({ invoiceId, invoiceNumber });
    });

    it("carries the same refs on the list, not just the detail", async () => {
      const q = await sentQuote();
      await inA((tx) => orders.createFromQuote(tx, q.id, actor));
      const [row] = await inA((tx) => orders.listSalesOrders(tx));
      expect(row.quoteRef.quoteNumber).toBe(q.quoteNumber);
      expect(row.itemCount).toBe(1);
    });

    it("lets quote_line_invoiced follow the LONGER chain, unchanged", async () => {
      // 0041 wrote that view RECURSIVE for exactly this: quote line → invoice
      // line becomes quote line → ORDER line → invoice line, and the view was
      // never touched by 0098. Nothing has been invoiced while the order sits
      // in the middle.
      const q = await sentQuote();
      const so = await inA((tx) => orders.createFromQuote(tx, q.id, actor));

      const before = await inA(async (tx) => {
        const [r] = await tx.execute(sql`
          SELECT COALESCE(SUM(invoiced_quantity), 0)::float8 AS qty
            FROM quote_line_invoiced WHERE quote_id = ${q.id}::uuid`);
        return r.qty;
      });
      expect(before).toBe(0);

      await inA((tx) => orders.confirmSalesOrder(tx, so._id, actor));
      await inA((tx) => orders.convertToInvoice(tx, so._id, {}));

      const after = await inA(async (tx) => {
        const [r] = await tx.execute(sql`
          SELECT COALESCE(SUM(invoiced_quantity), 0)::float8 AS qty
            FROM quote_line_invoiced WHERE quote_id = ${q.id}::uuid`);
        return r.qty;
      });
      expect(after).toBe(10);
    });

    it("marks the upstream quote converted once the chain reaches an invoice", async () => {
      // Without this step a quote that went the long way round would sit at
      // 'sent' for ever with a real invoice against it.
      const q = await sentQuote();
      const so = await inA((tx) => orders.createFromQuote(tx, q.id, actor));
      await inA((tx) => orders.confirmSalesOrder(tx, so._id, actor));
      await inA((tx) => orders.convertToInvoice(tx, so._id, {}));

      const quote = await inA((tx) => quotesRepo.getQuote(tx, q.id));
      expect(quote.status).toBe("converted");
      expect(quote.convertedAt).toBeTruthy();
    });

    it("lists the orders raised against one quote", async () => {
      const q = await sentQuote();
      const so = await inA((tx) => orders.createFromQuote(tx, q.id, actor));
      const list = await inA((tx) => orders.listOrdersForQuote(tx, q.id));
      expect(list).toHaveLength(1);
      expect(list[0].orderNumber).toBe(so.orderNumber);
      expect(list[0].total).toBe(10440);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("confirming reserves the stock", () => {
    it("commits every product line and leaves the physical count alone", async () => {
      const so = await order();
      await inA((tx) => orders.confirmSalesOrder(tx, so._id, actor));

      const s = await stock(widget);
      expect(s.on_hand).toBe(100);
      expect(s.committed).toBe(10);
      expect(s.available).toBe(90);
    });

    it("reports the reservation on the line, derived from the status", async () => {
      const so = await order();
      await inA((tx) => orders.confirmSalesOrder(tx, so._id, actor));
      const read = await inA((tx) => orders.getSalesOrder(tx, so._id));
      expect(read.items[0].stockCommitted).toBe(true);
      expect(read.status).toBe("confirmed");
      expect(read.confirmedAt).toBeTruthy();
    });

    it("reserves nothing for a service line", async () => {
      const q = await sentQuote({
        lines: [
          {
            itemType: "service",
            serviceCategory: "installation",
            description: "Install",
            quantity: "1.0000",
            unitPrice: "5000.0000",
            taxRate: "16.0000",
          },
        ],
      });
      const so = await inA((tx) => orders.createFromQuote(tx, q.id, actor));
      await inA((tx) => orders.confirmSalesOrder(tx, so._id, actor));
      const read = await inA((tx) => orders.getSalesOrder(tx, so._id));
      expect(read.items[0].stockCommitted).toBe(false);
    });

    it("refuses when there is not enough, and names the product and the shortfall", async () => {
      const q = await sentQuote({
        lines: [
          {
            itemType: "product",
            productId: gadget,
            productName: "Gadget",
            description: "Gadget",
            quantity: "5.0000",
            unitPrice: "500.0000",
          },
        ],
      });
      const so = await inA((tx) => orders.createFromQuote(tx, q.id, actor));
      await failsWith(
        () => inA((tx) => orders.confirmSalesOrder(tx, so._id, actor)),
        /Not enough Gadget in stock\. Available: 3, required: 5/i,
      );
    });

    it("commits NOTHING when one line of several cannot be met", async () => {
      // All or nothing: a half-reserved order is a reservation nobody can
      // reason about. The transaction is what makes it so.
      const q = await sentQuote({
        lines: [
          {
            itemType: "product",
            productId: widget,
            productName: "Widget",
            description: "Widget",
            quantity: "5.0000",
            unitPrice: "1000.0000",
          },
          {
            itemType: "product",
            productId: gadget,
            productName: "Gadget",
            description: "Gadget",
            quantity: "99.0000",
            unitPrice: "500.0000",
          },
        ],
      });
      const so = await inA((tx) => orders.createFromQuote(tx, q.id, actor));
      await failsWith(
        () => inA((tx) => orders.confirmSalesOrder(tx, so._id, actor)),
        /Not enough Gadget/i,
      );
      expect((await stock(widget)).committed).toBe(0);
      expect((await stock(gadget)).committed).toBe(0);
    });

    it("refuses to confirm an order that is already confirmed", async () => {
      const so = await order();
      await inA((tx) => orders.confirmSalesOrder(tx, so._id, actor));
      await failsWith(
        () => inA((tx) => orders.confirmSalesOrder(tx, so._id, actor)),
        /already confirmed/i,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("cancelling releases whatever is held", () => {
    it("releases a confirmed order's reservation", async () => {
      const so = await order();
      await inA((tx) => orders.confirmSalesOrder(tx, so._id, actor));
      expect((await stock(widget)).committed).toBe(10);

      await inA((tx) => orders.cancelSalesOrder(tx, so._id, "customer changed their mind", actor));
      const s = await stock(widget);
      expect(s.committed).toBe(0);
      expect(s.available).toBe(100);
    });

    it("releases nothing for a draft, which held nothing", async () => {
      const so = await order();
      await inA((tx) => orders.cancelSalesOrder(tx, so._id, null, actor));
      expect((await stock(widget)).committed).toBe(0);
      const read = await inA((tx) => orders.getSalesOrder(tx, so._id));
      expect(read.status).toBe("cancelled");
      expect(read.items[0].stockCommitted).toBe(false);
    });

    it("keeps the reason, and refuses to cancel an invoiced order", async () => {
      const so = await order();
      await inA((tx) => orders.confirmSalesOrder(tx, so._id, actor));
      await inA((tx) => orders.convertToInvoice(tx, so._id, {}));
      await failsWith(
        () => inA((tx) => orders.cancelSalesOrder(tx, so._id, "too late", actor)),
        /already invoiced/i,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("conversion releases before it commits", () => {
    it("hands the reservation over with no net change to the stock", async () => {
      const so = await order();
      await inA((tx) => orders.confirmSalesOrder(tx, so._id, actor));
      await inA((tx) => orders.convertToInvoice(tx, so._id, {}));

      // The invoice holds it now — the count is the same, the owner is not.
      const s = await stock(widget);
      expect(s.committed).toBe(10);
      expect(s.on_hand).toBe(100);

      const read = await inA((tx) => orders.getSalesOrder(tx, so._id));
      expect(read.status).toBe("invoiced");
      expect(read.items[0].stockCommitted).toBe(false);
      expect(read.items[0].invoicedQuantity).toBe(10);
    });

    it("SURVIVES a product committed to its very last unit", async () => {
      // THE ORDERING TEST. `products_commitments_within_on_hand` is a plain
      // CHECK, evaluated per statement and not deferred, so if the invoice
      // took its commitment before the order let go of its own, this would
      // raise — but only when there is no headroom, which is exactly when it
      // matters and exactly when a manual test would not notice.
      const q = await sentQuote({
        lines: [
          {
            itemType: "product",
            productId: gadget,
            productName: "Gadget",
            description: "Gadget",
            quantity: "3.0000", // every unit on hand
            unitPrice: "500.0000",
          },
        ],
      });
      const so = await inA((tx) => orders.createFromQuote(tx, q.id, actor));
      await inA((tx) => orders.confirmSalesOrder(tx, so._id, actor));
      expect((await stock(gadget)).available).toBe(0);

      await inA((tx) => orders.convertToInvoice(tx, so._id, {}));

      const s = await stock(gadget);
      expect(s.committed).toBe(3);
      expect(s.available).toBe(0);
    });

    it("creates a DRAFT invoice, in Postgres, with the order's figures", async () => {
      // The fourth of the four listed failures: Invoice.create wrote a MONGO
      // invoice while every invoice screen read Postgres.
      const so = await order();
      await inA((tx) => orders.confirmSalesOrder(tx, so._id, actor));
      const { invoiceId } = await inA((tx) => orders.convertToInvoice(tx, so._id, {}));

      const invoice = await inA((tx) => invoicesRepo.getInvoiceDetail(tx, invoiceId));
      expect(invoice).toBeTruthy();
      expect(invoice.status).toBe("draft");
      expect(Number(invoice.total)).toBe(10440);
    });

    it("carries the discount, so the invoice bills what the order agreed", async () => {
      // The quote → invoice path lost a customer's 10% by mapping lines
      // without the discount; the order line holds a percentage and the
      // invoice line takes an amount, which is the same trap one step along.
      const so = await order();
      await inA((tx) => orders.confirmSalesOrder(tx, so._id, actor));
      const { invoiceId } = await inA((tx) => orders.convertToInvoice(tx, so._id, {}));
      const invoice = await inA((tx) => invoicesRepo.getInvoiceDetail(tx, invoiceId));
      expect(Number(invoice.total)).toBe(so.total);
    });

    it("carries the rep onto the invoice, so Sales by Rep still sees the deal", async () => {
      const so = await order();
      await inA((tx) => orders.confirmSalesOrder(tx, so._id, actor));
      const { invoiceId } = await inA((tx) => orders.convertToInvoice(tx, so._id, {}));
      const [row] = await inA((tx) =>
        tx.execute(sql`
          SELECT salesperson_party_id::text AS pid, salesperson_name AS name
            FROM invoices WHERE id = ${invoiceId}::uuid`),
      );
      expect(row.pid).toBe(rep);
      expect(row.name).toBe("Achieng Odhiambo");
    });

    it("refuses to invoice an order nobody confirmed", async () => {
      const so = await order();
      await failsWith(
        () => inA((tx) => orders.convertToInvoice(tx, so._id, {})),
        /confirm it before invoicing/i,
      );
      expect((await stock(widget)).committed).toBe(0);
    });

    it("refuses to invoice the same order twice", async () => {
      const so = await order();
      await inA((tx) => orders.confirmSalesOrder(tx, so._id, actor));
      await inA((tx) => orders.convertToInvoice(tx, so._id, {}));
      await failsWith(
        () => inA((tx) => orders.convertToInvoice(tx, so._id, {})),
        /already invoiced|is invoiced/i,
      );
      // And the stock was not committed a second time.
      expect((await stock(widget)).committed).toBe(10);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the order backlog", () => {
    it("counts confirmed orders and nothing else", async () => {
      const q1 = await sentQuote();
      const draft = await inA((tx) => orders.createFromQuote(tx, q1.id, actor));

      const q2 = await sentQuote();
      const confirmed = await inA((tx) => orders.createFromQuote(tx, q2.id, actor));
      await inA((tx) => orders.confirmSalesOrder(tx, confirmed._id, actor));

      const backlog = await inA((tx) => orders.getOrderBacklog(tx));
      expect(backlog.count).toBe(1);
      expect(backlog.total).toBe(10440);
      expect(draft.status).toBe("draft"); // still there, still not counted
    });

    it("drops an order out of the backlog once it is billed", async () => {
      const so = await order();
      await inA((tx) => orders.confirmSalesOrder(tx, so._id, actor));
      expect((await inA((tx) => orders.getOrderBacklog(tx))).count).toBe(1);

      await inA((tx) => orders.convertToInvoice(tx, so._id, {}));
      const backlog = await inA((tx) => orders.getOrderBacklog(tx));
      expect(backlog.count).toBe(0);
      expect(backlog.total).toBe(0);
    });

    it("is zero, not an error, when there are no orders at all", async () => {
      expect(await inA((tx) => orders.getOrderBacklog(tx))).toEqual({
        count: 0,
        total: 0,
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("the totals belong to the lines", () => {
    it("recomputes the header when a line changes", async () => {
      const so = await order();
      await inA((tx) =>
        tx.execute(sql`
          UPDATE sales_order_lines SET quantity = 20
           WHERE sales_order_id = ${so._id}::uuid`),
      );
      const read = await inA((tx) => orders.getSalesOrder(tx, so._id));
      // 20 x 1000 = 20,000; less 10% = 18,000; plus 16% = 20,880.
      expect(read.subtotal).toBe(18000);
      expect(read.total).toBe(20880);
    });

    it("refuses a line with no quantity", async () => {
      const so = await order();
      await failsWith(
        () =>
          inA((tx) =>
            tx.execute(sql`
              UPDATE sales_order_lines SET quantity = 0
               WHERE sales_order_id = ${so._id}::uuid`),
          ),
        /quantity above zero/i,
      );
    });

    it("refuses a status the document cannot be in", async () => {
      const so = await order();
      await failsWith(
        () =>
          inA((tx) =>
            tx.execute(sql`
              UPDATE sales_orders SET status = 'delivered' WHERE id = ${so._id}::uuid`),
          ),
        /not a state a sales order can be in/i,
      );
    });

    it("refuses a confirmed order with no confirmation time", async () => {
      const so = await order();
      await failsWith(
        () =>
          inA((tx) =>
            tx.execute(sql`
              UPDATE sales_orders SET status = 'confirmed' WHERE id = ${so._id}::uuid`),
          ),
        /carries the moment it was confirmed/i,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("tenancy", () => {
    it("does not leak another company's orders", async () => {
      await order();
      const ours = await inA((tx) => orders.listSalesOrders(tx));
      const theirs = await asTenant(companyB, (tx) => orders.listSalesOrders(tx));
      expect(ours).toHaveLength(1);
      expect(theirs).toHaveLength(0);
    });

    it("does not count another company's orders in the backlog", async () => {
      const so = await order();
      await inA((tx) => orders.confirmSalesOrder(tx, so._id, actor));
      expect(await asTenant(companyB, (tx) => orders.getOrderBacklog(tx))).toEqual({
        count: 0,
        total: 0,
      });
    });
  });
});
