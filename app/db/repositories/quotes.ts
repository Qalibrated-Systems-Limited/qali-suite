import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { quotes, quoteLines } from "../schema/quotes";
import { documentFlow } from "../schema/documentFlow";
import { documentDeliveries } from "../schema/documentDeliveries";
import * as invoicesRepo from "./invoices";

/**
 * Quotes (0041).
 *
 * The offer that precedes an invoice. Totals, line amounts and commission are
 * all maintained by the database, so nothing here computes money — it supplies
 * quantity, price, discount and tax RATES, and reads back what they came to.
 */

export interface QuoteLineInput {
  itemType?: "product" | "service";
  serviceCategory?: string | null;
  productId?: string | null;
  productName?: string | null;
  productSku?: string | null;
  description?: string | null;
  unit?: string | null;
  quantity: string;
  unitPrice: string;
  discountPercentage?: string;
  taxRate?: string;
}

export interface CreateQuoteInput {
  companyId: string;
  customerId: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerTaxPin?: string | null;
  quoteDate: string;
  validUntil?: string | null;
  title?: string | null;
  notes?: string | null;
  internalNotes?: string | null;
  terms?: string | null;
  reference?: string | null;
  salespersonPartyId?: string | null;
  salespersonName?: string | null;
  salespersonEmployeeNumber?: string | null;
  commissionRate?: string;
  lines: QuoteLineInput[];
  createdById?: string | null;
  createdByName?: string | null;
  createdByRole?: string | null;
}

/**
 * Which statuses may follow which.
 *
 * A state machine, because a CHECK constraint can see the row it is validating
 * but not the row it replaced, so "accepted may not follow cancelled" is not
 * something the column can express. The source scattered these as `if` guards
 * across the actions; one table beats six.
 */
const TRANSITIONS: Record<string, string[]> = {
  draft: ["sent", "cancelled"],
  // 'converted' directly from 'sent': the source's canConvertToInvoice allows
  // sent as well as accepted, and a customer who signs the quote back often
  // never has it marked accepted separately.
  sent: ["accepted", "rejected", "expired", "converted", "cancelled"],
  accepted: ["converted", "cancelled"],
  rejected: ["cancelled"],
  expired: ["cancelled"],
  // Terminal. A converted quote has an invoice pointing at it.
  converted: [],
  cancelled: [],
};

export function canTransition(from: string, to: string): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

function assertTransition(from: string, to: string) {
  if (!canTransition(from, to)) {
    throw new Error(`A ${from} quote cannot become ${to}.`);
  }
}

/** "product" when a product is named, "service" otherwise — as invoices do. */
function normaliseLine(line: QuoteLineInput) {
  const itemType = line.itemType ?? (line.productId ? "product" : "service");
  return {
    itemType,
    serviceCategory:
      itemType === "service" ? (line.serviceCategory ?? "other") : null,
    productId: itemType === "product" ? (line.productId ?? null) : null,
    productName: line.productName ?? null,
    productSku: line.productSku ?? null,
    description: line.description ?? null,
    unit: line.unit ?? "pcs",
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountPercentage: line.discountPercentage ?? "0",
    taxRate: line.taxRate ?? "0",
  };
}

export async function createQuote(tx: Tx, input: CreateQuoteInput) {
  if (!input.lines?.length) {
    throw new Error("A quote needs at least one line.");
  }

  // document_prefix, not a literal 'QT': 0035 already reads the tenant's
  // configured quote_prefix, and a company that chose its own numbering must
  // keep getting it.
  const [{ quote_number }] = (await tx.execute(
    sql`SELECT next_entry_number(
      ${input.companyId}::uuid,
      document_prefix(${input.companyId}::uuid, 'quote')
    ) AS quote_number`,
  )) as unknown as Array<{ quote_number: string }>;

  const [quote] = await tx
    .insert(quotes)
    .values({
      companyId: input.companyId,
      quoteNumber: quote_number,
      customerId: input.customerId,
      customerName: input.customerName,
      customerEmail: input.customerEmail ?? null,
      customerPhone: input.customerPhone ?? null,
      customerAddress: input.customerAddress ?? null,
      customerTaxPin: input.customerTaxPin ?? null,
      quoteDate: input.quoteDate,
      validUntil: input.validUntil ?? null,
      status: "draft",
      title: input.title ?? null,
      notes: input.notes ?? null,
      internalNotes: input.internalNotes ?? null,
      terms: input.terms ?? null,
      reference: input.reference ?? null,
      salespersonPartyId: input.salespersonPartyId ?? null,
      salespersonName: input.salespersonName ?? null,
      salespersonEmployeeNumber: input.salespersonEmployeeNumber ?? null,
      commissionRate: input.commissionRate ?? "0",
      createdById: input.createdById ?? null,
      createdByName: input.createdByName ?? null,
      createdByRole: input.createdByRole ?? null,
    })
    .returning();

  await insertLines(tx, input.companyId, quote.id, input.lines);

  // Re-read: the totals and the commission are the trigger's and the generated
  // column's, and the row returned by INSERT predates both.
  return (await getQuote(tx, quote.id))!;
}

