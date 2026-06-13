import "server-only";
import { cache } from "react";
import mongoose from "mongoose";

import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  withTenantScope,
  buildTenantMatch,
} from "@/lib/utils/tenant-utils";
import SalesOrder from "@/app/models/salesOrder";

// ============================================
// SALES ORDER QUERIES — cached, request-scoped
// ============================================

function serializeLine(i) {
  return {
    _id: i._id?.toString?.(),
    lineNumber: i.lineNumber,
    itemType: i.itemType,
    product: i.product?.id
      ? { id: i.product.id.toString(), sku: i.product.sku || "", name: i.product.name || "" }
      : null,
    description: i.description,
    quantity: i.quantity,
    unit: i.unit,
    unitPrice: i.unitPrice,
    amount: i.amount || 0,
    taxAmount: i.taxAmount || 0,
    lineTotal: i.lineTotal,
    stockCommitted: !!i.stockCommitted,
    invoicedQuantity: i.invoicedQuantity || 0,
  };
}

function serializeOrder(r, withItems = false) {
  return {
    _id: r._id.toString(),
    orderNumber: r.orderNumber,
    status: r.status,
    orderDate: r.orderDate?.toISOString?.() ?? null,
    expectedDeliveryDate: r.expectedDeliveryDate?.toISOString?.() ?? null,
    customer: {
      partyId: r.customer?.partyId?.toString?.() ?? null,
      name: r.customer?.name || "",
      email: r.customer?.email || "",
      phone: r.customer?.phone || "",
      address: r.customer?.address || "",
      taxPin: r.customer?.taxPin || "",
    },
    salesPerson: r.salesPerson?.name ? { name: r.salesPerson.name } : null,
    quoteRef: r.quoteRef?.quoteId
      ? { quoteId: r.quoteRef.quoteId.toString(), quoteNumber: r.quoteRef.quoteNumber || "" }
      : null,
    invoiceRef: r.invoiceRef?.invoiceId
      ? {
          invoiceId: r.invoiceRef.invoiceId.toString(),
          invoiceNumber: r.invoiceRef.invoiceNumber || "",
        }
      : null,
    itemCount: r.items?.length || 0,
    subtotal: r.subtotal || 0,
    totalDiscount: r.totalDiscount || 0,
    taxAmount: r.taxAmount || 0,
    total: r.total || 0,
    currency: r.currency || "KES",
    notes: r.notes || "",
    cancellationReason: r.cancellationReason || "",
    confirmedAt: r.confirmedAt?.toISOString?.() ?? null,
    createdBy: { name: r.createdBy?.name || "" },
    createdAt: r.createdAt?.toISOString?.() ?? null,
    ...(withItems ? { items: (r.items || []).map(serializeLine) } : {}),
  };
}

/**
 * List sales orders, newest first. Optional status filter; capped at 100.
 * Projection drops line items — the list never renders them.
 */
export const cSalesOrders = cache(async (status = "") => {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    const filter = withTenantScope(
      status ? { status } : {},
      companyId,
      isSuperAdmin,
    );

    const rows = await SalesOrder.find(filter)
      .select("-items.product -items.description") // keep payload light; itemCount still works
      .sort({ orderDate: -1 })
      .limit(100)
      .lean();

    return rows.map((r) => serializeOrder(r, false));
  } catch (error) {
    console.error("cSalesOrders error:", error);
    return [];
  }
});

/**
 * One order, fully serialized for the detail page.
 */
export const cSalesOrder = cache(async (id) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    const r = await SalesOrder.findOne(
      withTenantScope({ _id: id }, companyId, isSuperAdmin),
    ).lean();
    if (!r) return null;
    return serializeOrder(r, true);
  } catch (error) {
    console.error("cSalesOrder error:", error);
    return null;
  }
});

/**
 * Order backlog — confirmed (committed, not yet invoiced) revenue. The
 * headline number sales orders exist to provide.
 */
export const cOrderBacklog = cache(async () => {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    const rows = await SalesOrder.aggregate([
      { $match: { ...buildTenantMatch(companyId, isSuperAdmin), status: "confirmed" } },
      { $group: { _id: null, count: { $sum: 1 }, total: { $sum: "$total" } } },
    ]);

    return { count: rows[0]?.count || 0, total: rows[0]?.total || 0 };
  } catch (error) {
    console.error("cOrderBacklog error:", error);
    return { count: 0, total: 0 };
  }
});
