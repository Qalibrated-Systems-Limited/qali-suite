"use server";

import { sql } from "drizzle-orm";
import { withAuthorizedTenant } from "../tenant";
import * as productsRepo from "../repositories/products";
import * as invoicesRepo from "../repositories/invoices";
import * as fulfilmentRepo from "../repositories/fulfilment";
import * as movementsRepo from "../repositories/stockMovements";
import * as reportsRepo from "../repositories/reports";
import { countClaimsAwaitingApprovalPg, sumClaimsPg } from "./claim-actions";

/**
 * The dashboard, on Postgres.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. `erp-dashboard-queries.ts` reads the
 * Mongo Invoice, Bill, JournalEntry, Account, Product, StockRequest,
 * ItemCheckout and StockMovement models — every one of which moved. The
 * dashboard was therefore reporting on a store nothing writes.
 *
 * It used to fail loudly: `new ObjectId(uuid)` threw and the page showed an
 * error. Once that cast was fixed the queries began SUCCEEDING against
 * pre-migration documents, so the first screen every user sees went from
 * visibly broken to quietly wrong. That is the worse of the two.
 *
 * Names and return shapes match the Mongo functions exactly, so the 23
 * components that read them keep their markup and this is an import swap.
 */

const int = (v: unknown) => Number(v ?? 0);

/**
 * Everything needing attention, as five counts and a total.
 *
 * Each is derived where the data now lives, and each already had a Postgres
 * source — the dashboard was the only thing still asking Mongo.
 */
export async function getDashboardAlerts() {
  const [tenantCounts, pendingClaims] = await Promise.all([
    withAuthorizedTenant([], async (tx) => {
      const [invoices, products, requests, overdueCheckouts] = await Promise.all([
        invoicesRepo.getInvoiceStats(tx),
        productsRepo.getProductStats(tx),
        fulfilmentRepo.getStockRequestStats(tx),
        // The view derives days_overdue from the expected return date, so an
        // overdue checkout is one the view already says is overdue rather
        // than a date comparison repeated here.
        tx.execute(sql`
          SELECT count(*)::int AS n FROM outstanding_checkouts WHERE days_overdue > 0
        `) as unknown as Promise<Array<{ n: number }>>,
      ]);
      return {
        overdueInvoices: invoices.overdue,
        lowStockCount: products.lowStock,
        pendingRequests: requests.pending,
        overdueCheckouts: int((await overdueCheckouts)[0]?.n),
      };
    }),
    countClaimsAwaitingApprovalPg(),
  ]);

  const alerts = { ...tenantCounts, pendingClaims, overdueClaims: 0 };
  return {
    ...alerts,
    total:
      alerts.overdueInvoices +
      alerts.lowStockCount +
      alerts.pendingClaims +
      alerts.overdueCheckouts +
      alerts.pendingRequests,
  };
}

/**
 * The inventory KPI row.
 *
 * LOW STOCK IS `quantity_on_hand <= reorder_level`, per product. The Mongo
 * dashboard used a shared LOW_STOCK_MATCH so its three inventory KPIs agreed
 * with each other; the stocks PAGE meanwhile counted "below 10 units", a fixed
 * threshold. They now agree because there is one definition, in
 * `getProductStats`, and it is the one the column exists for.
 */
export async function getStockStats() {
  return withAuthorizedTenant([], async (tx) => {
    const [s, requests, totals, overdue] = await Promise.all([
      productsRepo.getProductStats(tx),
      fulfilmentRepo.getStockRequestStats(tx),
      tx.execute(sql`
        SELECT COALESCE(SUM(quantity_on_hand), 0)::numeric(19,4) AS qty
          FROM products WHERE is_active
      `) as unknown as Promise<Array<{ qty: string }>>,
      tx.execute(sql`
        SELECT count(*)::int AS n FROM outstanding_checkouts WHERE days_overdue > 0
      `) as unknown as Promise<Array<{ n: number }>>,
    ]);

    // The names the tiles read — tsc caught this when the tab was swapped,
    // which is the argument for keeping the shape identical rather than
    // "improving" it during a port.
    return {
      totalValue: Number(s.stockValue),
      totalProducts: s.total,
      totalQuantity: int(totals[0]?.qty),
      lowStockCount: s.lowStock,
      outOfStockCount: s.outOfStock,
      pendingRequests: requests.pending,
      overdueCheckouts: int(overdue[0]?.n),
    };
  });
}

