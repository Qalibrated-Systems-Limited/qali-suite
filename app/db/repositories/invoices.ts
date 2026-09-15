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
import { issueStock, commitStock, releaseStock } from "./products";
import { recordMovement } from "./stockMovements";
import { recordInvoiceVatOutput } from "./taxTransactions";
import { isUuid, likeContains, likePrefix } from "./sqlHelpers";

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
  /** Required for a product line, omitted for a service. */
  productId?: string | null;
  /** Defaults to "product" when a productId is given, "service" otherwise. */
  itemType?: "product" | "service";
  serviceCategory?:
    | "labor"
    | "mileage"
    | "accommodation"
    | "installation"
    | "consultation"
    | "maintenance"
    | "repair"
    | "other";
  quantity: string;
  unitPrice: string;
  unitCost?: string;
  unit?: string;
  description?: string | null;
  discountAmount?: string;
  /**
   * Absolute tax for the line. Supply this OR taxRate, not both.
   */
  taxAmount?: string;
  /**
   * Tax as a percentage. Preferred over taxAmount: the UI knows the rate, and
   * computing the amount here keeps it exact decimal instead of the float
   * multiplication a browser would do. invoice_lines stores only the amount,
   * so the rate is not retained — see the note in §9B.2 about rates.
   */
  taxRate?: string;
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
  /** Who sold it — 0095. Carried from the quote; null on a direct invoice. */
  salespersonPartyId?: string | null;
  salespersonName?: string | null;
  invoiceDate: string;
  dueDate?: string | null;
  title?: string | null;
  notes?: string | null;
  /** A Mongo ObjectId — projects are not ported. See 0054. */
  projectId?: string | null;
  /**
   * Header discount, 0-100. The form has always shown one; nothing stored it
   * until 0055. The cap that bounds it is enforced in the action, where the
   * caller's role is known.
   */
  discountPercentage?: string | null;
  lines: InvoiceLineInput[];
  createdById?: string | null;
  createdByName?: string | null;
  createdByRole?: string | null;
}

/** True for "0", "0.0000" and friends, without going through Number(). */
const isZeroMoney = (v: string | null) => v === null || /^-?0(\.0*)?$/.test(v);

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
 * Resolves a set of line inputs into rows, with every amount computed in
 * Postgres.
 *
 * Shared by create and update so the two cannot drift: an edited invoice is
 * priced, costed and taxed by exactly the rules that created it.
 */
async function resolveInvoiceLines(tx: Tx, inputs: InvoiceLineInput[]) {
  // Resolve each line's cost from the product now: the cost at sale time is a
  // historical fact and must not move when the product is re-costed later.
  const resolved = [];
  for (const line of inputs) {
    const itemType = line.itemType ?? (line.productId ? "product" : "service");

    // A service has no product and therefore no inventory cost. Mongo has
    // always allowed these; this table could not express them until migration
    // 0025.
    let product = null;
    if (itemType === "product") {
      if (!line.productId) {
        throw new Error("A product line must name a product");
      }
      [product] = await tx
        .select()
        .from(products)
        .where(eq(products.id, line.productId));
      if (!product) throw new Error(`Product not found: ${line.productId}`);
    } else if (line.productId) {
      throw new Error("A service line cannot name a product");
    }

    // Tax and the line total are computed in Postgres, in exact decimal. The
    // form multiplies rate by amount in float64 and would hand us the drift
    // this migration exists to remove.
    const [{ tax_amount, line_total, net_amount }] = (await tx.execute(sql`
      WITH t AS (
        SELECT ${line.quantity}::numeric(19,4)  AS qty,
               ${line.unitPrice}::numeric(19,4) AS price,
               ${line.discountAmount ?? "0"}::numeric(19,4) AS disc,
               ${line.taxAmount ?? null}::numeric(19,4)     AS tax_abs,
               ${line.taxRate ?? null}::numeric(9,4)        AS tax_rate
      )
      SELECT tax.amount::text AS tax_amount,
             (t.qty * t.price - t.disc)::numeric(19,4)::text AS net_amount,
             (t.qty * t.price - t.disc + tax.amount)::numeric(19,4)::text AS line_total
        FROM t,
             LATERAL (
               SELECT COALESCE(
                 t.tax_abs,
                 ROUND((t.qty * t.price - t.disc) * COALESCE(t.tax_rate, 0) / 100, 4),
                 0
               ) AS amount
             ) AS tax
    `)) as unknown as Array<{ tax_amount: string; line_total: string; net_amount: string }>;

    resolved.push({
      ...line,
      itemType,
      taxAmount: tax_amount,
      netAmount: net_amount,
      unitCost: line.unitCost ?? product?.costPrice ?? "0",
      lineTotal: line_total,
    });
  }


  const subtotal = await sumNumeric(
    tx,
    resolved.map((r) => r.netAmount),
  );
  const taxTotal = await sumNumeric(
    tx,
    resolved.map((r) => r.taxAmount ?? "0"),
  );
  const total = await sumNumeric(tx, [subtotal, taxTotal]);

  return { lines: resolved, subtotal, taxTotal, total };
}

/**
 * Applies a header discount the way Mongo does — and the way the form has been
 * telling users it works all along.
 *
 * `invoice.js:767-800`: the discount comes off the subtotal, and the tax is
 * scaled by the resulting factor rather than recomputed, because a line's own
 * `tax_amount` is stored PRE-discount for audit. So:
 *
 *     discount = subtotal x pct/100
 *     factor   = (subtotal - discount) / subtotal
 *     tax      = sum(line tax) x factor
 *     total    = subtotal - discount + tax
 *
 * Done in NUMERIC, not JavaScript. `factor` is a division and usually a
 * repeating decimal; running it through float is precisely the drift §2.1 is
 * about. Mongo rounds to 2dp at each step in `lib/money.js` and has to.
 */
