"use server";

import { revalidatePath } from "next/cache";
import mongoose from "mongoose";

import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  withTenantScope,
  tenantFilter,
} from "@/lib/utils/tenant-utils";
import { safeErrorMessage } from "@/lib/safe-error";
import { canSeeSalesNav } from "@/lib/permissions";

import SalesOrder from "@/app/models/salesOrder";
import Quote from "@/app/models/quote";
import Product from "@/app/models/product";
import Invoice from "@/app/models/invoice";
import Company from "@/app/models/Company";
import { generateInvoiceNumber } from "@/app/mongodb/queries/invoice-queries";

// ============================================
// SALES ORDER — SERVER ACTIONS (slice 1)
// ============================================
//   createSalesOrderFromQuote — accepted quote → draft SO (no stock impact)
//   confirmSalesOrder         — draft → confirmed; commits stock atomically
//   cancelSalesOrder          — releases any held commitment; terminal
//   convertSalesOrderToInvoice— confirmed → draft Invoice; commitment
//                               ownership TRANSFERS to the invoice lines
//
// Commitment rule: exactly one line owns a reservation at a time. Confirm
// uses the same atomic conditional update draft invoices use (the $gte
// guard makes overselling impossible under concurrency). Conversion never
// touches Product counters — it flips the stockCommitted flags so the
// invoice's existing complete()/cancel()/expire() paths take over.

function userInfo(user) {
  return {
    id: user?.id || user?._id?.toString?.() || "system",
    name: user?.name || user?.email || "System",
    role: user?.role,
  };
}

function salesRoleGate(user) {
  if (!canSeeSalesNav(user?.role)) {
    return { success: false, error: "Not authorized for sales orders." };
  }
  return null;
}

// ============================================
// CREATE FROM QUOTE
// ============================================
export async function createSalesOrderFromQuote(quoteId) {
  try {
    if (!mongoose.Types.ObjectId.isValid(quoteId)) {
      return { success: false, error: "Invalid quote id" };
    }
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const denied = salesRoleGate(user);
    if (denied) return denied;

    const quote = await Quote.findOne(
      withTenantScope({ _id: quoteId }, companyId, isSuperAdmin),
    ).lean();
    if (!quote) return { success: false, error: "Quote not found" };
    if (!["accepted", "sent"].includes(quote.status)) {
      return {
        success: false,
        error: `Quote is ${quote.status}; only sent or accepted quotes can become orders.`,
      };
    }

    // One open order per quote — avoid duplicate commitments for one deal.
    const existing = await SalesOrder.findOne(
      withTenantScope(
        {
          "quoteRef.quoteId": quote._id,
          status: { $in: ["draft", "confirmed"] },
        },
        companyId,
        isSuperAdmin,
      ),
    )
      .select("orderNumber")
      .lean();
    if (existing) {
      return {
        success: false,
        error: `Order ${existing.orderNumber} is already open for this quote.`,
      };
    }

    const me = userInfo(user);
    const items = quote.items.map((q, i) => ({
      lineNumber: i + 1,
      itemType: q.itemType,
      product: q.product?.id
        ? { id: q.product.id, sku: q.product.sku, name: q.product.name }
        : undefined,
      description: q.description,
      quantity: q.quantity,
      unit: q.unit,
      unitPrice: q.unitPrice,
      amount: q.amount,
      taxRate: q.taxRate,
      taxAmount: q.taxAmount,
      discountPercentage: q.discountPercentage,
      discountAmount: q.discountAmount,
      lineTotal: q.lineTotal,
      stockCommitted: false,
      invoicedQuantity: 0,
    }));

    const orderNumber = await SalesOrder.generateOrderNumber(quote.companyId);
    const so = await SalesOrder.create({
      companyId: quote.companyId,
      orderNumber,
      orderDate: new Date(),
      customer: quote.customer,
      salesPerson: quote.salesPerson?.employeeId || quote.salesPerson?.name
        ? quote.salesPerson
        : undefined,
      quoteRef: { quoteId: quote._id, quoteNumber: quote.quoteNumber },
      items,
      subtotal: quote.subtotal,
      totalDiscount: quote.totalDiscount,
      taxAmount: quote.taxAmount,
      total: quote.total,
      currency: quote.currency,
      notes: quote.notes,
      status: "draft",
      createdBy: me,
      lastModifiedBy: me,
    });

    revalidatePath("/dashboard/sales-orders");
    revalidatePath(`/dashboard/quotes/${quoteId}`);
    return {
      success: true,
      data: { id: so._id.toString(), orderNumber },
    };
  } catch (error) {
    console.error("createSalesOrderFromQuote error:", error);
    return { success: false, error: safeErrorMessage(error, "Failed to create sales order") };
  }
}

