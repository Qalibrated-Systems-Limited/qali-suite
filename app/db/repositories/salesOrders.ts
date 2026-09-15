import { asc, desc, eq, sql } from "drizzle-orm";
import { anyOf, isUuid, toDate } from "./sqlHelpers";
import type { Tx } from "../client";
import {
  salesOrders,
  salesOrderLines,
  documentFlow,
  quotes,
} from "../schema";
import * as quotesRepo from "./quotes";
import * as invoicesRepo from "./invoices";
import { commitStock, releaseStock } from "./products";

/**
 * Sales orders — 0098. The order between the quote and the bill.
 *
 * Contract with the layer above: every function takes a `tx` from
 * withTenant(), so RLS is active; nothing here reads the session or checks a
 * permission. MONEY IS A NUMBER on the way out, because the screens format and
 * total it, and the Mongo queries returned numbers.
 *
 * ── What is not a transcription ────────────────────────────────────────────
 *
 * THE LINEAGE IS `document_flow`. Mongo embedded `quoteRef` and `invoiceRef`;
 * 0041 built the flow table for exactly this step and named 'sales_order' in
 * its CHECK constraints before one existed. The screens still read
 * `order.quoteRef` and `order.invoiceRef`, and `resolveRefs` assembles them.
 *
 * THE COMMITMENT IS THE STATUS. Mongo kept `stockCommitted` per line and
 * flipped it in four places. Here a confirmed order holds a reservation for
 * every product line and a non-confirmed one holds none — derived on read, so
 * the flag and the truth cannot part company.
 *
 * CONVERSION RELEASES BEFORE IT COMMITS. See `convertToInvoice`; the ordering
 * is a hard requirement of a non-deferred CHECK, not a preference.
 */

export const SALES_ORDER_STATUSES = [
  "draft",
  "confirmed",
  "invoiced",
  "cancelled",
] as const;

export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];

/** An order is open while it can still become something else. */
export const OPEN_STATUSES: SalesOrderStatus[] = ["draft", "confirmed"];

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const iso = (v: unknown) => {
  const d = toDate(v);
  return d ? d.toISOString() : null;
};

/** A `date` column, which has no time and must not acquire one. */
const dateOnly = (v: unknown) => (v == null ? null : String(v));

// ── Lineage ─────────────────────────────────────────────────────────────────

/**
 * The quote this order came from, and the invoice it became.
 *
 * Both from `document_flow` header rows joined to the real document, so a
 * deleted quote cannot leave a dangling ref and the number shown is the
 * document's own rather than a copy taken at conversion time — the same
 * reasoning `getQuoteDetail` gives for its `relatedInvoices`.
 */
async function resolveRefs(tx: Tx, orderIds: string[]) {
  const empty = new Map<
    string,
    {
      quoteRef: { quoteId: string; quoteNumber: string } | null;
      invoiceRef: { invoiceId: string; invoiceNumber: string } | null;
    }
  >();
  if (orderIds.length === 0) return empty;

  const rows = (await tx.execute(sql`
    SELECT f.successor_id AS order_id,
           q.id           AS quote_id,
           q.quote_number AS quote_number,
           NULL::uuid     AS invoice_id,
           NULL::text     AS invoice_number
      FROM document_flow f
      JOIN quotes q ON q.id = f.predecessor_id
     WHERE f.successor_type = 'sales_order'
       AND f.predecessor_type = 'quote'
       AND f.successor_id = ${anyOf(orderIds, "uuid[]")}

    UNION ALL

    SELECT f.predecessor_id AS order_id,
           NULL::uuid       AS quote_id,
           NULL::text       AS quote_number,
           i.id             AS invoice_id,
           i.invoice_number AS invoice_number
      FROM document_flow f
      JOIN invoices i ON i.id = f.successor_id
     WHERE f.predecessor_type = 'sales_order'
       AND f.successor_type = 'invoice'
       AND f.predecessor_id = ${anyOf(orderIds, "uuid[]")}
  `)) as unknown as Array<Record<string, unknown>>;

  for (const id of orderIds) empty.set(id, { quoteRef: null, invoiceRef: null });
  for (const r of rows) {
    const entry = empty.get(String(r.order_id));
    if (!entry) continue;
    if (r.quote_id) {
      entry.quoteRef = {
        quoteId: String(r.quote_id),
        quoteNumber: String(r.quote_number ?? ""),
      };
    }
    if (r.invoice_id) {
      entry.invoiceRef = {
        invoiceId: String(r.invoice_id),
        invoiceNumber: String(r.invoice_number ?? ""),
      };
    }
  }
  return empty;
}

