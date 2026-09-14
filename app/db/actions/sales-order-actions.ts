"use server";

import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import * as salesOrdersRepo from "../repositories/salesOrders";
import { rolesFor } from "@/lib/capabilities";

/**
 * Sales order actions on Postgres — 0098.
 *
 * `lib/unported-modules.js` switched this module off with four failures
 * listed: an ObjectId check on a uuid, a read of the Mongo Quote collection, a
 * stock commitment against Mongo Product counters, and an `Invoice.create`
 * that wrote a Mongo invoice while every invoice screen read Postgres. That
 * note observed that relaxing the id check alone would move the failure from
 * step one to step four, where it is invisible. All four are gone here, and
 * the flag with them.
 *
 * RESULT SHAPES ARE THE SCREENS' — `{ success, data }` with `_id`,
 * `customer.name`, `quoteRef`, `invoiceRef`, `items[].stockCommitted` — so the
 * three screens move over by changing an import path.
 *
 * WHO MAY DO WHAT — AND VIEWER MAY NOT, WHICH IS A CHANGE.
 *
 * All four Mongo actions gated on `canSeeSalesNav`, a NAV predicate whose list
 * includes "Viewer". So a Viewer — the read-only role CEO became in 0039 —
 * could confirm an order and reserve stock, or cancel one and release it. A
 * navigation gate answers "may this person see the menu", and it was being
 * asked "may this person move inventory".
 *
 * The list below is `canSeeSalesNav` minus Viewer, spelled out rather than
 * called: `withAuthorizedTenant` re-checks it against the role for the ACTIVE
 * company, which a helper reading only the session role cannot do. Reads stay
 * open to anyone who can see the module, which is what the nav gate is for.
 */

const SALES_ROLES = rolesFor("salesorder.write");

type ActionResult<T = unknown> =
  | { success: true; data?: T }
  | { success: false; error: string };

function revalidateOrders(orderId?: string | null) {
  revalidatePath("/dashboard/sales-orders");
  revalidatePath("/dashboard/executive");
  if (orderId) revalidatePath(`/dashboard/sales-orders/${orderId}`);
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function getSalesOrdersPg(status = "") {
  return withAuthorizedTenant([], (tx) =>
    salesOrdersRepo.listSalesOrders(tx, status || null),
  );
}

export async function getSalesOrderPg(id: string) {
  if (!id) return null;
  return withAuthorizedTenant([], (tx) =>
    salesOrdersRepo.getSalesOrder(tx, id),
  );
}

/**
 * Confirmed revenue that is not yet billed.
 *
 * Degrades to zeroes rather than taking the page down: the executive overview
 * reads this beside figures that come from the ledger, and one tile failing
 * should not blank the rest. The same reasoning `getPipelineTotalPg` gives.
 */
export async function getOrderBacklogPg() {
  try {
    return await withAuthorizedTenant([], (tx) =>
      salesOrdersRepo.getOrderBacklog(tx),
    );
  } catch {
    return { count: 0, total: 0 };
  }
}

/** The orders raised against one quote — for the quote's detail page. */
export async function getOrdersForQuotePg(quoteId: string) {
  if (!quoteId) return [];
  try {
    return await withAuthorizedTenant([], (tx) =>
      salesOrdersRepo.listOrdersForQuote(tx, quoteId),
    );
  } catch {
    return [];
  }
}

// ── Transitions ─────────────────────────────────────────────────────────────

export async function createSalesOrderFromQuote(
  quoteId: string,
): Promise<ActionResult<{ id: string; orderNumber: string }>> {
  try {
    const order = await withAuthorizedTenant(SALES_ROLES, (tx, { user }) =>
      salesOrdersRepo.createFromQuote(tx, quoteId, {
        id: user.id,
        name: user.name ?? "System",
      }),
    );

    revalidateOrders(order._id);
    revalidatePath(`/dashboard/quotes/${quoteId}`);
    return {
      success: true,
      data: { id: order._id, orderNumber: order.orderNumber },
    };
  } catch (error) {
    return {
      success: false,
      error: userMessage(error, "Failed to create sales order"),
    };
  }
}

/**
 * Draft → confirmed, reserving the stock.
 *
 * Also revalidates the stock screens: the reservation changes what those pages
 * report as available, and the Mongo action revalidated them for the same
 * reason.
 */
export async function confirmSalesOrder(
  orderId: string,
): Promise<ActionResult> {
  try {
    await withAuthorizedTenant(SALES_ROLES, (tx, { user }) =>
      salesOrdersRepo.confirmSalesOrder(tx, orderId, {
        id: user.id,
        name: user.name ?? null,
      }),
    );
    revalidateOrders(orderId);
    revalidatePath("/dashboard/stocks");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: userMessage(error, "Failed to confirm order"),
    };
  }
}

export async function cancelSalesOrder(
  orderId: string,
  reason: string | null = null,
): Promise<ActionResult> {
  try {
    await withAuthorizedTenant(SALES_ROLES, (tx, { user }) =>
      salesOrdersRepo.cancelSalesOrder(tx, orderId, reason, {
        id: user.id,
        name: user.name ?? null,
      }),
    );
    revalidateOrders(orderId);
    revalidatePath("/dashboard/stocks");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: userMessage(error, "Failed to cancel order"),
    };
  }
}

export async function convertSalesOrderToInvoice(
  orderId: string,
): Promise<ActionResult<{ invoiceId: string; invoiceNumber: string }>> {
  try {
    const result = await withAuthorizedTenant(SALES_ROLES, (tx, { user }) =>
      salesOrdersRepo.convertToInvoice(tx, orderId, {
        actorId: user.id,
        actorName: user.name ?? null,
        actorRole: user.role ?? null,
      }),
    );

    revalidateOrders(orderId);
    revalidatePath("/dashboard/invoices");
    revalidatePath("/dashboard/quotes");
    revalidatePath("/dashboard/stocks");
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: userMessage(error, "Failed to convert order to invoice"),
    };
  }
}