// ============================================
// CONFIRM — commit stock, all-or-nothing
// ============================================
export async function confirmSalesOrder(orderId) {
  let session = null;
  try {
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return { success: false, error: "Invalid order id" };
    }
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const denied = salesRoleGate(user);
    if (denied) return denied;

    const tenantClause = tenantFilter(companyId, isSuperAdmin);

    session = await mongoose.startSession();
    session.startTransaction();

    const so = await SalesOrder.findOne(
      withTenantScope({ _id: orderId }, companyId, isSuperAdmin),
    ).session(session);
    if (!so) {
      await session.abortTransaction();
      return { success: false, error: "Sales order not found" };
    }
    if (so.status !== "draft") {
      await session.abortTransaction();
      return { success: false, error: `Order is already ${so.status}.` };
    }

    // Commit every product line with the same race-safe conditional update
    // draft invoices use: the $gte guard in the filter means two concurrent
    // confirmations of the last units cannot both succeed.
    for (const item of so.items) {
      if (item.itemType !== "product" || !item.product?.id) continue;

      const committed = await Product.findOneAndUpdate(
        {
          _id: item.product.id,
          ...tenantClause,
          "inventory.quantityAvailable": { $gte: item.quantity },
        },
        {
          $inc: {
            "inventory.quantityCommitted": item.quantity,
            "inventory.quantityAvailable": -item.quantity,
          },
        },
        { session, new: true },
      );

      if (!committed) {
        const fresh = await Product.findOne({
          _id: item.product.id,
          ...tenantClause,
        })
          .select("name inventory.quantityAvailable")
          .session(session)
          .lean();
        await session.abortTransaction();
        return {
          success: false,
          error: `Insufficient stock for ${fresh?.name || item.description}. Available: ${fresh?.inventory?.quantityAvailable ?? 0}, required: ${item.quantity}.`,
        };
      }
      item.stockCommitted = true;
    }

    const me = userInfo(user);
    so.status = "confirmed";
    so.confirmedAt = new Date();
    so.confirmedBy = { name: me.name, id: me.id };
    so.lastModifiedBy = me;
    await so.save({ session });

    await session.commitTransaction();

    revalidatePath("/dashboard/sales-orders");
    revalidatePath(`/dashboard/sales-orders/${orderId}`);
    revalidatePath("/dashboard/stocks");
    return { success: true };
  } catch (error) {
    if (session) {
      try {
        await session.abortTransaction();
      } catch {
        // already ended
      }
    }
    console.error("confirmSalesOrder error:", error);
    return { success: false, error: safeErrorMessage(error, "Failed to confirm order") };
  } finally {
    if (session) session.endSession();
  }
}

// ============================================
// CANCEL — release any held commitment
// ============================================
export async function cancelSalesOrder(orderId, reason = "") {
  let session = null;
  try {
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return { success: false, error: "Invalid order id" };
    }
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const denied = salesRoleGate(user);
    if (denied) return denied;

    session = await mongoose.startSession();
    session.startTransaction();

    const so = await SalesOrder.findOne(
      withTenantScope({ _id: orderId }, companyId, isSuperAdmin),
    ).session(session);
    if (!so) {
      await session.abortTransaction();
      return { success: false, error: "Sales order not found" };
    }
    if (!["draft", "confirmed"].includes(so.status)) {
      await session.abortTransaction();
      return { success: false, error: `Order is already ${so.status}; cannot cancel.` };
    }

    // Release whatever this order still owns.
    for (const item of so.items) {
      if (!item.stockCommitted || !item.product?.id) continue;
      await Product.updateOne(
        { _id: item.product.id },
        {
          $inc: {
            "inventory.quantityCommitted": -item.quantity,
            "inventory.quantityAvailable": item.quantity,
          },
        },
        { session },
      );
      item.stockCommitted = false;
    }

    const me = userInfo(user);
    so.status = "cancelled";
    so.cancelledAt = new Date();
    so.cancelledBy = { name: me.name, id: me.id };
    so.cancellationReason = String(reason || "").slice(0, 500);
    so.lastModifiedBy = me;
    await so.save({ session });

    await session.commitTransaction();

    revalidatePath("/dashboard/sales-orders");
    revalidatePath(`/dashboard/sales-orders/${orderId}`);
    revalidatePath("/dashboard/stocks");
    return { success: true };
  } catch (error) {
    if (session) {
      try {
        await session.abortTransaction();
      } catch {
        // already ended
      }
    }
    console.error("cancelSalesOrder error:", error);
    return { success: false, error: safeErrorMessage(error, "Failed to cancel order") };
  } finally {
    if (session) session.endSession();
  }
}