// ── Serialisers ─────────────────────────────────────────────────────────────

type OrderRow = typeof salesOrders.$inferSelect;
type LineRow = typeof salesOrderLines.$inferSelect;

type Refs = {
  quoteRef: { quoteId: string; quoteNumber: string } | null;
  invoiceRef: { invoiceId: string; invoiceNumber: string } | null;
};

/** The shape the sales-order screens already render. */
function toScreenOrder(
  r: OrderRow,
  refs: Refs,
  extras: { itemCount: number; items?: unknown[] },
) {
  return {
    _id: String(r.id),
    id: String(r.id),
    orderNumber: r.orderNumber,
    status: r.status,
    orderDate: r.orderDate,
    expectedDeliveryDate: r.expectedDeliveryDate ?? null,
    customer: {
      partyId: r.customerId ? String(r.customerId) : null,
      name: r.customerName ?? "",
      email: r.customerEmail ?? "",
      phone: r.customerPhone ?? "",
      address: r.customerAddress ?? "",
      taxPin: r.customerTaxPin ?? "",
    },
    salesPerson: r.salespersonName ? { name: r.salespersonName } : null,
    quoteRef: refs.quoteRef,
    invoiceRef: refs.invoiceRef,
    itemCount: extras.itemCount,
    subtotal: num(r.subtotal),
    totalDiscount: num(r.discountTotal),
    taxAmount: num(r.taxTotal),
    total: num(r.total),
    currency: r.currency ?? "KES",
    notes: r.notes ?? "",
    cancellationReason: r.cancellationReason ?? "",
    confirmedAt: iso(r.confirmedAt),
    createdBy: { name: r.createdByName ?? "" },
    createdAt: iso(r.createdAt),
    ...(extras.items ? { items: extras.items } : {}),
  };
}

/**
 * `stockCommitted` is DERIVED from the order's status, not stored.
 *
 * A confirmed order holds a reservation for every product line it has, and an
 * order in any other state holds none. That is the invariant the transitions
 * maintain, so reading it off the status cannot disagree with reality — which
 * a boolean maintained by four code paths could, and eventually would.
 */
function toScreenLine(l: LineRow, orderStatus: string, invoicedQty: string) {
  return {
    _id: String(l.id),
    lineNumber: l.lineNumber,
    itemType: l.itemType,
    product: l.productId
      ? {
          id: String(l.productId),
          sku: l.productSku ?? "",
          name: l.productName ?? "",
        }
      : null,
    description: l.description ?? "",
    quantity: num(l.quantity),
    unit: l.unit ?? "pcs",
    unitPrice: num(l.unitPrice),
    amount: num(l.netAmount),
    taxAmount: num(l.taxAmount),
    lineTotal: num(l.lineTotal),
    stockCommitted: orderStatus === "confirmed" && l.itemType === "product",
    invoicedQuantity: num(invoicedQty),
  };
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** The list, newest first. Optional status filter; capped, as Mongo's was. */
export async function listSalesOrders(
  tx: Tx,
  status: string | null = null,
  opts: { limit?: number } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);

  const rows = await tx
    .select()
    .from(salesOrders)
    .where(status ? eq(salesOrders.status, status) : undefined)
    .orderBy(desc(salesOrders.orderDate), desc(salesOrders.createdAt))
    .limit(limit);

  if (rows.length === 0) return [];

  const ids = rows.map((r) => String(r.id));

  /**
   * The line COUNT, not the lines. The Mongo query pulled every line and
   * projected two fields out of them to "keep the payload light", which still
   * shipped the whole array over the wire to compute `items.length`.
   */
  const counts = (await tx.execute(sql`
    SELECT sales_order_id, COUNT(*)::int AS n
      FROM sales_order_lines
     WHERE sales_order_id = ${anyOf(ids, "uuid[]")}
     GROUP BY sales_order_id
  `)) as unknown as Array<Record<string, unknown>>;
  const countById = new Map(counts.map((c) => [String(c.sales_order_id), Number(c.n)]));

  const refs = await resolveRefs(tx, ids);

  return rows.map((r) =>
    toScreenOrder(r, refs.get(String(r.id))!, {
      itemCount: countById.get(String(r.id)) ?? 0,
    }),
  );
}