async function applyHeaderDiscount(
  tx: Tx,
  amounts: { subtotal: string; taxTotal: string },
  discountPercentage?: string | null,
) {
  const pct = discountPercentage ?? "0";

  const [row] = (await tx.execute(sql`
    WITH base AS (
      SELECT ${amounts.subtotal}::numeric(19,4) AS subtotal,
             ${amounts.taxTotal}::numeric(19,4) AS tax_total,
             ${pct}::numeric(9,4)               AS pct
    ), d AS (
      SELECT subtotal, tax_total, pct,
             ROUND(subtotal * pct / 100, 4)::numeric(19,4) AS discount_total
        FROM base
    )
    SELECT discount_total::text AS discount_total,
           (CASE WHEN subtotal = 0 THEN tax_total
                 ELSE ROUND(tax_total * (subtotal - discount_total) / subtotal, 4)
            END)::numeric(19,4)::text AS tax_amount,
           (subtotal - discount_total +
             CASE WHEN subtotal = 0 THEN tax_total
                  ELSE ROUND(tax_total * (subtotal - discount_total) / subtotal, 4)
             END)::numeric(19,4)::text AS total
      FROM d
  `)) as unknown as Array<{
    discount_total: string;
    tax_amount: string;
    total: string;
  }>;

  return {
    discountPercentage: pct,
    discountTotal: row.discount_total,
    taxAmount: row.tax_amount,
    total: row.total,
  };
}

/**
 * Creates a draft invoice with its lines and commits the stock they reserve.
 *
 * Line totals are computed in Postgres, not JavaScript — summing money in JS
 * is what produced the drift the whole migration exists to remove.
 */
