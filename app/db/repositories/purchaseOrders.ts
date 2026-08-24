import { asc, eq, sql } from "drizzle-orm";
import { anyOf } from "./sqlHelpers";
import type { Tx } from "../client";
import { purchaseOrders, purchaseOrderLines } from "../schema/purchaseOrders";
import { documentFlow } from "../schema/documentFlow";
import { billLines } from "../schema/bills";
import * as billsRepo from "./bills";

/**
 * Purchase orders (0049).
 *
 * Nothing here computes money. Line amounts are generated columns and the
 * header totals belong to recalc_purchase_order(), so this supplies quantity,
 * price and rates and reads back what they came to — the same division the
 * quotes repository draws.
 *
 * Nothing here counts, either. "How much has arrived" and "how much has been
 * billed" are read from `purchase_order_line_received` and
 * `purchase_order_line_billed`, never from a column somebody has to remember
 * to increment. That is the fault this port exists to remove: Mongo keeps one
 * counter for both questions and increments it from convertToBill() AND
 * acceptGRN(), so an order that is billed and received counts the same goods
 * twice and then refuses to bill quantity nobody billed.
 */

export interface PurchaseOrderLineInput {
  productId?: string | null;
  productName?: string | null;
  productSku?: string | null;
  description: string;
  accountId?: string | null;
  quantity: string;
  unit?: string | null;
  unitPrice: string;
  vatRate?: string;
}

export interface CreatePurchaseOrderInput {
  companyId: string;
  supplierId: string;
  supplierName: string;
  supplierTaxPin?: string | null;
  supplierEmail?: string | null;
  supplierPhone?: string | null;
  supplierAddress?: string | null;
  poDate: string;
  expectedDeliveryDate?: string | null;
  validUntil?: string | null;
  currency?: string;
  whtApplicable?: boolean;
  whtRate?: string;
  receiptTolerancePercentage?: string;
  deliveryAddress?: string | null;
  deliveryInstructions?: string | null;
  notes?: string | null;
  termsAndConditions?: string | null;
  internalNotes?: string | null;
  lines: PurchaseOrderLineInput[];
  createdById?: string | null;
  createdByName?: string | null;
}

/**
 * Which statuses may follow which.
 *
 * A state machine for the same reason quotes has one: a CHECK sees the row it
 * is validating but not the row it replaced. The source spreads these as `if`
 * guards and `canX` virtuals across nine actions and the model.
 *
 * 'expired' is absent on purpose — expiry is a fact about `valid_until` and
 * today, derived in `purchase_order_state`, not a status anybody writes.
 * Reopening an expired order is therefore just moving the date, and does not
 * need the model's trick of pushing validUntil forward to escape its own
 * pre-save hook.
 */
const TRANSITIONS: Record<string, string[]> = {
  draft: ["sent", "cancelled"],
  sent: ["confirmed", "cancelled", "closed", "draft"],
  // Back to draft is an AMENDMENT: the lines are frozen outside draft (0049),
  // so revising a sent order is a deliberate step with a name on it rather
  // than an edit nobody sees.
  confirmed: ["cancelled", "closed", "draft"],
  cancelled: [],
  closed: [],
};

export function canTransition(from: string, to: string): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

function assertTransition(from: string, to: string) {
  if (!canTransition(from, to)) {
    throw new Error(`A ${from} purchase order cannot become ${to}.`);
  }
}

async function insertLines(
  tx: Tx,
  companyId: string,
  purchaseOrderId: string,
  lines: PurchaseOrderLineInput[],
) {
  let n = 0;
  for (const line of lines) {
    n++;
    await tx.insert(purchaseOrderLines).values({
      companyId,
      purchaseOrderId,
      lineNumber: n,
      productId: line.productId ?? null,
      productName: line.productName ?? null,
      productSku: line.productSku ?? null,
      description: line.description,
      accountId: line.accountId ?? null,
      quantity: line.quantity,
      unit: line.unit ?? "pcs",
      unitPrice: line.unitPrice,
      vatRate: line.vatRate ?? "0",
    });
  }
}

export async function createPurchaseOrder(
  tx: Tx,
  input: CreatePurchaseOrderInput,
) {
  if (!input.lines?.length) {
    throw new Error("A purchase order needs at least one line.");
  }

  // document_prefix, not the literal `QSL-PO-YYYYMM` the model hard-codes:
  // 0035 already reads the tenant's configured po_prefix, and next_entry_number
  // is race-free — which replaces the model's five-attempt retry loop with its
  // exponential backoff and its timestamp-plus-random fallback.
  const [{ po_number }] = (await tx.execute(
    sql`SELECT next_entry_number(
      ${input.companyId}::uuid,
      document_prefix(${input.companyId}::uuid, 'po')
    ) AS po_number`,
  )) as unknown as Array<{ po_number: string }>;

  const [po] = await tx
    .insert(purchaseOrders)
    .values({
      companyId: input.companyId,
      poNumber: po_number,
      supplierId: input.supplierId,
      supplierName: input.supplierName,
      supplierTaxPin: input.supplierTaxPin ?? null,
      supplierEmail: input.supplierEmail ?? null,
      supplierPhone: input.supplierPhone ?? null,
      supplierAddress: input.supplierAddress ?? null,
      poDate: input.poDate,
      expectedDeliveryDate: input.expectedDeliveryDate ?? null,
      validUntil: input.validUntil ?? null,
      currency: input.currency ?? "KES",
      whtApplicable: input.whtApplicable ?? false,
      whtRate: input.whtRate ?? "0",
      receiptTolerancePercentage: input.receiptTolerancePercentage ?? "0",
      deliveryAddress: input.deliveryAddress ?? null,
      deliveryInstructions: input.deliveryInstructions ?? null,
      notes: input.notes ?? null,
      termsAndConditions: input.termsAndConditions ?? null,
      internalNotes: input.internalNotes ?? null,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName ?? null,
    })
    .returning();

  await insertLines(tx, input.companyId, po.id, input.lines);

  // Re-read: the totals are the trigger's output, not this function's.
  const [withTotals] = await tx
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, po.id));
  return withTotals;
}

