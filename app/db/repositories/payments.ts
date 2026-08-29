import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { createJournalEntry, reverseJournalEntry } from "./journal";
import type { Tx } from "../client";
import {
  payments,
  paymentAllocations,
  parties,
  accounts,
  invoices,
  bills,
  users,
} from "../schema";
import { likeContains } from "./sqlHelpers";

/**
 * Payments received and made, and what they settle.
 *
 * Per docs/POSTGRES-MIGRATION-PLAN.md §9:
 * - totalAllocated / unappliedAmount are read from the payment_balances view,
 *   never stored. Mongo recomputes them in a pre-save hook that any write
 *   bypassing the hook leaves stale.
 * - Over-allocation is refused exactly, by a deferred constraint trigger. The
 *   Mongo guard allows `totalAllocated > amount + 0.01`.
 * - Party and account details are immutable snapshots of what the payment
 *   document recorded, filled here and refused on update.
 */

export interface CreatePaymentInput {
  /**
   * Pre-allocated, for the one case that needs the id before the row: a
   * payment held for approval. The approval must point AT something, and
   * `targetRef` cannot reference a row that will not exist until it is
   * approved. So the id is minted first, travels on the approval, and the
   * payment is created with it on release — which makes the approval's link
   * to /dashboard/payments/:id resolve rather than 404.
   */
  id?: string;
  companyId: string;
  paymentType: "received" | "made";
  paymentDate: string;
  paymentMethod: "cash" | "mpesa" | "bank_transfer" | "cheque" | "card";
  amount: string;
  partyId: string;
  accountId: string;
  reference?: string | null;
  description?: string | null;
  notes?: string | null;
  mpesaReceipt?: string | null;
  mpesaPhone?: string | null;
  bankName?: string | null;
  bankReference?: string | null;
  chequeNumber?: string | null;
  createdById?: string | null;
}

export async function createPayment(tx: Tx, input: CreatePaymentInput) {
  // Resolve the snapshots now — they record what the document said at the time
  // of payment, so they are read once here and never refreshed.
  const [party] = await tx
    .select({ name: parties.name, email: parties.email, phone: parties.phone })
    .from(parties)
    .where(eq(parties.id, input.partyId));
  if (!party) throw new Error("Party not found");

  const [account] = await tx
    .select({ code: accounts.accountCode, name: accounts.accountName })
    .from(accounts)
    .where(eq(accounts.id, input.accountId));
  if (!account) throw new Error("Account not found");

  const prefix = input.paymentType === "received" ? "RCP" : "PMT";
  const [{ payment_number }] = (await tx.execute(
    sql`SELECT next_entry_number(${input.companyId}::uuid, ${prefix}) AS payment_number`,
  )) as unknown as Array<{ payment_number: string }>;

  const [created] = await tx
    .insert(payments)
    .values({
      ...(input.id ? { id: input.id } : {}),
      companyId: input.companyId,
      paymentNumber: payment_number,
      paymentType: input.paymentType,
      paymentDate: input.paymentDate,
      paymentMethod: input.paymentMethod,
      amount: input.amount,
      partyId: input.partyId,
      partyNameAtPayment: party.name,
      partyEmailAtPayment: party.email,
      partyPhoneAtPayment: party.phone,
      accountId: input.accountId,
      accountCodeAtPayment: account.code,
      accountNameAtPayment: account.name,
      reference: input.reference ?? null,
      description: input.description ?? null,
      notes: input.notes ?? null,
      mpesaReceipt: input.mpesaReceipt ?? null,
      mpesaPhone: input.mpesaPhone ?? null,
      bankName: input.bankName ?? null,
      bankReference: input.bankReference ?? null,
      chequeNumber: input.chequeNumber ?? null,
      createdById: input.createdById ?? null,
    })
    .returning();

  return created;
}

/**
 * Applies part or all of a payment to an invoice.
 *
 * No arithmetic check here: the deferred constraint trigger enforces
 * `SUM(allocated) <= amount` exactly at COMMIT, so a caller cannot allocate a
 * payment past its value even across several calls in one transaction.
 */