/** Products at or below their reorder level, most urgent first. */
export async function getLowStockProducts(limit = 10) {
  return withAuthorizedTenant([], async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT id, sku, name, unit, quantity_on_hand, reorder_level, cost_price
        FROM products
       WHERE is_active AND quantity_on_hand <= reorder_level
       ORDER BY (quantity_on_hand - reorder_level), name
       LIMIT ${Math.min(limit, 100)}
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      _id: String(r.id),
      SKU: String(r.sku),
      name: String(r.name),
      unit: String(r.unit ?? "pcs"),
      inventory: {
        quantityOnHand: int(r.quantity_on_hand),
        reorderLevel: int(r.reorder_level),
      },
      costing: { costPrice: int(r.cost_price) },
    }));
  });
}

/** Nothing on the shelf at all. */
export async function getOutOfStockProducts(limit = 10) {
  return withAuthorizedTenant([], async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT id, sku, name, unit, reorder_level
        FROM products
       WHERE is_active AND quantity_on_hand = 0
       ORDER BY name
       LIMIT ${Math.min(limit, 100)}
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      _id: String(r.id),
      SKU: String(r.sku),
      name: String(r.name),
      unit: String(r.unit ?? "pcs"),
      inventory: { quantityOnHand: 0, reorderLevel: int(r.reorder_level) },
    }));
  });
}

/**
 * Stock in and out per day, for the movement chart.
 *
 * Generated from a date series and LEFT JOINed, so a day with no movements is
 * a zero rather than a gap — a line chart that skips empty days misreports the
 * shape of the week.
 */
