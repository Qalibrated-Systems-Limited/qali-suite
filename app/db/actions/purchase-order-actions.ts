"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { PROCUREMENT_ROLES, BILL_WRITE_ROLES } from "@/lib/utils/role-gates";
import * as purchaseOrders from "../repositories/purchaseOrders";
import * as partiesRepo from "../repositories/parties";
import * as productsRepo from "../repositories/products";
import * as accountsRepo from "../repositories/accounts";
import {
  purchaseOrderSchema,
  toPurchaseOrderInput,
  convertToBillSchema,
} from "../validation/procurement";

/**
 * Purchase order actions on Postgres (§9G).
 *
 * Thin: parse, gate, call the repository, revalidate. What an order may become
 * lives in the repository's transition table; what its numbers may be lives in
 * the schema; what a person may do lives in the role gates and — for the rules
 * that depend on WHICH person already acted — in CHECK constraints.
 *
 * Errors come back through `userMessage`, so a trigger's sentence ("Receiving
 * 5 against PO-100 would bring the total to 113 on an order for 100…") reaches
 * the user instead of drizzle's rendering of the statement.
 */

export type ActionResult =
  | {
      success: true;
      purchaseOrderId?: string;
      poNumber?: string;
      billId?: string;
      billNumber?: string;
      message?: string;
    }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * POForm and ConvertToBillDialog post flat named fields, not a JSON blob:
 * `supplierId`, `lines[0].description`, `lines[1][quantity]`. This is the
 * Mongo action's `parseFormData` — same two bracket dialects, same sparse-array
 * cleanup — kept so the forms did not have to be rewritten to change store.
 *
 * Checkboxes are the one thing worth naming: an unchecked box posts NOTHING,
 * so `whtApplicable` is absent rather than "false", and the schema's coercion
 * would read a missing key as false anyway. The explicit map below makes that
 * legible rather than incidental.
 */
function formDataToObject(formData: FormData): Record<string, unknown> {
  const data: Record<string, any> = {};
  const rows: Record<string, any[]> = {};

  for (const [key, value] of formData.entries()) {
    // lines[0].description  and  lines[0][quantity]
    const m = key.match(/^(\w+)\[(\d+)\](?:\.|\[)([\w]+)\]?$/);
    if (m) {
      const [, name, index, prop] = m;
      rows[name] ??= [];
      rows[name][Number(index)] ??= {};
      rows[name][Number(index)][prop] = value;
    } else {
      data[key] = value;
    }
  }

  for (const [name, arr] of Object.entries(rows)) {
    data[name] = arr.filter(Boolean);
  }

  // An unchecked checkbox posts nothing at all.
  data.whtApplicable = formData.get("whtApplicable") != null;
  return data;
}