export async function createInvoice(tx: Tx, input: CreateInvoiceInput) {
  // document_prefix, not a literal 'INV': the tenant's configured prefix lived
  // in Mongo settings that nothing on this path read, so a company that chose
  // its own numbering silently stopped getting it when this ported (0035).
  const [{ invoice_number }] = (await tx.execute(
    sql`SELECT next_entry_number(
      ${input.companyId}::uuid,
      document_prefix(${input.companyId}::uuid, 'invoice')
    ) AS invoice_number`,
  )) as unknown as Array<{ invoice_number: string }>;

  const { lines: resolved, subtotal, taxTotal } = await resolveInvoiceLines(
    tx,
    input.lines,
  );
  const discounted = await applyHeaderDiscount(
    tx,
    { subtotal, taxTotal },
    input.discountPercentage,
  );

  const [invoice] = await tx
    .insert(invoices)
    .values({
      companyId: input.companyId,
      invoiceNumber: invoice_number,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate ?? null,
      customerId: input.customerId,
      /**
       * `invoices_salesperson_pair` refuses an id with no name — a row the
       * report can group and cannot label — so they travel together or not
       * at all.
       */
      salespersonPartyId: input.salespersonName ? (input.salespersonPartyId ?? null) : null,
      salespersonName: input.salespersonPartyId ? (input.salespersonName ?? null) : null,
      title: input.title ?? null,
      notes: input.notes ?? null,
      projectId: input.projectId ?? null,
      subtotal,
      discountPercentage: discounted.discountPercentage,
      discountTotal: discounted.discountTotal,
      taxAmount: discounted.taxAmount,
      total: discounted.total,
      status: "draft",
      createdById: input.createdById ?? null,
      createdByName: input.createdByName ?? null,
      createdByRole: input.createdByRole ?? null,
    })
    .returning();

  let n = 0;
  for (const line of resolved) {
    n++;
    await tx.insert(invoiceLines).values({
      companyId: input.companyId,
      invoiceId: invoice.id,
      itemType: line.itemType,
      serviceCategory: line.serviceCategory ?? null,
      productId: line.productId ?? null,
      lineNumber: n,
      description: line.description ?? null,
      unit: line.unit ?? "pcs",
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

    // Reserve the stock while the invoice is a draft. A service reserves
    // nothing — there is no stock behind it.
    if (
      line.itemType === "product" &&
      (line.fulfilmentSource ?? "inventory") === "inventory"
    ) {
      await commitStock(tx, line.productId!, line.quantity);
    }
  }

  return invoice;
}

export async function getInvoice(tx: Tx, invoiceId: string) {
  // An id a uuid column cannot hold is NOT FOUND, not a 22P02 with
  // the statement in the message. See isUuid in sqlHelpers.
  if (!isUuid(invoiceId)) return null;
  const [invoice] = await tx
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  if (!invoice) return null;

  const lines = await tx
    .select({
      id: invoiceLines.id,
      lineNumber: invoiceLines.lineNumber,
      itemType: invoiceLines.itemType,
      serviceCategory: invoiceLines.serviceCategory,
      productId: invoiceLines.productId,
      sku: products.sku,
      productName: products.name,
      description: invoiceLines.description,
      unit: invoiceLines.unit,
      quantity: invoiceLines.quantity,
      unitPrice: invoiceLines.unitPrice,
      unitCost: invoiceLines.unitCost,
      lineTotal: invoiceLines.lineTotal,
      fulfilmentSource: invoiceLines.fulfilmentSource,
    })
    .from(invoiceLines)
    // LEFT: a service line has no product, and an inner join would drop it
    // from the invoice entirely.
    .leftJoin(products, eq(products.id, invoiceLines.productId))
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
    /**
     * Cost of sales. Supply these and the completion posts
     * DR COGS / CR Inventory (and/or Technician Stock) alongside revenue.
     * Without them the stock leaves and its value never comes off the balance
     * sheet — see migration 0027.
     */
    /**
     * RETENTION HELD ON THIS INVOICE — the contract's, not the invoice's.
     *
     * The invoice is raised for the GROSS value certified, because VAT is due
     * on the value of the supply and not on what is paid after deductions.
     * What the employer holds back is then reclassified out of receivables:
     *
     *     DR Retention Receivable / CR Accounts Receivable
     *
     * Revenue stays at the gross, VAT stays on the gross, and the receivable
     * splits into the part due now and the part held. Invoicing the NET
     * instead would understate both revenue and output VAT for the life of
     * every job that retains.
     *
     * Passed IN rather than looked up, so this file need not know that
     * certificates exist. The caller knows.
     */
    retention?: { amount: string; accountId: string } | null;
    /**
     * The advance recovered by this certificate, if any — the mirror of the
     * retention split, on the other side of the balance sheet:
     *
     *     DR Customer Advance / CR Accounts Receivable
     *
     * The employer paid this money before any work was done, and it sits as a
     * liability until the works earn it. Recovering it is not revenue and not
     * a discount: the certificate is still worth its gross, the client simply
     * pays less cash because they have already paid this part. Without the
     * entry the receivable is overstated by every shilling recovered and the
     * advance sits on the balance sheet at its full value for ever.
     *
     * No VAT adjustment: output VAT was accounted on the gross valuation, and
     * how the client settles it does not change the value of the supply.
     */
    advanceRecovery?: { amount: string; accountId: string } | null;
    cogsAccountId?: string | null;
    inventoryAccountId?: string | null;
    technicianStockAccountId?: string | null;
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
    // The project dimension — 0084. Every line of a sale belongs to the job it
    // was raised against, receivable and revenue alike.
    projectId: invoice.projectId ?? null,
    createdById: opts.completedById,
    postImmediately: true,
    // Three lines, not two. Crediting revenue with the gross overstates income
    // by the tax and leaves the liability to the revenue authority unrecorded —
    // the money is collected on their behalf, not earned. Mongo splits it
    // (invoice.js:1004, "Revenue journal entry (AR / Revenue / VAT Output)").
    lines: [
      {
        accountId: opts.arAccountId,
        debit: invoice.total,
        description: `Sale — invoice ${invoice.invoiceNumber}`,
      },
      {
        accountId: opts.revenueAccountId,
        credit: invoice.subtotal,
        description: "Sales revenue",
      },
      ...(isZeroMoney(invoice.taxAmount)
        ? []
        : [
            {
              accountId: (() => {
                if (!opts.vatOutputAccountId) {
                  throw new Error(
                    "Invoice carries tax but the VAT Output system account is not configured",
                  );
                }
                return opts.vatOutputAccountId;
              })(),
              credit: invoice.taxAmount,
              description: "VAT Output on sales",
            },
          ]),
    ],
  });

  /**
   * The retention split, as its own entry rather than a line on the sale.
   *
   * A separate document because it is a different event: the sale recognised
   * the revenue, and this records that part of the resulting receivable will
   * not be collected until the works are taken over. Keeping them apart means
   * the sale entry still reads as a sale, and the retention can be released
   * later by reversing this and nothing else.
   */
  if (opts.retention && Number(opts.retention.amount) > 0) {
    await createJournalEntry(tx, {
      companyId: invoice.companyId,
      entryDate: invoice.invoiceDate,
      entryType: "adjustment",
      description: `Retention held — invoice ${invoice.invoiceNumber}`,
      reference: invoice.invoiceNumber,
      partyType: "customer",
      partyId: invoice.customerId,
      sourceType: "invoice",
      sourceId: invoice.id,
      projectId: invoice.projectId ?? null,
      createdById: opts.completedById,
      postImmediately: true,
      lines: [
        {
          accountId: opts.retention.accountId,
          debit: opts.retention.amount,
          description: "Held by the employer until taking-over",
        },
        {
          accountId: opts.arAccountId,
          credit: opts.retention.amount,
          description: "Not collectable this certificate",
        },
      ],
    });
  }

  /**
   * The advance recovery, likewise its own entry. Separate from the retention
   * so that either can be reversed without disturbing the other, and so a
   * reader of the ledger sees two distinct reasons the client pays less than
   * the invoice says.
   */
  if (opts.advanceRecovery && Number(opts.advanceRecovery.amount) > 0) {
    await createJournalEntry(tx, {
      companyId: invoice.companyId,
      entryDate: invoice.invoiceDate,
      entryType: "adjustment",
      description: `Advance recovered — invoice ${invoice.invoiceNumber}`,
      reference: invoice.invoiceNumber,
      partyType: "customer",
      partyId: invoice.customerId,
      sourceType: "invoice",
      sourceId: invoice.id,
      projectId: invoice.projectId ?? null,
      createdById: opts.completedById,
      postImmediately: true,
      lines: [
        {
          accountId: opts.advanceRecovery.accountId,
          debit: opts.advanceRecovery.amount,
          description: "Advance earned by the work certified",
        },
        {
          accountId: opts.arAccountId,
          credit: opts.advanceRecovery.amount,
          description: "Already paid by the employer in advance",
        },
      ],
    });
  }

  // ── Stock issue + COGS, per line ───────────────────────────────────────
  const cogsSkipped: string[] = [];
  for (const line of lines) {
    // A service moves no stock and has no cost of sale. Nothing to issue,
    // nothing to record, nothing to cost — invoice.js costs product items
    // only, and migration 0025 makes posting COGS against a service an error
    // rather than something to remember not to do.
    if (line.itemType === "service") continue;

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
        productId: line.productId!,
        movementType: "sale",
        direction: "out",
        quantity: line.quantity,
        unitCost: line.unitCost,
        invoiceLineId: line.id,
        sourceReference: invoice.invoiceNumber,
        performedById: opts.completedById,
      });

      await issueStock(tx, line.productId!, line.quantity);
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

  // ── Cost of sales: DR COGS / CR wherever the stock came from ────────────
  //
  // §8.1 is the whole reason fulfilment_source is mandatory and single-valued:
  // it decides which account COGS credits. Goods sold from the warehouse credit
  // Inventory; goods sold out of a technician's van credit Technician Stock.
  // A weighbridge line is skipped entirely — the gate already posted DR COGS /
  // CR Inventory when the truck crossed the scale, and posting again would
  // double the cost.
  let cogsEntryId: string | null = null;
  if (opts.cogsAccountId) {
    let fromInventory = "0";
    let fromTechnicianStock = "0";

    for (const line of lines) {
      if (line.itemType !== "product") continue; // a service has no cost
      if (line.fulfilmentSource === "weighbridge") continue; // costed at the gate
      if (cogsSkipped.includes(line.id)) continue; // someone else costed it

      const [{ cost }] = (await tx.execute(sql`
        SELECT (${line.quantity}::numeric(19,4) * ${line.unitCost}::numeric(19,4))::numeric(19,4) AS cost
      `)) as unknown as Array<{ cost: string }>;

      if (line.fulfilmentSource === "inventory") {
        fromInventory = await sumNumeric(tx, [fromInventory, cost]);
      } else {
        fromTechnicianStock = await sumNumeric(tx, [fromTechnicianStock, cost]);
      }
    }

    const total = await sumNumeric(tx, [fromInventory, fromTechnicianStock]);

    if (Number(total) > 0) {
      const creditLines = [];
      if (Number(fromInventory) > 0) {
        if (!opts.inventoryAccountId) {
          throw new Error("Inventory system account not configured");
        }
        creditLines.push({
          accountId: opts.inventoryAccountId,
          credit: fromInventory,
          description: "From inventory (direct sales)",
        });
      }
      if (Number(fromTechnicianStock) > 0) {
        if (!opts.technicianStockAccountId) {
          throw new Error("Technician Stock system account not configured");
        }
        creditLines.push({
          accountId: opts.technicianStockAccountId,
          credit: fromTechnicianStock,
          description: "From technician stock",
        });
      }

      const cogsEntry = await createJournalEntry(tx, {
        companyId: invoice.companyId,
        entryDate: invoice.invoiceDate,
        entryType: "sale",
        description: `Cost of sales — Invoice ${invoice.invoiceNumber}`,
        reference: invoice.invoiceNumber,
        sourceType: "invoice",
        sourceId: invoice.id,
        projectId: invoice.projectId ?? null,
        createdById: opts.completedById,
        postImmediately: true,
        lines: [
          {
            accountId: opts.cogsAccountId,
            debit: total,
            description: "Cost of goods sold",
          },
          ...creditLines,
        ],
      });
      cogsEntryId = cogsEntry.id;

      // The postings belong to the COGS entry, not the revenue one — that is
      // the entry that actually moved the cost.
      await tx.execute(sql`
        UPDATE cogs_postings SET journal_entry_id = ${cogsEntryId}
         WHERE invoice_line_id IN (
           SELECT id FROM invoice_lines WHERE invoice_id = ${invoiceId}
         )
         AND posted_by = 'invoice'
      `);
    }
  }

  const [updated] = await tx
    .update(invoices)
    .set({
      status: "completed",
      completedAt: new Date(),
      completedById: opts.completedById,
      revenueEntryId: revenueEntry.id,
      cogsEntryId,
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

  return { invoice: updated, revenueEntry, cogsEntryId, cogsSkipped, vatOutput };
}

/**
 * One invoice with everything the detail page renders.
 *
 * Two queries, not one: joining lines to a header repeats every header column
 * per line, and the page needs both shapes anyway. Both run inside the caller's
 * RLS-scoped transaction.
 *
 * `items` rather than `lines`, and `type`/`name`/`SKU` rather than the column
 * names, because that is what the existing page reads — matching the shape is
 * what lets the data source change without rewriting the markup.
 */
/**
 * Cancels a draft or sent invoice, releasing the stock it had reserved.
 *
 * A COMPLETED invoice cannot be cancelled — it has posted revenue, COGS and
 * tax, and unwinding those silently would rewrite a period that may be closed.
 * The correction for a posted invoice is a credit note, which is why credit
 * notes exist. This mirrors app/mongodb/invoice-actions.js:1342 exactly.
 *
 * Only product lines fulfilled from inventory reserved anything: a service
 * holds no stock, and a line fulfilled from a technician's stock or the
 * weighbridge was never committed here.
 */
export async function cancelInvoice(
  tx: Tx,
  invoiceId: string,
  cancelledById: string,
  reason?: string,
) {
  const [invoice] = await tx
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId));

  if (!invoice) throw new Error("Invoice not found");
  if (invoice.status === "cancelled") {
    throw new Error("Invoice is already cancelled");
  }
  if (invoice.status !== "draft" && invoice.status !== "sent") {
    throw new Error(
      "Only draft or sent invoices can be cancelled. Raise a credit note for a completed invoice.",
    );
  }

  const lines = await tx
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId));

  for (const line of lines) {
    if (line.itemType !== "product" || !line.productId) continue;
    if (line.fulfilmentSource !== "inventory") continue;
    await releaseStock(tx, line.productId, line.quantity);
  }

  const [updated] = await tx
    .update(invoices)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledById,
      notes: reason ? `${invoice.notes ?? ""}\nCancelled: ${reason}`.trim() : invoice.notes,
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, invoiceId))
    .returning();

  return updated;
}

