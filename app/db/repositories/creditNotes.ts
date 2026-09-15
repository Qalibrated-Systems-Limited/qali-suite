import { and, desc, eq, gte, ilike, inArray, lt, lte, or, sql } from "drizzle-orm";
import type { Tx } from "../client";
import {
  creditNotes,
  creditNoteLines,
  invoices,
  invoiceLines,
  parties,
  products,
} from "../schema";
import { createJournalEntry } from "./journal";
import { receiveStock } from "./products";
import { recordMovement } from "./stockMovements";
import { isUuid, likeContains } from "./sqlHelpers";

/**
 * Credit notes raised against sales invoices.
 *
 * As with bills, the header amounts are the database's to maintain: subtotal
 * and tax come from the lines by trigger, `total` and `amount_remaining` are
 * generated columns. `calculateAmounts()` (creditNote.js:338) does the same
 * arithmetic in JavaScript and stores the result, which is only correct while
 * nothing writes around that method.
 */

export interface CreditNoteLineInput {
  description: string;
  quantity: string;
  unitPrice: string;
  itemType?: "product" | "service";
  productId?: string | null;
  unit?: string;
  taxRate?: string;
  /** Puts the credited stock back on the shelf when the note is issued. */
  restoreInventory?: boolean;
  /** The invoice line being credited, where one applies. */
  originalInvoiceLineId?: string | null;
  originalQuantity?: string | null;
  originalUnitPrice?: string | null;
}

export interface CreateCreditNoteInput {
  companyId: string;
  invoiceId: string;
  creditNoteDate: string;
  reason:
    | "return"
    | "damaged"
    | "overcharge"
    | "cancellation"
    | "discount"
    | "defective"
    | "other";
  reasonDescription: string;
  lines: CreditNoteLineInput[];
  notes?: string | null;
  currency?: string;
  createdById?: string | null;
}

/**
 * Creates a draft credit note against an invoice.
 *
 * The invoice and customer details are read once and frozen — §9.4, and
 * creditNote.js:63 calls the customer block "cached from invoice" while it is
 * in fact a record of who was credited and against what. Migration 0016
 * refuses to let them be updated.
 */
export async function createCreditNote(
  tx: Tx,
  input: CreateCreditNoteInput,
) {
  if (input.lines.length === 0) {
    throw new Error("A credit note must have at least one line");
  }

  const [invoice] = await tx
    .select({
      id: invoices.id,
      number: invoices.invoiceNumber,
      date: invoices.invoiceDate,
      total: invoices.total,
      status: invoices.status,
      customerId: invoices.customerId,
    })
    .from(invoices)
    .where(eq(invoices.id, input.invoiceId));
  if (!invoice) throw new Error("Invoice not found");

  // credit-note-actions.js:131. A credit note reverses revenue, and a draft or
  // cancelled invoice never recognised any — cancelling it is the correction
  // for those. Only a completed invoice can be credited.
  if (invoice.status !== "completed") {
    throw new Error(
      `Only a completed invoice can be credited (this one is ${invoice.status})`,
    );
  }

  const [customer] = await tx
    .select({
      name: parties.name,
      email: parties.email,
      phone: parties.phone,
      taxPin: parties.taxPin,
    })
    .from(parties)
    .where(eq(parties.id, invoice.customerId));
  if (!customer) throw new Error("Customer not found");

  const [{ credit_note_number }] = (await tx.execute(
    sql`SELECT next_entry_number(${input.companyId}::uuid, 'CN') AS credit_note_number`,
  )) as unknown as Array<{ credit_note_number: string }>;

  const [note] = await tx
    .insert(creditNotes)
    .values({
      companyId: input.companyId,
      creditNoteNumber: credit_note_number,
      creditNoteDate: input.creditNoteDate,
      invoiceId: invoice.id,
      invoiceNumberAtIssue: invoice.number,
      invoiceDateAtIssue: invoice.date,
      invoiceTotalAtIssue: invoice.total,
      customerId: invoice.customerId,
      customerNameAtIssue: customer.name,
      customerEmailAtIssue: customer.email,
      customerPhoneAtIssue: customer.phone,
      customerTaxPinAtIssue: customer.taxPin,
      reason: input.reason,
      reasonDescription: input.reasonDescription,
      currency: input.currency ?? "KES",
      notes: input.notes ?? null,
      createdById: input.createdById ?? null,
    })
    .returning();

  let n = 0;
  for (const line of input.lines) {
    n++;
    const itemType =
      line.itemType ?? (line.productId ? "product" : "service");

    await tx.insert(creditNoteLines).values({
      companyId: input.companyId,
      creditNoteId: note.id,
      lineNumber: n,
      originalInvoiceLineId: line.originalInvoiceLineId ?? null,
      itemType,
      productId: line.productId ?? null,
      description: line.description,
      unit: line.unit ?? "pcs",
      quantity: line.quantity,
      originalQuantity: line.originalQuantity ?? null,
      originalUnitPrice: line.originalUnitPrice ?? null,
      unitPrice: line.unitPrice,
      taxRate: line.taxRate ?? "16",
      restoreInventory: line.restoreInventory ?? false,
    });
  }

  const [withTotals] = await tx
    .select()
    .from(creditNotes)
    .where(eq(creditNotes.id, note.id));
  return withTotals;
}