async function insertLines(
  tx: Tx,
  companyId: string,
  quoteId: string,
  lines: QuoteLineInput[],
) {
  let n = 0;
  for (const raw of lines) {
    n++;
    const line = normaliseLine(raw);
    await tx.insert(quoteLines).values({
      companyId,
      quoteId,
      lineNumber: n,
      ...line,
    });
  }
}

export async function getQuote(tx: Tx, quoteId: string) {
  const [row] = await tx.select().from(quotes).where(eq(quotes.id, quoteId));
  return row ?? null;
}

/**
 * A sent quote past its validity reads as expired without anything having run.
 *
 * The source flips the status in a pre-save hook, so a quote nobody saved stays
 * "sent" however long it has been. Odoo does it this way — validity_date and a
 * state that is interpreted — and it means no job has to be trusted.
 */
export function isExpired(quote: { status: string; validUntil: string | null }) {
  if (!quote.validUntil) return false;
  if (!["draft", "sent"].includes(quote.status)) return false;
  return quote.validUntil < new Date().toISOString().slice(0, 10);
}

export async function getQuoteDetail(tx: Tx, quoteId: string) {
  const quote = await getQuote(tx, quoteId);
  if (!quote) return null;

  const lines = await tx
    .select()
    .from(quoteLines)
    .where(eq(quoteLines.quoteId, quoteId))
    .orderBy(quoteLines.lineNumber);

  // What has actually been invoiced, per line — from the invoice lines, at
  // whatever chain depth (0041's recursive view).
  const invoiced = (await tx.execute(sql`
    SELECT quote_line_id, invoiced_quantity
      FROM quote_line_invoiced
     WHERE quote_id = ${quoteId}::uuid
  `)) as unknown as Array<{ quote_line_id: string; invoiced_quantity: string }>;
  const byLine = new Map(invoiced.map((r) => [r.quote_line_id, r.invoiced_quantity]));

  const deliveries = await tx
    .select()
    .from(documentDeliveries)
    .where(
      and(
        eq(documentDeliveries.documentType, "quote"),
        eq(documentDeliveries.documentId, quoteId),
      ),
    )
    .orderBy(desc(documentDeliveries.attemptedAt));

  const lastFailure = deliveries.find((d) =>
    ["failed", "bounced"].includes(d.status),
  );

  /**
   * The invoices this quote produced.
   *
   * The source kept an embedded array and pushed to it; these are the
   * document_flow header rows joined to the invoices, so an invoice that was
   * deleted cannot leave a dangling entry, and the amount shown is the
   * invoice's own total rather than a figure computed at conversion time.
   */
  const relatedInvoices = (await tx.execute(sql`
    SELECT i.id, i.invoice_number, i.total, i.status,
           f.created_at, f.created_by_id
      FROM document_flow f
      JOIN invoices i ON i.id = f.successor_id
     WHERE f.predecessor_id = ${quoteId}::uuid
       AND f.successor_type = 'invoice'
     ORDER BY f.created_at
  `)) as unknown as Array<Record<string, unknown>>;

  // Who pressed send, from the delivery log rather than a column on the quote.
  const firstSend = [...deliveries].reverse().find((d) => d.attemptedByName);

  return {
    ...quote,
    isExpired: isExpired(quote),
    lines: lines.map((l) => ({
      ...l,
      invoicedQuantity: byLine.get(l.id) ?? "0.0000",
    })),
    sentByName: firstSend?.attemptedByName ?? null,
    invoices: relatedInvoices.map((r) => ({
      invoiceId: String(r.id),
      invoiceNumber: String(r.invoice_number),
      amount: Number(r.total),
      status: String(r.status),
      createdAt: r.created_at as Date,
      createdById: (r.created_by_id as string) ?? null,
    })),
    delivery: {
      attempts: deliveries.length,
      deliveredAt: deliveries.find((d) => d.deliveredAt)?.deliveredAt ?? null,
      lastError: lastFailure?.error ?? null,
      history: deliveries,
    },
  };
}