export async function getMovementTrend(days = 7) {
  const span = Math.min(Math.max(days, 1), 90);
  return withAuthorizedTenant([], async (tx) => {
    const rows = (await tx.execute(sql`
      WITH series AS (
        SELECT generate_series(
          CURRENT_DATE - ${span - 1}::int, CURRENT_DATE, '1 day'
        )::date AS day
      )
      SELECT s.day,
             COALESCE(SUM(m.quantity) FILTER (WHERE m.direction = 'in'), 0)::numeric(19,4)  AS stock_in,
             COALESCE(SUM(m.quantity) FILTER (WHERE m.direction = 'out'), 0)::numeric(19,4) AS stock_out,
             count(m.id)::int AS movements
        FROM series s
        LEFT JOIN stock_movements m ON m.movement_date::date = s.day
       GROUP BY s.day
       ORDER BY s.day
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      date: r.day,
      stockIn: int(r.stock_in),
      stockOut: int(r.stock_out),
      movements: int(r.movements),
    }));
  });
}

/** What moved most, by quantity, over the period. */
export async function getTopMovedProducts(limit = 5) {
  return withAuthorizedTenant([], async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT p.id, p.sku, p.name,
             COALESCE(SUM(m.quantity), 0)::numeric(19,4) AS moved,
             count(m.id)::int AS movements
        FROM stock_movements m
        JOIN products p ON p.id = m.product_id
       GROUP BY p.id, p.sku, p.name
       ORDER BY moved DESC
       LIMIT ${Math.min(limit, 50)}
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      _id: String(r.id),
      SKU: String(r.sku),
      name: String(r.name),
      totalMoved: int(r.moved),
      movementCount: int(r.movements),
    }));
  });
}

/**
 * Stock split by category, for the distribution chart.
 *
 * Grouped on the SNAPSHOT `category`, not the foreign key, because that is
 * what the chart labels and what a product was actually filed under.
 */
export async function getCategoryDistribution() {
  return withAuthorizedTenant([], async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT COALESCE(NULLIF(category, ''), 'Uncategorised') AS category,
             count(*)::int                                   AS count,
             COALESCE(SUM(quantity_on_hand), 0)::numeric(19,4)              AS quantity,
             COALESCE(SUM(quantity_on_hand * cost_price), 0)::numeric(19,4) AS value
        FROM products
       WHERE is_active
       GROUP BY 1
       ORDER BY value DESC
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      name: String(r.category),
      category: String(r.category),
      count: int(r.count),
      quantity: int(r.quantity),
      value: int(r.value),
    }));
  });
}

/** The most recent movements across every product. */
export async function getRecentMovements(limit = 5) {
  return withAuthorizedTenant([], async (tx) => {
    const rows = await movementsRepo.listMovements(tx, {
      limit: Math.min(limit, 50),
    });
    return rows.map((m) => ({
      _id: String(m.id),
      movementNumber: m.movementNumber,
      reference: m.movementNumber,
      type: m.movementType,
      direction: m.direction,
      quantity: int(m.quantity),
      productName: m.productName,
      productSKU: m.productSku,
      createdAt: m.movementDate,
    }));
  });
}

/** Checkouts past their return date. */
export async function getOverdueCheckouts(limit = 10) {
  return withAuthorizedTenant([], async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT checkout_id, checkout_number, product_name_at_checkout,
             checked_out_to_name_at_checkout, quantity_outstanding,
             expected_return_date, days_overdue
        FROM outstanding_checkouts
       WHERE days_overdue > 0
       ORDER BY days_overdue DESC
       LIMIT ${Math.min(limit, 100)}
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      _id: String(r.checkout_id),
      checkoutNumber: String(r.checkout_number),
      productName: r.product_name_at_checkout,
      employee: { name: r.checked_out_to_name_at_checkout ?? "Unknown" },
      quantity: int(r.quantity_outstanding),
      expectedReturnDate: r.expected_return_date,
      daysOverdue: int(r.days_overdue),
    }));
  });
}

/** Requests still waiting, newest first. */
export async function getRecentRequests(limit = 5) {
  return withAuthorizedTenant([], async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT id, request_number, status, priority, requester_name_at_request, created_at
        FROM stock_requests
       ORDER BY created_at DESC
       LIMIT ${Math.min(limit, 50)}
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      _id: String(r.id),
      requestNumber: String(r.request_number),
      status: String(r.status),
      priority: String(r.priority ?? "normal"),
      requestedBy: {
        // `*_at_request` — the name as recorded, not a join.
        name: (r.requester_name_at_request as string) ?? "Unknown",
      },
      createdAt: r.created_at,
    }));
  });
}

/** AR aging, straight off the ledger rather than off invoice documents. */
export async function getARAgingSummary() {
  return agingSummary("receivable");
}

/** AP aging, the same way. */
export async function getAPAgingSummary() {
  return agingSummary("payable");
}

/**
 * An ARRAY of `{ bucket, amount }`, which is what the Mongo version returned
 * and what the dashboards reduce over. tsc caught this when the components
 * were swapped: a summed object read better and was the wrong shape, which is
 * the second time on this file that "improving" a ported return would have
 * broken a caller silently at runtime.
 *
 * The bucket LABELS matter too — the components index by "1-30", not days30.
 */
async function agingSummary(side: "receivable" | "payable") {
  return withAuthorizedTenant([], async (tx) => {
    const asOf = new Date().toISOString().slice(0, 10);
    const rows = await reportsRepo.getAgingReport(tx, side, asOf);

    const sum = (pick: (r: (typeof rows)[number]) => string) =>
      rows.reduce((acc, r) => acc + Number(pick(r)), 0);

    return [
      { bucket: "current", amount: sum((r) => r.current) },
      { bucket: "1-30", amount: sum((r) => r.days0_30) },
      { bucket: "31-60", amount: sum((r) => r.days31_60) },
      { bucket: "61-90", amount: sum((r) => r.days61_90) },
      { bucket: "90+", amount: sum((r) => r.days90plus) },
    ];
  });
}

/**
 * The most recent posted entries, as the activity feed reads them.
 *
 * `amount` is the sum of the DEBITS on the entry. A balanced entry debits and
 * credits the same total, so either side gives its size; debits are the side
 * the Mongo version summed and the convention the feed's labels assume.
 */
export async function getRecentTransactions(limit = 5) {
  return withAuthorizedTenant([], async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT e.id, e.entry_number, e.entry_date, e.entry_type, e.description,
             COALESCE(SUM(l.debit), 0)::numeric(19,4) AS amount,
             p.name AS party_name
        FROM journal_entries e
        JOIN journal_lines l ON l.entry_id = e.id
        LEFT JOIN parties p ON p.id = e.party_id
       WHERE e.status = 'posted'
       GROUP BY e.id, e.entry_number, e.entry_date, e.entry_type,
                e.description, e.created_at, p.name
       ORDER BY e.entry_date DESC, e.created_at DESC
       LIMIT ${Math.min(limit, 50)}
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      _id: String(r.id),
      entryNumber: String(r.entry_number),
      // The Mongo version returned an ISO string and the feed formats it.
      entryDate: new Date(r.entry_date as string).toISOString(),
      entryType: String(r.entry_type),
      description: String(r.description),
      amount: int(r.amount),
      party: (r.party_name as string) ?? null,
    }));
  });
}

/**
 * Revenue, expenses, profit and cash — each against the month before.
 *
 * SIGN CONVENTION. Revenue is credit-less-debit and expense is
 * debit-less-credit, because revenue and expense accounts carry opposite
 * natural balances. Getting this backwards is the classic way a dashboard
 * shows a loss in a profitable month.
 *
 * Cash is the LEDGER balance of the cash and bank accounts, not a stored
 * figure — the Mongo version read `actualBalance` off the account document,
 * which is a cache of exactly this sum.
 */
export async function getFinancialOverview() {
  return withAuthorizedTenant([], async (tx) => {
    const [row] = (await tx.execute(sql`
      WITH period AS (
        SELECT date_trunc('month', CURRENT_DATE)::date                     AS this_start,
               (date_trunc('month', CURRENT_DATE) - interval '1 month')::date AS last_start
      ),
      movement AS (
        SELECT a.account_type,
               a.sub_type,
               e.entry_date,
               l.debit,
               l.credit
          FROM journal_entries e
          JOIN journal_lines l ON l.entry_id = e.id
          JOIN accounts a ON a.id = l.account_id
         WHERE e.status = 'posted'
      )
      SELECT
        COALESCE(SUM(credit - debit) FILTER (
          WHERE account_type = 'revenue' AND entry_date >= (SELECT this_start FROM period)
        ), 0)::numeric(19,4) AS revenue_now,
        COALESCE(SUM(credit - debit) FILTER (
          WHERE account_type = 'revenue'
            AND entry_date >= (SELECT last_start FROM period)
            AND entry_date <  (SELECT this_start FROM period)
        ), 0)::numeric(19,4) AS revenue_prev,
        COALESCE(SUM(debit - credit) FILTER (
          WHERE account_type = 'expense' AND entry_date >= (SELECT this_start FROM period)
        ), 0)::numeric(19,4) AS expense_now,
        COALESCE(SUM(debit - credit) FILTER (
          WHERE account_type = 'expense'
            AND entry_date >= (SELECT last_start FROM period)
            AND entry_date <  (SELECT this_start FROM period)
        ), 0)::numeric(19,4) AS expense_prev,
        COALESCE(SUM(debit - credit) FILTER (WHERE sub_type = 'cash'), 0)::numeric(19,4) AS cash_only,
        COALESCE(SUM(debit - credit) FILTER (WHERE sub_type = 'bank'), 0)::numeric(19,4) AS bank_only
      FROM movement
    `)) as unknown as Array<Record<string, unknown>>;

    const revenue = int(row.revenue_now);
    const revenuePrev = int(row.revenue_prev);
    const expenses = int(row.expense_now);
    const expensesPrev = int(row.expense_prev);
    const cashOnly = int(row.cash_only);
    const bankOnly = int(row.bank_only);

    // Against a zero base a percentage is undefined, not infinite — the Mongo
    // version returned 0 and the tiles render it as "no change".
    const pct = (now: number, prev: number) =>
      prev ? ((now - prev) / prev) * 100 : 0;

    return {
      revenue: { current: revenue, trend: pct(revenue, revenuePrev) },
      expenses: { current: expenses, trend: pct(expenses, expensesPrev) },
      profit: {
        current: revenue - expenses,
        trend: pct(revenue - expenses, revenuePrev - expensesPrev),
      },
      cash: { balance: cashOnly + bankOnly, cashOnly, bankOnly },
    };
  });
}

/**
 * Revenue and expenses by month, for the trend chart.
 *
 * The months are GENERATED, so a month with no postings is a zero rather than
 * a missing point — the Mongo version built the same skeleton in JavaScript
 * and filled it from an aggregation, for the same reason.
 */
export async function getRevenueTrend(months = 6) {
  const span = Math.min(Math.max(months, 1), 36);
  return withAuthorizedTenant([], async (tx) => {
    const rows = (await tx.execute(sql`
      WITH series AS (
        SELECT generate_series(
          date_trunc('month', CURRENT_DATE) - make_interval(months => ${span - 1}),
          date_trunc('month', CURRENT_DATE),
          '1 month'
        ) AS m
      )
      SELECT to_char(s.m, 'YYYY-MM') AS month,
             COALESCE(SUM(l.credit - l.debit) FILTER (WHERE a.account_type = 'revenue'), 0)::numeric(19,4) AS revenue,
             COALESCE(SUM(l.debit - l.credit) FILTER (WHERE a.account_type = 'expense'), 0)::numeric(19,4) AS expenses
        FROM series s
        LEFT JOIN journal_entries e
               ON date_trunc('month', e.entry_date) = s.m AND e.status = 'posted'
        LEFT JOIN journal_lines l ON l.entry_id = e.id
        LEFT JOIN accounts a ON a.id = l.account_id
       GROUP BY s.m
       ORDER BY s.m
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      month: String(r.month),
      revenue: int(r.revenue),
      expenses: int(r.expenses),
    }));
  });
}

