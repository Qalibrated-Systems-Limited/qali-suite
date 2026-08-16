import { sql } from "drizzle-orm";
import type { Tx } from "../client";

/**
 * Report queries. All SQL for reporting lives here, per the layering rule in
 * docs/POSTGRES-MIGRATION-PLAN.md §4.1 — actions do auth and validation, this
 * layer does SQL, and neither does the other's job.
 *
 * Shapes mirror ReportService in app/mongodb/services/reportsService.js so a
 * page can switch source without touching its client components.
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
    /**
     * Decided in SQL on exact numeric(19,4) totals, NOT recomputed from the
     * JS numbers above. The Mongo version uses
     * `Math.abs(totalDebits - totalCredits) < 0.01`, which reports a ledger
     * out of balance by half a cent as balanced.
     */
    isBalanced: boolean;
    /** Exact numeric strings — use these for reconciliation, not the numbers. */
    exact: { totalDebits: string; totalCredits: string; difference: string };
  };
  source: "postgres";
}

export interface GeneralLedgerReport {
  reportName: string;
  account: {
    accountCode: string;
    accountName: string;
    accountType: string;
    normalBalanceSide: "debit" | "credit";
  };
  period: { startDate?: string; endDate?: string };
  transactions: Array<{
    date: string;
    entryNumber: string;
    description: string;
    reference: string | null;
    debit: number;
    credit: number;
    balance: number;
  }>;
  summary: {
    openingBalance: number;
    closingBalance: number;
    transactionCount: number;
  };
  source: "postgres";
}

/**
 * General ledger for one account, with opening balance carried forward.
 *
 * Reference: ReportService.generateGeneralLedger() in reportsService.js.
 *
 * ── One deliberate behavioural difference ───────────────────────────────────
 * The Mongo version resolves each entry's line with
 *
 *   entry.lines.find((l) => l.accountId.toString() === accountId.toString())
 *
 * `.find()` returns only the FIRST match. An entry legitimately carrying two
 * lines against the same account — say two cost centres with different
 * descriptions — has its second line silently dropped from the ledger, and the
 * running balance is understated by that amount for the rest of the report.
 *
 * The SQL below joins journal_lines, so every matching line appears. That is
 * correct, but it means this report can differ from the Mongo one for entries
 * of that shape. Any such difference found during reconciliation is the old
 * report being wrong, not this one — verify before "fixing" it.
 */
export async function getGeneralLedger(
  tx: Tx,
  accountId: string,
  startDate?: string,
  endDate?: string,
): Promise<GeneralLedgerReport> {
  {
    const [account] = (await tx.execute(sql`
      SELECT account_code AS "accountCode",
             account_name AS "accountName",
             account_type AS "accountType"
        FROM accounts WHERE id = ${accountId}
    `)) as unknown as Array<{
      accountCode: string;
      accountName: string;
      accountType: string;
    }>;

    if (!account) throw new Error("Account not found");

    const normalSide =
      account.accountType === "asset" || account.accountType === "expense"
        ? "debit"
        : "credit";

    // Movement is signed to the account's normal side, so a debit-normal
    // account increases on debits and a credit-normal one on credits.
    const movement =
      normalSide === "debit"
        ? sql`(l.debit - l.credit)`
        : sql`(l.credit - l.debit)`;

    // Opening balance: net movement strictly before the window.
    let openingBalance = "0";
    if (startDate) {
      const [prior] = (await tx.execute(sql`
        SELECT COALESCE(SUM(${movement}), 0)::numeric(19,4) AS opening
          FROM journal_lines l
          JOIN journal_entries e ON e.id = l.entry_id
         WHERE l.account_id = ${accountId}
           AND e.status = 'posted'
           AND e.entry_date < ${startDate}::date
      `)) as unknown as Array<{ opening: string }>;
      openingBalance = prior?.opening ?? "0";
    }

    const rows = (await tx.execute(sql`
      SELECT
        e.entry_date   AS "date",
        e.entry_number AS "entryNumber",
        e.description,
        e.reference,
        l.debit,
        l.credit,
        (${openingBalance}::numeric(19,4) + SUM(${movement}) OVER (
          ORDER BY e.entry_date, e.entry_number, l.line_number
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ))::numeric(19,4) AS "balance"
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id
     WHERE l.account_id = ${accountId}
       AND e.status = 'posted'
       AND (${startDate ?? null}::date IS NULL OR e.entry_date >= ${startDate ?? null}::date)
       AND (${endDate ?? null}::date   IS NULL OR e.entry_date <= ${endDate ?? null}::date)
     ORDER BY e.entry_date, e.entry_number, l.line_number
    `)) as unknown as Array<{
      date: string;
      entryNumber: string;
      description: string;
      reference: string | null;
      debit: string;
      credit: string;
      balance: string;
    }>;

    const transactions = rows.map((r) => ({
      date: r.date,
      entryNumber: r.entryNumber,
      description: r.description,
      reference: r.reference,
      debit: Number(r.debit),
      credit: Number(r.credit),
      balance: Number(r.balance),
    }));

    return {
      reportName: "General Ledger",
      account: { ...account, normalBalanceSide: normalSide as "debit" | "credit" },
      period: { startDate, endDate },
      transactions,
      summary: {
        openingBalance: Number(openingBalance),
        closingBalance: transactions.length
          ? transactions[transactions.length - 1].balance
          : Number(openingBalance),
        transactionCount: transactions.length,
      },
      source: "postgres" as const,
    };
  }
}

