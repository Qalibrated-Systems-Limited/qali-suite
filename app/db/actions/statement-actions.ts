"use server";

import { sql } from "drizzle-orm";
import { withAuthorizedTenant } from "../tenant";
import * as reports from "../repositories/reports";
import * as partiesRepo from "../repositories/parties";
import { rolesFor } from "@/lib/capabilities";

/**
 * Customer and supplier statements, off the ledger.
 *
 * WHAT THIS REPLACES. `app/mongodb/queries/statement-queries.js` assembled a
 * statement by reading the Mongo `Invoice`, `Bill`, `Party` and `Payment`
 * models and adding up a running balance in JavaScript. All four of those
 * moved to Postgres long ago and the collections stopped being written, so
 * the statements had been rendering an empty ledger — and before they could
 * even do that, `ObjectId.isValid(customerId)` returned false for a uuid and
 * the whole thing returned null.
 *
 * THE LEDGER IS THE BETTER SOURCE ANYWAY. Summing documents means every new
 * document type that touches a customer's balance has to be remembered here.
 * The AR and AP control accounts already carry every one of them, posted, so
 * a statement derived from `journal_entries` cannot miss a category the way
 * the document-summing version missed credit notes twice.
 *
 * SHAPE. The screens are kept — the return matches what they already destructure
 * (`customer`, `transactions`, `summary`, `aging`, `period`), so the port is a
 * change of source rather than a redesign of four pages.
 */

/** Roles that may read another party's account. Mirrors the finance gates. */
const STATEMENT_ROLES = rolesFor("statement.send");

const num = (v: unknown) => Number(v ?? 0);

/** Today, as the date-only string the ledger queries take. */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Aging for ONE party, from the same query the aging report uses.
 *
 * The Mongo version recomputed buckets in JavaScript from invoice due dates,
 * which disagreed with /dashboard/reports/ar-aging whenever a credit note or
 * an unallocated payment moved the balance. One source, one answer.
 */
function agingFor(rows: reports.AgingRow[], partyId: string) {
  const row = rows.find((r) => String(r.partyId) === String(partyId));
  return {
    current: num(row?.current),
    days30: num(row?.days0_30),
    days60: num(row?.days31_60),
    days90: num(row?.days61_90),
    over90: num(row?.days90plus),
  };
}

export async function getStatementOfAccountPg(
  partyType: "customer" | "supplier",
  partyId: string,
  startDate?: string | null,
  endDate?: string | null,
) {
  if (!partyId) return null;

  // A statement with no period is the account's whole life to date. The
  // Mongo version defaulted to no filter at all and then could not state an
  // opening balance; an explicit floor keeps one code path.
  const from = startDate || "1900-01-01";
  const to = endDate || today();

  return withAuthorizedTenant([...STATEMENT_ROLES], async (tx) => {
    const party = await partiesRepo.getParty(tx, partyId);
    // RLS already refused another tenant's party — this is "no such party".
    if (!party) return null;

    const [rows, openingBalance, aging] = await Promise.all([
      reports.getStatementOfAccount(tx, partyType, partyId, from, to),
      reports.getStatementOpeningBalance(tx, partyType, partyId, from),
      reports.getAgingReport(
        tx,
        partyType === "customer" ? "receivable" : "payable",
        to,
      ),
    ]);

    const opening = num(openingBalance);

    const transactions = rows.map((r) => ({
      date: r.date as Date,
      type: (r.sourceType as string) ?? "journal",
      reference: (r.reference as string) ?? (r.entryNumber as string),
      description: r.description as string,
      debit: num(r.debit),
      credit: num(r.credit),
      documentId: (r.sourceId as string) ?? null,
      dueDate: (r.dueDate as Date) ?? null,
      // The ledger records whether the entry has been settled; the Mongo
      // version read a paymentStatus field off the invoice.
      status: r.isFullyPaid ? "paid" : "outstanding",
      balance: num(r.balance),
    }));

    /**
     * Totals from the movements, not from the documents.
     *
     * For a customer a debit increases what they owe (an invoice) and a credit
     * reduces it (a payment or a credit note); for a supplier it is the other
     * way round. Which way the ledger already recorded it is not something
     * this layer has to know a second time — it sums what is there.
     */
    const debits = transactions.reduce((s, t) => s + t.debit, 0);
    const credits = transactions.reduce((s, t) => s + t.credit, 0);
    const closingBalance = transactions.length
      ? transactions[transactions.length - 1].balance
      : opening;

    return {
      // The same row under three names: the customer page destructures
      // `customer`, the supplier page `supplier`, and neither should be
      // rewritten for a change of data source.
      customer: party,
      supplier: party,
      party,
      transactions,
      summary: {
        openingBalance: opening,
        totalInvoiced: partyType === "customer" ? debits : credits,
        totalPaid: partyType === "customer" ? credits : debits,
        // Credit notes are one of the credits above and are no longer counted
        // separately: the ledger does not distinguish them from any other
        // reduction, and showing them twice was how the Mongo summary drifted
        // from its own transaction list.
        totalCredited: 0,
        closingBalance,
      },
      aging: agingFor(aging, partyId),
      period: { startDate: startDate || null, endDate: endDate || null },
      generatedAt: new Date(),
    };
  });
}

