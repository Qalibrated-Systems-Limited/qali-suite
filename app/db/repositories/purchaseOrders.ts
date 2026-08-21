import { asc, eq, sql } from "drizzle-orm";
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
      parts.push(sql`po.status = ANY(${statuses}::text[])`);
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