function parse<T extends { safeParse: (v: unknown) => any }>(
  schema: T,
  formData: FormData,
) {
  const parsed = schema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return {
      ok: false as const,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  return { ok: true as const, data: parsed.data };
}

/**
 * Freezes the product name and SKU onto each line.
 *
 * POForm posts `lines[i].productId` and a free-text description, and nothing
 * else about the product — so without this the order line carries a reference
 * and no snapshot, and a product renamed after the order was sent silently
 * rewrites what the supplier was asked for. §9.4: the snapshot is what was
 * ORDERED.
 *
 * One query for the distinct ids rather than one per line.
 */
async function withProductSnapshots(
  tx: Parameters<typeof productsRepo.getProduct>[0],
  lines: purchaseOrders.PurchaseOrderLineInput[],
): Promise<purchaseOrders.PurchaseOrderLineInput[]> {
  const ids = [...new Set(lines.map((l) => l.productId).filter(Boolean))] as string[];
  if (!ids.length) return lines;

  const found = await Promise.all(ids.map((id) => productsRepo.getProduct(tx, id)));
  const byId = new Map(found.filter(Boolean).map((prod) => [prod!.id, prod!]));

  return lines.map((l) => {
    const prod = l.productId ? byId.get(l.productId) : null;
    return {
      ...l,
      productName: prod?.name ?? null,
      productSku: prod?.sku ?? null,
    };
  });
}

/** What the order says about the supplier, frozen when it is raised (§9.4). */
function supplierSnapshot(supplier: {
  name: string;
  taxPin: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  city: string | null;
}) {
  return {
    supplierName: supplier.name,
    supplierTaxPin: supplier.taxPin,
    supplierEmail: supplier.email,
    supplierPhone: supplier.phone,
    supplierAddress:
      [supplier.addressLine1, supplier.city].filter(Boolean).join(", ") || null,
  };
}

function revalidateOrder(purchaseOrderId?: string) {
  revalidatePath("/dashboard/purchase-orders");
  if (purchaseOrderId) {
    revalidatePath(`/dashboard/purchase-orders/${purchaseOrderId}`);
  }
}

export async function createPurchaseOrderPg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = parse(purchaseOrderSchema, formData);
  if (!parsed.ok) {
    return { success: false, error: parsed.error, fieldErrors: parsed.fieldErrors };
  }

  try {
    const po = await withAuthorizedTenant(
      [...PROCUREMENT_ROLES],
      async (tx, { user, companyId }) => {
        /**
         * The supplier snapshot is resolved here, from the party row.
         *
         * POForm posts a hidden `supplierId` and nothing else about them, so
         * there is no name, tax PIN or address in the payload to snapshot —
         * and what the ORDER SAYS about the supplier is what gets sent to
         * them. Reading the party under RLS is both the only source available
         * and the right one.
         */
        const supplier = await partiesRepo.getParty(tx, parsed.data.supplierId);
        if (!supplier) throw new Error("That supplier no longer exists.");

        const input = toPurchaseOrderInput(parsed.data);
        return purchaseOrders.createPurchaseOrder(tx, {
          companyId,
          ...input,
          ...supplierSnapshot(supplier),
          lines: await withProductSnapshots(tx, input.lines),
          createdById: user.id,
          createdByName: user.name,
        });
      },
    );

    revalidateOrder();
    return {
      success: true,
      purchaseOrderId: po.id,
      poNumber: po.poNumber,
      message: `Purchase order ${po.poNumber} created`,
    };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not create the order.") };
  }
}

export async function updatePurchaseOrderPg(
  purchaseOrderId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = parse(purchaseOrderSchema, formData);
  if (!parsed.ok) {
    return { success: false, error: parsed.error, fieldErrors: parsed.fieldErrors };
  }

  try {
    const po = await withAuthorizedTenant(
      [...PROCUREMENT_ROLES],
      async (tx, { user }) => {
        // Re-snapshotted, so the reference and the name the supplier will read
        // on the order move together or not at all.
        const supplier = await partiesRepo.getParty(tx, parsed.data.supplierId);
        if (!supplier) throw new Error("That supplier no longer exists.");

        const input = toPurchaseOrderInput(parsed.data);
        return purchaseOrders.updatePurchaseOrder(tx, purchaseOrderId, {
          ...input,
          ...supplierSnapshot(supplier),
          lines: await withProductSnapshots(tx, input.lines),
          lastModifiedById: user.id,
          lastModifiedByName: user.name,
        });
      },
    );

    revalidateOrder(purchaseOrderId);
    return { success: true, purchaseOrderId, poNumber: po.poNumber, message: "Saved" };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not save the changes.") };
  }
}

export async function sendPurchaseOrderPg(
  purchaseOrderId: string,
): Promise<ActionResult> {
  try {
    const po = await withAuthorizedTenant([...PROCUREMENT_ROLES], (tx, { user }) =>
      purchaseOrders.sendPurchaseOrder(tx, purchaseOrderId, user.id, user.name),
    );
    revalidateOrder(purchaseOrderId);
    return { success: true, poNumber: po.poNumber, message: `${po.poNumber} sent` };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not send the order.") };
  }
}

export async function confirmPurchaseOrderPg(
  purchaseOrderId: string,
): Promise<ActionResult> {
  try {
    const po = await withAuthorizedTenant([...PROCUREMENT_ROLES], (tx, { user }) =>
      purchaseOrders.confirmPurchaseOrder(tx, purchaseOrderId, user.id, user.name),
    );
    revalidateOrder(purchaseOrderId);
    return { success: true, poNumber: po.poNumber, message: "Supplier confirmed" };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not confirm the order.") };
  }
}