export async function getPurchaseOrder(tx: Tx, purchaseOrderId: string) {
  const [po] = await tx
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, purchaseOrderId));
  return po ?? null;
}

/**
 * The order, its lines, and the position of each — ordered, received,
 * accepted, billed.
 *
 * One query per view rather than a counter per line. `remaining` is what the
 * order still expects, and it is derived from ACCEPTED quantity: goods that
 * arrived and were rejected did not fulfil anything.
 */
export async function getPurchaseOrderDetail(tx: Tx, purchaseOrderId: string) {
  const po = await getPurchaseOrder(tx, purchaseOrderId);
  if (!po) return null;

  const lines = (await tx.execute(sql`
    SELECT pol.*,
           r.received_quantity,
           r.accepted_quantity,
           b.billed_quantity,
           (pol.quantity - r.accepted_quantity) AS remaining_quantity,
           (pol.quantity - b.billed_quantity)   AS unbilled_quantity
      FROM purchase_order_lines pol
      JOIN purchase_order_line_received r ON r.purchase_order_line_id = pol.id
      JOIN purchase_order_line_billed   b ON b.purchase_order_line_id = pol.id
     WHERE pol.purchase_order_id = ${purchaseOrderId}::uuid
     ORDER BY pol.line_number
  `)) as unknown as Array<Record<string, unknown>>;

  const [state] = (await tx.execute(sql`
    SELECT * FROM purchase_order_state WHERE purchase_order_id = ${purchaseOrderId}::uuid
  `)) as unknown as Array<Record<string, unknown>>;

  const receipts = (await tx.execute(sql`
    SELECT grn.id, grn.grn_number, grn.status, grn.received_date::text AS received_date,
           s.outcome, s.received_quantity, s.accepted_quantity
      FROM goods_receipts grn
      JOIN goods_receipt_state s ON s.goods_receipt_id = grn.id
     WHERE grn.purchase_order_id = ${purchaseOrderId}::uuid
     ORDER BY grn.received_date DESC, grn.grn_number DESC
  `)) as unknown as Array<Record<string, unknown>>;

  // Which bills came out of this order. The source keeps a `bills[]` array on
  // the PO and pushes to it on conversion, so a bill cancelled afterwards is
  // still listed as if it stood.
  const bills = (await tx.execute(sql`
    SELECT b.id, b.bill_number, b.bill_date::text AS bill_date, b.status,
           b.total::text AS total, b.used_grni, b.inventory_moved
      FROM bills b
     WHERE b.purchase_order_id = ${purchaseOrderId}::uuid
     ORDER BY b.bill_date DESC, b.bill_number DESC
  `)) as unknown as Array<Record<string, unknown>>;

  const deliveries = (await tx.execute(sql`
    SELECT status, recipient, error, attempted_at, delivered_at
      FROM document_deliveries
     WHERE document_type = 'purchase_order' AND document_id = ${purchaseOrderId}::uuid
     ORDER BY attempted_at DESC
  `)) as unknown as Array<Record<string, unknown>>;

  return { ...po, lines, state: state ?? null, receipts, bills, deliveries };
}

/**
 * The display status the screens expect.
 *
 * ANTI-CORRUPTION LAYER, and deliberately so. 0049 removed 'expired',
 * 'partial' and 'received' as stored statuses because each was a computed
 * value wearing one — expiry written by a pre-save hook that fired on any
 * save, the other two by the counter that had two writers. `status` now holds
 * only what a person chose.
 *
 * The screens still speak the old vocabulary: one string that drives a badge,
 * a filter and half a dozen `includes()` guards. Translating here, at the
 * boundary, is the standard shape for this — the alternative is teaching six
 * components to combine two fields, which is the same logic copied six times.
 *
 * Precedence matters. A cancelled or closed order is that whatever its
 * receipts say; a fully-received order is not "expired" merely because its
 * validity has lapsed; and expiry only means anything while the order is still
 * live. That ordering is the reason this is one function and not an
 * expression.
 */
export function displayStatus(row: {
  status?: unknown;
  is_expired?: unknown;
  receipt_state?: unknown;
}): string {
  const status = String(row.status ?? "draft");
  if (status === "cancelled" || status === "closed") return status;
  if (row.receipt_state === "complete") return "received";
  if (row.receipt_state === "partial") return "partial";
  if (row.is_expired) return "expired";
  return status;
}