export async function listQuotes(
  tx: Tx,
  opts: { limit?: number; offset?: number; status?: string; customerId?: string } = {},
) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const filters = [];
  if (opts.status) filters.push(eq(quotes.status, opts.status));
  if (opts.customerId) filters.push(eq(quotes.customerId, opts.customerId));

  const rows = await tx
    .select({
      id: quotes.id,
      quoteNumber: quotes.quoteNumber,
      quoteDate: quotes.quoteDate,
      validUntil: quotes.validUntil,
      customerId: quotes.customerId,
      customerName: quotes.customerName,
      status: quotes.status,
      total: quotes.total,
      salespersonName: quotes.salespersonName,
    })
    .from(quotes)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(quotes.quoteDate), desc(quotes.createdAt))
    .limit(limit)
    .offset(opts.offset ?? 0);

  return rows.map((r) => ({ ...r, isExpired: isExpired(r) }));
}

/**
 * The list page's query: search, filters, paging and a total, in one trip.
 *
 * `visibleToUserId` IS A FEATURE, NOT A DETAIL. The source restricts the list
 * to `createdBy.id` for anyone outside SuperAdmin, Admin, CFO, Finance Manager,
 * Accountant and Sales Manager — a rep sees their own quotes and not the
 * floor's. That set is INVOICE_WRITE_ROLES, so the caller passes a user id when
 * the role is outside it and null when it is not.
 *
 * It is a parameter rather than a policy because the tenant GUCs carry a user
 * id but not a role, and inventing a second GUC to teach the database about
 * roles is a larger change than this rule is worth.
 */
export async function searchQuotes(
  tx: Tx,
  opts: {
    query?: string;
    page?: number;
    perPage?: number;
    status?: string;
    startDate?: string;
    endDate?: string;
    customerId?: string;
    expiringSoon?: boolean;
    visibleToUserId?: string | null;
  } = {},
) {
  const perPage = Math.min(opts.perPage ?? 10, 200);
  const page = Math.max(opts.page ?? 1, 1);
  const offset = (page - 1) * perPage;

  const where = [sql`TRUE`];
  if (opts.query) {
    const like = `%${opts.query}%`;
    where.push(sql`(q.quote_number ILIKE ${like} OR q.customer_name ILIKE ${like})`);
  }
  if (opts.status && opts.status !== "all") {
    where.push(sql`q.status = ${opts.status}`);
  }
  if (opts.startDate) where.push(sql`q.quote_date >= ${opts.startDate}::date`);
  if (opts.endDate) where.push(sql`q.quote_date <= ${opts.endDate}::date`);
  if (opts.customerId) where.push(sql`q.customer_id = ${opts.customerId}::uuid`);
  if (opts.expiringSoon) {
    where.push(sql`q.status IN ('draft','sent')
                   AND q.valid_until BETWEEN CURRENT_DATE AND CURRENT_DATE + 7`);
  }
  if (opts.visibleToUserId) {
    where.push(sql`q.created_by_id = ${opts.visibleToUserId}`);
  }
  const clause = sql.join(where, sql` AND `);

  // One trip: the page of rows and the total that pages it. Two round trips for
  // a list nobody reads twice is a round trip wasted.
  const rows = (await tx.execute(sql`
    SELECT q.id, q.quote_number, q.quote_date, q.valid_until, q.customer_id,
           q.customer_name, q.customer_email, q.customer_phone,
           q.status, q.total, q.salesperson_name,
           -- How many invoices this quote produced. The header rows in
           -- document_flow already say; the list showed "n invoice(s)" from an
           -- embedded array that no longer exists.
           (SELECT COUNT(*)::int FROM document_flow f
             WHERE f.predecessor_id = q.id AND f.successor_type = 'invoice') AS invoice_count,
           COUNT(*) OVER ()::int AS total_count
      FROM quotes q
     WHERE ${clause}
     ORDER BY q.quote_date DESC, q.created_at DESC
     LIMIT ${perPage} OFFSET ${offset}
  `)) as unknown as Array<Record<string, unknown>>;

  const total = rows.length ? Number(rows[0].total_count) : 0;
  return {
    rows: rows.map((r) => ({
      id: String(r.id),
      quoteNumber: String(r.quote_number),
      quoteDate: String(r.quote_date),
      validUntil: (r.valid_until as string) ?? null,
      customerId: String(r.customer_id),
      customerName: String(r.customer_name),
      customerEmail: (r.customer_email as string) ?? null,
      customerPhone: (r.customer_phone as string) ?? null,
      invoiceCount: Number(r.invoice_count ?? 0),
      status: String(r.status),
      total: String(r.total),
      salespersonName: (r.salesperson_name as string) ?? null,
      isExpired: isExpired({
        status: String(r.status),
        validUntil: (r.valid_until as string) ?? null,
      }),
    })),
    total,
    page,
    perPage,
    pages: Math.max(Math.ceil(total / perPage), 1),
  };
}

