"use server";

import { sql } from "drizzle-orm";
import { withAuthorizedTenant } from "../tenant";

/**
 * The inventory dashboard's own figures.
 *
 * WHY THIS IS A SECOND FILE and not more of dashboard-actions.ts: the Mongo
 * layer had TWO dashboard query modules, `erp-dashboard-queries.ts` and
 * `dashboard-queries.js`, and they export functions with the SAME NAMES and
 * DIFFERENT SHAPES. `getTopProducts` is `{name, sku, quantity}` in one and
 * `{productId, name, SKU, totalMovements, totalQuantity}` in the other;
 * `getStockByCategory` here is `{category, totalItems, totalStock, totalValue}`
 * where `getCategoryDistribution` there is `{name, count, quantity, value}`.
 *
 * Merging them would mean picking one shape and quietly breaking the four
 * screens that read the other. That is a consolidation worth doing, but it is
 * a change to what the screens receive — not something a port gets to decide
 * on the way past. Two files, two contracts, each matching what its callers
 * already destructure.
 */

const int = (v: unknown) => Number(v ?? 0);
const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

/** The eight tiles across the top of the inventory dashboard. */
export async function getDashboardStats() {
  return withAuthorizedTenant([], async (tx) => {
    const [row] = (await tx.execute(sql`
      SELECT
        (SELECT count(*) FROM products WHERE is_active)::int                       AS total_products,
        (SELECT count(*) FROM products
          WHERE is_active AND quantity_on_hand <= reorder_level)::int              AS low_stock_count,
        (SELECT count(*) FROM products
          WHERE is_active AND quantity_on_hand = 0)::int                           AS out_of_stock_count,
        (SELECT COALESCE(SUM(quantity_on_hand * cost_price), 0)
           FROM products WHERE is_active)::numeric(19,4)                           AS total_stock_value,
        (SELECT count(*) FROM stock_requests WHERE status = 'pending')::int        AS pending_requests,
        (SELECT count(*) FROM outstanding_checkouts)::int                          AS active_checkouts,
        (SELECT count(*) FROM outstanding_checkouts WHERE days_overdue > 0)::int   AS overdue_checkouts,
        (SELECT count(*) FROM stock_movements
          WHERE movement_date >= date_trunc('month', CURRENT_DATE))::int           AS monthly_movements
    `)) as unknown as Array<Record<string, unknown>>;

    return {
      totalProducts: int(row.total_products),
      lowStockCount: int(row.low_stock_count),
      outOfStockCount: int(row.out_of_stock_count),
      totalStockValue: int(row.total_stock_value),
      pendingRequests: int(row.pending_requests),
      activeCheckouts: int(row.active_checkouts),
      overdueCheckouts: int(row.overdue_checkouts),
      monthlyMovements: int(row.monthly_movements),
    };
  });
}