/**
 * A purchase order as the detail page and the PDF render it.
 *
 * Shaped to the page rather than to the schema, on the `getBillDetail` (0016)
 * and `getQuoteForDisplay` precedent: `amounts.total`, `supplier.name`,
 * `lines[].vat.rate`, `linkedBills[]`. The markup does not change with the
 * data source.
 *
 * `lines[].receivedQuantity` is the one to look at. In Mongo it is a stored
 * counter incremented from two places that do not know about each other; here
 * it is read from `purchase_order_line_received`, and the two other questions
 * that counter was also being asked to answer — how much was ACCEPTED and how
 * much was BILLED — come back as their own fields instead of being conflated
 * into it.
 */
export async function getPurchaseOrderForDisplay(
  tx: Tx,
  purchaseOrderId: string,
) {
  const detail = await getPurchaseOrderDetail(tx, purchaseOrderId);
  if (!detail) return null;

  const state = (detail.state ?? {}) as Record<string, unknown>;
  const receipts = detail.receipts as Array<Record<string, unknown>>;

  // When the order became complete: the last receipt that made it so. The
  // Mongo page reads `po.receivedAt` and the model never had such a field, so
  // it has always rendered blank.
  const finalised = receipts
    .filter((r) => r.status === "finalised")
    .map((r) => String(r.received_date))
    .sort();
  const receivedAt =
    state.receipt_state === "complete" && finalised.length
      ? finalised[finalised.length - 1]
      : null;

  return {
    _id: detail.id,
    id: detail.id,
    poNumber: detail.poNumber,

    /** What the badge and the filters read — see displayStatus above. */
    status: displayStatus({
      status: detail.status,
      is_expired: state.is_expired,
      receipt_state: state.receipt_state,
    }),
    /** What a person actually chose, when a caller needs to know. */
    workflowStatus: detail.status,
    isExpired: Boolean(state.is_expired),
    receiptState: (state.receipt_state as string) ?? "none",
    billState: (state.bill_state as string) ?? "none",

    poDate: detail.poDate,
    expectedDeliveryDate: detail.expectedDeliveryDate,
    validUntil: detail.validUntil,
    currency: detail.currency,
    deliveryAddress: detail.deliveryAddress,
    deliveryInstructions: detail.deliveryInstructions,
    notes: detail.notes,
    internalNotes: detail.internalNotes,
    terms: detail.termsAndConditions,
    termsAndConditions: detail.termsAndConditions,

    supplier: {
      partyId: detail.supplierId,
      _id: detail.supplierId,
      name: detail.supplierName,
      email: detail.supplierEmail,
      phone: detail.supplierPhone,
      taxPin: detail.supplierTaxPin,
      address: detail.supplierAddress,
    },

    whtApplicable: detail.whtApplicable,
    whtRate: Number(detail.whtRate),
    receiptTolerancePercentage: Number(detail.receiptTolerancePercentage),

    amounts: {
      subtotal: Number(detail.subtotal),
      vatTotal: Number(detail.vatTotal),
      vat: Number(detail.vatTotal),
      total: Number(detail.total),
      wht: Number(detail.whtAmount ?? 0),
      netPayable: Number(detail.netPayable ?? 0),
    },

    lines: (detail.lines as Array<Record<string, any>>).map((l) => ({
      _id: l.id,
      id: l.id,
      lineNumber: l.line_number,
      product: l.product_id
        ? { id: l.product_id, _id: l.product_id, name: l.product_name, sku: l.product_sku }
        : null,
      accountId: l.account_id,
      description: l.description,
      unit: l.unit,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unit_price),
      vat: { rate: Number(l.vat_rate), amount: Number(l.vat_amount ?? 0) },
      amount: Number(l.amount ?? 0),
      lineTotal: Number(l.line_total ?? 0),
      // Three answers where the source kept one number.
      receivedQuantity: Number(l.received_quantity ?? 0),
      acceptedQuantity: Number(l.accepted_quantity ?? 0),
      billedQuantity: Number(l.billed_quantity ?? 0),
      remainingQuantity: Number(l.remaining_quantity ?? 0),
      unbilledQuantity: Number(l.unbilled_quantity ?? 0),
    })),

    /**
     * Joined through document_flow, not an embedded array the conversion
     * pushed to — so a bill cancelled afterwards is not still listed as if it
     * stood, and the amount shown is the bill's own total.
     */
    linkedBills: (detail.bills as Array<Record<string, any>>).map((b) => ({
      billId: b.id,
      _id: b.id,
      billNumber: b.bill_number,
      billDate: b.bill_date,
      status: b.status,
      amount: Number(b.total),
      usedGrni: b.used_grni,
      inventoryMoved: b.inventory_moved,
    })),

    receipts: receipts.map((r) => ({
      _id: r.id,
      grnNumber: r.grn_number,
      status: r.status,
      outcome: r.outcome,
      receivedDate: r.received_date,
      receivedQuantity: Number(r.received_quantity ?? 0),
      acceptedQuantity: Number(r.accepted_quantity ?? 0),
    })),

    receivedAt,
    sentAt: detail.sentAt,
    sentBy: detail.sentByName ? { name: detail.sentByName } : null,
    confirmedAt: detail.confirmedAt,
    confirmedBy: detail.confirmedByName ? { name: detail.confirmedByName } : null,
    cancelledAt: detail.cancelledAt,
    cancelledBy: detail.cancelledByName ? { name: detail.cancelledByName } : null,
    cancellationReason: detail.cancellationReason,
    closedAt: detail.closedAt,
    closedBy: detail.closedByName ? { name: detail.closedByName } : null,
    closureReason: detail.closureReason,

    createdAt: detail.createdAt,
    createdBy: detail.createdByName ? { name: detail.createdByName } : null,
    deliveries: detail.deliveries,
  };
}