/**
 * Just the total, for the pagination boundary.
 *
 * A separate query rather than threading the count out of searchQuotes: the
 * table and the pager are separate Suspense boundaries so they stream
 * independently, and this counts an indexed predicate instead of re-running the
 * row fetch to throw the rows away.
 */
export async function countQuotes(
  tx: Tx,
  opts: Parameters<typeof searchQuotes>[1] = {},
) {
  const where = [sql`TRUE`];
  if (opts.query) {
    const like = `%${opts.query}%`;
    where.push(sql`(quote_number ILIKE ${like} OR customer_name ILIKE ${like})`);
  }
  if (opts.status && opts.status !== "all") where.push(sql`status = ${opts.status}`);
  if (opts.startDate) where.push(sql`quote_date >= ${opts.startDate}::date`);
  if (opts.endDate) where.push(sql`quote_date <= ${opts.endDate}::date`);
  if (opts.customerId) where.push(sql`customer_id = ${opts.customerId}::uuid`);
  if (opts.expiringSoon) {
    where.push(sql`status IN ('draft','sent')
                   AND valid_until BETWEEN CURRENT_DATE AND CURRENT_DATE + 7`);
  }
  if (opts.visibleToUserId) where.push(sql`created_by_id = ${opts.visibleToUserId}`);

  const [row] = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM quotes WHERE ${sql.join(where, sql` AND `)}
  `)) as unknown as Array<{ n: number }>;
  return Number(row?.n ?? 0);
}

/**
 * Quotes for a customer that still have something left to invoice.
 *
 * The source walks every line counting invoicedQuantity. Here "left" is what
 * quote_line_invoiced already derives, so a cancelled invoice releases its
 * quantity back without anything having to remember to.
 */
export async function getQuotesWithAvailableItems(tx: Tx, customerId: string) {
  const rows = (await tx.execute(sql`
    SELECT q.id, q.quote_number, q.quote_date, q.total,
           SUM(v.quoted_quantity - v.invoiced_quantity)::numeric(19,4) AS remaining
      FROM quotes q
      JOIN quote_line_invoiced v ON v.quote_id = q.id
     WHERE q.customer_id = ${customerId}::uuid
       AND q.status IN ('sent', 'accepted')
     GROUP BY q.id, q.quote_number, q.quote_date, q.total
    HAVING SUM(v.quoted_quantity - v.invoiced_quantity) > 0
     ORDER BY q.quote_date DESC
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    quoteNumber: String(r.quote_number),
    quoteDate: String(r.quote_date),
    total: String(r.total),
    remaining: String(r.remaining),
  }));
}

/**
 * The stats cards' numbers.
 *
 * THE SHAPE IS THE COMPONENT'S CONTRACT — a flat object of counts and values
 * that QuoteStatsCards destructures, cancelled excluded, carrying the same
 * per-user visibility as the list. Returning something tidier would mean
 * editing a component to suit the port, which is how a "port" becomes a
 * rewrite.
 *
 * One pass with FILTER aggregates rather than a query per status.
 */
