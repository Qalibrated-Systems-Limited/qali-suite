"use server";

import { sql } from "drizzle-orm";
import { withAuthorizedTenant, FINANCE_ROLES } from "../tenant";

/**
 * Postgres-backed reports, shaped to match the Mongo query layer exactly so a
 * page can switch source without touching its client components.
 *
 * Reference implementation: ReportService.generateTrialBalance() in
 * app/mongodb/services/reportsService.js.
 *
 * ── On numbers ──────────────────────────────────────────────────────────────
 * The per-account debit/credit values are returned as JS numbers, because the
 * existing client components format them that way and this must be a drop-in.
 * That is safe: they are display values.
 *
 * `summary.isBalanced` is NOT computed from those numbers. It is decided in
 * SQL by comparing exact numeric(19,4) totals, then passed through. The Mongo
 * version computes `Math.abs(totalDebits - totalCredits) < 0.01` in JavaScript
 * — which is how a ledger out of balance by half a cent reports as balanced.
 * Display may be approximate; the decision must not be.
 */

export interface TrialBalanceRow {
  accountCode: string;
  accountName: string;
  accountType: string;
  debit: number;
  credit: number;
}

export interface TrialBalanceReport {
  reportName: string;
  asOfDate: Date;
  accounts: TrialBalanceRow[];
  summary: {
    totalDebits: number;
    totalCredits: number;
    difference: number;
    isBalanced: boolean;
    /** Exact numeric strings — use these for reconciliation, not the numbers. */
    exact: { totalDebits: string; totalCredits: string; difference: string };
  };
  source: "postgres";
}

export async function getTrialBalanceDataPg(
  asOfDate: string,
  showZeroBalances = false,
): Promise<TrialBalanceReport> {
  return withAuthorizedTenant(FINANCE_ROLES, async (tx) => {
    // Balances as at a date. account_balances is not date-filtered, so the
    // as-of cut is applied here against the ledger directly.
    const rows = (await tx.execute(sql`
      WITH balances AS (
        SELECT
          a.account_code,
          a.account_name,
          a.account_type,
          COALESCE(SUM(l.debit),  0)::numeric(19,4) AS total_debit,
          COALESCE(SUM(l.credit), 0)::numeric(19,4) AS total_credit
        FROM accounts a
        JOIN journal_lines l   ON l.account_id = a.id
        JOIN journal_entries e ON e.id = l.entry_id
        WHERE e.status = 'posted'
          AND e.entry_date <= ${asOfDate}::date
          AND a.can_post = true
          AND a.is_active = true
        GROUP BY a.account_code, a.account_name, a.account_type
      )
      SELECT
        account_code AS "accountCode",
        account_name AS "accountName",
        account_type AS "accountType",
        -- Net per account onto a single column, matching the Mongo report.
        CASE WHEN (total_debit - total_credit) > 0
             THEN (total_debit - total_credit) ELSE 0 END::numeric(19,4) AS debit,
        CASE WHEN (total_debit - total_credit) < 0
             THEN (total_credit - total_debit) ELSE 0 END::numeric(19,4) AS credit
      FROM balances
      ORDER BY account_code
    `)) as unknown as Array<{
      accountCode: string;
      accountName: string;
      accountType: string;
      debit: string;
      credit: string;
    }>;

    // Exact totals, decided in the database.
    const [totals] = (await tx.execute(sql`
      WITH balances AS (
        SELECT
          a.id,
          COALESCE(SUM(l.debit),  0)::numeric(19,4) AS total_debit,
          COALESCE(SUM(l.credit), 0)::numeric(19,4) AS total_credit
        FROM accounts a
        JOIN journal_lines l   ON l.account_id = a.id
        JOIN journal_entries e ON e.id = l.entry_id
        WHERE e.status = 'posted'
          AND e.entry_date <= ${asOfDate}::date
          AND a.can_post = true
          AND a.is_active = true
        GROUP BY a.id
      ),
      netted AS (
        SELECT
          CASE WHEN (total_debit - total_credit) > 0
               THEN (total_debit - total_credit) ELSE 0 END AS d,
          CASE WHEN (total_debit - total_credit) < 0
               THEN (total_credit - total_debit) ELSE 0 END AS c
        FROM balances
      )
      SELECT
        COALESCE(SUM(d), 0)::numeric(19,4)     AS "totalDebits",
        COALESCE(SUM(c), 0)::numeric(19,4)     AS "totalCredits",
        (COALESCE(SUM(d), 0) - COALESCE(SUM(c), 0))::numeric(19,4) AS "difference",
        (COALESCE(SUM(d), 0) = COALESCE(SUM(c), 0))                AS "isBalanced"
      FROM netted
    `)) as unknown as Array<{
      totalDebits: string;
      totalCredits: string;
      difference: string;
      isBalanced: boolean;
    }>;

    const accounts = rows
      .filter((r) => showZeroBalances || Number(r.debit) !== 0 || Number(r.credit) !== 0)
      .map((r) => ({
        accountCode: r.accountCode,
        accountName: r.accountName,
        accountType: r.accountType,
        debit: Number(r.debit),
        credit: Number(r.credit),
      }));

    return {
      reportName: "Trial Balance",
      asOfDate: new Date(asOfDate),
      accounts,
      summary: {
        totalDebits: Number(totals.totalDebits),
        totalCredits: Number(totals.totalCredits),
        difference: Number(totals.difference),
        // Decided by Postgres on exact numerics, not recomputed from floats.
        isBalanced: totals.isBalanced,
        exact: {
          totalDebits: totals.totalDebits,
          totalCredits: totals.totalCredits,
          difference: totals.difference,
        },
      },
      source: "postgres" as const,
    };
  });
}