/** The list rows, in the shape POTable reads. */
export async function listPurchaseOrdersForDisplay(
  tx: Tx,
  filters: ListPurchaseOrdersFilters = {},
  page = 1,
  pageSize = 20,
) {
  const rows = await listPurchaseOrders(tx, filters, page, pageSize);
  if (!rows.length) return [];

  // One query for every order's bill count rather than one per row.
  const ids = rows.map((r) => String(r.id));
  const counts = (await tx.execute(sql`
    SELECT purchase_order_id, COUNT(*)::int AS n
      FROM bills
     WHERE purchase_order_id = ${anyOf(ids, "uuid[]")}
       AND status <> 'cancelled'
     GROUP BY purchase_order_id
  `)) as unknown as Array<{ purchase_order_id: string; n: number }>;
  const billCount = new Map(counts.map((c) => [c.purchase_order_id, c.n]));

  return rows.map((r: Record<string, any>) => ({
    _id: r.id,
    id: r.id,
    poNumber: r.po_number,
    status: displayStatus(r),
    workflowStatus: r.status,
    isExpired: Boolean(r.is_expired),
    receiptState: r.receipt_state ?? "none",
    billState: r.bill_state ?? "none",
    poDate: r.po_date,
    expectedDeliveryDate: r.expected_delivery_date,
    validUntil: r.valid_until,
    supplier: {
      partyId: r.supplier_id,
      name: r.supplier_name,
      taxPin: r.supplier_tax_pin,
    },
    amounts: {
      subtotal: Number(r.subtotal),
      vatTotal: Number(r.vat_total),
      total: Number(r.total),
      netPayable: Number(r.net_payable ?? 0),
    },
    // POTable only reads .length; the rows themselves are on the detail page.
    linkedBills: Array.from({ length: billCount.get(String(r.id)) ?? 0 }),
  }));
}

export interface ListPurchaseOrdersFilters {
  status?: string | string[] | null;
  supplierId?: string | null;
  search?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  /** Orders whose valid_until has passed — derived, never a stored status. */
  expiredOnly?: boolean;
}

function listConditions(filters: ListPurchaseOrdersFilters) {
  const parts = [sql`TRUE`];
  if (filters.status) {
    const statuses = Array.isArray(filters.status)
      ? filters.status
      : [filters.status];
    if (statuses.length) {
      parts.push(sql`po.status = ${anyOf(statuses, "text[]")}`);
    }
  }
  if (filters.supplierId) {
    parts.push(sql`po.supplier_id = ${filters.supplierId}::uuid`);
  }
  if (filters.fromDate) parts.push(sql`po.po_date >= ${filters.fromDate}::date`);
  if (filters.toDate) parts.push(sql`po.po_date <= ${filters.toDate}::date`);
  if (filters.expiredOnly) {
    parts.push(
      sql`po.valid_until IS NOT NULL AND po.valid_until < CURRENT_DATE
          AND po.status IN ('draft', 'sent', 'confirmed')`,
    );
  }
  if (filters.search) {
    const term = `%${filters.search}%`;
    parts.push(
      sql`(po.po_number ILIKE ${term} OR po.supplier_name ILIKE ${term}
           OR po.notes ILIKE ${term} OR po.internal_notes ILIKE ${term})`,
    );
  }
  return sql.join(parts, sql` AND `);
}

export async function listPurchaseOrders(
  tx: Tx,
  filters: ListPurchaseOrdersFilters = {},
  page = 1,
  pageSize = 20,
) {
  const limit = Math.min(Math.max(pageSize, 1), 200);
  const offset = Math.max(page - 1, 0) * limit;

  const rows = (await tx.execute(sql`
    SELECT po.*, st.is_expired, st.receipt_state, st.bill_state
      FROM purchase_orders po
      JOIN purchase_order_state st ON st.purchase_order_id = po.id
     WHERE ${listConditions(filters)}
     ORDER BY po.po_date DESC, po.po_number DESC
     LIMIT ${limit} OFFSET ${offset}
  `)) as unknown as Array<Record<string, unknown>>;

  return rows;
}