export async function getQuoteStats(
  tx: Tx,
  opts: {
    status?: string;
    startDate?: string;
    endDate?: string;
    visibleToUserId?: string | null;
  } = {},
) {
  const where = [sql`status <> 'cancelled'`];
  if (opts.status && opts.status !== "all") where.push(sql`status = ${opts.status}`);
  if (opts.startDate) where.push(sql`quote_date >= ${opts.startDate}::date`);
  if (opts.endDate) where.push(sql`quote_date <= ${opts.endDate}::date`);
  if (opts.visibleToUserId) where.push(sql`created_by_id = ${opts.visibleToUserId}`);
  const clause = sql.join(where, sql` AND `);

  const [row] = (await tx.execute(sql`
    SELECT COUNT(*)::int                                        AS total,
           COALESCE(SUM(total), 0)::numeric(19,4)               AS "totalValue",
           COUNT(*) FILTER (WHERE status = 'draft')::int        AS draft,
           COUNT(*) FILTER (WHERE status = 'sent')::int         AS sent,
           COUNT(*) FILTER (WHERE status = 'accepted')::int     AS accepted,
           COUNT(*) FILTER (WHERE status = 'rejected')::int     AS rejected,
           COUNT(*) FILTER (WHERE status = 'converted')::int    AS converted,
           COUNT(*) FILTER (WHERE status = 'expired')::int      AS expired,
           COALESCE(SUM(total) FILTER (WHERE status = 'draft'), 0)::numeric(19,4)     AS "draftValue",
           COALESCE(SUM(total) FILTER (WHERE status = 'sent'), 0)::numeric(19,4)      AS "sentValue",
           COALESCE(SUM(total) FILTER (WHERE status = 'accepted'), 0)::numeric(19,4)  AS "acceptedValue",
           COALESCE(SUM(total) FILTER (WHERE status = 'converted'), 0)::numeric(19,4) AS "convertedValue"
      FROM quotes
     WHERE ${clause}
  `)) as unknown as Array<Record<string, unknown>>;

  // Numbers, because the cards format them as numbers. Money stays exact in
  // the database; these are display totals, already aggregated.
  const n = (v: unknown) => Number(v ?? 0);
  return {
    total: n(row?.total),
    totalValue: n(row?.totalValue),
    draft: n(row?.draft),
    sent: n(row?.sent),
    accepted: n(row?.accepted),
    rejected: n(row?.rejected),
    converted: n(row?.converted),
    expired: n(row?.expired),
    draftValue: n(row?.draftValue),
    sentValue: n(row?.sentValue),
    acceptedValue: n(row?.acceptedValue),
    convertedValue: n(row?.convertedValue),
  };
}

export async function updateQuote(
  tx: Tx,
  quoteId: string,
  input: Partial<CreateQuoteInput> & { lines?: QuoteLineInput[] },
) {
  const quote = await getQuote(tx, quoteId);
  if (!quote) throw new Error("Quote not found.");
  // Editing a sent quote would change what the customer is holding.
  if (quote.status !== "draft") {
    throw new Error(`Only a draft quote can be edited; this one is ${quote.status}.`);
  }

  await tx
    .update(quotes)
    .set({
      customerId: input.customerId ?? quote.customerId,
      customerName: input.customerName ?? quote.customerName,
      customerEmail: input.customerEmail ?? quote.customerEmail,
      customerPhone: input.customerPhone ?? quote.customerPhone,
      customerAddress: input.customerAddress ?? quote.customerAddress,
      customerTaxPin: input.customerTaxPin ?? quote.customerTaxPin,
      quoteDate: input.quoteDate ?? quote.quoteDate,
      validUntil: input.validUntil ?? quote.validUntil,
      title: input.title ?? quote.title,
      notes: input.notes ?? quote.notes,
      internalNotes: input.internalNotes ?? quote.internalNotes,
      terms: input.terms ?? quote.terms,
      reference: input.reference ?? quote.reference,
      salespersonPartyId: input.salespersonPartyId ?? quote.salespersonPartyId,
      salespersonName: input.salespersonName ?? quote.salespersonName,
      salespersonEmployeeNumber:
        input.salespersonEmployeeNumber ?? quote.salespersonEmployeeNumber,
      commissionRate: input.commissionRate ?? quote.commissionRate,
      lastModifiedById: input.createdById ?? null,
      lastModifiedByName: input.createdByName ?? null,
      updatedAt: new Date(),
    })
    .where(eq(quotes.id, quoteId));

  if (input.lines) {
    if (!input.lines.length) throw new Error("A quote needs at least one line.");
    // Replaced wholesale rather than diffed: line numbers are positional, and
    // the totals follow whatever ends up here.
    await tx.delete(quoteLines).where(eq(quoteLines.quoteId, quoteId));
    await insertLines(tx, quote.companyId, quoteId, input.lines);
  }

  return (await getQuote(tx, quoteId))!;
}