/** The largest expense accounts, for the breakdown chart. */
export async function getExpenseBreakdown() {
  return withAuthorizedTenant([], async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT a.account_name AS category,
             SUM(l.debit - l.credit)::numeric(19,4) AS value
        FROM journal_entries e
        JOIN journal_lines l ON l.entry_id = e.id
        JOIN accounts a ON a.id = l.account_id
       WHERE e.status = 'posted' AND a.account_type = 'expense'
       GROUP BY a.account_name
      HAVING SUM(l.debit - l.credit) > 0
       ORDER BY value DESC
       LIMIT 8
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      category: String(r.category),
      value: int(r.value),
    }));
  });
}

/**
 * What is on an accountant's desk: what is late, what is about to be, and
 * what has been paid today.
 */
export async function getAccountantWorkload() {
  const [invoiceWork, claimsToPay, paidToday] = await Promise.all([
    withAuthorizedTenant([], async (tx) => {
      const [row] = (await tx.execute(sql`
        SELECT
          count(*) FILTER (WHERE due_date < CURRENT_DATE)::int                       AS overdue_count,
          COALESCE(SUM(total - amount_paid) FILTER (WHERE due_date < CURRENT_DATE), 0)::numeric(19,4) AS overdue_total,
          count(*) FILTER (
            WHERE due_date >= CURRENT_DATE AND due_date <= CURRENT_DATE + 7
          )::int                                                                     AS week_count,
          COALESCE(SUM(total - amount_paid) FILTER (
            WHERE due_date >= CURRENT_DATE AND due_date <= CURRENT_DATE + 7
          ), 0)::numeric(19,4)                                                       AS week_total
        FROM invoices
        WHERE payment_status IN ('unpaid', 'partial')
          AND status <> 'cancelled'
          AND due_date IS NOT NULL
      `)) as unknown as Array<Record<string, unknown>>;

      return {
        overdueInvoices: {
          count: int(row.overdue_count),
          total: int(row.overdue_total),
        },
        dueThisWeek: { count: int(row.week_count), total: int(row.week_total) },
      };
    }),
    // The EXISTING helper, which the Mongo version also called. Writing the
    // sum again here got it wrong — there is no `total_amount` column; a
    // claim's value is derived from its receipts, which is exactly what
    // sumClaims already does.
    sumClaimsPg({ status: "approved" }),
    sumClaimsPg({
      status: "paid",
      paidSince: new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
    }).then((r) => r.count),
  ]);

  return { ...invoiceWork, claimsToPay, paidToday };
}