export async function countPurchaseOrders(
  tx: Tx,
  filters: ListPurchaseOrdersFilters = {},
) {
  const [row] = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM purchase_orders po
     WHERE ${listConditions(filters)}
  `)) as unknown as Array<{ n: number }>;
  return row?.n ?? 0;
}

/**
 * The dashboard figures, in one pass.
 *
 * The Mongo version runs a separate count per status and then a fourth query
 * for the value, each scanning the same collection. Postgres does the
 * bucketing in the aggregate.
 */
export async function getPurchaseOrderStats(
  tx: Tx,
  filters: ListPurchaseOrdersFilters = {},
) {
  const [row] = (await tx.execute(sql`
    SELECT
      COUNT(*)::int                                                        AS total,
      COUNT(*) FILTER (WHERE po.status = 'draft')::int                     AS draft,
      COUNT(*) FILTER (WHERE po.status = 'sent')::int                      AS sent,
      COUNT(*) FILTER (WHERE po.status = 'confirmed')::int                 AS confirmed,
      COUNT(*) FILTER (WHERE po.status = 'cancelled')::int                 AS cancelled,
      COUNT(*) FILTER (WHERE po.status = 'closed')::int                    AS closed,
      COUNT(*) FILTER (WHERE st.is_expired)::int                           AS expired,
      COUNT(*) FILTER (WHERE st.receipt_state = 'partial')::int            AS partially_received,
      COUNT(*) FILTER (WHERE st.receipt_state = 'complete')::int           AS fully_received,
      COALESCE(SUM(po.total) FILTER (
        WHERE po.status IN ('sent', 'confirmed')), 0)::text                AS open_value,
      COALESCE(SUM(po.total), 0)::text                                     AS total_value
    FROM purchase_orders po
    JOIN purchase_order_state st ON st.purchase_order_id = po.id
   WHERE ${listConditions(filters)}
  `)) as unknown as Array<Record<string, unknown>>;
  return row ?? null;
}

/** Orders still expecting goods, oldest expected delivery first. */
export async function getOpenPurchaseOrders(
  tx: Tx,
  supplierId?: string | null,
  limit = 100,
) {
  return (await tx.execute(sql`
    SELECT po.*, st.receipt_state, st.is_expired
      FROM purchase_orders po
      JOIN purchase_order_state st ON st.purchase_order_id = po.id
     WHERE po.status IN ('sent', 'confirmed')
       AND st.receipt_state <> 'complete'
       ${supplierId ? sql`AND po.supplier_id = ${supplierId}::uuid` : sql``}
     ORDER BY po.expected_delivery_date ASC NULLS LAST, po.po_date DESC
     LIMIT ${Math.min(limit, 500)}
  `)) as unknown as Array<Record<string, unknown>>;
}

/** Past their expected delivery date and still short. */
export async function getOverduePurchaseOrders(tx: Tx, limit = 100) {
  return (await tx.execute(sql`
    SELECT po.*, st.receipt_state,
           (CURRENT_DATE - po.expected_delivery_date) AS days_overdue
      FROM purchase_orders po
      JOIN purchase_order_state st ON st.purchase_order_id = po.id
     WHERE po.status IN ('sent', 'confirmed')
       AND po.expected_delivery_date IS NOT NULL
       AND po.expected_delivery_date < CURRENT_DATE
       AND st.receipt_state <> 'complete'
     ORDER BY po.expected_delivery_date ASC
     LIMIT ${Math.min(limit, 500)}
  `)) as unknown as Array<Record<string, unknown>>;
}

/** Orders whose validity runs out within `daysAhead`. */
export async function getExpiringPurchaseOrders(
  tx: Tx,
  daysAhead = 7,
  limit = 100,
) {
  return (await tx.execute(sql`
    SELECT po.*, (po.valid_until - CURRENT_DATE) AS days_remaining
      FROM purchase_orders po
     WHERE po.status IN ('draft', 'sent', 'confirmed')
       AND po.valid_until IS NOT NULL
       AND po.valid_until >= CURRENT_DATE
       AND po.valid_until <= CURRENT_DATE + ${daysAhead}::int
     ORDER BY po.valid_until ASC
     LIMIT ${Math.min(limit, 500)}
  `)) as unknown as Array<Record<string, unknown>>;
}

/**
 * Lines with quantity still to bill, for the convert-to-bill screen.
 *
 * Available = ordered less BILLED, not less received. The source calls the
 * same thing `receivedQuantity` because in that model billing IS receiving —
 * which is the conflation §9G describes and the reason a PO that was also
 * goods-received stops being billable.
 */
export async function getAvailableLines(tx: Tx, purchaseOrderId: string) {
  return (await tx.execute(sql`
    SELECT pol.id, pol.line_number, pol.product_id, pol.product_name,
           pol.product_sku, pol.description, pol.account_id, pol.unit,
           pol.unit_price::text  AS unit_price,
           pol.vat_rate::text    AS vat_rate,
           pol.quantity::text    AS ordered_quantity,
           b.billed_quantity::text AS billed_quantity,
           r.accepted_quantity::text AS accepted_quantity,
           (pol.quantity - b.billed_quantity)::text AS available_quantity
      FROM purchase_order_lines pol
      JOIN purchase_order_line_billed   b ON b.purchase_order_line_id = pol.id
      JOIN purchase_order_line_received r ON r.purchase_order_line_id = pol.id
     WHERE pol.purchase_order_id = ${purchaseOrderId}::uuid
       AND pol.quantity > b.billed_quantity
     ORDER BY pol.line_number
  `)) as unknown as Array<Record<string, unknown>>;
}

/**
 * Open orders with what is still to ARRIVE on each, for the receipt form.
 *
 * The sibling of `getAvailableLines`, and the distinction is the whole point
 * of the port: that one answers "what is left to BILL" (ordered less billed);
 * this answers "what is left to RECEIVE" (ordered less accepted). Mongo has
 * one counter for both, so the two questions returned the same wrong number.
 *
 * Each line carries its own id, which the receipt line stores. Without it a
 * PO-sourced receipt links to nothing.
 */
export async function getOpenPurchaseOrdersWithLines(
  tx: Tx,
  supplierId?: string | null,
  limit = 100,
) {
  const rows = (await tx.execute(sql`
    SELECT po.id, po.po_number, po.supplier_id, po.supplier_name,
           po.po_date::text AS po_date,
           po.expected_delivery_date::text AS expected_delivery_date,
           pol.id            AS line_id,
           pol.line_number,
           pol.product_id, pol.product_name, pol.product_sku,
           pol.description, pol.unit,
           pol.unit_price::text AS unit_price,
           pol.vat_rate::text   AS vat_rate,
           pol.quantity::text   AS ordered_quantity,
           (pol.quantity - r.accepted_quantity)::text AS available_quantity
      FROM purchase_orders po
      JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
      JOIN purchase_order_line_received r ON r.purchase_order_line_id = pol.id
     WHERE po.status IN ('sent', 'confirmed')
       AND pol.quantity > r.accepted_quantity
       AND pol.product_id IS NOT NULL
       ${supplierId ? sql`AND po.supplier_id = ${supplierId}::uuid` : sql``}
     ORDER BY po.expected_delivery_date ASC NULLS LAST, po.po_number, pol.line_number
     LIMIT ${Math.min(limit, 500) * 50}
  `)) as unknown as Array<Record<string, any>>;

  const orders = new Map<string, Record<string, any>>();
  for (const r of rows) {
    const id = String(r.id);
    if (!orders.has(id)) {
      orders.set(id, {
        _id: id,
        id,
        poNumber: r.po_number,
        poDate: r.po_date,
        expectedDeliveryDate: r.expected_delivery_date,
        supplier: { partyId: r.supplier_id, name: r.supplier_name },
        availableLines: [],
      });
    }
    orders.get(id)!.availableLines.push({
      _id: r.line_id,
      id: r.line_id,
      lineNumber: r.line_number,
      product: {
        id: r.product_id,
        _id: r.product_id,
        name: r.product_name,
        sku: r.product_sku,
      },
      description: r.description,
      unit: r.unit,
      unitPrice: Number(r.unit_price),
      vatRate: Number(r.vat_rate),
      orderedQuantity: Number(r.ordered_quantity),
      availableQuantity: Number(r.available_quantity),
    });
  }
  return [...orders.values()].slice(0, limit);
}

/**
 * An order by its number — for integrations that quote a PO reference.
 *
 * The weighbridge gate sends `purchaseOrderRef` as a string and the connector
 * resolves it to an id. That lookup was against Mongo, so once orders moved it
 * matched nothing and every inbound ticket recorded a null purchase order —
 * silently, because the connector treats a miss as soft (gate software may
 * quote a PO before it is raised).
 */
export async function findPurchaseOrderByNumber(tx: Tx, poNumber: string) {
  const [po] = await tx
    .select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.poNumber, poNumber));
  return po ?? null;
}

export interface UpdatePurchaseOrderInput
  extends Partial<Omit<CreatePurchaseOrderInput, "companyId" | "lines">> {
  lines?: PurchaseOrderLineInput[];
  lastModifiedById?: string | null;
  lastModifiedByName?: string | null;
}

/**
 * Edits a draft order.
 *
 * Lines are replaced wholesale when supplied — the trigger in 0049 refuses the
 * write outright if the order has left draft, so this cannot silently rewrite
 * what a supplier was sent.
 */
export async function updatePurchaseOrder(
  tx: Tx,
  purchaseOrderId: string,
  input: UpdatePurchaseOrderInput,
) {
  const po = await getPurchaseOrder(tx, purchaseOrderId);
  if (!po) throw new Error("Purchase order not found");
  if (po.status !== "draft") {
    throw new Error(
      `Only a draft purchase order can be edited (this one is ${po.status}). Return it to draft to amend it.`,
    );
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const assign = <K extends string>(key: K, value: unknown) => {
    if (value !== undefined) patch[key] = value;
  };
  assign("supplierId", input.supplierId);
  assign("supplierName", input.supplierName);
  assign("supplierTaxPin", input.supplierTaxPin);
  assign("supplierEmail", input.supplierEmail);
  assign("supplierPhone", input.supplierPhone);
  assign("supplierAddress", input.supplierAddress);
  assign("poDate", input.poDate);
  assign("expectedDeliveryDate", input.expectedDeliveryDate);
  assign("validUntil", input.validUntil);
  assign("currency", input.currency);
  assign("whtApplicable", input.whtApplicable);
  assign("whtRate", input.whtRate);
  assign("receiptTolerancePercentage", input.receiptTolerancePercentage);
  assign("deliveryAddress", input.deliveryAddress);
  assign("deliveryInstructions", input.deliveryInstructions);
  assign("notes", input.notes);
  assign("termsAndConditions", input.termsAndConditions);
  assign("internalNotes", input.internalNotes);
  assign("lastModifiedById", input.lastModifiedById);
  assign("lastModifiedByName", input.lastModifiedByName);

  await tx
    .update(purchaseOrders)
    .set(patch)
    .where(eq(purchaseOrders.id, purchaseOrderId));

  if (input.lines) {
    if (!input.lines.length) {
      throw new Error("A purchase order needs at least one line.");
    }
    await tx
      .delete(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId));
    await insertLines(tx, po.companyId, purchaseOrderId, input.lines);
  }

  const [updated] = await tx
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, purchaseOrderId));
  return updated;
}

async function setStatus(
  tx: Tx,
  purchaseOrderId: string,
  to: string,
  patch: Record<string, unknown> = {},
) {
  const po = await getPurchaseOrder(tx, purchaseOrderId);
  if (!po) throw new Error("Purchase order not found");
  assertTransition(po.status, to);

  const [updated] = await tx
    .update(purchaseOrders)
    .set({ status: to, updatedAt: new Date(), ...patch })
    .where(eq(purchaseOrders.id, purchaseOrderId))
    .returning();
  return updated;
}

export async function sendPurchaseOrder(
  tx: Tx,
  purchaseOrderId: string,
  sentById?: string | null,
  sentByName?: string | null,
) {
  return setStatus(tx, purchaseOrderId, "sent", {
    sentAt: new Date(),
    sentById: sentById ?? null,
    sentByName: sentByName ?? null,
  });
}

export async function confirmPurchaseOrder(
  tx: Tx,
  purchaseOrderId: string,
  confirmedById?: string | null,
  confirmedByName?: string | null,
) {
  return setStatus(tx, purchaseOrderId, "confirmed", {
    confirmedAt: new Date(),
    confirmedById: confirmedById ?? null,
    confirmedByName: confirmedByName ?? null,
  });
}

export async function cancelPurchaseOrder(
  tx: Tx,
  purchaseOrderId: string,
  reason: string,
  cancelledById?: string | null,
  cancelledByName?: string | null,
) {
  if (!reason?.trim()) {
    throw new Error("Cancelling a purchase order needs a reason.");
  }

  // A bill or a receipt against the order is a real event; cancelling the
  // order would leave them pointing at something that says it never happened.
  // The source guards this with `canCancel`, which only checks bills.
  const [{ receipts, bills: billCount }] = (await tx.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM goods_receipts
        WHERE purchase_order_id = ${purchaseOrderId}::uuid AND status <> 'voided')::int AS receipts,
      (SELECT COUNT(*) FROM bills
        WHERE purchase_order_id = ${purchaseOrderId}::uuid AND status <> 'cancelled')::int AS bills
  `)) as unknown as Array<{ receipts: number; bills: number }>;

  if (receipts > 0 || billCount > 0) {
    throw new Error(
      `This order has ${receipts} goods receipt(s) and ${billCount} bill(s) against it and cannot be cancelled. Close it short instead, which records that no more is expected without denying what already arrived.`,
    );
  }

  return setStatus(tx, purchaseOrderId, "cancelled", {
    cancelledAt: new Date(),
    cancelledById: cancelledById ?? null,
    cancelledByName: cancelledByName ?? null,
    cancellationReason: reason,
  });
}