/**
 * The parties with a non-zero balance.
 *
 * Derived from the aging report rather than from a party list, so somebody
 * who owes nothing does not appear — which is what the Mongo version's name
 * ("customers WITH balances") promised and its implementation did not do.
 *
 * NOT EXPORTED. Every export of a `"use server"` file is a callable server
 * action, and no screen needs this one: the picker wants every party
 * (`listPartiesForStatementsPg`) and the cards want the totals
 * (`getAgingSummaryPg`, which is the only caller). find-unwired-actions.mjs
 * flags it otherwise, correctly.
 */
async function listPartiesWithBalancesPg(
  partyType: "customer" | "supplier",
  asOfDate?: string,
) {
  return withAuthorizedTenant([...STATEMENT_ROLES], async (tx) => {
    const rows = await reports.getAgingReport(
      tx,
      partyType === "customer" ? "receivable" : "payable",
      asOfDate || today(),
    );
    return rows.map((r) => ({
      _id: String(r.partyId),
      id: String(r.partyId),
      name: (r.partyName as string) ?? "(unnamed)",
      balance: num(r.total),
      current: num(r.current),
      days30: num(r.days0_30),
      days60: num(r.days31_60),
      days90: num(r.days61_90),
      over90: num(r.days90plus),
    }));
  });
}

/**
 * Every active party of this type, with its balance — what the statement
 * picker lists.
 *
 * The Mongo function this replaces was called `getCustomersWithBalances` and
 * returned every active customer whether or not it had one, so the name is
 * not a filter and the picker depends on that: you must be able to raise a
 * statement for somebody who owes nothing. `listPartiesWithBalancesPg` above
 * is the one that filters.
 *
 * `balance` comes from the `party_balances` view, derived from the AR/AP
 * control accounts. The Mongo field was `cachedBalance`, whose own schema
 * comment read "Cached - NOT source of truth!" and which 0006 deliberately
 * did not carry over. It is exposed under the old name so the components
 * that read it keep working.
 */
export async function listPartiesForStatementsPg(
  partyType: "customer" | "supplier",
) {
  return withAuthorizedTenant([...STATEMENT_ROLES], async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT p.id, p.name, p.display_name, p.email, p.phone,
             COALESCE(b.balance, 0)::numeric(19,4) AS balance
        FROM parties p
        LEFT JOIN party_balances b ON b.party_id = p.id
       WHERE p.is_active = true
         AND ${partyType === "customer" ? sql`p.is_customer` : sql`p.is_supplier`} = true
       ORDER BY p.name
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      _id: String(r.id),
      id: String(r.id),
      name: String(r.name),
      displayName: (r.display_name as string) ?? null,
      email: (r.email as string) ?? null,
      phone: (r.phone as string) ?? null,
      cachedBalance: num(r.balance),
      balance: num(r.balance),
    }));
  });
}

/** The four bucket totals the statements index prints above the list. */
export async function getAgingSummaryPg(
  partyType: "customer" | "supplier",
  asOfDate?: string,
) {
  const rows = await listPartiesWithBalancesPg(partyType, asOfDate);
  return rows.reduce(
    (acc, r) => ({
      current: acc.current + r.current,
      days30: acc.days30 + r.days30,
      days60: acc.days60 + r.days60,
      days90: acc.days90 + r.days90,
      over90: acc.over90 + r.over90,
      total: acc.total + r.balance,
      // `totalOutstanding` is the name the index cards read; `total` is kept
      // because it is the name every other aging caller uses.
      totalOutstanding: acc.totalOutstanding + r.balance,
    }),
    {
      current: 0,
      days30: 0,
      days60: 0,
      days90: 0,
      over90: 0,
      total: 0,
      totalOutstanding: 0,
    },
  );
}