async function setStatus(
  tx: Tx,
  quoteId: string,
  to: string,
  extra: Record<string, unknown> = {},
) {
  const quote = await getQuote(tx, quoteId);
  if (!quote) throw new Error("Quote not found.");
  assertTransition(quote.status, to);

  await tx
    .update(quotes)
    .set({ status: to, updatedAt: new Date(), ...extra })
    .where(eq(quotes.id, quoteId));

  return (await getQuote(tx, quoteId))!;
}

/**
 * Marks the quote sent and records the attempt.
 *
 * The status says the user pressed send; the delivery row says what the mail
 * provider did. They are different facts and the source conflated them.
 */
export async function sendQuote(
  tx: Tx,
  quoteId: string,
  input: {
    recipient: string;
    provider?: string | null;
    providerMessageId?: string | null;
    status?: "queued" | "sent" | "delivered" | "failed" | "bounced";
    error?: string | null;
    actorId?: string | null;
    actorName?: string | null;
  },
) {
  const quote = await getQuote(tx, quoteId);
  if (!quote) throw new Error("Quote not found.");

  const deliveryStatus = input.status ?? "sent";
  await tx.insert(documentDeliveries).values({
    companyId: quote.companyId,
    documentType: "quote",
    documentId: quoteId,
    recipient: input.recipient,
    status: deliveryStatus,
    provider: input.provider ?? null,
    providerMessageId: input.providerMessageId ?? null,
    error: input.error ?? null,
    deliveredAt: deliveryStatus === "delivered" ? new Date() : null,
    attemptedById: input.actorId ?? null,
    attemptedByName: input.actorName ?? null,
  });

  // A failed attempt does not move the quote on — it is still a draft nobody
  // has received. Re-sending an already-sent quote is fine and adds a row.
  if (["failed", "bounced"].includes(deliveryStatus)) return quote;
  if (quote.status === "draft") {
    return setStatus(tx, quoteId, "sent", { sentAt: new Date() });
  }
  return quote;
}

export async function acceptQuote(
  tx: Tx,
  quoteId: string,
  input: { acceptedByName?: string | null } = {},
) {
  return setStatus(tx, quoteId, "accepted", {
    acceptedAt: new Date(),
    acceptedByName: input.acceptedByName ?? null,
  });
}

export async function rejectQuote(tx: Tx, quoteId: string, reason?: string | null) {
  return setStatus(tx, quoteId, "rejected", {
    rejectedAt: new Date(),
    rejectionReason: reason ?? null,
  });
}

/**
 * Cancels a quote that has produced nothing.
 *
 * The source's canCancel refuses when `invoices.length > 0`, and the transition
 * table alone cannot express that — it sees the status, not what the quote has
 * already become. Without this a quote with real invoices against it could be
 * cancelled, leaving those invoices descended from a cancelled document.
 *
 * Asked of document_flow, which is where the source's embedded invoices array
 * went, so it counts invoices that exist rather than ids somebody pushed.
 */