export async function getCreditNote(tx: Tx, noteId: string) {
  // An id a uuid column cannot hold is NOT FOUND, not a 22P02 with
  // the statement in the message. See isUuid in sqlHelpers.
  if (!isUuid(noteId)) return null;
  const [note] = await tx
    .select()
    .from(creditNotes)
    .where(eq(creditNotes.id, noteId));
  if (!note) return null;

  const lines = await tx
    .select({
      id: creditNoteLines.id,
      lineNumber: creditNoteLines.lineNumber,
      itemType: creditNoteLines.itemType,
      productId: creditNoteLines.productId,
      sku: products.sku,
      description: creditNoteLines.description,
      quantity: creditNoteLines.quantity,
      unit: creditNoteLines.unit,
      unitPrice: creditNoteLines.unitPrice,
      amount: creditNoteLines.amount,
      taxRate: creditNoteLines.taxRate,
      taxAmount: creditNoteLines.taxAmount,
      restoreInventory: creditNoteLines.restoreInventory,
      originalInvoiceLineId: creditNoteLines.originalInvoiceLineId,
      originalQuantity: creditNoteLines.originalQuantity,
      originalUnitPrice: creditNoteLines.originalUnitPrice,
    })
    .from(creditNoteLines)
    .leftJoin(products, eq(products.id, creditNoteLines.productId))
    .where(eq(creditNoteLines.creditNoteId, noteId))
    .orderBy(creditNoteLines.lineNumber);

  return { ...note, lines };
}

export interface IssueCreditNoteAccounts {
  /** Accounts Receivable — credited, reducing what the customer owes. */
  arAccountId: string;
  /** Sales revenue — debited, reversing the sale. */
  revenueAccountId: string;
  /** VAT Output — debited, reducing the VAT liability. */
  vatOutputAccountId?: string | null;
  /** Inventory — debited when credited goods come back. */
  inventoryAccountId?: string | null;
  /** COGS — credited by the same amount. */
  cogsAccountId?: string | null;
}

/**
 * Issues a draft credit note.
 *
 * Posts DR Revenue, DR VAT Output, CR Accounts Receivable — and, for lines
 * marked `restore_inventory`, a second entry DR Inventory / CR COGS with the
 * stock movements to match.
 *
 * The cost used to value returned goods is the invoice line's `unit_cost`, not
 * the product's current cost. creditNote.js:493 reads
 * `product.costing.costPrice` at the moment of the return, so a product
 * re-costed between sale and return puts back a different value than the sale
 * took out — and the difference lands silently in COGS. Where a credit line
 * names no invoice line, there is nothing to look up and the current cost is
 * the only figure available; that case falls back, and says so.
 */