/**
 * Closes an order short.
 *
 * The move the source has no name for. An order part-delivered and then
 * abandoned can neither be cancelled (bills exist) nor completed (goods do
 * not), so it sits in 'partial' forever and every open-order report carries
 * it. Closing says a person decided nothing more is coming.
 */
export async function closePurchaseOrder(
  tx: Tx,
  purchaseOrderId: string,
  reason: string,
  closedById?: string | null,
  closedByName?: string | null,
) {
  if (!reason?.trim()) {
    throw new Error("Closing a purchase order short needs a reason.");
  }
  return setStatus(tx, purchaseOrderId, "closed", {
    closedAt: new Date(),
    closedById: closedById ?? null,
    closedByName: closedByName ?? null,
    closureReason: reason,
  });
}

/**
 * Returns an order to draft so it can be amended or re-dated.
 *
 * This is also what "reopen an expired PO" becomes. The model's reopen() has
 * to push validUntil 30 days forward because its own pre-save hook would
 * otherwise re-expire the order on save; with expiry derived there is no hook
 * to escape, so the caller sets whatever date it means.
 */
export async function reopenPurchaseOrder(
  tx: Tx,
  purchaseOrderId: string,
  validUntil?: string | null,
  modifiedById?: string | null,
  modifiedByName?: string | null,
) {
  const patch: Record<string, unknown> = {
    lastModifiedById: modifiedById ?? null,
    lastModifiedByName: modifiedByName ?? null,
  };
  if (validUntil !== undefined) patch.validUntil = validUntil;
  return setStatus(tx, purchaseOrderId, "draft", patch);
}