export async function allocateToInvoice(
  tx: Tx,
  input: {
    companyId: string;
    paymentId: string;
    invoiceId: string;
    amount: string;
  },
) {
  const [invoice] = await tx
    .select({
      number: invoices.invoiceNumber,
      total: invoices.total,
      paid: invoices.amountPaid,
    })
    .from(invoices)
    .where(eq(invoices.id, input.invoiceId));
  if (!invoice) throw new Error("Invoice not found");

  const [{ balance_before }] = (await tx.execute(sql`
    SELECT (${invoice.total}::numeric(19,4) - ${invoice.paid}::numeric(19,4))::numeric(19,4) AS balance_before
  `)) as unknown as Array<{ balance_before: string }>;

  const [allocation] = await tx
    .insert(paymentAllocations)
    .values({
      companyId: input.companyId,
      paymentId: input.paymentId,
      documentType: "invoice",
      documentId: input.invoiceId,
      documentNumberAtAllocation: invoice.number,
      originalAmount: invoice.total,
      balanceBefore: balance_before,
      amountAllocated: input.amount,
    })
    .returning();

  // The invoice's amount_paid and payment_status follow from this row; a
  // trigger recomputes them (migration 0017). This function used to increment
  // them here, which meant removing an allocation left the invoice still
  // claiming the money, and a second writer — applyCreditNote — was
  // incrementing the same field from another code path.
  return allocation;
}

/**
 * Applies part or all of a payment to a bill — the AP mirror of
 * `allocateToInvoice`.
 *
 * Unlike the invoice side, nothing here updates the bill's `amount_paid`: a
 * trigger (migration 0016) maintains it from the allocations themselves, so
 * "paid according to the bill" and "paid according to the payments" are the
 * same number by construction rather than by both being updated correctly.
 * That is the §8.2 correction — two records of one event, kept in step by two
 * code paths, is the arrangement that drifts.
 *
 * Over-payment is refused by CHECK (balance >= 0) on the bill, exactly.
 * bill.js:1302 allows `amount > balance + 0.01`.
 */
export async function allocateToBill(
  tx: Tx,
  input: {
    companyId: string;
    paymentId: string;
    billId: string;
    amount: string;
  },
) {
  const [bill] = await tx
    .select({
      number: bills.billNumber,
      netPayable: bills.netPayable,
      balance: bills.balance,
    })
    .from(bills)
    .where(eq(bills.id, input.billId));
  if (!bill) throw new Error("Bill not found");

  const [allocation] = await tx
    .insert(paymentAllocations)
    .values({
      companyId: input.companyId,
      paymentId: input.paymentId,
      documentType: "bill",
      documentId: input.billId,
      documentNumberAtAllocation: bill.number,
      originalAmount: bill.netPayable!,
      balanceBefore: bill.balance!,
      amountAllocated: input.amount,
    })
    .returning();

  return allocation;
}

/**
 * Posts a receipt to the ledger and moves the payment out of draft.
 *
 *     DR  cash / bank / M-Pesa / clearing      amount
 *     CR  Accounts Receivable                  amount
 *
 * This is what payment.confirm() does in Mongo (payment.js:537). Without it a
 * payment settles the invoice — amount_paid and payment_status follow the
 * allocation by trigger — while the trial balance still shows the receivable
 * outstanding and no cash received. The invoice and the ledger disagree, and
 * only the ledger is the books.
 *
 * CLEARING. A cheque banked or a transfer you have been told about is not cash
 * in hand until the statement says so, and posting it straight to Bank claims
 * money you cannot demonstrate. Where a clearing account is supplied, the
 * receipt lands there and the payment stays `pending_clearance` — the state the
 * enum has carried since 0011 and nothing has used. Cash and M-Pesa are in hand
 * on receipt, so they post to their own account and confirm immediately.
 *
 * Falls back to the payment's own account when no clearing account is
 * configured: refusing the receipt would be worse than posting it directly.
 */