export async function issueCreditNote(
  tx: Tx,
  noteId: string,
  opts: IssueCreditNoteAccounts & { issuedById: string },
) {
  const [note] = await tx
    .select()
    .from(creditNotes)
    .where(and(eq(creditNotes.id, noteId), eq(creditNotes.status, "draft")));
  if (!note) throw new Error("Credit note not found, or not in draft status");

  const lines = await tx
    .select()
    .from(creditNoteLines)
    .where(eq(creditNoteLines.creditNoteId, noteId))
    .orderBy(creditNoteLines.lineNumber);

  const hasTax = !/^-?0(\.0*)?$/.test(note.taxAmount);
  if (hasTax && !opts.vatOutputAccountId) {
    throw new Error(
      "Credit note carries tax but no VAT Output account was supplied",
    );
  }

  // ── DR Revenue, DR VAT Output, CR Accounts Receivable ───────────────────
  const jeLines: Array<{
    accountId: string;
    debit?: string;
    credit?: string;
    description?: string | null;
  }> = [
    {
      accountId: opts.revenueAccountId,
      debit: note.subtotal,
      description: `Credit note — ${note.reasonDescription}`,
    },
  ];

  if (hasTax) {
    jeLines.push({
      accountId: opts.vatOutputAccountId!,
      debit: note.taxAmount,
      description: "VAT on credit note",
    });
  }

  jeLines.push({
    accountId: opts.arAccountId,
    credit: note.total!,
    description: `Credit to ${note.customerNameAtIssue}`,
  });

  /**
   * THE PROJECT COMES FROM THE INVOICE — 0084.
   *
   * A credit note has no project of its own and should not: it reverses part
   * of an invoice, so it belongs to whatever job that invoice was raised
   * against. Reading it here rather than copying it onto `credit_notes` keeps
   * one answer to "which project", which is the same reason the note carries
   * `invoice_id` and not a second copy of the customer.
   */
  const [creditedInvoice] = await tx
    .select({ projectId: invoices.projectId })
    .from(invoices)
    .where(eq(invoices.id, note.invoiceId));
  const creditedProjectId = creditedInvoice?.projectId ?? null;

  const entry = await createJournalEntry(tx, {
    companyId: note.companyId,
    entryDate: note.creditNoteDate,
    entryType: "credit_note",
    description: `Credit Note ${note.creditNoteNumber} — ${note.invoiceNumberAtIssue}`,
    reference: note.creditNoteNumber,
    partyType: "customer",
    partyId: note.customerId,
    sourceType: "invoice",
    sourceId: note.invoiceId,
    projectId: creditedProjectId,
    createdById: opts.issuedById,
    postImmediately: true,
    lines: jeLines,
  });

  // ── Returned goods: DR Inventory / CR COGS ──────────────────────────────
  const restoring = lines.filter((l) => l.restoreInventory && l.productId);
  let inventoryEntryId: string | null = null;
  const costedAtCurrentPrice: string[] = [];

  if (restoring.length > 0) {
    if (!opts.inventoryAccountId || !opts.cogsAccountId) {
      throw new Error(
        "Credit note restores inventory but no Inventory/COGS accounts were supplied",
      );
    }

    const restored: Array<{ line: typeof restoring[number]; unitCost: string }> =
      [];

    for (const line of restoring) {
      let unitCost: string | null = null;

      if (line.originalInvoiceLineId) {
        const [original] = await tx
          .select({ unitCost: invoiceLines.unitCost })
          .from(invoiceLines)
          .where(eq(invoiceLines.id, line.originalInvoiceLineId));
        unitCost = original?.unitCost ?? null;
      }

      if (unitCost === null) {
        const [product] = await tx
          .select({ costPrice: products.costPrice })
          .from(products)
          .where(eq(products.id, line.productId!));
        if (!product) throw new Error(`Product not found: ${line.productId}`);
        unitCost = product.costPrice;
        costedAtCurrentPrice.push(line.id);
      }

      restored.push({ line, unitCost });
    }

    const [{ total_cogs }] = (await tx.execute(sql`
      SELECT SUM(v)::numeric(19,4) AS total_cogs
        FROM unnest(ARRAY[${sql.join(
          restored.map(
            (r) =>
              sql`(${r.line.quantity}::numeric(19,4) * ${r.unitCost}::numeric(19,4))::numeric(19,4)`,
          ),
          sql`, `,
        )}]) AS v
    `)) as unknown as Array<{ total_cogs: string }>;

    const inventoryEntry = await createJournalEntry(tx, {
      companyId: note.companyId,
      entryDate: note.creditNoteDate,
      entryType: "credit_note",
      description: `Stock returned — Credit Note ${note.creditNoteNumber}`,
      reference: note.creditNoteNumber,
      sourceType: "invoice",
      sourceId: note.invoiceId,
      projectId: creditedProjectId,
      createdById: opts.issuedById,
      postImmediately: true,
      lines: [
        { accountId: opts.inventoryAccountId, debit: total_cogs },
        { accountId: opts.cogsAccountId, credit: total_cogs },
      ],
    });
    inventoryEntryId = inventoryEntry.id;

    for (const { line, unitCost } of restored) {
      // Before the level changes — recordMovement reads it as `previous_stock`.
      await recordMovement(tx, {
        companyId: note.companyId,
        productId: line.productId!,
        movementType: "return",
        direction: "in",
        quantity: line.quantity,
        unitCost,
        sourceReference: note.creditNoteNumber,
        performedById: opts.issuedById,
      });
      await receiveStock(
        tx,
        line.productId!,
        line.quantity,
        unitCost,
        note.creditNoteDate,
      );
    }
  }

  const [updated] = await tx
    .update(creditNotes)
    .set({
      status: "issued",
      issuedAt: new Date(),
      issuedById: opts.issuedById,
      journalEntryId: entry.id,
      inventoryJournalEntryId: inventoryEntryId,
      updatedAt: new Date(),
    })
    .where(eq(creditNotes.id, noteId))
    .returning();

  return { creditNote: updated, entry, inventoryEntryId, costedAtCurrentPrice };
}

