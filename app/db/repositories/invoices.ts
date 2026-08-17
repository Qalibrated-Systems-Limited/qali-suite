import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import {
  invoices,
  invoiceLines,
  cogsPostings,
  products,
  parties,
} from "../schema";
import { createJournalEntry } from "./journal";
import { issueStock, commitStock } from "./products";
import { recordMovement } from "./stockMovements";
import { recordInvoiceVatOutput } from "./taxTransactions";

/**
 * Sales invoices and the posting they drive.
 *
 * Money is passed and returned as strings throughout — numeric(19,4) maps to
 * string in Drizzle precisely so values never round-trip through float64.
 */

export type FulfilmentSource =
  | "inventory"
  | "stock_request"
  | "checkout"
  | "weighbridge";

export interface InvoiceLineInput {
  productId: string;
  quantity: string;
  unitPrice: string;
  unitCost?: string;
  description?: string | null;
  discountAmount?: string;
  taxAmount?: string;
  /**
   * Where this line's stock comes from. Mandatory and single-valued — the
   * matching reference below must be supplied and the others left out, which a
   * CHECK enforces (§8.1). In Mongo this was inferred from whether a nullable
   * nested field happened to exist, so a field that failed to save silently
   * changed which inventory account COGS credited.
   */
  fulfilmentSource?: FulfilmentSource;
  stockRequestId?: string | null;
  checkoutId?: string | null;
  weighbridgeTicketId?: string | null;
}

export interface CreateInvoiceInput {
  companyId: string;
  customerId: string;
  invoiceDate: string;
  dueDate?: string | null;
  title?: string | null;
  notes?: string | null;
  lines: InvoiceLineInput[];
  createdById?: string | null;
}

/** Exact decimal arithmetic on money strings, via Postgres rather than JS. */
async function sumNumeric(tx: Tx, values: string[]): Promise<string> {
  if (values.length === 0) return "0.0000";
  const [row] = (await tx.execute(sql`
    SELECT SUM(v)::numeric(19,4) AS total
      FROM unnest(ARRAY[${sql.join(
        values.map((v) => sql`${v}::numeric(19,4)`),
        sql`, `,
      )}]) AS v
  `)) as unknown as Array<{ total: string }>;
  return row.total;
}

/**
 * Creates a draft invoice with its lines and commits the stock they reserve.
 *
 * Line totals are computed in Postgres, not JavaScript — summing money in JS
 * is what produced the drift the whole migration exists to remove.
 */
export async function createInvoice(tx: Tx, input: CreateInvoiceInput) {
  const [{ invoice_number }] = (await tx.execute(
    sql`SELECT next_entry_number(${input.companyId}::uuid, 'INV') AS invoice_number`,
  )) as unknown as Array<{ invoice_number: string }>;

  // Resolve each line's cost from the product now: the cost at sale time is a
  // historical fact and must not move when the product is re-costed later.
  const resolved = [];
  for (const line of input.lines) {
    const [product] = await tx
      .select()
      .from(products)
      .where(eq(products.id, line.productId));
    if (!product) throw new Error(`Product not found: ${line.productId}`);

    const [{ line_total }] = (await tx.execute(sql`
      SELECT (${line.quantity}::numeric(19,4) * ${line.unitPrice}::numeric(19,4)
              - ${line.discountAmount ?? "0"}::numeric(19,4)
              + ${line.taxAmount ?? "0"}::numeric(19,4))::numeric(19,4) AS line_total
    `)) as unknown as Array<{ line_total: string }>;

    resolved.push({
      ...line,
      unitCost: line.unitCost ?? product.costPrice,
      lineTotal: line_total,
    });
  }

  const subtotal = await sumNumeric(
    tx,
    resolved.map((r) => r.lineTotal),
  );
  const taxTotal = await sumNumeric(
    tx,
    resolved.map((r) => r.taxAmount ?? "0"),
  );

  const [invoice] = await tx
    .insert(invoices)
    .values({
      companyId: input.companyId,
      invoiceNumber: invoice_number,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate ?? null,
      customerId: input.customerId,
      title: input.title ?? null,
      notes: input.notes ?? null,
      subtotal,
      taxAmount: taxTotal,
      total: subtotal,
      status: "draft",
      createdById: input.createdById ?? null,
    })
    .returning();

  let n = 0;
  for (const line of resolved) {
    n++;
    await tx.insert(invoiceLines).values({
      companyId: input.companyId,
      invoiceId: invoice.id,
      productId: line.productId,
      lineNumber: n,
      description: line.description ?? null,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      unitCost: line.unitCost,
      discountAmount: line.discountAmount ?? "0",
      taxAmount: line.taxAmount ?? "0",
      lineTotal: line.lineTotal,
      fulfilmentSource: line.fulfilmentSource ?? "inventory",
      stockRequestId: line.stockRequestId ?? null,
      checkoutId: line.checkoutId ?? null,
      weighbridgeTicketId: line.weighbridgeTicketId ?? null,
    });

    // Reserve the stock while the invoice is a draft.
    if ((line.fulfilmentSource ?? "inventory") === "inventory") {
      await commitStock(tx, line.productId, line.quantity);
    }
  }

  return invoice;
}