export async function cancelPurchaseOrderPg(
  purchaseOrderId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { success: false, error: "Cancelling an order needs a reason." };
  }

  try {
    await withAuthorizedTenant([...PROCUREMENT_ROLES], (tx, { user }) =>
      purchaseOrders.cancelPurchaseOrder(tx, purchaseOrderId, reason, user.id, user.name),
    );
    revalidateOrder(purchaseOrderId);
    return { success: true, message: "Order cancelled" };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not cancel the order.") };
  }
}

/**
 * Closes an order short — the move the Mongo module has no name for.
 *
 * An order part-delivered and then abandoned can be neither cancelled (bills
 * or receipts exist against it) nor completed (the goods never came), so it
 * sits in 'partial' and every open-order report carries it forever.
 */
export async function closePurchaseOrderPg(
  purchaseOrderId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { success: false, error: "Closing an order short needs a reason." };
  }

  try {
    await withAuthorizedTenant([...PROCUREMENT_ROLES], (tx, { user }) =>
      purchaseOrders.closePurchaseOrder(tx, purchaseOrderId, reason, user.id, user.name),
    );
    revalidateOrder(purchaseOrderId);
    return { success: true, message: "Order closed" };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not close the order.") };
  }
}

/**
 * Returns an order to draft.
 *
 * This is also "reopen an expired order". Expiry is derived from `valid_until`
 * (§9G notes), so reopening is moving the date — not the model's trick of
 * pushing validUntil forward to escape its own pre-save hook.
 */
export async function reopenPurchaseOrderPg(
  purchaseOrderId: string,
  validUntil?: string | null,
): Promise<ActionResult> {
  try {
    const po = await withAuthorizedTenant([...PROCUREMENT_ROLES], (tx, { user }) =>
      purchaseOrders.reopenPurchaseOrder(
        tx,
        purchaseOrderId,
        validUntil ?? null,
        user.id,
        user.name,
      ),
    );
    revalidateOrder(purchaseOrderId);
    return { success: true, poNumber: po.poNumber, message: "Returned to draft" };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not reopen the order.") };
  }
}

export async function deletePurchaseOrderPg(
  purchaseOrderId: string,
): Promise<ActionResult> {
  try {
    await withAuthorizedTenant([...PROCUREMENT_ROLES], (tx) =>
      purchaseOrders.deletePurchaseOrder(tx, purchaseOrderId),
    );
    revalidateOrder();
    return { success: true, message: "Draft deleted" };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not delete the order.") };
  }
}

/**
 * Raises a bill for selected lines.
 *
 * Gated on BILL_WRITE_ROLES rather than PROCUREMENT_ROLES: this creates a
 * payable, and the list that may do that already exists and includes
 * Accountant, who enters supplier invoices without running procurement.
 *
 * It does NOT record a receipt. The Mongo version calls recordReceiving() here
 * — "in this model, receiving happens when creating a bill" — which is the
 * conflation §9G describes and the reason an order that is both billed and
 * goods-received counts the same units twice.
 */