export async function cancelQuote(tx: Tx, quoteId: string, reason?: string | null) {
  const [{ n }] = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n
      FROM document_flow
     WHERE predecessor_id = ${quoteId}::uuid
       AND successor_type = 'invoice'
  `)) as unknown as Array<{ n: number }>;

  if (Number(n) > 0) {
    throw new Error(
      `This quote has ${n} invoice(s) against it and cannot be cancelled. Cancel the invoices first.`,
    );
  }

  return setStatus(tx, quoteId, "cancelled", {
    cancelledAt: new Date(),
    cancellationReason: reason ?? null,
  });
}

export async function deleteQuote(tx: Tx, quoteId: string) {
  const quote = await getQuote(tx, quoteId);
  if (!quote) throw new Error("Quote not found.");
  // Anything that has been sent is a document somebody outside the company has
  // seen; it is cancelled, not deleted.
  if (quote.status !== "draft") {
    throw new Error(`Only a draft quote can be deleted; this one is ${quote.status}. Cancel it instead.`);
  }
  await tx.delete(quotes).where(eq(quotes.id, quoteId));
  return { deleted: true as const };
}

/** A new draft with the same lines, and its own number. */
export async function cloneQuote(
  tx: Tx,
  quoteId: string,
  actor: { id?: string | null; name?: string | null; role?: string | null } = {},
) {
  const source = await getQuoteDetail(tx, quoteId);
  if (!source) throw new Error("Quote not found.");

  return createQuote(tx, {
    companyId: source.companyId,
    customerId: source.customerId,
    customerName: source.customerName,
    customerEmail: source.customerEmail,
    customerPhone: source.customerPhone,
    customerAddress: source.customerAddress,
    customerTaxPin: source.customerTaxPin,
    quoteDate: new Date().toISOString().slice(0, 10),
    validUntil: null,
    title: source.title,
    notes: source.notes,
    internalNotes: source.internalNotes,
    terms: source.terms,
    reference: source.reference,
    salespersonPartyId: source.salespersonPartyId,
    salespersonName: source.salespersonName,
    salespersonEmployeeNumber: source.salespersonEmployeeNumber,
    commissionRate: source.commissionRate,
    lines: source.lines.map((l) => ({
      itemType: l.itemType as "product" | "service",
      serviceCategory: l.serviceCategory,
      productId: l.productId,
      productName: l.productName,
      productSku: l.productSku,
      description: l.description,
      unit: l.unit,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercentage: l.discountPercentage,
      taxRate: l.taxRate,
    })),
    createdById: actor.id ?? null,
    createdByName: actor.name ?? null,
    createdByRole: actor.role ?? null,
  });
}

/**
 * Turns a quote into a Postgres invoice, and records the flow.
 *
 * THIS IS THE PATH THAT WAS BROKEN. Every invoice surface reads Postgres while
 * quote.convertToInvoice() wrote a Mongo one and redirected to a Postgres page
 * with an ObjectId (§9E). The invoice created here is the same one the invoice
 * list shows.
 *
 * Partial by design: `selection` names the lines and quantities to invoice, so
 * a quote can be invoiced in stages. What is left is the quoted quantity less
 * what the flow already accounts for.
 */
export async function convertQuoteToInvoice(
  tx: Tx,
  quoteId: string,
  input: {
    selection?: Array<{ quoteLineId: string; quantity?: string }>;
    invoiceDate: string;
    dueDate?: string | null;
    notes?: string | null;
    createdById?: string | null;
    createdByName?: string | null;
    createdByRole?: string | null;
  },
) {
  const quote = await getQuoteDetail(tx, quoteId);
  if (!quote) throw new Error("Quote not found.");

  // The source's canConvertToInvoice: sent or accepted, and not expired. This
  // guard was written too loosely first — it refused only cancelled and
  // rejected, so a DRAFT converted happily and then the status machine
  // declined to mark it converted, leaving a real invoice against a quote that
  // still said draft. A test caught it. The two rules have to agree, so the
  // guard is now the same rule the machine enforces.
  if (!["sent", "accepted"].includes(quote.status)) {
    throw new Error(
      `A ${quote.status} quote cannot be invoiced — send it first.`,
    );
  }
  if (quote.isExpired) {
    throw new Error("This quote has expired. Re-issue it before invoicing.");
  }

  // No selection means "invoice whatever is left on every line".
  const selection: Array<{ quoteLineId: string; quantity?: string }> =
    input.selection ?? quote.lines.map((l) => ({ quoteLineId: l.id }));
  const wanted = new Map<string, string | undefined>(
    selection.map((s) => [s.quoteLineId, s.quantity]),
  );

  const toInvoice = quote.lines
    .filter((l) => wanted.has(l.id))
    .map((l) => {
      const remaining =
        Number(l.quantity) - Number(l.invoicedQuantity ?? "0");
      const qty = Number(wanted.get(l.id) ?? remaining);
      if (qty <= 0) return null;
      if (qty > remaining) {
        throw new Error(
          `Line ${l.lineNumber}: ${qty} exceeds the ${remaining} still to invoice.`,
        );
      }
      return { line: l, quantity: qty.toFixed(4) };
    })
    .filter(Boolean) as Array<{ line: (typeof quote.lines)[number]; quantity: string }>;

  if (!toInvoice.length) {
    throw new Error("Nothing left to invoice on this quote.");
  }

  /**
   * THE DISCOUNT HAS TO BE CARRIED, AND PRORATED.
   *
   * A quote line holds a discount PERCENTAGE and the database generates the
   * amount; an invoice line takes an absolute discountAmount. Mapping the
   * lines without it produced an invoice for 1160 against a quote for 1044 —
   * the customer's 10% silently gone. A test caught it.
   *
   * Prorated, because a partial conversion takes part of the line: invoicing 4
   * of 10 carries four tenths of the discount. Computed in SQL, at
   * numeric(19,4), with the same ROUND the generated column uses — doing it in
   * JavaScript is the §2.1 mistake this port exists to stop making.
   */
  // Bound as ARRAY LITERALS, not as JavaScript arrays: the driver binds a JS
  // array as one scalar and Postgres answers "malformed array literal". Both
  // are still parameters, and both hold values Postgres itself produced.
  const idList = `{${toInvoice.map(({ line }) => line.id).join(",")}}`;
  const qtyList = `{${toInvoice.map(({ quantity }) => quantity).join(",")}}`;
  const discountRows = (await tx.execute(sql`
    SELECT u.line_id::text AS line_id,
           ROUND(u.qty * ql.unit_price * ql.discount_percentage / 100, 4)::text AS discount
      FROM unnest(${idList}::uuid[], ${qtyList}::numeric[]) AS u(line_id, qty)
      JOIN quote_lines ql ON ql.id = u.line_id
  `)) as unknown as Array<{ line_id: string; discount: string }>;
  const discountByLine = new Map(discountRows.map((r) => [r.line_id, r.discount]));

  const invoice = await invoicesRepo.createInvoice(tx, {
    companyId: quote.companyId,
    customerId: quote.customerId,
    invoiceDate: input.invoiceDate,
    dueDate: input.dueDate ?? null,
    title: quote.title ?? null,
    notes: input.notes ?? quote.notes ?? null,
    lines: toInvoice.map(({ line, quantity }) => ({
      itemType: line.itemType as "product" | "service",
      serviceCategory: (line.serviceCategory ?? undefined) as never,
      productId: line.productId ?? null,
      description: line.description ?? line.productName ?? null,
      unit: line.unit ?? "pcs",
      quantity,
      unitPrice: line.unitPrice,
      discountAmount: discountByLine.get(line.id) ?? "0",
      taxRate: line.taxRate,
      fulfilmentSource: "inventory",
    })),
    createdById: input.createdById ?? null,
    createdByName: input.createdByName ?? null,
    createdByRole: input.createdByRole ?? null,
  });

  // The lineage. Header first, then a row per line carrying what flowed.
  await tx.insert(documentFlow).values({
    companyId: quote.companyId,
    predecessorType: "quote",
    predecessorId: quoteId,
    successorType: "invoice",
    successorId: invoice.id,
    quantity: null,
    createdById: input.createdById ?? null,
  });

  const newLines = await tx.execute(sql`
    SELECT id, line_number FROM invoice_lines
     WHERE invoice_id = ${invoice.id}::uuid
     ORDER BY line_number
  `) as unknown as Array<{ id: string; line_number: number }>;

  let i = 0;
  for (const { line, quantity } of toInvoice) {
    const invoiceLine = newLines[i++];
    if (!invoiceLine) break;
    await tx.insert(documentFlow).values({
      companyId: quote.companyId,
      predecessorType: "quote_line",
      predecessorId: line.id,
      successorType: "invoice_line",
      successorId: invoiceLine.id,
      quantity,
      createdById: input.createdById ?? null,
    });
  }

  // Fully invoiced means converted; partially invoiced leaves it where it was,
  // so the rest can still be billed.
  const after = (await tx.execute(sql`
    SELECT COALESCE(SUM(quoted_quantity - invoiced_quantity), 0) AS remaining
      FROM quote_line_invoiced WHERE quote_id = ${quoteId}::uuid
  `)) as unknown as Array<{ remaining: string }>;

  if (Number(after[0]?.remaining ?? 0) <= 0 && canTransition(quote.status, "converted")) {
    await tx
      .update(quotes)
      .set({ status: "converted", convertedAt: new Date(), updatedAt: new Date() })
      .where(eq(quotes.id, quoteId));
  }

  return { invoice, remaining: after[0]?.remaining ?? "0" };
}