/** Drafts only, and only while nothing points at them. */
export async function deletePurchaseOrder(tx: Tx, purchaseOrderId: string) {
  const po = await getPurchaseOrder(tx, purchaseOrderId);
  if (!po) throw new Error("Purchase order not found");
  if (po.status !== "draft") {
    throw new Error(
      `Only a draft purchase order can be deleted (this one is ${po.status}). Cancel it instead, which keeps the record.`,
    );
  }
  await tx.delete(purchaseOrders).where(eq(purchaseOrders.id, purchaseOrderId));
  return { id: purchaseOrderId };
}

export interface ConvertToBillSelection {
  purchaseOrderLineId: string;
  quantity: string;
}

/**
 * Raises a bill for selected lines of an order.
 *
 * Three things separate this from the model's convertToBill():
 *
 * 1. IT DOES NOT RECORD A RECEIPT. The source calls recordReceiving() here,
 *    incrementing the same counter acceptGRN() increments, on the theory that
 *    "in this model, receiving happens when creating a bill". Billing is not
 *    receiving. What has arrived is what the goods receipts say.
 *
 * 2. THE LINK IS A document_flow ROW per line, so `purchase_order_line_billed`
 *    can derive the billed quantity — and un-derive it when the bill is
 *    cancelled, which the counter never did.
 *
 * 3. AVAILABLE MEANS UNBILLED. Over-billing an order line is refused here
 *    against the derived figure rather than against a number the receiving
 *    path also writes.
 */