export async function postPaymentReceipt(
  tx: Tx,
  paymentId: string,
  opts: {
    arAccountId: string;
    /** Where an uncleared receipt waits. Omit to post straight to the account. */
    clearingAccountId?: string | null;
    postedById: string;
  },
) {
  const [payment] = await tx
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId));
  if (!payment) throw new Error("Payment not found");
  if (payment.journalEntryId) {
    throw new Error(`Payment ${payment.paymentNumber} has already been posted`);
  }

  // In hand on receipt; nothing to clear.
  const settlesImmediately =
    payment.paymentMethod === "cash" || payment.paymentMethod === "mpesa";

  const useClearing = !settlesImmediately && Boolean(opts.clearingAccountId);
  const debitAccountId = useClearing
    ? opts.clearingAccountId!
    : payment.accountId;

  const entry = await createJournalEntry(tx, {
    companyId: payment.companyId,
    entryDate: payment.paymentDate,
    entryType: "payment_received",
    description: `Payment ${payment.paymentNumber} from ${payment.partyNameAtPayment}`,
    reference: payment.paymentNumber,
    partyType: "customer",
    partyId: payment.partyId,
    sourceType: "payment",
    sourceId: payment.id,
    createdById: opts.postedById,
    postImmediately: true,
    lines: [
      {
        accountId: debitAccountId,
        debit: payment.amount,
        description: `Payment from ${payment.partyNameAtPayment}`,
      },
      {
        accountId: opts.arAccountId,
        credit: payment.amount,
        description: `Reduce receivable — ${payment.partyNameAtPayment}`,
      },
    ],
  });

  const [updated] = await tx
    .update(payments)
    .set({
      journalEntryId: entry.id,
      status: useClearing ? "pending_clearance" : "confirmed",
      confirmedAt: useClearing ? null : new Date(),
      confirmedById: useClearing ? null : opts.postedById,
      updatedAt: new Date(),
    })
    .where(eq(payments.id, paymentId))
    .returning();

  return { payment: updated, entry, pendingClearance: useClearing };
}

/**
 * Posts a payment MADE to the ledger and moves it out of draft.
 *
 *     DR  Accounts Payable                 amount
 *     CR  cash / bank / M-Pesa             amount
 *
 * The mirror of postPaymentReceipt, and the leg that did not exist: without it
 * a bill payment settles the bill — amount_paid and payment_status follow the
 * allocation by trigger — while the trial balance still shows the payable
 * outstanding and the bank untouched. Bill and ledger disagreeing, with only
 * the ledger being the books; the same failure §9.7 records for invoices.
 *
 * NO CLEARING LEG, deliberately. A receipt may be promised and not yet banked,
 * which is what pending_clearance describes. Money leaving is the opposite
 * case: once you have written the cheque or sent the transfer, the payable is
 * discharged from your side. An unpresented cheque is a bank reconciliation
 * matter, not an unposted payment, and modelling it as one would leave the
 * payable outstanding on a bill the supplier considers settled.
 */
export async function postPaymentMade(
  tx: Tx,
  paymentId: string,
  opts: { apAccountId: string; postedById: string },
) {
  const [payment] = await tx
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId));
  if (!payment) throw new Error("Payment not found");
  if (payment.paymentType !== "made") {
    throw new Error(
      `Payment ${payment.paymentNumber} is a receipt; post it with postPaymentReceipt`,
    );
  }
  if (payment.journalEntryId) {
    throw new Error(`Payment ${payment.paymentNumber} has already been posted`);
  }

  const entry = await createJournalEntry(tx, {
    companyId: payment.companyId,
    entryDate: payment.paymentDate,
    entryType: "payment_made",
    description: `Payment ${payment.paymentNumber} to ${payment.partyNameAtPayment}`,
    reference: payment.paymentNumber,
    partyType: "supplier",
    partyId: payment.partyId,
    sourceType: "payment",
    sourceId: payment.id,
    createdById: opts.postedById,
    postImmediately: true,
    lines: [
      {
        accountId: opts.apAccountId,
        debit: payment.amount,
        description: `Reduce payable — ${payment.partyNameAtPayment}`,
      },
      {
        accountId: payment.accountId,
        credit: payment.amount,
        description: `Payment to ${payment.partyNameAtPayment}`,
      },
    ],
  });

  const [updated] = await tx
    .update(payments)
    .set({
      journalEntryId: entry.id,
      status: "confirmed",
      confirmedAt: new Date(),
      confirmedById: opts.postedById,
      updatedAt: new Date(),
    })
    .where(eq(payments.id, paymentId))
    .returning();

  return { payment: updated, entry };
}

/**
 * Clears a receipt that was waiting on the bank: moves it out of the clearing
 * account and into the account it was actually banked into.
 *
 *     DR  bank        amount
 *     CR  clearing    amount
 */