export async function getTrialBalanceReport(
  tx: Tx,
  asOfDate: string,
  showZeroBalances = false,
): Promise<TrialBalanceReport> {
  {
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
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Shared balance helper — the equivalent of
// ReportService.calculateAccountBalances(). Returns each account's balance
// signed to its normal side, over an optional date window.
//
// One difference from the Mongo version: it filters on `balance <> 0` rather
// than `Math.abs(balance) > 0.01`. That tolerance existed because float
// arithmetic produces residues like 0.000000001; numeric(19,4) does not, so
// the guard is unnecessary. It also means a genuine 0.005 balance now appears
// on the report instead of being hidden — which is the point.
// ────────────────────────────────────────────────────────────────────────────
export interface AccountBalanceRow {
  accountCode: string;
  accountName: string;
  accountType: string;
  subType: string | null;
  balance: number;
  /** Exact numeric string; use for reconciliation, not the number above. */
  exactBalance: string;
}

async function balancesForTypes(
  tx: Tx,
  types: string[],
  startDate: string | null,
  endDate: string | null,
): Promise<AccountBalanceRow[]> {
  const rows = (await tx.execute(sql`
    SELECT
      a.account_code AS "accountCode",
      a.account_name AS "accountName",
      a.account_type AS "accountType",
      a.sub_type     AS "subType",
      (CASE WHEN a.account_type IN ('asset', 'expense')
            THEN COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0)
            ELSE COALESCE(SUM(l.credit), 0) - COALESCE(SUM(l.debit), 0)
       END)::numeric(19,4) AS "balance"
    FROM accounts a
    JOIN journal_lines l   ON l.account_id = a.id
    JOIN journal_entries e ON e.id = l.entry_id
    WHERE e.status = 'posted'
      AND a.is_active = true
      AND a.account_type = ANY(${sql.raw(`ARRAY[${types.map((t) => `'${t}'`).join(",")}]::account_type[]`)})
      AND (${startDate}::date IS NULL OR e.entry_date >= ${startDate}::date)
      AND (${endDate}::date   IS NULL OR e.entry_date <= ${endDate}::date)
    GROUP BY a.id, a.account_code, a.account_name, a.account_type, a.sub_type
    HAVING (CASE WHEN a.account_type IN ('asset', 'expense')
                 THEN COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0)
                 ELSE COALESCE(SUM(l.credit), 0) - COALESCE(SUM(l.debit), 0)
            END) <> 0
    ORDER BY a.account_code
  `)) as unknown as Array<{
    accountCode: string;
    accountName: string;
    accountType: string;
    subType: string | null;
    balance: string;
  }>;

  return rows.map((r) => ({
    accountCode: r.accountCode,
    accountName: r.accountName,
    accountType: r.accountType,
    subType: r.subType,
    balance: Number(r.balance),
    exactBalance: r.balance,
  }));
}

const sum = (rows: AccountBalanceRow[]) =>
  rows.reduce((acc, r) => acc + r.balance, 0);

/** Profit & Loss. Mirrors ReportService.generateProfitLoss(). */
export async function getProfitLoss(
  tx: Tx,
  startDate: string,
  endDate: string,
) {
  const all = await balancesForTypes(tx, ["revenue", "expense"], startDate, endDate);

  const revenue = all.filter((a) => a.accountType === "revenue");
  const expenses = all.filter((a) => a.accountType === "expense");

  const totalRevenue = sum(revenue);
  const totalExpenses = sum(expenses);
  const netIncome = totalRevenue - totalExpenses;
  const netMargin = totalRevenue > 0 ? (netIncome / totalRevenue) * 100 : 0;

  return {
    reportName: "Profit & Loss Statement",
    period: { startDate: new Date(startDate), endDate: new Date(endDate) },
    revenue: { accounts: revenue, total: totalRevenue },
    expenses: { accounts: expenses, total: totalExpenses },
    summary: {
      grossProfit: totalRevenue,
      totalExpenses,
      netIncome,
      netMargin: netMargin.toFixed(2),
    },
    source: "postgres" as const,
  };
}

/**
 * Balance Sheet. Mirrors ReportService.generateBalanceSheet(), including the
 * synthetic "Current Year Earnings" equity line — revenue less expenses that
 * has not yet been closed out into Retained Earnings.
 *
 * `summary.isBalanced` is decided by comparing exact numeric strings rather
 * than `Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.01`. A balance
 * sheet out by half a cent is out.
 */
export async function getBalanceSheet(tx: Tx, asOfDate: string) {
  const all = await balancesForTypes(
    tx,
    ["asset", "liability", "equity", "revenue", "expense"],
    null,
    asOfDate,
  );

  const assets = all.filter((a) => a.accountType === "asset");
  const liabilities = all.filter((a) => a.accountType === "liability");
  const equity = all.filter((a) => a.accountType === "equity");

  const currentYearEarnings =
    sum(all.filter((a) => a.accountType === "revenue")) -
    sum(all.filter((a) => a.accountType === "expense"));

  if (currentYearEarnings !== 0) {
    equity.push({
      accountCode: "CYE",
      accountName: "Current Year Earnings",
      accountType: "equity",
      subType: "earnings",
      balance: currentYearEarnings,
      exactBalance: currentYearEarnings.toFixed(4),
    });
  }

  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = sum(equity);
  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;

  const CURRENT_ASSET = ["cash", "bank", "accounts_receivable", "inventory"];
  const FIXED_ASSET = ["fixed_asset"];
  const CURRENT_LIAB = ["accounts_payable", "tax_payable"];
  const LONG_TERM_LIAB = ["loan", "long_term_liability"];

  return {
    reportName: "Balance Sheet",
    asOfDate: new Date(asOfDate),
    assets: {
      current: assets.filter((a) => CURRENT_ASSET.includes(a.subType ?? "")),
      fixed: assets.filter((a) => FIXED_ASSET.includes(a.subType ?? "")),
      other: assets.filter(
        (a) => ![...CURRENT_ASSET, ...FIXED_ASSET].includes(a.subType ?? ""),
      ),
      total: totalAssets,
    },
    liabilities: {
      current: liabilities.filter((l) => CURRENT_LIAB.includes(l.subType ?? "")),
      longTerm: liabilities.filter((l) => LONG_TERM_LIAB.includes(l.subType ?? "")),
      other: liabilities.filter(
        (l) => ![...CURRENT_LIAB, ...LONG_TERM_LIAB].includes(l.subType ?? ""),
      ),
      total: totalLiabilities,
    },
    equity: { accounts: equity, total: totalEquity },
    summary: {
      totalAssets,
      totalLiabilities,
      totalEquity,
      totalLiabilitiesAndEquity,
      isBalanced: totalAssets === totalLiabilitiesAndEquity,
      difference: totalAssets - totalLiabilitiesAndEquity,
    },
    source: "postgres" as const,
  };
}