export async function getInvoice(tx: Tx, invoiceId: string) {
  const [invoice] = await tx
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  if (!invoice) return null;

  const lines = await tx
    .select({
      id: invoiceLines.id,
      lineNumber: invoiceLines.lineNumber,
      productId: invoiceLines.productId,
      sku: products.sku,
      productName: products.name,
      description: invoiceLines.description,
      quantity: invoiceLines.quantity,
      unitPrice: invoiceLines.unitPrice,
      unitCost: invoiceLines.unitCost,
      lineTotal: invoiceLines.lineTotal,
      fulfilmentSource: invoiceLines.fulfilmentSource,
    })
    .from(invoiceLines)
    .innerJoin(products, eq(products.id, invoiceLines.productId))
    .where(eq(invoiceLines.invoiceId, invoiceId))
    .orderBy(invoiceLines.lineNumber);

  const [customer] = await tx
    .select({ id: parties.id, name: parties.name, email: parties.email })
    .from(parties)
    .where(eq(parties.id, invoice.customerId));

  return { ...invoice, lines, customer: customer ?? null };
}

/**
 * Records that COGS has been posted for one invoice line — the §8.3
 * correction.
 *
 * Both the invoice posting path and the weighbridge connector call this. The
 * primary key on invoice_line_id means the SECOND caller takes a unique
 * violation instead of duplicating the posting, whatever order they arrive in
 * and whatever else is happening concurrently.
 *
 * That replaces the current arrangement, where the connector reads the
 * invoice's status and stands down if it looks already-posted — a check in one
 * process, a write in another, and no transaction spanning them.
 *
 * Returns null if COGS was already posted by someone else, so callers can skip
 * quietly rather than treating an expected outcome as an error.
 */
export async function recordCogsPosting(
  tx: Tx,
  input: {
    invoiceLineId: string;
    companyId: string;
    postedBy: "invoice" | "weighbridge";
    journalEntryId: string;
    quantity: string;
    unitCost: string;
  },
) {
  const [{ total_cost }] = (await tx.execute(sql`
    SELECT (${input.quantity}::numeric(19,4) * ${input.unitCost}::numeric(19,4))::numeric(19,4) AS total_cost
  `)) as unknown as Array<{ total_cost: string }>;

  const inserted = await tx
    .insert(cogsPostings)
    .values({
      invoiceLineId: input.invoiceLineId,
      companyId: input.companyId,
      postedBy: input.postedBy,
      journalEntryId: input.journalEntryId,
      quantity: input.quantity,
      unitCost: input.unitCost,
      totalCost: total_cost,
    })
    .onConflictDoNothing()
    .returning();

  return inserted[0] ?? null;
}

/** Has COGS already been posted for this line, and by whom? */
export async function getCogsPosting(tx: Tx, invoiceLineId: string) {
  const [row] = await tx
    .select()
    .from(cogsPostings)
    .where(eq(cogsPostings.invoiceLineId, invoiceLineId));
  return row ?? null;
}

/**
 * Completes a draft invoice: posts the revenue entry, issues the stock, and
 * posts COGS for any line the weighbridge has not already costed.
 *
 * The revenue and COGS entries, the stock issue and the cogs_postings rows all
 * land in the caller's transaction, so a failure anywhere leaves no half-posted
 * invoice — unlike the Mongo path, where inventory counters were updated
 * outside the session.
 */