export async function clearPaymentReceipt(
  tx: Tx,
  paymentId: string,
  opts: { clearingAccountId: string; clearedById: string },
) {
  const [payment] = await tx
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.id, paymentId),
        eq(payments.status, "pending_clearance"),
      ),
    );
  if (!payment) {
    throw new Error("Payment not found, or not awaiting clearance");
  }

  await createJournalEntry(tx, {
    companyId: payment.companyId,
    entryDate: new Date().toISOString().slice(0, 10),
    entryType: "payment_received",
    description: `Cleared ${payment.paymentNumber} — ${payment.partyNameAtPayment}`,
    reference: payment.paymentNumber,
    sourceType: "payment",
    sourceId: payment.id,
    createdById: opts.clearedById,
    postImmediately: true,
    lines: [
      { accountId: payment.accountId, debit: payment.amount },
      { accountId: opts.clearingAccountId, credit: payment.amount },
    ],
  });

  const [updated] = await tx
    .update(payments)
    .set({
      status: "confirmed",
      confirmedAt: new Date(),
      confirmedById: opts.clearedById,
      updatedAt: new Date(),
    })
    .where(eq(payments.id, paymentId))
    .returning();

  return updated;
}

/** Allocation totals from the view — derived, never stored, never clamped. */
export async function getPaymentBalance(tx: Tx, paymentId: string) {
  const [row] = (await tx.execute(sql`
    SELECT payment_number, amount, total_allocated, unapplied_amount, is_fully_applied
      FROM payment_balances WHERE payment_id = ${paymentId}
  `)) as unknown as Array<{
    payment_number: string;
    amount: string;
    total_allocated: string;
    unapplied_amount: string;
    is_fully_applied: boolean;
  }>;
  return row ?? null;
}

/**
 * One payment, its allocations, its balance and who acted on it.
 *
 * The actor NAMES are joined from `users` rather than snapshotted into columns
 * the way assets and attendance do it. Both are defensible; the join wins here
 * because a payment's audit trail is read to answer "who do I ask about this",
 * and the current name answers that better than the name at the time. It
 * degrades to null rather than erroring when the actor is no longer visible
 * within the company — RLS decides that, per the `visible_within_company`
 * policy in 0036.
 */
export async function getPayment(tx: Tx, paymentId: string) {
  const [payment] = await tx
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId));
  if (!payment) return null;

  const allocations = await tx
    .select()
    .from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, paymentId))
    .orderBy(asc(paymentAllocations.createdAt));

  const balance = await getPaymentBalance(tx, paymentId);

  const actorIds = [
    payment.createdById,
    payment.confirmedById,
    payment.cancelledById,
  ].filter((id): id is string => Boolean(id));

  const names = new Map<string, string>();
  if (actorIds.length) {
    const rows = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, [...new Set(actorIds)]));
    for (const r of rows) names.set(r.id, r.name);
  }

  return {
    ...payment,
    allocations,
    balance,
    createdByName: payment.createdById ? (names.get(payment.createdById) ?? null) : null,
    confirmedByName: payment.confirmedById ? (names.get(payment.confirmedById) ?? null) : null,
    cancelledByName: payment.cancelledById ? (names.get(payment.cancelledById) ?? null) : null,
  };
}

export async function confirmPayment(
  tx: Tx,
  paymentId: string,
  confirmedById: string,
) {
  const [updated] = await tx
    .update(payments)
    .set({
      status: "confirmed",
      confirmedAt: new Date(),
      confirmedById,
      updatedAt: new Date(),
    })
    .where(and(eq(payments.id, paymentId), eq(payments.status, "draft")))
    .returning();

  if (!updated) throw new Error("Payment not found, or not in draft status");
  return updated;
}

/**
 * Cancels a payment, undoing everything confirming it did.
 *
 * Three things happen, in the caller's transaction:
 *
 *   1. The posted journal entry is REVERSED — never deleted. A payment that
 *      reached the ledger is a fact; withdrawing it is a second fact.
 *   2. The allocation rows are DELETED, which is what gives the invoice or
 *      bill its balance back. Nothing here touches `amount_paid`: the trigger
 *      from 0016/0017 fires on DELETE and recomputes it from what remains.
 *      This is the §8.2 arrangement — one writer, one number.
 *   3. The payment is marked cancelled, with who and why. The pair CHECK from
 *      0063 refuses that write if either is missing.
 *
 * Mongo does 1 and 3 and approximates 2: `reverseAllocatedDocuments` calls
 * `invoice.reversePayment()` per allocation inside a try/catch that logs and
 * CONTINUES. A failure there leaves the payment cancelled, the entry reversed,
 * and the invoice still showing the money as received — with the error only in
 * a server log. Here the deletion is part of the same transaction, so either
 * the whole cancellation happens or none of it does.
 *
 * A cancelled payment cannot be re-cancelled, and — unlike the Mongo path,
 * which reads a `canCancel` virtual off a reconciliation flag this schema does
 * not have — the guard is the status alone.
 */
