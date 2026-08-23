import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { Tx } from "../client";
import {
  accounts,
  bills,
  invoices,
  journalEntries,
  journalLines,
  parties,
} from "../schema";
import { createJournalEntry, reverseJournalEntry } from "./journal";

/**
 * Opening balances — the cutover (0061).
 *
 * Two shapes of opening figure, and they are not the same thing:
 *
 *   THE LUMP — one journal entry carrying every account's balance as at the
 *   cutover date, with the difference plugged to Opening Balance Equity so it
 *   balances. Booked once.
 *
 *   THE DOCUMENTS — an opening invoice or bill per customer or supplier, so
 *   the AR and AP subledgers know WHO owed what. These live in `invoices` and
 *   `bills` with `is_opening_balance`, and post against OBE rather than
 *   revenue or expense.
 *
 * The Mongo version distinguishes them by whether `relatedDocuments` is set —
 * "the lump is identified by having NO related invoice/bill". Here the lump is
 * the entry whose `source_type IS NULL`, which is the same test said directly.
 */

export type MoneyString = string;

/** Every posted line touching an account, netted. OBE is credit-normal. */
async function accountNet(tx: Tx, accountId: string) {
  const [row] = (await tx.execute(sql`
    SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::text AS net
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
     WHERE jl.account_id = ${accountId}::uuid
       AND je.status = 'posted'
  `)) as unknown as Array<{ net: string }>;
  return row?.net ?? "0";
}

/** The opening LUMP entry, if one has been booked and not reversed. */
export async function getOpeningLumpEntry(tx: Tx) {
  const [entry] = await tx
    .select({
      id: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
      entryDate: journalEntries.entryDate,
      status: journalEntries.status,
    })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.entryType, "opening_balance"),
        ne(journalEntries.status, "reversed"),
        sql`${journalEntries.sourceType} IS NULL`,
      ),
    );
  return entry ?? null;
}

export interface OpeningLine {
  accountId: string;
  debit: MoneyString;
  credit: MoneyString;
}

/**
 * Books the opening lump.
 *
 * The plug to Opening Balance Equity is computed in SQL-safe decimal strings
 * rather than accumulated in JavaScript: the Mongo version rounds each side to
 * two places, subtracts, and treats anything under a cent as balanced — one of
 * §9.2's tolerances. Here the entry either balances or the database refuses it.
 */
export async function postOpeningBalances(
  tx: Tx,
  input: {
    companyId: string;
    entryDate: string;
    lines: OpeningLine[];
    openingEquityAccountId: string;
    createdById?: string | null;
  },
) {
  const existing = await getOpeningLumpEntry(tx);
  if (existing) {
    throw new Error(
      `Opening balances were already posted (${existing.entryNumber}). Reverse that entry before re-entering.`,
    );
  }

  const cleaned = input.lines.filter(
    (l) => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0),
  );
  if (!cleaned.length) throw new Error("Enter at least one opening balance.");
  if (cleaned.some((l) => Number(l.debit) > 0 && Number(l.credit) > 0)) {
    throw new Error("A line cannot have both a debit and a credit.");
  }

  // Every account must be postable and in this tenant. RLS handles the tenant;
  // `can_post` is checked here so the failure names the account.
  const ids = cleaned.map((l) => l.accountId);
  const postable = await tx
    .select({ id: accounts.id, name: accounts.accountName, canPost: accounts.canPost })
    .from(accounts)
    .where(sql`${accounts.id} = ANY(${ids}::uuid[])`);
  const byId = new Map(postable.map((a) => [a.id, a]));
  for (const line of cleaned) {
    const account = byId.get(line.accountId);
    if (!account) {
      throw new Error("One of the selected accounts could not be found.");
    }
    if (account.canPost === false) {
      throw new Error(`${account.name} is a header account and cannot be posted to.`);
    }
  }

  const totalDebit = cleaned.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = cleaned.reduce((s, l) => s + Number(l.credit), 0);
  const diff = Math.round((totalDebit - totalCredit) * 10000) / 10000;

  const entryLines = cleaned.map((l) => ({
    accountId: l.accountId,
    debit: Number(l.debit) > 0 ? l.debit : undefined,
    credit: Number(l.credit) > 0 ? l.credit : undefined,
    description: "Opening balance",
  }));

  if (diff !== 0) {
    entryLines.push({
      accountId: input.openingEquityAccountId,
      debit: diff > 0 ? undefined : Math.abs(diff).toFixed(4),
      credit: diff > 0 ? diff.toFixed(4) : undefined,
      description: "Opening balance — to be reclassified to equity",
    });
  }

  if (entryLines.length < 2) {
    throw new Error("Opening balances need at least two accounts.");
  }

  const entry = await createJournalEntry(tx, {
    companyId: input.companyId,
    entryDate: input.entryDate,
    entryType: "opening_balance",
    description: "Opening balances",
    // Deliberately NO sourceType: that is what marks this as the lump rather
    // than an opening document, and what getOpeningLumpEntry looks for.
    lines: entryLines,
    createdById: input.createdById ?? null,
    postImmediately: true,
  });

  return { entry, openingBalanceEquity: -diff };
}

/**
 * Reverses an opening document and cancels it.
 *
 * Refuses anything that is not an opening document — the Mongo version filters
 * on `isOpeningBalance` in its query, so a plain invoice id simply "was not
 * found"; here it says which rule it broke.
 */