/** One order, with its lines, for the detail page and the PDF. */
export async function getSalesOrder(tx: Tx, orderId: string) {
  // An id a uuid column cannot hold is NOT FOUND, not a 22P02 with the
  // statement in the message. See isUuid in sqlHelpers.
  if (!isUuid(orderId)) return null;

  const [order] = await tx
    .select()
    .from(salesOrders)
    .where(eq(salesOrders.id, orderId));
  if (!order) return null;

  const lines = await tx
    .select()
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, orderId))
    .orderBy(asc(salesOrderLines.lineNumber));

  /**
   * How much of each order line has reached an invoice — from `document_flow`,
   * the same source `quote_line_invoiced` uses, rather than a counter this
   * table would have to remember to increment.
   */
  const invoiced = (await tx.execute(sql`
    SELECT f.predecessor_id AS line_id,
           COALESCE(SUM(f.quantity), 0)::text AS qty
      FROM document_flow f
      JOIN invoice_lines il ON il.id = f.successor_id
      JOIN invoices i ON i.id = il.invoice_id AND i.status <> 'cancelled'
     WHERE f.predecessor_type = 'sales_order_line'
       AND f.successor_type = 'invoice_line'
       AND f.predecessor_id IN (
         SELECT id FROM sales_order_lines WHERE sales_order_id = ${orderId}::uuid
       )
     GROUP BY f.predecessor_id
  `)) as unknown as Array<Record<string, unknown>>;
  const invoicedByLine = new Map(
    invoiced.map((r) => [String(r.line_id), String(r.qty)]),
  );

  const refs = await resolveRefs(tx, [orderId]);

  return toScreenOrder(order, refs.get(orderId)!, {
    itemCount: lines.length,
    items: lines.map((l) =>
      toScreenLine(l, order.status, invoicedByLine.get(String(l.id)) ?? "0"),
    ),
  });
}

/**
 * The order backlog: confirmed revenue that is not yet billed.
 *
 * The headline number this module exists to provide, and the tile the
 * executive overview DELETED rather than ported because its Mongo source was
 * empty — "a tile reading zero because its store is empty is worse than no
 * tile". This is where it comes back from.
 */