export async function convertToBill(
  tx: Tx,
  purchaseOrderId: string,
  selections: ConvertToBillSelection[],
  billData: {
    billDate: string;
    dueDate: string;
    supplierInvoiceNumber?: string | null;
    description?: string | null;
    internalNotes?: string | null;
    /** Used for any line whose PO line named no account. */
    defaultAccountId?: string | null;
    createdById?: string | null;
    createdByName?: string | null;
    createdByRole?: string | null;
  },
) {
  const po = await getPurchaseOrder(tx, purchaseOrderId);
  if (!po) throw new Error("Purchase order not found");
  if (!["sent", "confirmed"].includes(po.status)) {
    throw new Error(
      `A ${po.status} purchase order cannot be billed. Send it to the supplier first.`,
    );
  }
  if (!selections?.length) {
    throw new Error("Select at least one line to bill.");
  }

  const available = await getAvailableLines(tx, purchaseOrderId);
  const byId = new Map(available.map((l) => [String(l.id), l]));

  const lines: billsRepo.BillLineInput[] = [];
  const flow: Array<{ poLineId: string; quantity: string; index: number }> = [];

  for (const selection of selections) {
    const line = byId.get(selection.purchaseOrderLineId);
    if (!line) {
      throw new Error(
        `Line ${selection.purchaseOrderLineId} is not on this order, or has nothing left to bill.`,
      );
    }
    if (Number(selection.quantity) <= 0) continue;
    if (Number(selection.quantity) > Number(line.available_quantity)) {
      throw new Error(
        `Cannot bill ${selection.quantity} of "${line.description}": only ${line.available_quantity} of the ordered ${line.ordered_quantity} is still unbilled.`,
      );
    }

    const accountId = (line.account_id as string | null) ?? billData.defaultAccountId;
    if (!accountId) {
      throw new Error(
        `Line "${line.description}" names no account and no default was supplied.`,
      );
    }

    flow.push({
      poLineId: String(line.id),
      quantity: selection.quantity,
      index: lines.length,
    });
    lines.push({
      description: String(line.description),
      accountId,
      quantity: selection.quantity,
      unitPrice: String(line.unit_price),
      unit: (line.unit as string) ?? "pcs",
      vatRate: String(line.vat_rate),
      productId: (line.product_id as string | null) ?? null,
      purchaseOrderId,
      purchaseOrderLineNumber: Number(line.line_number),
    });
  }

  if (!lines.length) throw new Error("Nothing to bill.");

  const bill = await billsRepo.createBill(tx, {
    companyId: po.companyId,
    supplierId: po.supplierId,
    billDate: billData.billDate,
    dueDate: billData.dueDate,
    supplierInvoiceNumber: billData.supplierInvoiceNumber ?? null,
    whtApplicable: po.whtApplicable,
    whtRate: po.whtRate,
    currency: po.currency,
    description: billData.description ?? `Bill from ${po.poNumber}`,
    internalNotes: billData.internalNotes ?? null,
    purchaseOrderId,
    purchaseOrderNumber: po.poNumber,
    lines,
    createdById: billData.createdById ?? null,
    createdByName: billData.createdByName ?? null,
    createdByRole: billData.createdByRole ?? null,
  });

  // The bill lines were written in the order supplied, numbered from 1, so the
  // index into `lines` is the line number.
  const created = await tx
    .select({ id: billLines.id, lineNumber: billLines.lineNumber })
    .from(billLines)
    .where(eq(billLines.billId, bill.id))
    .orderBy(asc(billLines.lineNumber));
  const billLineByNumber = new Map(created.map((l) => [l.lineNumber, l.id]));

  await tx.insert(documentFlow).values(
    flow.map((f) => ({
      companyId: po.companyId,
      predecessorType: "purchase_order_line",
      predecessorId: f.poLineId,
      successorType: "bill_line",
      successorId: billLineByNumber.get(f.index + 1)!,
      quantity: f.quantity,
      createdById: billData.createdById ?? null,
    })),
  );

  // The header link, so "which bills came from this order" is answerable
  // without walking every line.
  await tx
    .insert(documentFlow)
    .values({
      companyId: po.companyId,
      predecessorType: "purchase_order",
      predecessorId: purchaseOrderId,
      successorType: "bill",
      successorId: bill.id,
      createdById: billData.createdById ?? null,
    })
    .onConflictDoNothing();

  return bill;
}