/**
 * Stock in and out per day, keyed `in` and `out` for the chart.
 *
 * Zero-filled from a generated series: the Mongo version built a map from
 * whatever days the aggregation returned, so a quiet day was simply absent and
 * the chart drew a straight line across it.
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
      SELECT to_char(s.day, 'YYYY-MM-DD') AS date,
             COALESCE(SUM(m.quantity) FILTER (WHERE m.direction = 'in'), 0)::numeric(19,4)  AS qty_in,
             COALESCE(SUM(m.quantity) FILTER (WHERE m.direction = 'out'), 0)::numeric(19,4) AS qty_out
        FROM series s
        LEFT JOIN stock_movements m ON m.movement_date::date = s.day
       GROUP BY s.day
       ORDER BY s.day
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      date: String(r.date),
      in: int(r.qty_in),
      out: int(r.qty_out),
    }));
  });
}

/** Stock grouped by the category each product was filed under. */
export async function getStockByCategory() {
  return withAuthorizedTenant([], async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT COALESCE(NULLIF(category, ''), 'Uncategorized') AS category,
             count(*)::int                                            AS total_items,
             COALESCE(SUM(quantity_on_hand), 0)::numeric(19,4)        AS total_stock,
             COALESCE(SUM(quantity_on_hand * cost_price), 0)::numeric(19,4) AS total_value
        FROM products
       WHERE is_active
       GROUP BY 1
       ORDER BY total_value DESC
    `)) as unknown as Array<Record<string, unknown>>;

    // "Uncategorized" with a z — the spelling this module's callers use.
    return rows.map((r) => ({
      category: String(r.category),
      totalItems: int(r.total_items),
      totalStock: int(r.total_stock),
      totalValue: int(r.total_value),
    }));
  });
}

/** The newest requests, with how many lines each has. */
export async function getRecentRequests(limit = 5) {
  return withAuthorizedTenant([], async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT r.id, r.request_number, r.status, r.priority, r.created_at,
             r.requester_name_at_request,
             (SELECT count(*) FROM stock_request_items i
               WHERE i.request_id = r.id)::int AS item_count
        FROM stock_requests r
       ORDER BY r.created_at DESC
       LIMIT ${Math.min(limit, 50)}
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      _id: String(r.id),
      requestNumber: String(r.request_number),
      requester: { name: (r.requester_name_at_request as string) ?? "Unknown" },
      status: String(r.status),
      priority: String(r.priority ?? "normal"),
      itemCount: int(r.item_count),
      createdAt: iso(r.created_at),
    }));
  });
}

/**
 * The newest movements.
 *
 * `productSnapshot` is the name and SKU AS RECORDED ON THE MOVEMENT, not a
 * join to the product: a movement is history, and renaming a product must not
 * rewrite what last month's issue says it was.
 */
export async function getRecentMovements(limit = 10) {
  return withAuthorizedTenant([], async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT id, movement_number, movement_type, direction, quantity,
             product_sku_at_movement, product_name_at_movement,
             performed_by_name_at_movement, created_at
        FROM stock_movements
       ORDER BY movement_date DESC, created_at DESC
       LIMIT ${Math.min(limit, 100)}
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      _id: String(r.id),
      movementNumber: String(r.movement_number),
      productSnapshot: {
        name: r.product_name_at_movement,
        SKU: r.product_sku_at_movement,
      },
      movementType: String(r.movement_type),
      direction: String(r.direction),
      quantity: int(r.quantity),
      performedBy: {
        // The name AS RECORDED, like the product snapshot beside it.
        name: (r.performed_by_name_at_movement as string) ?? "System",
      },
      createdAt: iso(r.created_at),
    }));
  });
}

/**
 * Products at or below their reorder level.
 *
 * THE `threshold` ARGUMENT IS IGNORED, deliberately. It defaulted to 10 and
 * meant "fewer than ten units", which is not what low stock means — a product
 * reordered at 50 is low at 40 and one reordered at 2 is not low at 8. Every
 * other low-stock figure in the system now reads `quantity_on_hand <=
 * reorder_level`; this one agreeing with them matters more than honouring an
 * argument no caller passes.
 */
export async function getLowStockAlerts(_threshold = 10) {
  return withAuthorizedTenant([], async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT id, sku, name, unit, quantity_on_hand, reorder_level, category
        FROM products
       WHERE is_active AND quantity_on_hand <= reorder_level
       ORDER BY (quantity_on_hand - reorder_level), name
       LIMIT 50
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      _id: String(r.id),
      SKU: String(r.sku),
      name: String(r.name),
      unit: String(r.unit ?? "pcs"),
      category: (r.category as string) ?? null,
      inventory: {
        quantityOnHand: int(r.quantity_on_hand),
        reorderLevel: int(r.reorder_level),
      },
    }));
  });
}

/** Checkouts past their return date, worst first. */
export async function getOverdueCheckouts() {
  return withAuthorizedTenant([], async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT checkout_id, checkout_number, product_name_at_checkout,
             checked_out_to_name_at_checkout, quantity_outstanding,
             expected_return_date, days_overdue
        FROM outstanding_checkouts
       WHERE days_overdue > 0
       ORDER BY days_overdue DESC
       LIMIT 50
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      _id: String(r.checkout_id),
      checkoutNumber: String(r.checkout_number),
      productSnapshot: { name: r.product_name_at_checkout },
      checkedOutTo: { name: r.checked_out_to_name_at_checkout ?? "Unknown" },
      quantity: int(r.quantity_outstanding),
      expectedReturnDate: r.expected_return_date,
      daysOverdue: int(r.days_overdue),
    }));
  });
}

/** What moved most — this module's shape, not the other dashboard's. */
export async function getTopProducts(limit = 5) {
  return withAuthorizedTenant([], async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT p.id, p.sku, p.name,
             count(m.id)::int                            AS total_movements,
             COALESCE(SUM(m.quantity), 0)::numeric(19,4) AS total_quantity
        FROM stock_movements m
        JOIN products p ON p.id = m.product_id
       GROUP BY p.id, p.sku, p.name
       ORDER BY total_quantity DESC
       LIMIT ${Math.min(limit, 50)}
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      productId: String(r.id),
      name: String(r.name),
      SKU: String(r.sku),
      totalMovements: int(r.total_movements),
      totalQuantity: int(r.total_quantity),
    }));
  });
}

/**
 * Requests by status, as a complete map.
 *
 * Every status is present with a zero, because the chart reads the keys and a
 * status that happens to have no requests today must not disappear from it.
 */
export async function getRequestStatusBreakdown() {
  return withAuthorizedTenant([], async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT status, count(*)::int AS n FROM stock_requests GROUP BY status
    `)) as unknown as Array<{ status: string; n: number }>;

    const map: Record<string, number> = {
      pending: 0,
      approved: 0,
      rejected: 0,
      fulfilled: 0,
      partially_fulfilled: 0,
      cancelled: 0,
    };
    for (const r of rows) {
      if (r.status in map) map[r.status] = int(r.n);
    }
    return map;
  });
}