/**
 * One employee's claim counts, for their own dashboard.
 *
 * ALREADY POSTGRES IN THE MONGO FILE. Every figure here came from
 * `sumClaimsPg`; the only Mongo left in it was a `tenantMatch` built and never
 * read — the same dead scaffolding that made the HR alerts strip throw. So
 * this is the Mongo function with the scaffolding removed, not a rewrite.
 */
export async function getEmployeeSummary(userId: string) {
  const [pendingClaims, approvedClaims, paidClaims, totalAdvances] =
    await Promise.all([
      sumClaimsPg({ userId, status: "submitted" }).then((r) => r.count),
      sumClaimsPg({ userId, status: "approved" }).then((r) => r.count),
      sumClaimsPg({ userId, status: "paid" }).then((r) => r.count),
      sumClaimsPg({
        userId,
        claimType: "advance_request",
        status: ["approved", "paid"],
      }).then((r) => r.total),
    ]);

  return { pendingClaims, approvedClaims, paidClaims, totalAdvances };
}

/** What one employee is holding, and what they have been reimbursed this month. */
export async function getEmployeeFinancialSummary(userId: string) {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [advancesGiven, reimbursedMTD] = await Promise.all([
    // "Nothing points at this advance yet" — the reverse pointer the Mongo
    // document carried is gone with the port (§8.2).
    sumClaimsPg({
      userId,
      claimType: "advance_request",
      status: "paid",
      unsettledOnly: true,
    }).then((r) => r.total),
    sumClaimsPg({
      userId,
      claimType: "reimbursement",
      status: "paid",
      paidSince: startOfMonth.toISOString(),
    }).then((r) => r.total),
  ]);

  return { advancesGiven, reimbursedMTD };
}