/**
 * Applies part or all of an issued credit against the invoice it was raised
 * for, reducing what the customer owes.
 *
 * Over-application is refused exactly by CHECK (amount_remaining >= 0). The
 * Mongo equivalent reports a credit exhausted once `amountRemaining <= 0.01`
 * (creditNote.js:328), so up to a cent of credit could be reported as spent
 * while still being spendable.
 */
export async function applyCreditNote(
  tx: Tx,
  noteId: string,
  amount: string,
) {
  const [note] = await tx
    .select()
    .from(creditNotes)
    .where(eq(creditNotes.id, noteId));
  if (!note) throw new Error("Credit note not found");
  if (note.status !== "issued" && note.status !== "applied") {
    throw new Error(
      `Only an issued credit note can be applied (this one is ${note.status})`,
    );
  }

  const [updated] = await tx
    .update(creditNotes)
    .set({
      amountApplied: sql`(${creditNotes.amountApplied} + ${amount}::numeric(19,4))::numeric(19,4)`,
      updatedAt: new Date(),
    })
    .where(eq(creditNotes.id, noteId))
    .returning();

  // Fully applied is `remaining = 0`, exactly — not "within a cent of zero".
  const [settled] = await tx
    .update(creditNotes)
    .set({ status: "applied" })
    .where(
      and(eq(creditNotes.id, noteId), eq(creditNotes.amountRemaining, "0")),
    )
    .returning();

  // The credit reduces what is owed on the invoice it was raised against —
  // maintained by the same trigger that follows payment allocations, since
  // both are sources of the same number (migration 0017).
  return settled ?? updated;
}

export async function voidCreditNote(
  tx: Tx,
  noteId: string,
  voidedById: string,
  reason: string,
) {
  const [updated] = await tx
    .update(creditNotes)
    .set({
      status: "void",
      voidedAt: new Date(),
      voidedById,
      voidReason: reason || "No reason provided",
      updatedAt: new Date(),
    })
    .where(and(eq(creditNotes.id, noteId), eq(creditNotes.status, "draft")))
    .returning();

  if (!updated) {
    throw new Error(
      "Credit note not found, or not in draft status — an issued credit note must be reversed, not voided",
    );
  }
  return updated;
}

