import { sql } from "drizzle-orm";
import type { Tx } from "../client";

/**
 * Financial reports.
 *
 * These replace the largest and most duplicated of the 270 Mongo aggregation
 * pipelines. Compare getARAgingReport() in app/models/JournalEntry.js: ~90
 * lines of $unwind / $addFields / $switch / $group, duplicated almost verbatim
 * for AP, with the opening $match missing a companyId filter so it scanned
 * every tenant's entries.
 *
 * Here AR and AP are one query parameterised by side, and tenant scope comes
 * from RLS rather than from remembering to write it.
 */

export interface AgingRow {
  partyId: string;
  partyName: string | null;
  current: string;
  days0_30: string;
  days31_60: string;
  days61_90: string;
  days90plus: string;
  total: string;
}

/**
 * AR/AP aging as at a date.
 *
 * `side` picks which system account and which sign convention applies:
 *   receivable — customers, AR account, debit-positive
 *   payable    — suppliers, AP account, credit-positive
 */
export async function getAgingReport(
  tx: Tx,
  side: "receivable" | "payable",
  asOfDate: string,
): Promise<AgingRow[]> {
  const systemAccount = side === "receivable" ? "accounts_receivable" : "accounts_payable";
  const partyType = side === "receivable" ? "customer" : "supplier";

  // Debit-positive for AR, credit-positive for AP.
  const amount =
    side === "receivable"
      ? sql`(l.debit - l.credit)`
      : sql`(l.credit - l.debit)`;

  const rows = await tx.execute(sql`
    WITH target_account AS (
      SELECT id FROM accounts WHERE system_account = ${systemAccount}
    ),
    aged AS (
      SELECT
        e.party_id,
        ${amount}::numeric(19,4) AS amount,
        CASE
          WHEN e.due_date IS NULL THEN 0
          ELSE GREATEST(0, (${asOfDate}::date - e.due_date))
        END AS days_overdue
      FROM journal_entries e
      JOIN journal_lines l ON l.entry_id = e.id
      JOIN target_account ta ON ta.id = l.account_id
      WHERE e.status = 'posted'
        AND e.entry_date <= ${asOfDate}::date
        AND e.party_type = ${partyType}
        AND e.is_fully_paid = false
    )
    SELECT
      party_id AS "partyId",
      NULL::text AS "partyName",
      COALESCE(SUM(amount) FILTER (WHERE days_overdue = 0), 0)::numeric(19,4)          AS "current",
      COALESCE(SUM(amount) FILTER (WHERE days_overdue BETWEEN 1 AND 30), 0)::numeric(19,4)  AS "days0_30",
      COALESCE(SUM(amount) FILTER (WHERE days_overdue BETWEEN 31 AND 60), 0)::numeric(19,4) AS "days31_60",
      COALESCE(SUM(amount) FILTER (WHERE days_overdue BETWEEN 61 AND 90), 0)::numeric(19,4) AS "days61_90",
      COALESCE(SUM(amount) FILTER (WHERE days_overdue > 90), 0)::numeric(19,4)         AS "days90plus",
      COALESCE(SUM(amount), 0)::numeric(19,4)                                          AS "total"
    FROM aged
    GROUP BY party_id
    HAVING SUM(amount) <> 0
    ORDER BY "total" DESC
  `);

  return rows as unknown as AgingRow[];
}

/**
 * Statement of account for one party, with a running balance.
 *
 * The Mongo version computed the running balance in JavaScript after fetching
 * every transaction, and its query carried no tenant filter at all — see
 * getStatementOfAccount() in app/models/JournalEntry.js. A window function does
 * the running total in the database, and RLS supplies the tenant scope.
 */
export async function getStatementOfAccount(
  tx: Tx,
  partyType: "customer" | "supplier",
  partyId: string,
  startDate: string,
  endDate: string,
) {
  const systemAccount =
    partyType === "customer" ? "accounts_receivable" : "accounts_payable";

  const movement =
    partyType === "customer"
      ? sql`(l.debit - l.credit)`
      : sql`(l.credit - l.debit)`;

  const rows = await tx.execute(sql`
    WITH target_account AS (
      SELECT id FROM accounts WHERE system_account = ${systemAccount}
    ),
    txns AS (
      SELECT
        e.entry_date,
        e.entry_number,
        e.description,
        e.reference,
        e.due_date,
        e.is_fully_paid,
        l.debit,
        l.credit,
        ${movement}::numeric(19,4) AS movement
      FROM journal_entries e
      JOIN journal_lines l ON l.entry_id = e.id
      JOIN target_account ta ON ta.id = l.account_id
      WHERE e.status = 'posted'
        AND e.party_type = ${partyType}
        AND e.party_id = ${partyId}::uuid
        AND e.entry_date BETWEEN ${startDate}::date AND ${endDate}::date
    )
    SELECT
      entry_date      AS "date",
      entry_number    AS "entryNumber",
      description,
      reference,
      due_date        AS "dueDate",
      is_fully_paid   AS "isFullyPaid",
      debit,
      credit,
      SUM(movement) OVER (
        ORDER BY entry_date, entry_number
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )::numeric(19,4) AS "balance"
    FROM txns
    ORDER BY entry_date, entry_number
  `);

  return rows as unknown as Array<Record<string, unknown>>;
}

/**
 * Trial balance as at a date, straight off the view.
 *
 * This is the cutover reconciliation target: these totals must equal the Mongo
 * trial balance exactly. `totalDebit = totalCredit` is the check that the whole
 * ledger is internally consistent.
 */
export async function getTrialBalance(tx: Tx) {
  const rows = (await tx.execute(sql`
    SELECT
      account_code   AS "accountCode",
      account_name   AS "accountName",
      account_type   AS "accountType",
      debit_balance  AS "debitBalance",
      credit_balance AS "creditBalance"
    FROM trial_balance
    WHERE debit_balance <> 0 OR credit_balance <> 0
    ORDER BY account_code
  `)) as unknown as Array<{
    accountCode: string;
    accountName: string;
    accountType: string;
    debitBalance: string;
    creditBalance: string;
  }>;

  const [totals] = (await tx.execute(sql`
    SELECT
      COALESCE(SUM(debit_balance), 0)::numeric(19,4)  AS "totalDebit",
      COALESCE(SUM(credit_balance), 0)::numeric(19,4) AS "totalCredit"
    FROM trial_balance
  `)) as unknown as Array<{ totalDebit: string; totalCredit: string }>;

  return {
    rows,
    totalDebit: totals.totalDebit,
    totalCredit: totals.totalCredit,
    // String comparison is exact for numeric; never compare these as floats.
    isBalanced: totals.totalDebit === totals.totalCredit,
  };
}
