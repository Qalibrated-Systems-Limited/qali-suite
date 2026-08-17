import { and, desc, eq, sql } from "drizzle-orm";
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
      customerId: invoices.customerId,
    })
    .from(invoices)
    .where(eq(invoices.id, input.invoiceId));
  if (!invoice) throw new Error("Invoice not found");

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
  } = {},
) {
  const limit = Math.min(opts.limit ?? 50, 200);

  const filters = [
    opts.status ? eq(creditNotes.status, opts.status) : undefined,
    opts.invoiceId ? eq(creditNotes.invoiceId, opts.invoiceId) : undefined,
  ].filter(Boolean);

  return tx
    .select({
      id: creditNotes.id,
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