export async function reverseOpeningInvoice(
  tx: Tx,
  invoiceId: string,
  opts: { reversedById: string },
) {
  const [invoice] = await tx
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  if (!invoice) throw new Error("Opening invoice not found.");
  if (!invoice.isOpeningBalance) {
    throw new Error("That is not an opening-balance invoice.");
  }
  if (invoice.status === "cancelled") {
    throw new Error("That opening invoice is already reversed.");
  }

  const entries = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.sourceType, "invoice"),
        eq(journalEntries.sourceId, invoiceId),
        eq(journalEntries.status, "posted"),
      ),
    );
  for (const e of entries) {
    await reverseJournalEntry(
      tx,
      e.id,
      opts.reversedById,
      "Opening invoice reversed during setup",
    );
  }

  const [updated] = await tx
    .update(invoices)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId))
    .returning();
  return updated;
}

export async function reverseOpeningBill(
  tx: Tx,
  billId: string,
  opts: { reversedById: string },
) {
  const [bill] = await tx.select().from(bills).where(eq(bills.id, billId));
  if (!bill) throw new Error("Opening bill not found.");
  if (!bill.isOpeningBalance) {
    throw new Error("That is not an opening-balance bill.");
  }
  if (bill.status === "cancelled") {
    throw new Error("That opening bill is already reversed.");
  }

  const entries = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.sourceType, "bill"),
        eq(journalEntries.sourceId, billId),
        eq(journalEntries.status, "posted"),
      ),
    );
  for (const e of entries) {
    await reverseJournalEntry(
      tx,
      e.id,
      opts.reversedById,
      "Opening bill reversed during setup",
    );
  }

  const [updated] = await tx
    .update(bills)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(bills.id, billId))
    .returning();
  return updated;
}

/**
 * Everything the opening-balances screen needs, in the shape it reads.
 *
 * `liveLocked` is the important one: once a REAL transaction has posted,
 * opening balances must not be re-entered underneath it. The Mongo version
 * asks for any posted entry that is not an opening balance and not a reversal.
 */
export async function getOpeningBalanceSetup(tx: Tx) {
  const [
    postableAccounts,
    lump,
    obe,
    openingReceivables,
    openingPayables,
    customers,
    suppliers,
    liveTxn,
  ] = await Promise.all([
    tx
      .select({
        _id: accounts.id,
        id: accounts.id,
        accountCode: accounts.accountCode,
        accountName: accounts.accountName,
        accountType: accounts.accountType,
        subType: accounts.subType,
        systemAccount: accounts.systemAccount,
      })
      .from(accounts)
      .where(and(eq(accounts.canPost, true), eq(accounts.isActive, true)))
      .orderBy(asc(accounts.accountCode)),

    getOpeningLumpEntry(tx),

    tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.systemAccount, "opening_balance_equity")),

    tx
      .select({
        _id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        invoiceDate: invoices.invoiceDate,
        dueDate: invoices.dueDate,
        total: invoices.total,
        // No amountDue column on invoices — it is total less what has been
        // paid, and an opening invoice is unpaid by construction.
        amountPaid: invoices.amountPaid,
        paymentStatus: invoices.paymentStatus,
        customerName: parties.name,
      })
      .from(invoices)
      .leftJoin(parties, eq(parties.id, invoices.customerId))
      .where(
        and(eq(invoices.isOpeningBalance, true), ne(invoices.status, "cancelled")),
      )
      .orderBy(asc(invoices.invoiceDate)),

    tx
      .select({
        _id: bills.id,
        billNumber: bills.billNumber,
        billDate: bills.billDate,
        dueDate: bills.dueDate,
        netPayable: bills.netPayable,
        balance: bills.balance,
        paymentStatus: bills.paymentStatus,
        supplierName: bills.supplierNameAtBill,
      })
      .from(bills)
      .where(and(eq(bills.isOpeningBalance, true), ne(bills.status, "cancelled")))
      .orderBy(asc(bills.billDate)),

    tx
      .select({ _id: parties.id, id: parties.id, name: parties.name })
      .from(parties)
      .where(and(eq(parties.isCustomer, true), eq(parties.isActive, true)))
      .orderBy(asc(parties.name)),

    tx
      .select({ _id: parties.id, id: parties.id, name: parties.name })
      .from(parties)
      .where(and(eq(parties.isSupplier, true), eq(parties.isActive, true)))
      .orderBy(asc(parties.name)),

    tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.status, "posted"),
          ne(journalEntries.entryType, "opening_balance"),
          sql`${journalEntries.originalEntryId} IS NULL`,
        ),
      )
      .limit(1),
  ]);

  const obeAccountId = obe[0]?.id ?? null;
  const openingBalanceEquity = obeAccountId
    ? Number(await accountNet(tx, obeAccountId))
    : 0;

  const r2 = (n: number) => Math.round(n * 100) / 100;

  return {
    accounts: postableAccounts,
    obeAccountId,
    alreadyPosted: lump
      ? { entryNumber: lump.entryNumber, entryDate: lump.entryDate }
      : null,
    openingBalanceEquity: r2(openingBalanceEquity),
    liveLocked: liveTxn.length > 0,
    customers,
    suppliers,
    // The screen reads `customer.name` / `supplier.name` on these rows.
    openingReceivables: openingReceivables.map((d) => ({
      ...d,
      total: Number(d.total),
      amountDue: Number(d.total) - Number(d.amountPaid),
      customer: { name: d.customerName },
    })),
    openingPayables: openingPayables.map((d) => ({
      ...d,
      amounts: { netPayable: Number(d.netPayable), balance: Number(d.balance) },
      supplier: { name: d.supplierName },
    })),
    receivablesTotal: r2(
      openingReceivables.reduce((s, d) => s + Number(d.total ?? 0), 0),
    ),
    payablesTotal: r2(
      openingPayables.reduce((s, d) => s + Number(d.netPayable ?? 0), 0),
    ),
  };
}
