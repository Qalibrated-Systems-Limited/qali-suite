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
      /**
       * A misnomer carried from reportsService.js:57, where it is also
       * `totalRevenue`. It is NOT revenue less cost of sales — COGS is an
       * expense account here and the statement does not separate it from
       * operating expenses.
       *
       * Named rather than renamed because the P&L client reads
       * `variance.revenue`, which is computed from this, and the two agree:
       * the variance shown on the Total Revenue row IS a revenue variance.
       * Anyone reading the variance calculation alone would reasonably think
       * it a bug, so this is the note that says it is not.
       */
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

// ─────────────────────────────────────────────────────────────────────────────
// The executive snapshot
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutiveFigure {
  total: number;
  count: number;
}

export interface ExecutiveSnapshot {
  revenue: ExecutiveFigure & { prev: number };
  expenses: ExecutiveFigure & { prev: number };
  ar: ExecutiveFigure;
  ap: ExecutiveFigure;
  cash: ExecutiveFigure & { cashOnly: number; bankOnly: number; mpesaOnly: number };
}

/**
 * Seven headline numbers for the executive overview, in one query.
 *
 * EVERY ONE OF THEM COMES FROM THE LEDGER, and that is the change. The Mongo
 * snapshot summed DOCUMENTS — invoice totals, bill balances,
 * `Account.cachedBalance` — which had three consequences:
 *
 * 1. It read four collections nothing writes to any more. Invoices, bills and
 *    accounts are all on Postgres, so revenue, AR, AP and cash have reported
 *    zero on the CEO's home screen since those modules ported.
 *
 * 2. THE HEADLINE DISAGREED WITH THE REPORT IT LINKS TO. Revenue was
 *    `status IN ('sent', 'completed')`, and a SENT invoice posts nothing: only
 *    completing one credits the revenue account. So the executive card
 *    reported a bigger month than the P&L it drills into, by exactly the value
 *    of what had been sent and not completed. Reading the ledger removes the
 *    question — the tile IS the P&L's number.
 *
 * 3. Credit notes were never netted off. A ledger read gets that for free: a
 *    credit note debits revenue, and `SUM(credit - debit)` is already net.
 *
 * `cachedBalance` deserves its own line. It is the same pattern as
 * `parties.cachedBalance` and `products.quantityAvailable` — a stored number
 * that can disagree with the ledger it summarises, and its own Mongo comment
 * reads "Cached - NOT source of truth!".
 *
 * AR AND AP ARE DEFINED EXACTLY AS `getAgingReport` DEFINES THEM: open entries
 * against the control account, by party type. The tile and the aging page it
 * links to cannot disagree, because they are the same predicate.
 *
 * M-PESA IS CASH. The chart seeds account 1113 with sub-type `mpesa` and
 * `getFinancialOverview` counts only `cash` and `bank`, so the main dashboard
 * has been understating the money position by the whole M-Pesa float. In this
 * market that is not a rounding difference.
 */