export async function cancelPayment(
  tx: Tx,
  paymentId: string,
  cancelledById: string,
  reason: string,
) {
  const trimmed = (reason ?? "").trim();
  if (!trimmed) throw new Error("A cancellation reason is required");

  const [payment] = await tx
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId));
  if (!payment) throw new Error("Payment not found");
  if (payment.status === "cancelled") {
    throw new Error(`Payment ${payment.paymentNumber} is already cancelled`);
  }

  if (payment.journalEntryId) {
    await reverseJournalEntry(
      tx,
      payment.journalEntryId,
      cancelledById,
      `Payment ${payment.paymentNumber} cancelled: ${trimmed}`,
    );
  }

  // Gives the documents their balance back, by trigger. Done BEFORE the status
  // flips, because 0063 refuses an allocation against a cancelled payment.
  await tx
    .delete(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, paymentId));

  const [updated] = await tx
    .update(payments)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledById,
      cancellationReason: trimmed,
      updatedAt: new Date(),
    })
    .where(eq(payments.id, paymentId))
    .returning();

  return updated;
}

/**
 * What a party still owes, or is still owed — the picker behind the payment
 * form's allocation table.
 *
 * `balance`, not a stored "amount due": invoices derive it as
 * `total - amount_paid` and bills carry `balance` as a generated column, both
 * maintained by the same triggers the allocations drive. Mongo read
 * `amounts.balance` and `amountDue`, which its hooks maintained separately.
 *
 * Only documents with something OUTSTANDING are returned. The Mongo version
 * filtered on `paymentStatus IN (unpaid, partial)`, a cached label that can
 * disagree with the arithmetic; this filters on the arithmetic, so a document
 * whose label drifted cannot appear here fully paid.
 */
export async function listUnpaidDocuments(
  tx: Tx,
  input: { partyId: string; documentType: "invoice" | "bill" },
) {
  if (input.documentType === "bill") {
    return tx
      .select({
        id: bills.id,
        documentNumber: bills.billNumber,
        documentDate: bills.billDate,
        dueDate: bills.dueDate,
        originalAmount: bills.netPayable,
        balance: bills.balance,
      })
      .from(bills)
      .where(
        and(
          eq(bills.supplierId, input.partyId),
          eq(bills.status, "approved"),
          sql`${bills.balance} > 0`,
        ),
      )
      .orderBy(asc(bills.dueDate), asc(bills.billNumber))
      .limit(200);
  }

  return tx
    .select({
      id: invoices.id,
      documentNumber: invoices.invoiceNumber,
      documentDate: invoices.invoiceDate,
      dueDate: invoices.dueDate,
      originalAmount: invoices.total,
      balance: sql<string>`(${invoices.total} - ${invoices.amountPaid})::numeric(19,4)`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.customerId, input.partyId),
        eq(invoices.status, "completed"),
        sql`(${invoices.total} - ${invoices.amountPaid}) > 0`,
      ),
    )
    .orderBy(asc(invoices.dueDate), asc(invoices.invoiceNumber))
    .limit(200);
}

