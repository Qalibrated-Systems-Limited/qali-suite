import { and, desc, eq, sql } from "drizzle-orm";
import { createJournalEntry } from "./journal";
import type { Tx } from "../client";
import {
  payments,
  paymentAllocations,
  parties,
  accounts,
  invoices,
  bills,
} from "../schema";

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
  companyId: string;
  paymentType: "received" | "made";
  paymentDate: string;
  paymentMethod: "cash" | "mpesa" | "bank_transfer" | "cheque" | "card";
  amount: string;
  partyId: string;
  accountId: string;
  reference?: string | null;
  description?: string | null;
  mpesaReceipt?: string | null;
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
      mpesaReceipt: input.mpesaReceipt ?? null,
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

export async function getPayment(tx: Tx, paymentId: string) {
  const [payment] = await tx
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId));
  if (!payment) return null;

  const allocations = await tx
    .select()
    .from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, paymentId));

  const balance = await getPaymentBalance(tx, paymentId);

  return { ...payment, allocations, balance };
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

export async function listPayments(
  tx: Tx,
  opts: {
    paymentType?: "received" | "made";
    limit?: number;
    offset?: number;
  } = {},
) {
  const limit = Math.min(opts.limit ?? 50, 200);
  return tx
    .select({
      id: payments.id,
      paymentNumber: payments.paymentNumber,
      paymentDate: payments.paymentDate,
      paymentType: payments.paymentType,
      paymentMethod: payments.paymentMethod,
      amount: payments.amount,
      // The snapshot, not a join — this is what the payment document said.
      partyName: payments.partyNameAtPayment,
      status: payments.status,
    })
    .from(payments)
    .where(
      opts.paymentType ? eq(payments.paymentType, opts.paymentType) : undefined,
    )
    .orderBy(desc(payments.paymentDate), desc(payments.paymentNumber))
    .limit(limit)
    .offset(opts.offset ?? 0);
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