/**
 * Replaces a draft invoice's lines and header, re-reserving stock by the
 * difference.
 *
 * Ported from app/mongodb/invoice-actions.js:36. Its rules, kept:
 *
 *   - refuse if the invoice is PAID          (money has moved)
 *   - refuse if CANCELLED                    (it is closed)
 *   - refuse if COMPLETED                    (it has posted; correct it with
 *                                             a credit note)
 *   - a customer is required
 *   - commitments move by the DELTA: stock freed where a line shrank or
 *     vanished, reserved where it grew or appeared
 *   - products are read in one query, not per line (Mongo added this to kill
 *     an N+1 and the note is worth keeping)
 *
 * The §8/§9 corrections applied on top, and nothing else: money stays exact
 * decimal, the tenant filter is RLS rather than a passed companyId,
 * fulfilment_source is single-valued, services are first-class (0025), and
 * subtotal is net of tax.
 *
 * Commitments are released in full and re-taken rather than adjusted in place.
 * The net effect is the delta Mongo computes, and doing it in that order never
 * transiently breaks CHECK (committed + on_hold <= on_hand) — reserving before
 * freeing could.
 */
export async function updateInvoice(
  tx: Tx,
  invoiceId: string,
  input: Omit<CreateInvoiceInput, "companyId" | "createdById">,
) {
  const [invoice] = await tx
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId));

  if (!invoice) throw new Error("Invoice not found");
  if (invoice.paymentStatus === "paid") {
    throw new Error("A paid invoice cannot be edited");
  }
  if (invoice.status === "cancelled") {
    throw new Error("A cancelled invoice cannot be edited");
  }
  if (invoice.status === "completed") {
    throw new Error(
      "A completed invoice cannot be edited. Raise a credit note instead.",
    );
  }
  if (input.lines.length === 0) {
    throw new Error("An invoice must have at least one line");
  }

  // Free everything this invoice was holding, then take what it now needs.
  const existing = await tx
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId));

  for (const line of existing) {
    if (line.itemType !== "product" || !line.productId) continue;
    if (line.fulfilmentSource !== "inventory") continue;
    await releaseStock(tx, line.productId, line.quantity);
  }

  await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));

  const { lines, subtotal, taxTotal } = await resolveInvoiceLines(
    tx,
    input.lines,
  );
  const discounted = await applyHeaderDiscount(
    tx,
    { subtotal, taxTotal },
    input.discountPercentage,
  );

  let n = 0;
  for (const line of lines) {
    n++;
    await tx.insert(invoiceLines).values({
      companyId: invoice.companyId,
      invoiceId,
      itemType: line.itemType,
      serviceCategory: line.serviceCategory ?? null,
      productId: line.productId ?? null,
      lineNumber: n,
      description: line.description ?? null,
      unit: line.unit ?? "pcs",
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

    if (
      line.itemType === "product" &&
      (line.fulfilmentSource ?? "inventory") === "inventory"
    ) {
      await commitStock(tx, line.productId!, line.quantity);
    }
  }

  const [updated] = await tx
    .update(invoices)
    .set({
      customerId: input.customerId,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate ?? null,
      title: input.title ?? null,
      notes: input.notes ?? null,
      projectId: input.projectId ?? null,
      subtotal,
      discountPercentage: discounted.discountPercentage,
      discountTotal: discounted.discountTotal,
      taxAmount: discounted.taxAmount,
      total: discounted.total,
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, invoiceId))
    .returning();

  return updated;
}

export async function getInvoiceDetail(tx: Tx, invoiceId: string) {
  // An id a uuid column cannot hold is NOT FOUND, not a 22P02 with
  // the statement in the message. See isUuid in sqlHelpers.
  if (!isUuid(invoiceId)) return null;
  const [inv] = (await tx.execute(sql`
    SELECT i.id,
           i.invoice_number,
           i.invoice_date,
           i.due_date,
           i.status::text          AS status,
           i.payment_status::text  AS payment_status,
           i.subtotal::text        AS subtotal,
           i.discount_percentage::text AS discount_percentage,
           i.discount_total::text  AS discount_total,
           i.tax_amount::text      AS tax_amount,
           i.total::text           AS total,
           i.amount_paid::text     AS amount_paid,
           (i.total - i.amount_paid)::text AS amount_due,
           i.currency,
           i.title,
           i.notes,
           i.created_by_name,
           i.created_by_role,
           i.customer_id,
           p.name    AS customer_name,
           p.email   AS customer_email,
           p.phone   AS customer_phone,
           p.tax_pin AS customer_tax_pin,
           concat_ws(', ',
             NULLIF(p.address_line1, ''), NULLIF(p.address_line2, ''),
             NULLIF(p.city, ''), NULLIF(p.country, '')
           ) AS customer_address
      FROM invoices i
      JOIN parties p ON p.id = i.customer_id
     WHERE i.id = ${invoiceId}
  `)) as unknown as Array<Record<string, string | null>>;

  if (!inv) return null;

  const items = (await tx.execute(sql`
    SELECT l.id,
           l.item_type::text AS type,
           l.description,
           l.unit,
           l.quantity::text    AS quantity,
           l.unit_price::text  AS unit_price,
           l.tax_amount::text  AS tax_amount,
           l.line_total::text  AS amount,
           l.discount_amount::text AS discount_amount,
           l.product_id,
           l.service_category::text AS service_category,
           -- invoice_lines stores the tax AMOUNT, not the rate. Consumers that
           -- need a rate (the credit note dialog prefills one) would otherwise
           -- fall back to a hardcoded 16%, which is silently wrong for a line
           -- billed at 0 or 8. Recovering it from the amount and its base is
           -- exact, and avoids storing a second value that could disagree.
           CASE
             WHEN (l.quantity * l.unit_price - l.discount_amount) = 0 THEN 0
             ELSE ROUND(
               l.tax_amount * 100
               / (l.quantity * l.unit_price - l.discount_amount), 4)
           END::text AS tax_rate,
           pr.name AS product_name,
           pr.sku  AS sku
      FROM invoice_lines l
      LEFT JOIN products pr ON pr.id = l.product_id
     WHERE l.invoice_id = ${invoiceId}
     ORDER BY l.line_number
  `)) as unknown as Array<Record<string, string | null>>;

  return {
    _id: inv.id,
    id: inv.id,
    invoiceNumber: inv.invoice_number,
    invoiceDate: inv.invoice_date,
    dueDate: inv.due_date,
    status: inv.status,
    paymentStatus: inv.payment_status,
    subtotal: inv.subtotal,
    // EditInvoiceForm pre-fills its discount box from `discountPercentage`.
    // Without it the box reads 0 on every edit, and saving would quietly strip
    // a discount the invoice already carried (0055).
    discountPercentage: Number(inv.discount_percentage ?? 0),
    discountAmount: inv.discount_total,
    totalDiscount: inv.discount_total,
    taxAmount: inv.tax_amount,
    total: inv.total,
    amountPaid: inv.amount_paid,
    // Derived, never stored — a difference that is kept can drift (§8.4).
    amountDue: inv.amount_due,
    currency: inv.currency,
    title: inv.title,
    notes: inv.notes,
    // Snapshotted at creation: there is no users table to join to (0026).
    createdBy: { name: inv.created_by_name, role: inv.created_by_role },
    customer: {
      // The edit form preselects the picker from this, so the id has to be
      // here — without it every edit reopened with no customer chosen.
      id: inv.customer_id,
      _id: inv.customer_id,
      name: inv.customer_name,
      email: inv.customer_email,
      phone: inv.customer_phone,
      taxPin: inv.customer_tax_pin,
      address: inv.customer_address || null,
    },
    items: items.map((l) => ({
      _id: l.id,
      id: l.id,
      productId: l.product_id,
      // Both spellings: the detail page reads `type`, the credit note dialog
      // reads `itemType`.
      type: l.type,
      itemType: l.type,
      taxRate: l.tax_rate,
      discountAmount: l.discount_amount,
      // A service has no product, so its own description is its name.
      name: l.product_name ?? l.description,
      SKU: l.sku,
      description: l.description,
      unit: l.unit,
      quantity: l.quantity,
      unitPrice: l.unit_price,
      taxAmount: l.tax_amount,
      amount: l.amount,
      serviceCategory: l.service_category,
    })),
  };
}

/**
 * The invoice list as the UI needs it: filtered, paginated, customer joined.
 *
 * TWO THINGS HERE ARE ABOUT THE QUERY PLAN, not style.
 *
 * 1. Predicates are composed, not written as a catch-all. The obvious shape —
 *
 *        WHERE ($1 = '' OR status::text = $1) AND ($2 = '' OR ...)
 *
 *    makes Postgres build ONE plan for every combination of filters, and it
 *    cannot use an index for a predicate that might not apply. Measured on this
 *    schema it produced a Seq Scan on invoices. Only active filters are emitted.
 *
 * 2. The cast goes on the PARAMETER, never the column. `status::text = $1`
 *    casts every row before comparing and cannot use an index on status;
 *    `status = $1::invoice_status` compares in the column's own type and can.
 *
 * Rows and the total come from one query via count(*) OVER(), rather than a
 * second round trip for the page count as the Mongo path does.
 *
 * Search matches the invoice number by prefix, which the
 * (company_id, invoice_number) index serves. Customer name is matched anywhere,
 * which is a scan of the joined parties row; if that becomes hot the fix is a
 * trigram index on parties.name, not a change here.
 */
export async function searchInvoices(
  tx: Tx,
  opts: {
    query?: string;
    page?: number;
    perPage?: number;
    status?: string;
    paymentStatus?: string;
    startDate?: string;
    endDate?: string;
  } = {},
) {
  const perPage = Math.min(opts.perPage ?? 20, 100);
  const page = Math.max(opts.page ?? 1, 1);
  const offset = (page - 1) * perPage;
  const q = (opts.query ?? "").trim();

  const where = [];
  if (q) {
    where.push(
      sql`(i.invoice_number ILIKE ${likePrefix(q)} OR p.name ILIKE ${likeContains(q)})`,
    );
  }
  if (opts.status) where.push(sql`i.status = ${opts.status}::invoice_status`);
  if (opts.paymentStatus) {
    where.push(sql`i.payment_status = ${opts.paymentStatus}::payment_status`);
  }
  if (opts.startDate) where.push(sql`i.invoice_date >= ${opts.startDate}::date`);
  if (opts.endDate) where.push(sql`i.invoice_date <= ${opts.endDate}::date`);

  const clause = where.length
    ? sql`WHERE ${sql.join(where, sql` AND `)}`
    : sql``;

  const rows = (await tx.execute(sql`
    SELECT i.id,
           i.invoice_number,
           i.invoice_date,
           i.due_date,
           i.total::text        AS total,
           i.amount_paid::text  AS amount_paid,
           i.payment_status::text AS payment_status,
           i.status::text         AS status,
           p.name  AS customer_name,
           p.email AS customer_email,
           p.phone AS customer_phone,
           count(*) OVER() AS total_count
      FROM invoices i
      JOIN parties p ON p.id = i.customer_id
      ${clause}
     ORDER BY i.invoice_date DESC, i.invoice_number DESC
     LIMIT ${perPage} OFFSET ${offset}
  `)) as unknown as Array<Record<string, string>>;

  const total = rows.length ? Number(rows[0].total_count) : 0;

  return {
    // Shaped for the existing table component, so switching the data source
    // does not rewrite the UI.
    invoices: rows.map((r) => ({
      _id: r.id,
      id: r.id,
      invoiceNumber: r.invoice_number,
      invoiceDate: r.invoice_date,
      dueDate: r.due_date,
      total: r.total,
      amountPaid: r.amount_paid,
      paymentStatus: r.payment_status,
      status: r.status,
      customer: {
        name: r.customer_name,
        email: r.customer_email,
        phone: r.customer_phone,
      },
    })),
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    page,
  };
}

/** Headline figures for the list page, over the same filters, in one pass. */
export async function getInvoiceStats(
  tx: Tx,
  opts: { status?: string; paymentStatus?: string; startDate?: string; endDate?: string } = {},
) {
  const where = [];
  if (opts.status) where.push(sql`status = ${opts.status}::invoice_status`);
  if (opts.paymentStatus) {
    where.push(sql`payment_status = ${opts.paymentStatus}::payment_status`);
  }
  if (opts.startDate) where.push(sql`invoice_date >= ${opts.startDate}::date`);
  if (opts.endDate) where.push(sql`invoice_date <= ${opts.endDate}::date`);
  const clause = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;

  const [row] = (await tx.execute(sql`
    SELECT count(*)::int                                     AS count,
           COALESCE(SUM(total), 0)::text                     AS total,
           COALESCE(SUM(amount_paid), 0)::text               AS paid,
           COALESCE(SUM(total - amount_paid), 0)::text       AS outstanding,
           count(*) FILTER (WHERE payment_status = 'paid')::int    AS paid_count,
           count(*) FILTER (WHERE payment_status = 'partial')::int AS partial_count,
           count(*) FILTER (WHERE payment_status = 'unpaid')::int  AS unpaid_count,
           count(*) FILTER (
             WHERE status = 'completed' AND payment_status <> 'paid'
               AND due_date IS NOT NULL AND due_date < CURRENT_DATE
           )::int                                                  AS overdue
      FROM invoices
      ${clause}
  `)) as unknown as Array<Record<string, string>>;

  // Named as the existing stats cards read them, so the component keeps its
  // markup. `overdue` is DERIVED from due_date here rather than read from a
  // stored status — see §9B.2 on why paymentStatus 'overdue' was not carried.
  return {
    totalInvoices: Number(row.count),
    totalRevenue: row.total,
    totalAmountPaid: row.paid,
    balanceDue: row.outstanding,
    totalPaid: Number(row.paid_count),
    totalPartial: Number(row.partial_count),
    totalUnpaid: Number(row.unpaid_count),
    overdue: Number(row.overdue),
  };
}

/**
 * The oldest overdue invoices — the finance tab's actionable list.
 *
 * OVERDUE IS DERIVED, not a status. The Mongo query asked for
 * `paymentStatus: { $in: ["unpaid", "partial"] }` and a due date in the past;
 * the same predicate is here, plus `status = 'completed'`, because a DRAFT
 * invoice past its due date is not overdue — nobody has been asked to pay it.
 * The stats card beside this one has always excluded drafts (invoices.ts:1146)
 * and the list did not, so the two disagreed about the same invoices.
 *
 * `amountDue` is computed rather than stored, as everywhere else on this
 * branch: total less what has been paid.
 */
export async function listOverdueInvoices(tx: Tx, limit = 4) {
  const rows = (await tx.execute(sql`
    SELECT i.id,
           i.invoice_number                       AS "invoiceNumber",
           i.due_date                             AS "dueDate",
           p.name                                 AS "customerName",
           (i.total - i.amount_paid)::text        AS "amountDue",
           (CURRENT_DATE - i.due_date)::int       AS "daysOverdue"
      FROM invoices i
      JOIN parties p ON p.id = i.customer_id
     WHERE i.status = 'completed'
       AND i.payment_status <> 'paid'
       AND i.due_date IS NOT NULL
       AND i.due_date < CURRENT_DATE
     ORDER BY i.due_date ASC
     LIMIT ${limit}
  `)) as unknown as Array<{
    id: string;
    invoiceNumber: string;
    dueDate: string;
    customerName: string;
    amountDue: string;
    daysOverdue: number;
  }>;

  return Array.from(rows);
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

/**
 * An invoice by its number.
 *
 * The weighbridge gate quotes an `invoiceRef` and the connector links the
 * ticket to it; it also reads the status, because an invoice that already
 * posted has taken COGS and the stock with it.
 */
export async function findInvoiceByNumber(tx: Tx, invoiceNumber: string) {
  const rows = (await tx.execute(sql`
    SELECT id, invoice_number, status::text AS status
      FROM invoices WHERE invoice_number = ${invoiceNumber} LIMIT 1
  `)) as unknown as Array<Record<string, string>>;

  if (!rows.length) return null;
  return {
    id: String(rows[0].id),
    invoiceNumber: String(rows[0].invoice_number),
    status: String(rows[0].status),
  };
}

/**
 * An opening-balance invoice: a pre-cutover receivable carried in at onboarding.
 *
 * Posts Dr Accounts Receivable / Cr Opening Balance Equity, and nothing else —
 * no revenue, no VAT, no COGS, no stock movement. The point is to seed the AR
 * subledger with what customers already owed on the cutover date without
 * booking a sale into the new period.
 *
 * Mirrors `createOpeningBalanceBill` in bills.ts, with one difference: that
 * one creates the row and stops. Nothing ever posted its journal entry, so an
 * opening payable created through it would never have reached the trial
 * balance. Both post here.
 */
export async function createOpeningBalanceInvoice(
  tx: Tx,
  input: {
    companyId: string;
    customerId: string;
    invoiceDate: string;
    dueDate: string;
    amount: string;
    arAccountId: string;
    openingEquityAccountId: string;
    createdById?: string | null;
  },
) {
  const [customer] = await tx
    .select({ name: parties.name, email: parties.email, phone: parties.phone })
    .from(parties)
    .where(eq(parties.id, input.customerId));
  if (!customer) throw new Error("Customer not found");

  if (!(Number(input.amount) > 0)) {
    throw new Error("An opening balance must be greater than zero");
  }

  const [{ invoice_number }] = (await tx.execute(
    sql`SELECT next_entry_number(
      ${input.companyId}::uuid,
      document_prefix(${input.companyId}::uuid, 'invoice') || '-OB'
    ) AS invoice_number`,
  )) as unknown as Array<{ invoice_number: string }>;

  const [invoice] = await tx
    .insert(invoices)
    .values({
      companyId: input.companyId,
      invoiceNumber: invoice_number,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate,
      customerId: input.customerId,
      // No name snapshot: `invoices` joins parties for the customer, where
      // `bills` snapshots the supplier. Not changed here — a difference that
      // predates this and belongs to whoever reconciles the two.
      isOpeningBalance: true,
      // subtotal AND total. `invoices.total` is a plain stored column written
      // by whoever creates the invoice — there is no trigger recomputing it
      // from the lines, and an opening invoice has no lines. Setting only
      // subtotal left the document worth nothing.
      subtotal: input.amount,
      total: input.amount,
      status: "completed",
      createdById: input.createdById ?? null,
    })
    .returning();

  const entry = await createJournalEntry(tx, {
    companyId: input.companyId,
    entryDate: input.invoiceDate,
    entryType: "opening_balance",
    description: `Opening balance — ${customer.name}`,
    reference: invoice_number,
    partyType: "customer",
    partyId: input.customerId,
    sourceType: "invoice",
    sourceId: invoice.id,
    lines: [
      {
        accountId: input.arAccountId,
        debit: input.amount,
        description: `Opening receivable — ${customer.name}`,
      },
      {
        accountId: input.openingEquityAccountId,
        credit: input.amount,
        description: "Opening balance — to be reclassified to equity",
      },
    ],
    createdById: input.createdById ?? null,
    postImmediately: true,
  });

  return { invoice, entry };
}

// ── Sales by rep — 0095 ─────────────────────────────────────────────────────

/** float8 comes back as a string on some drivers; this file had no helper. */
const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

//
// The last `reports` screen reading Mongo. It could not be transcribed: the
// Mongo query groups by `salesPerson.employeeId` and the Postgres invoice had
// no salesperson at all, so a faithful port would have returned one row —
// "Unattributed" — for every invoice ever raised, and looked like it worked.

export interface SalesByRepRow {
  partyId: string | null;
  name: string;
  invoices: number;
  revenue: number;
  collected: number;
  outstanding: number;
}

/**
 * Billed revenue per salesperson, for a month or for all time.
 *
 * SENT AND COMPLETED, the Mongo query's own filter: a draft is not billed and
 * a cancelled invoice is not revenue.
 *
 * UNATTRIBUTED IS AN EXPLICIT BUCKET, not a dropped row. Invoices raised
 * directly carry no rep, and silently omitting them would make the report's
 * total disagree with the sales figure on every other screen — which is worse
 * than a bucket somebody has to explain.
 *
 * OUTSTANDING IS DERIVED. Mongo stored `amountDue` beside `amountPaid` and the
 * two could drift; here it is `total - amount_paid`, never below zero, because
 * an over-payment is a credit and not a negative debt.
 */
export async function getSalesByRep(
  tx: Tx,
  opts: { year?: number | null; month?: number | null } = {},
): Promise<SalesByRepRow[]> {
  const { year, month } = opts;
  const period =
    year && month
      ? sql`AND i.invoice_date >= make_date(${year}, ${month}, 1)
            AND i.invoice_date <  (make_date(${year}, ${month}, 1) + interval '1 month')`
      : sql``;

  const rows = (await tx.execute(sql`
    SELECT i.salesperson_party_id::text                       AS party_id,
           MAX(i.salesperson_name)                            AS name,
           COUNT(*)::int                                      AS invoices,
           COALESCE(SUM(i.total), 0)::float8                  AS revenue,
           COALESCE(SUM(i.amount_paid), 0)::float8            AS collected,
           COALESCE(SUM(GREATEST(i.total - i.amount_paid, 0)), 0)::float8
                                                              AS outstanding
      FROM invoices i
     WHERE i.status IN ('sent', 'completed')
       ${period}
     GROUP BY i.salesperson_party_id
     ORDER BY revenue DESC
     LIMIT 100
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    partyId: r.party_id ? String(r.party_id) : null,
    name: r.party_id ? (r.name ? String(r.name) : "Unknown rep") : "Unattributed",
    invoices: Number(r.invoices ?? 0),
    revenue: num(r.revenue),
    collected: num(r.collected),
    outstanding: num(r.outstanding),
  }));
}

/** One rep's invoices — the drill-down, capped the way the Mongo one was. */
export async function getRepInvoices(
  tx: Tx,
  partyId: string,
  opts: { year?: number | null; month?: number | null } = {},
) {
  if (!isUuid(partyId)) return [];
  const { year, month } = opts;
  const period =
    year && month
      ? sql`AND i.invoice_date >= make_date(${year}, ${month}, 1)
            AND i.invoice_date <  (make_date(${year}, ${month}, 1) + interval '1 month')`
      : sql``;

  const rows = (await tx.execute(sql`
    SELECT i.id::text                                    AS id,
           i.invoice_number                              AS invoice_number,
           p.name                                        AS customer,
           i.invoice_date                                AS invoice_date,
           i.total::float8                               AS total,
           i.amount_paid::float8                         AS amount_paid,
           GREATEST(i.total - i.amount_paid, 0)::float8  AS amount_due,
           i.payment_status                              AS payment_status
      FROM invoices i
      LEFT JOIN parties p ON p.id = i.customer_id
     WHERE i.salesperson_party_id = ${partyId}::uuid
       AND i.status IN ('sent', 'completed')
       ${period}
     ORDER BY i.invoice_date DESC
     LIMIT 100
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    _id: String(r.id),
    invoiceNumber: String(r.invoice_number),
    customer: r.customer ? String(r.customer) : "",
    invoiceDate: r.invoice_date ? String(r.invoice_date) : null,
    total: num(r.total),
    amountPaid: num(r.amount_paid),
    amountDue: num(r.amount_due),
    paymentStatus: r.payment_status ? String(r.payment_status) : null,
  }));
}