export interface ListPaymentsOptions {
  paymentType?: "received" | "made";
  status?: "draft" | "pending_clearance" | "confirmed" | "cancelled";
  paymentMethod?: "cash" | "mpesa" | "bank_transfer" | "cheque" | "card";
  partyId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * The payments list, filtered and paged.
 *
 * Every filter the Mongo `getPayments` offered, minus `fiscalPeriod` and
 * `isReconciled`, which have no column here — see the note on the detail page
 * and §9M. It used to take only `paymentType` and silently drop `status` and
 * `partyId`, which the action's own signature advertised; a caller filtering by
 * status got the unfiltered list back and no error.
 *
 * `unappliedAmount` comes from the payment_balances view rather than a stored
 * column, for the reason at the top of this file. It is joined LATERALLY so the
 * page does not issue one balance query per row.
 */
export async function listPayments(tx: Tx, opts: ListPaymentsOptions = {}) {
  const page = Math.max(1, opts.page ?? 1);
  // Capped. The Mongo list takes whatever limit it is handed.
  const limit = Math.min(opts.limit ?? 20, 200);

  const conditions = [];
  if (opts.paymentType) conditions.push(eq(payments.paymentType, opts.paymentType));
  if (opts.status) conditions.push(eq(payments.status, opts.status));
  if (opts.paymentMethod) {
    conditions.push(eq(payments.paymentMethod, opts.paymentMethod));
  }
  if (opts.partyId) conditions.push(eq(payments.partyId, opts.partyId));
  if (opts.startDate) conditions.push(gte(payments.paymentDate, opts.startDate));
  if (opts.endDate) conditions.push(lte(payments.paymentDate, opts.endDate));
  if (opts.search) {
    const term = likeContains(opts.search);
    conditions.push(
      or(
        ilike(payments.paymentNumber, term),
        ilike(payments.partyNameAtPayment, term),
        ilike(payments.reference, term),
        ilike(payments.description, term),
        ilike(payments.mpesaReceipt, term),
      )!,
    );
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await tx
    .select({
      id: payments.id,
      paymentNumber: payments.paymentNumber,
      paymentDate: payments.paymentDate,
      paymentType: payments.paymentType,
      paymentMethod: payments.paymentMethod,
      amount: payments.amount,
      // The snapshot, not a join — this is what the payment document said.
      partyName: payments.partyNameAtPayment,
      reference: payments.reference,
      status: payments.status,
      unappliedAmount: sql<string>`COALESCE(
        (SELECT b.unapplied_amount FROM payment_balances b WHERE b.payment_id = ${payments.id}),
        ${payments.amount}
      )`.as("unapplied_amount"),
    })
    .from(payments)
    .where(where)
    .orderBy(desc(payments.paymentDate), desc(payments.paymentNumber))
    .limit(limit)
    .offset((page - 1) * limit);

  const [{ count }] = (await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(payments)
    .where(where)) as Array<{ count: number }>;

  return {
    payments: rows,
    pagination: {
      page,
      limit,
      total: count,
      pages: Math.max(1, Math.ceil(count / limit)),
    },
  };
}

/** Unapplied payments — money received but not yet matched to a document. */
export async function getUnappliedPayments(tx: Tx, limit = 50) {
  return tx.execute(sql`
    SELECT payment_id, payment_number, amount, total_allocated, unapplied_amount
      FROM payment_balances
     WHERE unapplied_amount > 0
     ORDER BY unapplied_amount DESC
     LIMIT ${Math.min(limit, 200)}
  `);
}

/**
 * The payments list's stat tiles, in the shape the pages already read:
 * `{ thisMonth: { received, made }, byStatus, unreconciledCount }`.
 *
 * One grouped query rather than four counts and a fold. `thisMonth` is
 * computed from the payment DATE, not `created_at` — a payment entered today
 * for last month belongs to last month, which is the whole reason the date is
 * a separate column.
 */
export async function getPaymentStats(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT
      count(*) FILTER (WHERE payment_type = 'received'
                         AND date_trunc('month', payment_date) = date_trunc('month', CURRENT_DATE))::int AS received_count,
      COALESCE(SUM(amount) FILTER (WHERE payment_type = 'received'
                         AND date_trunc('month', payment_date) = date_trunc('month', CURRENT_DATE)), 0)::text AS received_total,
      count(*) FILTER (WHERE payment_type = 'made'
                         AND date_trunc('month', payment_date) = date_trunc('month', CURRENT_DATE))::int AS made_count,
      COALESCE(SUM(amount) FILTER (WHERE payment_type = 'made'
                         AND date_trunc('month', payment_date) = date_trunc('month', CURRENT_DATE)), 0)::text AS made_total,
      count(*) FILTER (WHERE status = 'draft')::int      AS draft,
      count(*) FILTER (WHERE status = 'confirmed')::int  AS confirmed,
      count(*) FILTER (WHERE status = 'cancelled')::int  AS cancelled,
      -- "Unreconciled" in the Mongo sense has no column here.
      -- pending_clearance is the honest analogue: recorded, and not yet
      -- through the bank. A cheque written today sits here until it clears.
      count(*) FILTER (WHERE status = 'pending_clearance')::int AS unreconciled
    FROM payments
  `)) as unknown as Array<Record<string, string | number>>;

  return {
    thisMonth: {
      received: { count: Number(row.received_count), total: Number(row.received_total) },
      made: { count: Number(row.made_count), total: Number(row.made_total) },
    },
    byStatus: {
      draft: Number(row.draft),
      confirmed: Number(row.confirmed),
      cancelled: Number(row.cancelled),
      pendingClearance: Number(row.unreconciled),
    },
    unreconciledCount: Number(row.unreconciled),
  };
}
