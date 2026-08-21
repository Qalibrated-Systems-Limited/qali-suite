"use server";

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

function parse<T extends { safeParse: (v: unknown) => any }>(
  schema: T,
  formData: FormData,
  key = "data",
) {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get(key) ?? "{}"));
  } catch {
    return { ok: false as const, error: "Could not read the form data" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  return { ok: true as const, data: parsed.data };
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
      (tx, { user, companyId }) =>
        purchaseOrders.createPurchaseOrder(tx, {
          companyId,
          ...toPurchaseOrderInput(parsed.data),
          createdById: user.id,
          createdByName: user.name,
        }),
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
      (tx, { user }) =>
        purchaseOrders.updatePurchaseOrder(tx, purchaseOrderId, {
          ...toPurchaseOrderInput(parsed.data),
          lastModifiedById: user.id,
          lastModifiedByName: user.name,
        }),
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
          parsed.data.selections.map((s) => ({
            purchaseOrderLineId: s.purchaseOrderLineId,
            quantity: s.quantity.toFixed(4),
          })),
          {
            billDate: parsed.data.billDate,
            dueDate: parsed.data.dueDate,
            supplierInvoiceNumber: parsed.data.supplierInvoiceNumber ?? null,
            description: parsed.data.description ?? null,
            internalNotes: parsed.data.internalNotes ?? null,
            defaultAccountId: parsed.data.defaultAccountId ?? null,
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

export async function getPurchaseOrderStatsPg(
  filters: purchaseOrders.ListPurchaseOrdersFilters = {},
) {
  return withAuthorizedTenant([], (tx) =>
    purchaseOrders.getPurchaseOrderStats(tx, filters),
  );
}

export async function getOpenPurchaseOrdersPg(supplierId?: string | null) {
  return withAuthorizedTenant([], (tx) =>
    purchaseOrders.getOpenPurchaseOrders(tx, supplierId ?? null),
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

export async function getAvailablePurchaseOrderLinesPg(purchaseOrderId: string) {
  return withAuthorizedTenant([], (tx) =>
    purchaseOrders.getAvailableLines(tx, purchaseOrderId),
  );
}