export async function listCreditNotes(
  tx: Tx,
  opts: {
    limit?: number;
    offset?: number;
    status?: "draft" | "issued" | "applied" | "void";
    invoiceId?: string;
    /** The list page's search box: number, customer or invoice number. */
    search?: string;
  } = {},
) {
  const limit = Math.min(opts.limit ?? 50, 200);

  const term = opts.search?.trim() ? likeContains(opts.search.trim()) : null;
  const filters = [
    opts.status ? eq(creditNotes.status, opts.status) : undefined,
    opts.invoiceId ? eq(creditNotes.invoiceId, opts.invoiceId) : undefined,
    term
      ? or(
          ilike(creditNotes.creditNoteNumber, term),
          ilike(creditNotes.customerNameAtIssue, term),
          ilike(creditNotes.invoiceNumberAtIssue, term),
        )
      : undefined,
  ].filter(Boolean);

  return tx
    .select({
      id: creditNotes.id,
      invoiceId: creditNotes.invoiceId,
      creditNoteNumber: creditNotes.creditNoteNumber,
      creditNoteDate: creditNotes.creditNoteDate,
      invoiceNumber: creditNotes.invoiceNumberAtIssue,
      customerName: creditNotes.customerNameAtIssue,
      reason: creditNotes.reason,
      total: creditNotes.total,
      amountApplied: creditNotes.amountApplied,
      amountRemaining: creditNotes.amountRemaining,
      status: creditNotes.status,
    })
    .from(creditNotes)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(creditNotes.creditNoteDate), desc(creditNotes.creditNoteNumber))
    .limit(limit)
    .offset(opts.offset ?? 0);
}

/**
 * Deletes a DRAFT credit note.
 *
 * Draft only, and the status is in the WHERE clause rather than in a
 * read-then-check: `deleteDraftCreditNote` in the Mongo action loads the note,
 * tests `status !== "draft"`, and then deletes — so a note issued between the
 * two statements was deleted anyway, taking its journal entry's source with
 * it. Here the delete simply matches nothing.
 */
export async function deleteDraftCreditNote(tx: Tx, noteId: string) {
  const [deleted] = await tx
    .delete(creditNotes)
    .where(and(eq(creditNotes.id, noteId), eq(creditNotes.status, "draft")))
    .returning();

  if (!deleted) {
    throw new Error(
      "Credit note not found, or not in draft status — only a draft can be deleted",
    );
  }
  return deleted;
}

/**
 * The list page's summary tiles, in the shape it already reads:
 * `{ draft, issued, applied, void, totalCount, totalValue }`.
 *
 * One grouped query rather than an aggregate plus a JavaScript fold, and the
 * money stays a string until the screen formats it.
 */