export async function convertPurchaseOrderToBillPg(
  purchaseOrderId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = parse(convertToBillSchema, formData);
  if (!parsed.ok) {
    return { success: false, error: parsed.error, fieldErrors: parsed.fieldErrors };
  }

  try {
    const bill = await withAuthorizedTenant(
      [...BILL_WRITE_ROLES],
      (tx, { user }) =>
        purchaseOrders.convertToBill(
          tx,
          purchaseOrderId,
          // The dialog posts every line with a quantity box; only the ones
          // the operator actually filled are billed.
          parsed.data.lines
            .filter((l) => l.quantity > 0)
            .map((l) => ({
              purchaseOrderLineId: l.lineId,
              quantity: l.quantity.toFixed(4),
            })),
          {
            billDate: parsed.data.billDate,
            dueDate: parsed.data.dueDate,
            supplierInvoiceNumber: parsed.data.supplierInvoiceNumber ?? null,
            description: parsed.data.description ?? null,
            internalNotes: parsed.data.internalNotes ?? null,
            defaultAccountId: parsed.data.defaultAccountId,
            createdById: user.id,
            createdByName: user.name,
            createdByRole: user.role,
          },
        ),
    );

    revalidateOrder(purchaseOrderId);
    revalidatePath("/dashboard/bills");
    return {
      success: true,
      billId: bill.id,
      billNumber: bill.billNumber,
      message: `Bill ${bill.billNumber} raised`,
    };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not raise the bill.") };
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getPurchaseOrderFormDataPg() {
  return withAuthorizedTenant([...PROCUREMENT_ROLES], async (tx) => {
    const [suppliers, products, accounts] = await Promise.all([
      partiesRepo.listParties(tx, { role: "supplier", limit: 200 }),
      productsRepo.listProducts(tx, { limit: 200 }),
      accountsRepo.listAccounts(tx, { postableOnly: true }),
    ]);

    return {
      suppliers: suppliers.map((s) => ({
        _id: s.id,
        name: s.name,
        email: s.email ?? "",
        phone: s.phone ?? "",
        taxPin: s.taxPin ?? "",
        address: [s.addressLine1, s.city].filter(Boolean).join(", "),
      })),
      products: products.map((p) => ({
        _id: p.id,
        name: p.name,
        SKU: p.sku,
        unit: p.unit ?? "pcs",
        costing: { costPrice: p.costPrice, lastPurchaseCost: p.lastPurchaseCost },
        inventory: {
          quantityOnHand: p.quantityOnHand,
          quantityAvailable: p.quantityAvailable,
        },
      })),
      // An order line charges an expense or an asset, the same pair a bill line
      // is restricted to — anything else means somebody picked a revenue or
      // equity account for a purchase.
      accounts: accounts
        .filter((a) => a.accountType === "expense" || a.accountType === "asset")
        .map((a) => ({
          _id: a.id,
          accountCode: a.accountCode,
          accountName: a.accountName,
          accountType: a.accountType,
        })),
    };
  });
}

export async function listPurchaseOrdersPg(
  filters: purchaseOrders.ListPurchaseOrdersFilters = {},
  page = 1,
  pageSize = 20,
) {
  return withAuthorizedTenant([], (tx) =>
    purchaseOrders.listPurchaseOrders(tx, filters, page, pageSize),
  );
}

export async function countPurchaseOrdersPg(
  filters: purchaseOrders.ListPurchaseOrdersFilters = {},
) {
  return withAuthorizedTenant([], (tx) =>
    purchaseOrders.countPurchaseOrders(tx, filters),
  );
}

export async function getPurchaseOrderDetailPg(purchaseOrderId: string) {
  return withAuthorizedTenant([], (tx) =>
    purchaseOrders.getPurchaseOrderDetail(tx, purchaseOrderId),
  );
}

/** The order as the detail page and the PDF render it. */
export async function getPurchaseOrderForDisplayPg(purchaseOrderId: string) {
  return withAuthorizedTenant([], (tx) =>
    purchaseOrders.getPurchaseOrderForDisplay(tx, purchaseOrderId),
  );
}

/** The list rows, in the shape POTable reads. */
export async function listPurchaseOrdersForDisplayPg(
  filters: purchaseOrders.ListPurchaseOrdersFilters = {},
  page = 1,
  pageSize = 20,
) {
  return withAuthorizedTenant([], (tx) =>
    purchaseOrders.listPurchaseOrdersForDisplay(tx, filters, page, pageSize),
  );
}

export async function getPurchaseOrderStatsPg(
  filters: purchaseOrders.ListPurchaseOrdersFilters = {},
) {
  return withAuthorizedTenant([], (tx) =>
    purchaseOrders.getPurchaseOrderStats(tx, filters),
  );
}

const PAGE_SIZE = 20;

/**
 * The list page's query, in the shape POServerComponents calls it.
 *
 * `searchPurchaseOrders(query, page, filters)` in the Mongo queries; kept as
 * the same three arguments so the component does not change.
 */
export async function searchPurchaseOrdersPg(
  query = "",
  page = 1,
  filters: purchaseOrders.ListPurchaseOrdersFilters = {},
) {
  return withAuthorizedTenant([], (tx) =>
    purchaseOrders.listPurchaseOrdersForDisplay(
      tx,
      { ...filters, search: query || null },
      page,
      PAGE_SIZE,
    ),
  );
}

/** Total PAGES, which is what the pagination component takes. */
export async function countPurchaseOrderPagesPg(
  query = "",
  filters: purchaseOrders.ListPurchaseOrdersFilters = {},
) {
  const total = await withAuthorizedTenant([], (tx) =>
    purchaseOrders.countPurchaseOrders(tx, { ...filters, search: query || null }),
  );
  return Math.ceil(total / PAGE_SIZE);
}

/**
 * The stat cards and the filter counts, keyed as the components read them.
 *
 * `partial` and `received` are counts of a DERIVED state now — the receipt
 * progress that 0049 stopped storing as a status — so they are computed in the
 * same aggregate rather than looked up. `open` is what is still expected in:
 * sent or confirmed, and not yet complete.
 */
export async function getPurchaseOrderStatsForDisplayPg(
  filters: purchaseOrders.ListPurchaseOrdersFilters = {},
) {
  const raw = (await withAuthorizedTenant([], (tx) =>
    purchaseOrders.getPurchaseOrderStats(tx, filters),
  )) as Record<string, string | number> | null;

  const n = (k: string) => Number(raw?.[k] ?? 0);
  return {
    total: n("total"),
    draft: n("draft"),
    sent: n("sent"),
    confirmed: n("confirmed"),
    cancelled: n("cancelled"),
    closed: n("closed"),
    expired: n("expired"),
    partial: n("partially_received"),
    received: n("fully_received"),
    open: n("sent") + n("confirmed") - n("fully_received"),
    totalValue: Number(raw?.total_value ?? 0),
    openValue: Number(raw?.open_value ?? 0),
    // The cards show a value beside each receipt state; the aggregate carries
    // the order totals, and splitting THOSE by receipt state would mean
    // valuing part-delivered lines, which is what gr_ir_open_items is for.
    partialValue: 0,
    receivedValue: 0,
  };
}

export async function getOpenPurchaseOrdersPg(supplierId?: string | null) {
  return withAuthorizedTenant([], (tx) =>
    purchaseOrders.getOpenPurchaseOrders(tx, supplierId ?? null),
  );
}

/** Open orders and what is still to arrive on each — for the receipt form. */
export async function getOpenPurchaseOrdersWithLinesPg(
  supplierId?: string | null,
) {
  return withAuthorizedTenant([], (tx) =>
    purchaseOrders.getOpenPurchaseOrdersWithLines(tx, supplierId ?? null),
  );
}

export async function getOverduePurchaseOrdersPg() {
  return withAuthorizedTenant([], (tx) =>
    purchaseOrders.getOverduePurchaseOrders(tx),
  );
}

export async function getExpiringPurchaseOrdersPg(daysAhead = 7) {
  return withAuthorizedTenant([], (tx) =>
    purchaseOrders.getExpiringPurchaseOrders(tx, daysAhead),
  );
}

// ── The procurement dashboard ───────────────────────────────────────────────
//
// Three reads the dashboard made against Mongo while every figure beside them
// came from Postgres. Ported together because they are one screen.
//
// Two corrections come with them. `totalAmount` does not exist on the Mongo
// purchase order — the field is `amounts.total` — so the recent-orders list and
// the supplier spend table have been summing `undefined || 0` and reporting
// zero. And "partial deliveries" counted a STATUS that 0049 removed, because it
// was a stored value computed from the counter with two writers; it is read
// from the receipts now.

export async function getProcurementSummaryPg() {
  try {
    const row = await withAuthorizedTenant([...PROCUREMENT_ROLES], async (tx) => {
      const [result] = (await tx.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM purchase_orders
            WHERE status IN ('sent', 'confirmed'))::int              AS open_pos,
          (SELECT COUNT(*) FROM purchase_order_state
            WHERE receipt_state = 'partial')::int                    AS partial_pos,
          (SELECT COUNT(*) FROM bills
            WHERE status IN ('draft', 'submitted'))::int             AS pending_bills,
          (SELECT COALESCE(SUM(total), 0) FROM bills
            WHERE status NOT IN ('draft', 'rejected', 'cancelled')
              AND bill_date >= date_trunc('month', CURRENT_DATE))    AS mtd_spend,
          (SELECT COUNT(*) FROM parties
            WHERE is_supplier = true AND is_active = true)::int      AS active_suppliers,
          (SELECT COUNT(*) FROM products
            WHERE is_active = true
              AND reorder_level > 0
              AND quantity_on_hand <= reorder_level)::int            AS low_stock_count
      `)) as unknown as Array<Record<string, any>>;
      return result;
    });

    return {
      success: true as const,
      openPOs: Number(row?.open_pos ?? 0),
      partialPOs: Number(row?.partial_pos ?? 0),
      pendingBills: Number(row?.pending_bills ?? 0),
      mtdSpend: Number(row?.mtd_spend ?? 0),
      activeSuppliers: Number(row?.active_suppliers ?? 0),
      lowStockCount: Number(row?.low_stock_count ?? 0),
    };
  } catch (err) {
    return { success: false as const, error: userMessage(err, "Could not load the summary.") };
  }
}

export async function getRecentPurchaseOrdersPg(limit = 8) {
  try {
    const rows = await withAuthorizedTenant([...PROCUREMENT_ROLES], async (tx) =>
      (await tx.execute(sql`
        SELECT po.id, po.po_number, po.po_date::text AS po_date,
               po.status, po.total::text AS total, po.supplier_name,
               po.expected_delivery_date::text AS expected_delivery_date,
               st.is_expired, st.receipt_state
          FROM purchase_orders po
          JOIN purchase_order_state st ON st.purchase_order_id = po.id
         WHERE po.status <> 'cancelled'
         ORDER BY po.po_date DESC, po.po_number DESC
         LIMIT ${Math.min(limit, 50)}
      `)) as unknown as Array<Record<string, any>>,
    );

    return {
      success: true as const,
      rows: rows.map((r) => ({
        _id: r.id,
        poNumber: r.po_number,
        poDate: r.po_date,
        status: purchaseOrders.displayStatus(r),
        totalAmount: Number(r.total),
        supplierName: r.supplier_name ?? "—",
        expectedDeliveryDate: r.expected_delivery_date,
      })),
    };
  } catch (err) {
    return {
      success: false as const,
      error: userMessage(err, "Could not load recent orders."),
      rows: [] as Array<Record<string, unknown>>,
    };
  }
}

export async function getTopSuppliersBySpendPg(limit = 6) {
  try {
    const rows = await withAuthorizedTenant([...PROCUREMENT_ROLES], async (tx) =>
      (await tx.execute(sql`
        SELECT b.supplier_id,
               MAX(b.supplier_name_at_bill) AS supplier_name,
               SUM(b.total)                 AS total,
               COUNT(*)::int                AS bill_count
          FROM bills b
         WHERE b.status NOT IN ('draft', 'rejected', 'cancelled')
           AND b.bill_date >= CURRENT_DATE - INTERVAL '1 year'
         GROUP BY b.supplier_id
         ORDER BY SUM(b.total) DESC
         LIMIT ${Math.min(limit, 50)}
      `)) as unknown as Array<Record<string, any>>,
    );

    return {
      success: true as const,
      rows: rows.map((r) => ({
        supplierId: r.supplier_id,
        supplierName: r.supplier_name ?? "—",
        total: Number(r.total),
        billCount: Number(r.bill_count),
      })),
    };
  } catch (err) {
    return {
      success: false as const,
      error: userMessage(err, "Could not load supplier spend."),
      rows: [] as Array<Record<string, unknown>>,
    };
  }
}

export async function getAvailablePurchaseOrderLinesPg(purchaseOrderId: string) {
  return withAuthorizedTenant([], (tx) =>
    purchaseOrders.getAvailableLines(tx, purchaseOrderId),
  );
}