// ============================================
// CONVERT TO INVOICE — transfer commitment ownership
// ============================================
export async function convertSalesOrderToInvoice(orderId) {
  let session = null;
  try {
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return { success: false, error: "Invalid order id" };
    }
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const denied = salesRoleGate(user);
    if (denied) return denied;

    session = await mongoose.startSession();
    session.startTransaction();

    const so = await SalesOrder.findOne(
      withTenantScope({ _id: orderId }, companyId, isSuperAdmin),
    ).session(session);
    if (!so) {
      await session.abortTransaction();
      return { success: false, error: "Sales order not found" };
    }
    if (so.status !== "confirmed") {
      await session.abortTransaction();
      return {
        success: false,
        error: `Order is ${so.status}; confirm it before invoicing.`,
      };
    }

    const me = userInfo(user);

    // Build invoice lines. stockCommitted carries over 1:1 — the Product
    // counters are NOT touched; the invoice now owns the reservation and
    // its complete()/cancel()/expire() handle it exactly as today.
    const invoiceItems = so.items.map((item) => ({
      itemType: item.itemType,
      productId: item.product?.id,
      productSKU: item.product?.sku,
      productName: item.product?.name,
      description: item.description,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.amount,
      taxRate: item.taxRate,
      taxAmount: item.taxAmount,
      discountPercentage: item.discountPercentage,
      discountAmount: item.discountAmount,
      stockCommitted: item.stockCommitted === true,
    }));

    const invoiceNumber = await generateInvoiceNumber(so.companyId, session);
    const now = new Date();

    // Invoices holding committed stock carry draftExpiresAt so the expiry
    // sweep auto-releases stale reservations (same as createInvoice).
    const hasCommitted = invoiceItems.some((i) => i.stockCommitted);
    let draftExpiresAt = null;
    if (hasCommitted) {
      const company = await Company.findById(so.companyId)
        .select("settings.draftInvoiceExpiryDays")
        .session(session)
        .lean();
      const expiryDays = company?.settings?.draftInvoiceExpiryDays ?? 14;
      draftExpiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);
    }
    const [invoice] = await Invoice.create(
      [
        {
          companyId: so.companyId,
          invoiceNumber,
          invoiceDate: now,
          dueDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
          customer: {
            id: so.customer?.id || so.customer?.partyId?.toString?.(),
            name: so.customer?.name,
            email: so.customer?.email,
            phone: so.customer?.phone,
            address: so.customer?.address,
            taxPin: so.customer?.taxPin,
          },
          items: invoiceItems,
          subtotal: so.subtotal,
          totalDiscount: so.totalDiscount,
          taxAmount: so.taxAmount,
          total: so.total,
          amountDue: so.total,
          amountPaid: 0,
          paymentStatus: "unpaid",
          status: "draft",
          draftExpiresAt,
          quoteRef: so.quoteRef?.quoteId
            ? { quoteId: so.quoteRef.quoteId, quoteNumber: so.quoteRef.quoteNumber }
            : undefined,
          salesPerson: so.salesPerson?.employeeId || so.salesPerson?.name
            ? so.salesPerson
            : undefined,
          notes: `From sales order ${so.orderNumber}${so.notes ? ` — ${so.notes}` : ""}`,
          createdBy: { name: me.name, id: me.id },
        },
      ],
      { session },
    );

    // Hand off: the SO no longer owns any reservation.
    for (const item of so.items) {
      if (item.stockCommitted) item.stockCommitted = false;
      item.invoicedQuantity = item.quantity;
    }
    so.status = "invoiced";
    so.invoiceRef = {
      invoiceId: invoice._id,
      invoiceNumber,
      invoicedAt: now,
    };
    so.lastModifiedBy = me;
    await so.save({ session });

    await session.commitTransaction();

    revalidatePath("/dashboard/sales-orders");
    revalidatePath(`/dashboard/sales-orders/${orderId}`);
    revalidatePath("/dashboard/invoices");
    return {
      success: true,
      data: { invoiceId: invoice._id.toString(), invoiceNumber },
    };
  } catch (error) {
    if (session) {
      try {
        await session.abortTransaction();
      } catch {
        // already ended
      }
    }
    console.error("convertSalesOrderToInvoice error:", error);
    return { success: false, error: safeErrorMessage(error, "Failed to convert order to invoice") };
  } finally {
    if (session) session.endSession();
  }
}