export async function getCreditNoteStats(tx: Tx) {
  const rows = await tx
    .select({
      status: creditNotes.status,
      count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${creditNotes.total}), 0)::text`,
    })
    .from(creditNotes)
    .groupBy(creditNotes.status);

  const stats: Record<string, { count: number; total: number }> = {
    draft: { count: 0, total: 0 },
    issued: { count: 0, total: 0 },
    applied: { count: 0, total: 0 },
    void: { count: 0, total: 0 },
  };
  let totalCount = 0;
  let totalValue = 0;

  for (const row of rows) {
    const bucket = stats[row.status] ?? { count: 0, total: 0 };
    bucket.count = row.count;
    bucket.total = Number(row.total);
    stats[row.status] = bucket;
    totalCount += row.count;
    // A void credit note is not value — it was cancelled before it did
    // anything. The Mongo version adds it in, so the "total credited" tile
    // counted notes that credited nobody.
    if (row.status !== "void") totalValue += Number(row.total);
  }

  return { ...stats, totalCount, totalValue };
}

/**
 * The detail page's shape.
 *
 * Named for what it is — the PAGE shape, not the row. The screen reads
 * `customer.name`, `invoice.invoiceNumber`, `items[]`, `amountApplied` and
 * `amountRemaining`; the table has `customer_name_at_note`, a join to the
 * invoice, `lines[]` and a generated remaining balance.
 */
export async function getCreditNoteForDisplay(tx: Tx, noteId: string) {
  // An id a uuid column cannot hold is NOT FOUND, not a 22P02 with
  // the statement in the message. See isUuid in sqlHelpers.
  if (!isUuid(noteId)) return null;
  const note = await getCreditNote(tx, noteId);
  if (!note) return null;

  const [inv] = note.invoiceId
    ? await tx
        .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
        .from(invoices)
        .where(eq(invoices.id, note.invoiceId))
    : [];

  return {
    _id: note.id,
    id: note.id,
    creditNoteNumber: note.creditNoteNumber,
    creditNoteDate: note.creditNoteDate,
    status: note.status,
    reason: note.reason,
    reasonDescription: note.reasonDescription,
    notes: note.notes,

    // §9.4 — what the document said, not what the party record says today.
    customer: {
      id: note.customerId,
      name: note.customerNameAtIssue,
      email: note.customerEmailAtIssue,
      phone: note.customerPhoneAtIssue,
    },
    invoice: inv ? { id: inv.id, invoiceNumber: inv.invoiceNumber } : null,

    subtotal: note.subtotal,
    taxAmount: note.taxAmount,
    total: note.total,
    amountApplied: note.amountApplied,
    amountRemaining: note.amountRemaining,

    items: note.lines.map((l) => ({
      _id: l.id,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      // `amount` and `taxAmount` are both generated columns; the screen's
      // "lineTotal" is the two together.
      amount: l.amount,
      taxAmount: l.taxAmount,
      lineTotal: (Number(l.amount) + Number(l.taxAmount)).toFixed(4),
      restoreInventory: l.restoreInventory,
    })),

    voidReason: note.voidReason,
    voidedAt: note.voidedAt,
    issuedAt: note.issuedAt,
    createdAt: note.createdAt,
  };
}

/**
 * Credit raised against a set of invoices — the figure that REVERSES revenue.
 *
 * `issued` and `applied` only: a draft has credited nobody and a void one was
 * cancelled before it did. Used by the project P&L, which without it counts
 * revenue that was given back.
 */
export async function sumCreditForInvoices(tx: Tx, invoiceIds: string[]) {
  if (!invoiceIds.length) return "0";
  const [row] = await tx
    .select({
      total: sql<string>`coalesce(sum(${creditNotes.total}), 0)::text`,
    })
    .from(creditNotes)
    .where(
      and(
        inArray(creditNotes.invoiceId, invoiceIds),
        inArray(creditNotes.status, ["issued", "applied"]),
      ),
    );
  return row?.total ?? "0";
}

/** A customer's credit notes, for the statement of account. */
export async function listCreditNotesForCustomer(
  tx: Tx,
  customerId: string,
  opts: { from?: string; to?: string } = {},
) {
  const conditions = [
    eq(creditNotes.customerId, customerId),
    inArray(creditNotes.status, ["issued", "applied"]),
  ];
  if (opts.from) conditions.push(gte(creditNotes.creditNoteDate, opts.from));
  if (opts.to) conditions.push(lte(creditNotes.creditNoteDate, opts.to));

  return tx
    .select({
      id: creditNotes.id,
      creditNoteNumber: creditNotes.creditNoteNumber,
      creditNoteDate: creditNotes.creditNoteDate,
      reason: creditNotes.reason,
      total: creditNotes.total,
      status: creditNotes.status,
      // The statement labels each row with the invoice it credits.
      invoiceNumber: creditNotes.invoiceNumberAtIssue,
    })
    .from(creditNotes)
    .where(and(...conditions))
    .orderBy(creditNotes.creditNoteDate);
}

/** Credit raised for a customer BEFORE a date — the statement's opening figure. */
export async function sumCustomerCreditBefore(
  tx: Tx,
  customerId: string,
  before: string,
) {
  const [row] = await tx
    .select({
      total: sql<string>`coalesce(sum(${creditNotes.total}), 0)::text`,
    })
    .from(creditNotes)
    .where(
      and(
        eq(creditNotes.customerId, customerId),
        inArray(creditNotes.status, ["issued", "applied"]),
        lt(creditNotes.creditNoteDate, before),
      ),
    );
  return row?.total ?? "0";
}
