"use server";

import { sql } from "drizzle-orm";
import { withAuthorizedTenant } from "../tenant";
import * as productsRepo from "../repositories/products";
import * as invoicesRepo from "../repositories/invoices";
import * as fulfilmentRepo from "../repositories/fulfilment";
import * as movementsRepo from "../repositories/stockMovements";
import * as reportsRepo from "../repositories/reports";
import { countClaimsAwaitingApprovalPg } from "./claim-actions";

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
      SELECT id, request_number, status, priority, requested_by_name, created_at
        FROM stock_requests
       ORDER BY created_at DESC
       LIMIT ${Math.min(limit, 50)}
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      _id: String(r.id),
      requestNumber: String(r.request_number),
      status: String(r.status),
      priority: String(r.priority ?? "normal"),
      requestedBy: { name: (r.requested_by_name as string) ?? "Unknown" },
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

async function agingSummary(side: "receivable" | "payable") {
  return withAuthorizedTenant([], async (tx) => {
    const asOf = new Date().toISOString().slice(0, 10);
    const rows = await reportsRepo.getAgingReport(tx, side, asOf);

    const zero = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0, total: 0 };
    return rows.reduce(
      (acc, r) => ({
        current: acc.current + Number(r.current),
        days30: acc.days30 + Number(r.days0_30),
        days60: acc.days60 + Number(r.days31_60),
        days90: acc.days90 + Number(r.days61_90),
        over90: acc.over90 + Number(r.days90plus),
        total: acc.total + Number(r.total),
      }),
      zero,
    );
  });
}