export async function completeInvoice(
  tx: Tx,
  invoiceId: string,
  opts: {
    arAccountId: string;
    revenueAccountId: string;
    completedById: string;
    /**
     * Supply to raise the VAT Output record alongside the posting, as
     * invoice.js:1025 does. Optional because an invoice carrying no tax has
     * nothing to file.
     */
    vatOutputAccountId?: string | null;
    vatRate?: string;
  },
) {
  const [invoice] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.status, "draft")));

  if (!invoice) throw new Error("Invoice not found, or not in draft status");

  const lines = await tx
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId))
    .orderBy(invoiceLines.lineNumber);

  if (lines.length === 0) {
    throw new Error("Cannot complete an invoice with no lines");
  }

  // ── Revenue: DR Accounts Receivable / CR Sales ──────────────────────────
  const revenueEntry = await createJournalEntry(tx, {
    companyId: invoice.companyId,
    entryDate: invoice.invoiceDate,
    entryType: "sale",
    description: `Invoice ${invoice.invoiceNumber}`,
    reference: invoice.invoiceNumber,
    partyType: "customer",
    partyId: invoice.customerId,
    dueDate: invoice.dueDate,
    sourceType: "invoice",
    sourceId: invoice.id,
    createdById: opts.completedById,
    postImmediately: true,
    lines: [
      { accountId: opts.arAccountId, debit: invoice.total },
      { accountId: opts.revenueAccountId, credit: invoice.total },
    ],
  });

  // ── Stock issue + COGS, per line ───────────────────────────────────────
  const cogsSkipped: string[] = [];
  for (const line of lines) {
    // A weighbridge line's stock left at the gate and was costed there, so the
    // movement was recorded by the connector rather than here.
    if (line.fulfilmentSource !== "weighbridge") {
      // Record what physically moved, linked to the line. This is the last
      // link in the COGS provenance chain: invoice line -> COGS posting ->
      // stock movement. Without it a cost figure has no documented basis.
      //
      // BEFORE issueStock, not after: recordMovement reads the product's
      // current level as `previous_stock` and derives `new_stock` from it.
      // Issuing first made both figures describe the wrong transition — a
      // sale of 10 from 100 recorded "90 -> 80" — so every movement
      // understated the stock either side of it by the quantity that moved.
      await recordMovement(tx, {
        companyId: invoice.companyId,
        productId: line.productId,
        movementType: "sale",
        direction: "out",
        quantity: line.quantity,
        unitCost: line.unitCost,
        invoiceLineId: line.id,
        sourceReference: invoice.invoiceNumber,
        performedById: opts.completedById,
      });

      await issueStock(tx, line.productId, line.quantity);
    }

    const posting = await recordCogsPosting(tx, {
      invoiceLineId: line.id,
      companyId: invoice.companyId,
      postedBy: "invoice",
      journalEntryId: revenueEntry.id,
      quantity: line.quantity,
      unitCost: line.unitCost,
    });

    // Already costed — by the weighbridge, at the weighed quantity. Expected,
    // not an error.
    if (!posting) cogsSkipped.push(line.id);
  }

  const [updated] = await tx
    .update(invoices)
    .set({
      status: "completed",
      completedAt: new Date(),
      completedById: opts.completedById,
      revenueEntryId: revenueEntry.id,
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, invoiceId))
    .returning();

  // VAT Output, in the same transaction as the posting it belongs to.
  const vatOutput = opts.vatOutputAccountId
    ? await recordInvoiceVatOutput(tx, {
        companyId: invoice.companyId,
        invoiceId: invoice.id,
        vatOutputAccountId: opts.vatOutputAccountId,
        taxRate: opts.vatRate,
        createdById: opts.completedById,
      })
    : null;

  return { invoice: updated, revenueEntry, cogsSkipped, vatOutput };
}

export async function listInvoices(
  tx: Tx,
  opts: { limit?: number; offset?: number; status?: "draft" | "completed" | "cancelled" } = {},
) {
  const limit = Math.min(opts.limit ?? 50, 200);
  return tx
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      dueDate: invoices.dueDate,
      customerName: parties.name,
      total: invoices.total,
      amountPaid: invoices.amountPaid,
      status: invoices.status,
      paymentStatus: invoices.paymentStatus,
    })
    .from(invoices)
    .innerJoin(parties, eq(parties.id, invoices.customerId))
    .where(opts.status ? eq(invoices.status, opts.status) : undefined)
    .orderBy(desc(invoices.invoiceDate), desc(invoices.invoiceNumber))
    .limit(limit)
    .offset(opts.offset ?? 0);
}