export async function getExecutiveSnapshot(tx: Tx): Promise<ExecutiveSnapshot> {
  const [row] = (await tx.execute(sql`
    WITH period AS (
      SELECT date_trunc('month', CURRENT_DATE)::date                        AS this_start,
             (date_trunc('month', CURRENT_DATE) - interval '1 month')::date AS last_start
    ),
    posted AS (
      SELECT a.account_type,
             a.sub_type,
             a.system_account,
             e.entry_date,
             e.party_type,
             e.is_fully_paid,
             e.id AS entry_id,
             l.debit,
             l.credit
        FROM journal_entries e
        JOIN journal_lines l ON l.entry_id = e.id
        JOIN accounts a ON a.id = l.account_id
       WHERE e.status = 'posted'
    )
    SELECT
      -- ── The flows, this month against last ─────────────────────────────
      COALESCE(SUM(credit - debit) FILTER (
        WHERE account_type = 'revenue'
          AND entry_date >= (SELECT this_start FROM period)
      ), 0)::float8                                              AS revenue_now,
      COALESCE(SUM(credit - debit) FILTER (
        WHERE account_type = 'revenue'
          AND entry_date >= (SELECT last_start FROM period)
          AND entry_date <  (SELECT this_start FROM period)
      ), 0)::float8                                              AS revenue_prev,
      COALESCE(SUM(debit - credit) FILTER (
        WHERE account_type = 'expense'
          AND entry_date >= (SELECT this_start FROM period)
      ), 0)::float8                                              AS expense_now,
      COALESCE(SUM(debit - credit) FILTER (
        WHERE account_type = 'expense'
          AND entry_date >= (SELECT last_start FROM period)
          AND entry_date <  (SELECT this_start FROM period)
      ), 0)::float8                                              AS expense_prev,

      -- How many entries made up each, for the "N documents" subtitles.
      COUNT(DISTINCT entry_id) FILTER (
        WHERE account_type = 'revenue'
          AND entry_date >= (SELECT this_start FROM period)
      )::int                                                     AS revenue_count,
      COUNT(DISTINCT entry_id) FILTER (
        WHERE account_type = 'expense'
          AND entry_date >= (SELECT this_start FROM period)
      )::int                                                     AS expense_count,

      -- ── The position ───────────────────────────────────────────────────
      COALESCE(SUM(debit - credit) FILTER (WHERE sub_type = 'cash'), 0)::float8   AS cash_only,
      COALESCE(SUM(debit - credit) FILTER (WHERE sub_type = 'bank'), 0)::float8   AS bank_only,
      COALESCE(SUM(debit - credit) FILTER (WHERE sub_type = 'mpesa'), 0)::float8  AS mpesa_only,

      -- Open items against the control accounts — the same predicate
      -- getAgingReport uses, so the tile and the aging page agree.
      COALESCE(SUM(debit - credit) FILTER (
        WHERE system_account = 'accounts_receivable'
          AND is_fully_paid = false AND party_type = 'customer'
      ), 0)::float8                                              AS ar_total,
      COUNT(DISTINCT entry_id) FILTER (
        WHERE system_account = 'accounts_receivable'
          AND is_fully_paid = false AND party_type = 'customer'
      )::int                                                     AS ar_count,
      COALESCE(SUM(credit - debit) FILTER (
        WHERE system_account = 'accounts_payable'
          AND is_fully_paid = false AND party_type = 'supplier'
      ), 0)::float8                                              AS ap_total,
      COUNT(DISTINCT entry_id) FILTER (
        WHERE system_account = 'accounts_payable'
          AND is_fully_paid = false AND party_type = 'supplier'
      )::int                                                     AS ap_count,

      -- The count of money accounts is a fact about the CHART, not about the
      -- postings — a bank account opened and not yet used still exists.
      (SELECT COUNT(*) FROM accounts
        WHERE sub_type IN ('cash', 'bank', 'mpesa')
          AND is_active IS NOT false)::int                        AS cash_count
    FROM posted
  `)) as unknown as Array<Record<string, unknown>>;

  const n = (v: unknown) => Number(v ?? 0);
  const cashOnly = n(row?.cash_only);
  const bankOnly = n(row?.bank_only);
  const mpesaOnly = n(row?.mpesa_only);

  return {
    revenue: {
      total: n(row?.revenue_now),
      count: n(row?.revenue_count),
      prev: n(row?.revenue_prev),
    },
    expenses: {
      total: n(row?.expense_now),
      count: n(row?.expense_count),
      prev: n(row?.expense_prev),
    },
    ar: { total: n(row?.ar_total), count: n(row?.ar_count) },
    ap: { total: n(row?.ap_total), count: n(row?.ap_count) },
    cash: {
      total: cashOnly + bankOnly + mpesaOnly,
      count: n(row?.cash_count),
      cashOnly,
      bankOnly,
      mpesaOnly,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cash flow
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The cash flow statement, by the indirect route the Mongo service took:
 * every posted entry that touches a cash account, categorised by what it was
 * paid to or received from.
 *
 * THREE OF THE MONGO CATEGORISER'S SIX FINANCING SUB-TYPES DO NOT EXIST.
 * `ReportService.generateCashFlow` tests for `owner_drawings`,
 * `retained_earnings` and `share_capital`; this chart seeds `drawings`,
 * `retained` and `capital` (`lib/chart-of-accounts.js`). Its investing arm
 * tests for `investment` and `other_asset`, and neither is seeded either. So
 * the only tests that ever matched were `fixed_asset`, `loan` and
 * `accountType === 'equity'` — which caught the equity accounts anyway, and
 * left owner drawings out of financing whenever they were not typed as equity.
 * The names below are the ones the chart actually uses.
 *
 * A transfer BETWEEN cash accounts is not a cash flow, and an entry whose only
 * lines are cash lines is exactly that — it is skipped, as it was.
 */
export async function getCashFlow(
  tx: Tx,
  startDate: string,
  endDate: string,
) {
  const rows = (await tx.execute(sql`
    WITH cash_accounts AS (
      SELECT id FROM accounts
       WHERE sub_type IN ('cash', 'bank', 'mpesa')
         AND is_active IS NOT false
    ),
    -- What each entry did to the cash position over the window.
    cash_impact AS (
      SELECT e.id                                   AS entry_id,
             e.entry_date,
             e.entry_number,
             e.description,
             SUM(l.debit - l.credit)::numeric(19,4) AS amount
        FROM journal_entries e
        JOIN journal_lines l ON l.entry_id = e.id
        JOIN cash_accounts c ON c.id = l.account_id
       WHERE e.status = 'posted'
         AND e.entry_date >= ${startDate}::date
         AND e.entry_date <= ${endDate}::date
       GROUP BY e.id
      HAVING ABS(SUM(l.debit - l.credit)) >= 0.01
    ),
    -- The FIRST contra line that names a category, by line number — the Mongo
    -- loop breaks on its first match, so an entry with a financing line above
    -- an investing one is financing, and reordering the test would silently
    -- reclassify it.
    categorised AS (
      SELECT ci.*,
             COALESCE((
               SELECT CASE
                        WHEN a.sub_type IN ('fixed_asset', 'investment') THEN 'investing'
                        ELSE 'financing'
                      END
                 FROM journal_lines l2
                 JOIN accounts a ON a.id = l2.account_id
                WHERE l2.entry_id = ci.entry_id
                  AND a.id NOT IN (SELECT id FROM cash_accounts)
                  AND (a.sub_type IN ('fixed_asset', 'investment', 'loan',
                                      'drawings', 'retained', 'capital')
                       OR a.account_type = 'equity')
                ORDER BY l2.line_number
                LIMIT 1
             ), 'operating') AS category
        FROM cash_impact ci
       -- An entry with no non-cash line is a transfer between cash accounts.
       WHERE EXISTS (
         SELECT 1 FROM journal_lines l3
          WHERE l3.entry_id = ci.entry_id
            AND l3.account_id NOT IN (SELECT id FROM cash_accounts)
       )
    )
    SELECT entry_id::text     AS id,
           entry_date         AS date,
           entry_number       AS "entryNumber",
           description,
           amount::float8     AS amount,
           category
      FROM categorised
     ORDER BY entry_date, entry_number
  `)) as unknown as Array<Record<string, unknown>>;

  const bucket = (name: string) => {
    const transactions = rows
      .filter((r) => r.category === name)
      .map((r) => ({
        date: r.date,
        description: r.description,
        entryNumber: r.entryNumber,
        amount: Number(r.amount ?? 0),
      }));
    return {
      transactions,
      total: transactions.reduce((sum, t) => sum + t.amount, 0),
    };
  };

  const operating = bucket("operating");
  const investing = bucket("investing");
  const financing = bucket("financing");

  return {
    reportName: "Cash Flow Statement",
    period: { startDate: new Date(startDate), endDate: new Date(endDate) },
    operating,
    investing,
    financing,
    summary: {
      operatingCashFlow: operating.total,
      investingCashFlow: investing.total,
      financingCashFlow: financing.total,
      netCashFlow: operating.total + investing.total + financing.total,
    },
    source: "postgres" as const,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sales and purchase reports
//
// All three read the Mongo `Invoice` and `Bill` collections, both of which
// moved — so these pages have shown an empty report for as long as those
// modules have been ported. Nothing errored; there was simply nothing there.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sales by customer, with gross margin.
 *
 * COGS comes from `cogs_postings` — what actually reached the ledger — rather
 * than a stored `totalCOGS` on the document, which is where the Mongo version
 * read it. That column is a cache of the same thing and one of the family this
 * port has been removing.
 *
 * The status filter is Mongo's, and its comment is worth keeping: everything
 * except draft and cancelled, because restricting to `completed` undercounts
 * in tenants whose workflow ends at `sent`.
 */
export async function getSalesByCustomer(
  tx: Tx,
  startDate: string,
  endDate: string,
) {
  const rows = (await tx.execute(sql`
    SELECT i.customer_id::text                            AS "customerId",
           COALESCE(p.name, 'Unnamed')                    AS "customerName",
           p.email                                        AS "customerEmail",
           COUNT(*)::int                                  AS "invoiceCount",
           SUM(i.total)::float8                           AS "totalSales",
           COALESCE(SUM(c.cogs), 0)::float8               AS "totalCOGS",
           SUM(i.amount_paid)::float8                     AS "totalPaid",
           AVG(i.total)::float8                           AS "avgInvoiceValue",
           MIN(i.invoice_date)                            AS "firstInvoice",
           MAX(i.invoice_date)                            AS "lastInvoice"
      FROM invoices i
      LEFT JOIN parties p ON p.id = i.customer_id
      LEFT JOIN LATERAL (
        SELECT SUM(cp.total_cost) AS cogs
          FROM cogs_postings cp
          JOIN invoice_lines il ON il.id = cp.invoice_line_id
         WHERE il.invoice_id = i.id
      ) c ON true
     WHERE i.status NOT IN ('draft', 'cancelled')
       AND i.invoice_date >= ${startDate}::date
       AND i.invoice_date <= ${endDate}::date
     GROUP BY i.customer_id, p.name, p.email
     ORDER BY SUM(i.total) DESC
  `)) as unknown as Array<Record<string, unknown>>;

  const n = (v: unknown) => Number(v ?? 0);
  const base = rows.map((r) => {
    const totalSales = n(r.totalSales);
    const totalCOGS = n(r.totalCOGS);
    const totalPaid = n(r.totalPaid);
    return {
      customerId: r.customerId,
      customerName: r.customerName,
      customerEmail: r.customerEmail ?? "",
      invoiceCount: n(r.invoiceCount),
      totalSales,
      totalCOGS,
      grossProfit: totalSales - totalCOGS,
      grossMarginPct: totalSales > 0 ? ((totalSales - totalCOGS) / totalSales) * 100 : 0,
      totalPaid,
      totalOutstanding: totalSales - totalPaid,
      avgInvoiceValue: n(r.avgInvoiceValue),
      firstInvoice: r.firstInvoice,
      lastInvoice: r.lastInvoice,
    };
  });

  const totalSales = base.reduce((s, c) => s + c.totalSales, 0);
  const totalCOGS = base.reduce((s, c) => s + c.totalCOGS, 0);
  const share = (amount: number) => (totalSales > 0 ? (amount / totalSales) * 100 : 0);

  return {
    reportName: "Sales by Customer",
    period: { startDate: new Date(startDate), endDate: new Date(endDate) },
    customers: base.map((c) => ({ ...c, revenueShare: share(c.totalSales) })),
    summary: {
      totalCustomers: base.length,
      totalSales,
      totalCOGS,
      grossProfit: totalSales - totalCOGS,
      grossMarginPct: totalSales > 0 ? ((totalSales - totalCOGS) / totalSales) * 100 : 0,
      totalPaid: base.reduce((s, c) => s + c.totalPaid, 0),
      totalOutstanding: base.reduce((s, c) => s + c.totalOutstanding, 0),
      totalInvoices: base.reduce((s, c) => s + c.invoiceCount, 0),
      topCustomerShare: base.length ? share(base[0].totalSales) : 0,
      topFiveShare: share(base.slice(0, 5).reduce((s, c) => s + c.totalSales, 0)),
    },
    source: "postgres" as const,
  };
}

/** Sales by product — completed invoices only, as the Mongo version had it. */
export async function getSalesByProduct(
  tx: Tx,
  startDate: string,
  endDate: string,
) {
  const rows = (await tx.execute(sql`
    SELECT il.product_id::text                          AS "productId",
           COALESCE(pr.name, il.description, 'Unnamed') AS "productName",
           pr.sku                                       AS "productSKU",
           SUM(il.quantity)::float8                     AS "quantitySold",
           SUM(il.line_total)::float8                   AS "totalRevenue",
           COUNT(DISTINCT il.invoice_id)::int           AS "invoiceCount",
           (SUM(il.line_total) / NULLIF(SUM(il.quantity), 0))::float8 AS "avgPrice"
      FROM invoice_lines il
      JOIN invoices i ON i.id = il.invoice_id
      LEFT JOIN products pr ON pr.id = il.product_id
     WHERE i.status = 'completed'
       AND i.invoice_date >= ${startDate}::date
       AND i.invoice_date <= ${endDate}::date
     GROUP BY il.product_id, pr.name, il.description, pr.sku
     ORDER BY SUM(il.line_total) DESC
  `)) as unknown as Array<Record<string, unknown>>;

  const n = (v: unknown) => Number(v ?? 0);
  const products = rows.map((r) => ({
    productId: r.productId,
    productName: r.productName,
    productSKU: r.productSKU ?? "",
    quantitySold: n(r.quantitySold),
    totalRevenue: n(r.totalRevenue),
    invoiceCount: n(r.invoiceCount),
    avgPrice: n(r.avgPrice),
  }));

  return {
    reportName: "Sales by Product",
    period: { startDate: new Date(startDate), endDate: new Date(endDate) },
    products,
    summary: {
      totalProducts: products.length,
      totalRevenue: products.reduce((s, p) => s + p.totalRevenue, 0),
      totalQuantity: products.reduce((s, p) => s + p.quantitySold, 0),
    },
    source: "postgres" as const,
  };
}

/** Supplier spend, and the accounts it was charged to. */
export async function getSupplierPurchases(
  tx: Tx,
  startDate: string,
  endDate: string,
) {
  const where = sql`
    b.status NOT IN ('draft', 'cancelled', 'rejected')
    AND b.bill_date >= ${startDate}::date
    AND b.bill_date <= ${endDate}::date`;

  const [supplierRows, categoryRows] = await Promise.all([
    tx.execute(sql`
      SELECT b.supplier_id::text                        AS "supplierId",
             COALESCE(p.name, b.supplier_name_at_bill, 'Unnamed') AS "supplierName",
             COUNT(*)::int                              AS "billCount",
             SUM(b.total)::float8                       AS "totalSpend",
             SUM(b.net_payable)::float8                 AS "totalNetPayable",
             SUM(b.amount_paid)::float8                 AS "totalPaid",
             SUM(b.balance)::float8                     AS outstanding,
             MIN(b.bill_date)                           AS "firstBillDate",
             MAX(b.bill_date)                           AS "lastBillDate"
        FROM bills b
        LEFT JOIN parties p ON p.id = b.supplier_id
       WHERE ${where}
       GROUP BY b.supplier_id, p.name, b.supplier_name_at_bill
       ORDER BY SUM(b.total) DESC
    `),
    tx.execute(sql`
      SELECT bl.account_code_at_bill                    AS "accountCode",
             MIN(bl.account_name_at_bill)               AS "accountName",
             MIN(a.account_type::text)                  AS "accountType",
             SUM(bl.amount)::float8                     AS "totalSpend"
        FROM bill_lines bl
        JOIN bills b ON b.id = bl.bill_id
        LEFT JOIN accounts a ON a.id = bl.account_id
       WHERE ${where}
       GROUP BY bl.account_code_at_bill
       ORDER BY SUM(bl.amount) DESC
    `),
  ]);

  const n = (v: unknown) => Number(v ?? 0);
  const suppliersRaw = (supplierRows as unknown as Array<Record<string, unknown>>).map(
    (r) => ({
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      billCount: n(r.billCount),
      totalSpend: n(r.totalSpend),
      totalNetPayable: n(r.totalNetPayable),
      totalPaid: n(r.totalPaid),
      outstanding: n(r.outstanding),
      firstBillDate: r.firstBillDate,
      lastBillDate: r.lastBillDate,
    }),
  );

  const totalSpend = suppliersRaw.reduce((s, r) => s + r.totalSpend, 0);
  const share = (amount: number) => (totalSpend > 0 ? (amount / totalSpend) * 100 : 0);

  return {
    period: { startDate: new Date(startDate).toISOString(), endDate: new Date(endDate).toISOString() },
    summary: {
      totalSuppliers: suppliersRaw.length,
      totalSpend,
      totalOutstanding: suppliersRaw.reduce((s, r) => s + r.outstanding, 0),
      totalBills: suppliersRaw.reduce((s, r) => s + r.billCount, 0),
      topSupplierShare: suppliersRaw.length ? share(suppliersRaw[0].totalSpend) : 0,
      topFiveShare: share(suppliersRaw.slice(0, 5).reduce((s, r) => s + r.totalSpend, 0)),
    },
    suppliers: suppliersRaw.map((r) => ({ ...r, spendShare: share(r.totalSpend) })),
    categories: (categoryRows as unknown as Array<Record<string, unknown>>).map((c) => ({
      accountCode: c.accountCode,
      accountName: c.accountName,
      accountType: c.accountType,
      totalSpend: n(c.totalSpend),
      spendShare: share(n(c.totalSpend)),
    })),
    source: "postgres" as const,
  };
}