/**
 * The admin dashboard's six headline figures.
 *
 * AR and AP come from the LEDGER's aging, not from summing invoice and bill
 * documents, so they cannot disagree with the aging report or the statements.
 */
export async function getKeyMetrics() {
  const [tenant, claimsPending] = await Promise.all([
    withAuthorizedTenant([], async (tx) => {
      const asOf = new Date().toISOString().slice(0, 10);
      const [products, requests, ar, ap] = await Promise.all([
        productsRepo.getProductStats(tx),
        fulfilmentRepo.getStockRequestStats(tx),
        reportsRepo.getAgingReport(tx, "receivable", asOf),
        reportsRepo.getAgingReport(tx, "payable", asOf),
      ]);
      const total = (rows: Array<{ total: string }>) =>
        rows.reduce((acc, r) => acc + Number(r.total), 0);

      return {
        stockValue: Number(products.stockValue),
        lowStockCount: products.lowStock,
        pendingOrders: requests.pending,
        arOutstanding: total(ar),
        apOutstanding: total(ap),
      };
    }),
    countClaimsAwaitingApprovalPg(),
  ]);

  return { ...tenant, claimsPending };
}

/** The products that moved most, for the "top products" tile. */
export async function getTopProducts(limit = 5) {
  const rows = await getTopMovedProducts(limit);
  return rows.map((p) => ({
    name: p.name,
    sku: p.SKU,
    quantity: p.totalMoved,
  }));
}

/**
 * Stock in/out per day for Recharts, keyed `in` and `out`.
 *
 * Same data as getMovementTrend, different key names: this one feeds a chart
 * whose series are named after the directions. Kept as its own function
 * because that is how the Mongo file had it and both names are in use.
 */
export async function getStockMovementTrend(days = 7) {
  const trend = await getMovementTrend(days);
  return trend.map((d) => ({
    date: String(d.date instanceof Date ? d.date.toISOString().slice(0, 10) : d.date),
    in: d.stockIn,
    out: d.stockOut,
  }));
}

/** Movements recorded today — a small count several tiles share. */
export async function getTodayMovementCount() {
  return withAuthorizedTenant([], async (tx) => {
    const [row] = (await tx.execute(sql`
      SELECT count(*)::int AS n
        FROM stock_movements
       WHERE created_at >= CURRENT_DATE
    `)) as unknown as Array<{ n: number }>;
    return int(row?.n);
  });
}