export async function getOrderBacklog(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT COUNT(*)::int                    AS count,
           COALESCE(SUM(total), 0)::float8  AS total
      FROM sales_orders
     WHERE status = 'confirmed'
  `)) as unknown as Array<Record<string, unknown>>;

  return { count: num(row?.count), total: num(row?.total) };
}

// ── Create ──────────────────────────────────────────────────────────────────

/**
 * An accepted (or sent) quote becomes a draft order.
 *
 * Draft, so nothing is reserved yet — confirming is the act that reserves.
 * Every figure crosses as the quote's own percentage and rate rather than as a
 * computed amount, so the order's generated columns re-derive them with the
 * identical expression. Copying the amounts instead would let a JavaScript
 * round in between change a total, which is the §2.1 mistake this port exists
 * to stop making.
 */
export async function createFromQuote(
  tx: Tx,
  quoteId: string,
  actor: { id?: string | null; name?: string | null } = {},
) {
  const quote = await quotesRepo.getQuoteDetail(tx, quoteId);
  if (!quote) throw new Error("Quote not found.");

  if (!["sent", "accepted"].includes(quote.status)) {
    throw new Error(
      `A ${quote.status} quote cannot become an order — send it first.`,
    );
  }
  if (quote.isExpired) {
    throw new Error("This quote has expired. Re-issue it before ordering.");
  }

  /**
   * ONE OPEN ORDER PER QUOTE.
   *
   * The Mongo rule, kept deliberately rather than widened. Partial ordering —
   * three of the ten quoted now, seven later — is what an ERP eventually
   * wants, and `document_flow` and its recursive view already support it; but
   * that is a feature, not a port, and two open orders against one quote each
   * reserving the full quantity is a double reservation for one deal.
   *
   * It is a query rather than a constraint because "open" is a status on
   * `sales_orders` and the link lives in `document_flow`, so no single index
   * spans it.
   */
  const [existing] = (await tx.execute(sql`
    SELECT so.order_number
      FROM document_flow f
      JOIN sales_orders so ON so.id = f.successor_id
     WHERE f.predecessor_type = 'quote'
       AND f.predecessor_id = ${quoteId}::uuid
       AND f.successor_type = 'sales_order'
       AND so.status IN ('draft', 'confirmed')
     LIMIT 1
  `)) as unknown as Array<Record<string, unknown>>;

  if (existing) {
    throw new Error(
      `Order ${existing.order_number} is already open for this quote.`,
    );
  }

  const [{ order_number }] = (await tx.execute(sql`
    SELECT next_entry_number(
      ${quote.companyId}::uuid,
      document_prefix(${quote.companyId}::uuid, 'sales_order')
    ) AS order_number`)) as unknown as Array<{ order_number: string }>;

  const [order] = await tx
    .insert(salesOrders)
    .values({
      companyId: quote.companyId,
      orderNumber: order_number,
      customerId: quote.customerId,
      customerName: quote.customerName,
      customerEmail: quote.customerEmail ?? null,
      customerPhone: quote.customerPhone ?? null,
      customerAddress: quote.customerAddress ?? null,
      customerTaxPin: quote.customerTaxPin ?? null,
      orderDate: new Date().toISOString().slice(0, 10),
      status: "draft",
      title: quote.title ?? null,
      notes: quote.notes ?? null,
      currency: quote.currency ?? "KES",
      salespersonPartyId: quote.salespersonPartyId ?? null,
      salespersonName: quote.salespersonName ?? null,
      createdById: actor.id ?? null,
      createdByName: actor.name ?? "System",
    })
    .returning();

  let n = 0;
  const lineByQuoteLine = new Map<string, string>();
  for (const l of quote.lines) {
    n++;
    const [line] = await tx
      .insert(salesOrderLines)
      .values({
        companyId: quote.companyId,
        salesOrderId: order.id,
        lineNumber: n,
        itemType: l.itemType,
        serviceCategory: l.serviceCategory ?? null,
        productId: l.productId ?? null,
        productName: l.productName ?? null,
        productSku: l.productSku ?? null,
        description: l.description ?? null,
        unit: l.unit ?? "pcs",
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercentage: l.discountPercentage ?? "0",
        taxRate: l.taxRate ?? "0",
      })
      .returning();
    lineByQuoteLine.set(l.id, line.id);
  }

  // The lineage. Header first, then a row per line carrying what flowed.
  await tx.insert(documentFlow).values({
    companyId: quote.companyId,
    predecessorType: "quote",
    predecessorId: quoteId,
    successorType: "sales_order",
    successorId: order.id,
    quantity: null,
    createdById: actor.id ?? null,
  });

  for (const l of quote.lines) {
    await tx.insert(documentFlow).values({
      companyId: quote.companyId,
      predecessorType: "quote_line",
      predecessorId: l.id,
      successorType: "sales_order_line",
      successorId: lineByQuoteLine.get(l.id)!,
      quantity: l.quantity,
      createdById: actor.id ?? null,
    });
  }

  return (await getSalesOrder(tx, order.id))!;
}

// ── Transitions ─────────────────────────────────────────────────────────────

/** The product lines that a reservation applies to. */
async function productLines(tx: Tx, orderId: string) {
  return (await tx.execute(sql`
    SELECT l.id, l.product_id, l.quantity, l.description,
           p.name AS product_name,
           p.quantity_available::text AS available
      FROM sales_order_lines l
      JOIN products p ON p.id = l.product_id
     WHERE l.sales_order_id = ${orderId}::uuid
       AND l.item_type = 'product'
       AND l.product_id IS NOT NULL
     ORDER BY l.line_number
  `)) as unknown as Array<Record<string, unknown>>;
}

/**
 * Draft → confirmed. The customer said yes, so the stock is reserved.
 *
 * The availability is CHECKED FIRST so the refusal can name the product and
 * the shortfall — `products_commitments_within_on_hand` is the guarantee, but a
 * constraint violation is not a sentence anybody can act on. The same division
 * of labour the budget-line duplicate check uses.
 */
export async function confirmSalesOrder(
  tx: Tx,
  orderId: string,
  actor: { id?: string | null; name?: string | null } = {},
) {
  if (!isUuid(orderId)) throw new Error("Sales order not found.");

  const [order] = await tx
    .select()
    .from(salesOrders)
    .where(eq(salesOrders.id, orderId));
  if (!order) throw new Error("Sales order not found.");
  if (order.status !== "draft") {
    throw new Error(`This order is already ${order.status}.`);
  }

  const lines = await productLines(tx, orderId);

  for (const l of lines) {
    if (Number(l.available) < Number(l.quantity)) {
      throw new Error(
        `Not enough ${l.product_name ?? l.description} in stock. ` +
          `Available: ${Number(l.available)}, required: ${Number(l.quantity)}.`,
      );
    }
  }
  for (const l of lines) {
    await commitStock(tx, String(l.product_id), String(l.quantity));
  }

  await tx
    .update(salesOrders)
    .set({
      status: "confirmed",
      confirmedAt: new Date(),
      confirmedById: actor.id ?? null,
      confirmedByName: actor.name ?? null,
      lastModifiedById: actor.id ?? null,
      lastModifiedByName: actor.name ?? null,
      updatedAt: new Date(),
    })
    .where(eq(salesOrders.id, orderId));

  return { id: orderId, status: "confirmed" as const };
}

/**
 * Cancel, releasing whatever this order still holds.
 *
 * A confirmed order holds a reservation and a draft one does not, so what to
 * release follows from the status rather than from a flag that may or may not
 * have been kept up to date.
 */
export async function cancelSalesOrder(
  tx: Tx,
  orderId: string,
  reason: string | null = null,
  actor: { id?: string | null; name?: string | null } = {},
) {
  if (!isUuid(orderId)) throw new Error("Sales order not found.");

  const [order] = await tx
    .select()
    .from(salesOrders)
    .where(eq(salesOrders.id, orderId));
  if (!order) throw new Error("Sales order not found.");
  if (!OPEN_STATUSES.includes(order.status as SalesOrderStatus)) {
    throw new Error(`This order is already ${order.status}; it cannot be cancelled.`);
  }

  if (order.status === "confirmed") {
    for (const l of await productLines(tx, orderId)) {
      await releaseStock(tx, String(l.product_id), String(l.quantity));
    }
  }

  await tx
    .update(salesOrders)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledById: actor.id ?? null,
      cancelledByName: actor.name ?? null,
      cancellationReason: (reason ?? "").slice(0, 500) || null,
      lastModifiedById: actor.id ?? null,
      lastModifiedByName: actor.name ?? null,
      updatedAt: new Date(),
    })
    .where(eq(salesOrders.id, orderId));

  return { id: orderId, status: "cancelled" as const };
}

/**
 * Confirmed → invoiced. The order hands its reservation to a draft invoice.
 *
 * ── THE RELEASE COMES FIRST, AND IT HAS TO ────────────────────────────────
 *
 * Mongo "transferred ownership" by flipping `stockCommitted` from the order
 * line to the invoice line and touching no counter. That cannot work here:
 * `createInvoice` commits stock for every inventory product line as it writes
 * them, unconditionally, with no flag to carry across.
 *
 * So the order lets go BEFORE the invoice takes hold.
 * `products_commitments_within_on_hand` is a plain CHECK — evaluated per
 * statement, not deferred — so on a fully-committed product, holding both at
 * once for the duration of one statement is enough to raise. Both happen in
 * one transaction, so no other session ever observes the gap, and the row lock
 * taken by the release means none can slip into it.
 *
 * Reversing these two lines produces a bug that only appears when a product is
 * committed to its last unit, which is exactly when it matters. There is a
 * test that pins it.
 */
export async function convertToInvoice(
  tx: Tx,
  orderId: string,
  input: {
    invoiceDate?: string;
    dueDate?: string | null;
    actorId?: string | null;
    actorName?: string | null;
    actorRole?: string | null;
  } = {},
) {
  if (!isUuid(orderId)) throw new Error("Sales order not found.");

  const [order] = await tx
    .select()
    .from(salesOrders)
    .where(eq(salesOrders.id, orderId));
  if (!order) throw new Error("Sales order not found.");
  if (order.status !== "confirmed") {
    throw new Error(`This order is ${order.status}; confirm it before invoicing.`);
  }

  const lines = await tx
    .select()
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, orderId))
    .orderBy(asc(salesOrderLines.lineNumber));

  if (lines.length === 0) throw new Error("This order has no lines to invoice.");

  // Let go first. See the note above — this is an ordering requirement.
  for (const l of await productLines(tx, orderId)) {
    await releaseStock(tx, String(l.product_id), String(l.quantity));
  }

  const invoiceDate = input.invoiceDate ?? new Date().toISOString().slice(0, 10);
  const dueDate =
    input.dueDate ??
    new Date(Date.parse(invoiceDate) + 30 * 86_400_000).toISOString().slice(0, 10);

  const invoice = await invoicesRepo.createInvoice(tx, {
    companyId: order.companyId,
    customerId: order.customerId,
    /** Who sold it — 0095. The order carries it so the chain does not drop it. */
    salespersonPartyId: order.salespersonPartyId ?? null,
    salespersonName: order.salespersonName ?? null,
    invoiceDate,
    dueDate,
    title: order.title ?? null,
    notes: `From sales order ${order.orderNumber}${order.notes ? ` — ${order.notes}` : ""}`,
    lines: lines.map((l) => ({
      itemType: l.itemType as "product" | "service",
      serviceCategory: (l.serviceCategory ?? undefined) as never,
      productId: l.productId ?? null,
      description: l.description ?? l.productName ?? null,
      unit: l.unit ?? "pcs",
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      /**
       * The ABSOLUTE discount the order's generated column already computed,
       * because an invoice line takes an amount where an order line holds a
       * percentage. Read from the row rather than recomputed, so the two
       * documents cannot differ by a rounding step.
       */
      discountAmount: l.discountAmount ?? "0",
      taxRate: l.taxRate,
      fulfilmentSource: "inventory" as const,
    })),
    createdById: input.actorId ?? null,
    createdByName: input.actorName ?? null,
    createdByRole: input.actorRole ?? null,
  });

  // The lineage, header then lines.
  await tx.insert(documentFlow).values({
    companyId: order.companyId,
    predecessorType: "sales_order",
    predecessorId: orderId,
    successorType: "invoice",
    successorId: invoice.id,
    quantity: null,
    createdById: input.actorId ?? null,
  });

  const invoiceLineRows = (await tx.execute(sql`
    SELECT id, line_number FROM invoice_lines
     WHERE invoice_id = ${invoice.id}::uuid
     ORDER BY line_number
  `)) as unknown as Array<{ id: string; line_number: number }>;

  let i = 0;
  for (const l of lines) {
    const invoiceLine = invoiceLineRows[i++];
    if (!invoiceLine) break;
    await tx.insert(documentFlow).values({
      companyId: order.companyId,
      predecessorType: "sales_order_line",
      predecessorId: l.id,
      successorType: "invoice_line",
      successorId: invoiceLine.id,
      quantity: l.quantity,
      createdById: input.actorId ?? null,
    });
  }

  const now = new Date();
  await tx
    .update(salesOrders)
    .set({
      status: "invoiced",
      invoicedAt: now,
      lastModifiedById: input.actorId ?? null,
      lastModifiedByName: input.actorName ?? null,
      updatedAt: now,
    })
    .where(eq(salesOrders.id, orderId));

  await markUpstreamQuoteConverted(tx, orderId);

  return { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber };
}

/**
 * A quote whose every line has now reached an invoice is converted.
 *
 * `convertQuoteToInvoice` does this for the direct path. Without the same step
 * here, a quote that went the long way round — quote → order → invoice — would
 * sit at 'sent' for ever with a paid invoice against it, which is the state
 * the status exists to rule out.
 *
 * The remaining quantity comes from `quote_line_invoiced`, the 0041 view that
 * was written RECURSIVE for exactly this: it walks quote line → order line →
 * invoice line without knowing an order step exists.
 */
async function markUpstreamQuoteConverted(tx: Tx, orderId: string) {
  const [link] = (await tx.execute(sql`
    SELECT f.predecessor_id AS quote_id
      FROM document_flow f
     WHERE f.successor_type = 'sales_order'
       AND f.successor_id = ${orderId}::uuid
       AND f.predecessor_type = 'quote'
     LIMIT 1
  `)) as unknown as Array<Record<string, unknown>>;
  if (!link) return;

  const quoteId = String(link.quote_id);
  const [q] = await tx.select().from(quotes).where(eq(quotes.id, quoteId));
  if (!q) return;

  const [remaining] = (await tx.execute(sql`
    SELECT COALESCE(SUM(quoted_quantity - invoiced_quantity), 0) AS remaining
      FROM quote_line_invoiced WHERE quote_id = ${quoteId}::uuid
  `)) as unknown as Array<{ remaining: string }>;

  if (
    Number(remaining?.remaining ?? 0) <= 0 &&
    quotesRepo.canTransition(q.status, "converted")
  ) {
    await tx
      .update(quotes)
      .set({ status: "converted", convertedAt: new Date(), updatedAt: new Date() })
      .where(eq(quotes.id, quoteId));
  }
}

/** Orders raised against one quote, for the quote's detail page. */
export async function listOrdersForQuote(tx: Tx, quoteId: string) {
  if (!isUuid(quoteId)) return [];
  const rows = (await tx.execute(sql`
    SELECT so.id, so.order_number, so.status, so.total, so.order_date
      FROM document_flow f
      JOIN sales_orders so ON so.id = f.successor_id
     WHERE f.predecessor_type = 'quote'
       AND f.predecessor_id = ${quoteId}::uuid
       AND f.successor_type = 'sales_order'
     ORDER BY so.order_date, so.order_number
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    orderId: String(r.id),
    orderNumber: String(r.order_number),
    status: String(r.status),
    total: num(r.total),
    orderDate: dateOnly(r.order_date),
  }));
}
