"use server";

import { formatAddress } from "@/lib/format-address";
import Quote from "@/app/models/quote";
import Party from "@/app/models/parties";
import Product from "@/app/models/product";
import Company from "@/app/models/Company";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import {
  getTenantContext,
  getCompanyIdForCreate,
  withTenantScope,
  buildTenantMatch,
} from "@/lib/utils/tenant-utils";
import { sendQuoteEmail } from "@/lib/email";

// ============================================
// HELPER: Format user for audit
// ============================================
function formatUser({ user }) {
  return {
    name: user?.name || "Unknown",
    id: user?.id || "unknown",
  };
}

// ============================================
// CREATE QUOTE
// ============================================
export async function createQuote(prevState, formData) {
  // Auth check with tenant context
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }

  // Get tenant companyId for create
  let tenantCompanyId;
  try {
    tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }

  const dbConnect = (await import("@/app/config/dbConnect")).default;
  await dbConnect();

  try {
    // Parse form data
    const data = JSON.parse(formData.get("data"));

    // Validate customer (tenant-scoped)
    let customerData;
    if (data.customerId) {
      const customer = await Party.findOne(
        withTenantScope({ _id: data.customerId }, tenantCompanyId, isSuperAdmin)
      );
      if (customer) {
        customerData = {
          partyId: customer._id,
          id: customer._id.toString(),
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          address: formatAddress(customer.address),
          taxPin: customer.taxPin,
        };
      }
    }

    // Fallback to direct customer data
    if (!customerData && data.customer) {
      customerData = {
        id: data.customer.id,
        name: data.customer.name,
        email: data.customer.email,
        phone: data.customer.phone,
        address: formatAddress(data.customer.address),
        taxPin: data.customer.taxPin,
      };
    }

    if (!customerData || !customerData.name) {
      return {
        success: false,
        error: "Customer information is required",
        fieldErrors: { customerId: "Please select a customer" },
      };
    }

    // Validate items
    if (!data.items || data.items.length === 0) {
      return {
        success: false,
        error: "Quote must have at least one item",
      };
    }

    // Process items
    const processedItems = [];
    let lineNumber = 1;

    for (const item of data.items) {
      const processedItem = {
        lineNumber: lineNumber++,
        itemType: item.itemType || "product",
        ...(item.serviceCategory && { serviceCategory: item.serviceCategory }),
        description: item.description,
        quantity: parseFloat(item.quantity),
        unit: item.unit || "pcs",
        unitPrice: parseFloat(item.unitPrice),
        amount: parseFloat(item.quantity) * parseFloat(item.unitPrice),
        taxRate: parseFloat(item.taxRate || 16),
        taxAmount: 0,
        discountPercentage: parseFloat(item.discountPercentage || 0),
        discountAmount: 0,
        lineTotal: 0,
        invoicedQuantity: 0,
        invoices: [],
      };

      // Calculate discount
      if (processedItem.discountPercentage > 0) {
        processedItem.discountAmount =
          processedItem.amount * (processedItem.discountPercentage / 100);
      }

      // Adjust amount for discount
      const amountAfterDiscount =
        processedItem.amount - processedItem.discountAmount;

      // Calculate tax on discounted amount
      processedItem.taxAmount =
        amountAfterDiscount * (processedItem.taxRate / 100);

      // Line total
      processedItem.lineTotal = amountAfterDiscount + processedItem.taxAmount;

      // Adjust amount to be after discount (matching schema calculation)
      processedItem.amount = amountAfterDiscount;

      // Add product reference if provided (tenant-scoped)
      if (item.productId) {
        const product = await Product.findOne(
          withTenantScope({ _id: item.productId }, tenantCompanyId, isSuperAdmin)
        );
        if (product) {
          processedItem.product = {
            id: product._id,
            sku: product.SKU,
            name: product.name,
          };
        }
      }

      // Add related request if provided
      if (item.relatedRequest) {
        processedItem.relatedRequest = item.relatedRequest;
      }

      processedItems.push(processedItem);
    }

    // Calculate quote totals
    const subtotal = processedItems.reduce((sum, item) => sum + item.amount, 0);
    const totalDiscount = processedItems.reduce((sum, item) => sum + item.discountAmount, 0);
    const taxAmount = processedItems.reduce((sum, item) => sum + item.taxAmount, 0);
    const total = processedItems.reduce((sum, item) => sum + item.lineTotal, 0);

    // Generate quote number (tenant-scoped)
    const quoteNumber = await Quote.generateQuoteNumber(tenantCompanyId);

    // Calculate validity (default 30 days)
    const quoteDate = data.quoteDate ? new Date(data.quoteDate) : new Date();
    const validUntil = data.validUntil
      ? new Date(data.validUntil)
      : new Date(quoteDate.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Create quote with tenant companyId
    const quote = new Quote({
      companyId: tenantCompanyId,
      quoteNumber,
      quoteDate,
      validUntil,
      title: data.title || "",
      reference: data.reference || "",
      customer: customerData,
      salesPerson: data.salesPerson || null,
      items: processedItems,
      subtotal,
      totalDiscount,
      taxAmount,
      total,
      notes: data.notes,
      termsAndConditions: data.termsAndConditions,
      internalNotes: data.internalNotes,
      createdBy: formatUser({ user }),
      status: "draft",
    });

    await quote.save();

    revalidatePath("/dashboard/quotes");
    redirect(`/dashboard/quotes/${quote._id}`);
  } catch (error) {
    // Re-throw redirect errors (they're not actual errors)
    if (error?.digest?.startsWith("NEXT_REDIRECT")) {
      throw error;
    }
    console.error("Create quote error:", error);
    return {
      success: false,
      error: error.message || "Failed to create quote",
    };
  }
}

// ============================================
// UPDATE QUOTE
// ============================================
export async function updateQuote(quoteId, prevState, formData) {
  // Auth check with tenant context
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }

  const dbConnect = (await import("@/app/config/dbConnect")).default;
  await dbConnect();

  try {
    // Find quote with tenant scoping
    const quote = await Quote.findOne(
      withTenantScope({ _id: quoteId }, companyId, isSuperAdmin)
    );
    if (!quote) {
      return {
        success: false,
        error: "Quote not found",
      };
    }

    if (!quote.canEdit) {
      return {
        success: false,
        error: `Cannot edit quote in status: ${quote.status}`,
      };
    }

    const data = JSON.parse(formData.get("data"));

    // Update customer if changed (tenant-scoped)
    if (data.customerId) {
      const customer = await Party.findOne(
        withTenantScope({ _id: data.customerId }, companyId, isSuperAdmin)
      );
      if (customer) {
        quote.customer = {
          partyId: customer._id,
          id: customer._id.toString(),
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          address: formatAddress(customer.address),
          taxPin: customer.taxPin,
        };
      }
    }

    // Process items
    if (data.items && data.items.length > 0) {
      const processedItems = [];
      let lineNumber = 1;

      for (const item of data.items) {
        const processedItem = {
          lineNumber: lineNumber++,
          itemType: item.itemType || "product",
          description: item.description,
          quantity: parseFloat(item.quantity),
          unit: item.unit || "pcs",
          unitPrice: parseFloat(item.unitPrice),
          amount: parseFloat(item.quantity) * parseFloat(item.unitPrice),
          taxRate: parseFloat(item.taxRate || 16),
          taxAmount: 0,
          discountPercentage: parseFloat(item.discountPercentage || 0),
          discountAmount: 0,
          lineTotal: 0,
          invoicedQuantity: 0,
          invoices: [],
        };

        if (processedItem.discountPercentage > 0) {
          processedItem.discountAmount =
            processedItem.amount * (processedItem.discountPercentage / 100);
        }

        const amountAfterDiscount =
          processedItem.amount - processedItem.discountAmount;
        processedItem.taxAmount =
          amountAfterDiscount * (processedItem.taxRate / 100);
        processedItem.lineTotal = amountAfterDiscount + processedItem.taxAmount;
        processedItem.amount = amountAfterDiscount;

        // Product lookup (tenant-scoped)
        if (item.productId) {
          const product = await Product.findOne(
            withTenantScope({ _id: item.productId }, companyId, isSuperAdmin)
          );
          if (product) {
            processedItem.product = {
              id: product._id,
              sku: product.SKU,
              name: product.name,
            };
          }
        }

        if (item.relatedRequest) {
          processedItem.relatedRequest = item.relatedRequest;
        }

        processedItems.push(processedItem);
      }
      quote.items = processedItems;

      // Recalculate quote totals
      quote.subtotal = processedItems.reduce((sum, item) => sum + item.amount, 0);
      quote.totalDiscount = processedItems.reduce((sum, item) => sum + item.discountAmount, 0);
      quote.taxAmount = processedItems.reduce((sum, item) => sum + item.taxAmount, 0);
      quote.total = processedItems.reduce((sum, item) => sum + item.lineTotal, 0);
    }

    // Update other fields
    if (data.quoteDate) quote.quoteDate = new Date(data.quoteDate);
    if (data.validUntil) quote.validUntil = new Date(data.validUntil);
    if (data.salesPerson !== undefined) quote.salesPerson = data.salesPerson;
    if (data.title !== undefined) quote.title = data.title;
    if (data.reference !== undefined) quote.reference = data.reference;
    if (data.notes !== undefined) quote.notes = data.notes;
    if (data.termsAndConditions !== undefined) {
      quote.termsAndConditions = data.termsAndConditions;
    }
    if (data.internalNotes !== undefined) {
      quote.internalNotes = data.internalNotes;
    }

    quote.lastModifiedBy = formatUser({ user });

    await quote.save();

    revalidatePath("/dashboard/quotes");
    revalidatePath(`/dashboard/quotes/${quoteId}`);
    redirect(`/dashboard/quotes/${quoteId}`);
  } catch (error) {
    // Re-throw redirect errors (they're not actual errors)
    if (error?.digest?.startsWith("NEXT_REDIRECT")) {
      throw error;
    }
    console.error("Update quote error:", error);
    return {
      success: false,
      error: error.message || "Failed to update quote",
    };
  }
}

// ============================================
// SEND QUOTE TO CUSTOMER
// ============================================
export async function sendQuote(quoteId) {
  // Auth check with tenant context
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return { message: error.message };
  }

  const dbConnect = (await import("@/app/config/dbConnect")).default;
  await dbConnect();

  // Find quote with tenant scoping
  const quote = await Quote.findOne(
    withTenantScope({ _id: quoteId }, companyId, isSuperAdmin)
  );
  if (!quote) {
    return { message: "Quote not found" };
  }

  // Resolve customer email up-front so we don't flip status if we
  // can't actually email anyone.
  const customerParty = quote.customer?.partyId
    ? await Party.findById(quote.customer.partyId)
        .select("email name")
        .lean()
    : null;
  const customerEmail = customerParty?.email?.trim();
  if (!customerEmail) {
    return {
      message:
        "Customer has no email on file. Add an email to the customer record, then try again.",
    };
  }

  try {
    await quote.send(formatUser({ user }));
    quote.sentTo = customerEmail;
    await quote.save();
  } catch (error) {
    console.error("Send quote error:", error);
    return { message: error.message || "Failed to send quote" };
  }

  // Defer the PDF render + email send so the UI returns immediately.
  after(async () => {
    try {
      const [{ renderToBuffer }, { QuotePDF }, freshQuote, company] =
        await Promise.all([
          import("@react-pdf/renderer"),
          import("@/lib/pdf"),
          Quote.findById(quoteId).lean(),
          Company.findById(quote.companyId)
            .select("name email phone address bankName accountNumber settings")
            .lean(),
        ]);
      if (!freshQuote) return;

      const pdfBuffer = await renderToBuffer(
        QuotePDF({ quote: freshQuote, company }),
      );

      await sendQuoteEmail({
        to: customerEmail,
        replyTo: company?.email || undefined,
        customerName: customerParty?.name || quote.customer?.name,
        senderCompany: company?.name || "Our Company",
        quoteNumber: quote.quoteNumber,
        quoteDate: quote.quoteDate,
        validUntil: quote.validUntil,
        total: quote.amounts?.total || 0,
        currency: company?.settings?.currency || "KES",
        pdfBuffer,
      });

      await Quote.findByIdAndUpdate(quoteId, {
        $set: { deliveredAt: new Date(), lastDeliveryError: null },
        $inc: { deliveryAttempts: 1 },
      });
      revalidatePath(`/dashboard/quotes/${quoteId}`);
    } catch (err) {
      console.error("[sendQuote] email dispatch failed:", err);
      await Quote.findByIdAndUpdate(quoteId, {
        $set: { lastDeliveryError: err.message || "Email send failed" },
        $inc: { deliveryAttempts: 1 },
      });
      revalidatePath(`/dashboard/quotes/${quoteId}`);
    }
  });

  revalidatePath("/dashboard/quotes");
  revalidatePath(`/dashboard/quotes/${quoteId}`);
  redirect(`/dashboard/quotes/${quoteId}`);
}

// ============================================
// ACCEPT QUOTE (Customer accepted)
// ============================================
export async function acceptQuote(quoteId) {
  // Auth check with tenant context
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return { message: error.message };
  }

  const dbConnect = (await import("@/app/config/dbConnect")).default;
  await dbConnect();

  // Find quote with tenant scoping
  const quote = await Quote.findOne(
    withTenantScope({ _id: quoteId }, companyId, isSuperAdmin)
  );
  if (!quote) {
    return { message: "Quote not found" };
  }

  try {
    await quote.accept(formatUser({ user }));
  } catch (error) {
    console.error("Accept quote error:", error);
    return { message: error.message || "Failed to accept quote" };
  }

  revalidatePath("/dashboard/quotes");
  revalidatePath(`/dashboard/quotes/${quoteId}`);
  redirect(`/dashboard/quotes/${quoteId}`);
}

// ============================================
// REJECT QUOTE
// ============================================
export async function rejectQuote(quoteId, reason = "") {
  // Auth check with tenant context
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return { message: error.message };
  }

  const dbConnect = (await import("@/app/config/dbConnect")).default;
  await dbConnect();

  // Find quote with tenant scoping
  const quote = await Quote.findOne(
    withTenantScope({ _id: quoteId }, companyId, isSuperAdmin)
  );
  if (!quote) {
    return { message: "Quote not found" };
  }

  try {
    await quote.reject(formatUser({ user }), reason || "Customer declined");
  } catch (error) {
    console.error("Reject quote error:", error);
    return { message: error.message || "Failed to reject quote" };
  }

  revalidatePath("/dashboard/quotes");
  revalidatePath(`/dashboard/quotes/${quoteId}`);
  redirect(`/dashboard/quotes/${quoteId}`);
}

// ============================================
// CANCEL QUOTE
// ============================================
export async function cancelQuote(quoteId, reason = "") {
  // Auth check with tenant context
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return { message: error.message };
  }

  const dbConnect = (await import("@/app/config/dbConnect")).default;
  await dbConnect();

  // Find quote with tenant scoping
  const quote = await Quote.findOne(
    withTenantScope({ _id: quoteId }, companyId, isSuperAdmin)
  );
  if (!quote) {
    return { message: "Quote not found" };
  }

  try {
    await quote.cancel(formatUser({ user }), reason || `Cancelled by ${user.name}`);
  } catch (error) {
    console.error("Cancel quote error:", error);
    return { message: error.message || "Failed to cancel quote" };
  }

  revalidatePath("/dashboard/quotes");
  revalidatePath(`/dashboard/quotes/${quoteId}`);
  redirect("/dashboard/quotes");
}

// ============================================
// CONVERT QUOTE TO INVOICE
// ============================================
export async function convertQuoteToInvoice(quoteId, prevState, formData) {
  // Auth check with tenant context
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }

  const dbConnect = (await import("@/app/config/dbConnect")).default;
  await dbConnect();

  try {
    // Find quote with tenant scoping
    const quote = await Quote.findOne(
      withTenantScope({ _id: quoteId }, companyId, isSuperAdmin)
    );
    if (!quote) {
      return {
        success: false,
        error: "Quote not found",
      };
    }

    if (!quote.canConvertToInvoice) {
      return {
        success: false,
        error: `Cannot convert quote to invoice in status: ${quote.status}`,
      };
    }

    const data = JSON.parse(formData.get("data"));

    // Validate selected items
    if (!data.selectedItems || data.selectedItems.length === 0) {
      return {
        success: false,
        error: "Please select at least one item",
      };
    }

    const invoiceData = {
      companyId: quote.companyId, // Pass tenant companyId for the invoice
      invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : new Date(),
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      vatPercentage: data.vatPercentage || 16,
      notes: data.notes,
    };

    const invoice = await quote.convertToInvoice(
      data.selectedItems,
      invoiceData,
      formatUser({ user })
    );

    revalidatePath("/dashboard/quotes");
    revalidatePath(`/dashboard/quotes/${quoteId}`);
    revalidatePath("/dashboard/invoices");

    redirect(`/dashboard/invoices/${invoice._id}`);
  } catch (error) {
    // Re-throw redirect errors (they're not actual errors)
    if (error?.digest?.startsWith("NEXT_REDIRECT")) {
      throw error;
    }
    console.error("Convert quote to invoice error:", error);
    return {
      success: false,
      error: error.message || "Failed to convert quote to invoice",
    };
  }
}

// ============================================
// GET ACTIVE QUOTES FOR CUSTOMER
// ============================================
export async function getActiveQuotesForCustomer(customerId) {
  // Auth check with tenant context
  let companyId, isSuperAdmin;
  try {
    ({ companyId, isSuperAdmin } = await getTenantContext());
  } catch (error) {
    return { success: false, error: error.message, quotes: [] };
  }

  const dbConnect = (await import("@/app/config/dbConnect")).default;
  await dbConnect();

  try {
    // Get quotes with tenant scoping
    const quotes = await Quote.getQuotesWithAvailableItems(customerId, companyId, isSuperAdmin);

    // Serialize for client
    const serialized = quotes.map((quote) => ({
      _id: quote._id.toString(),
      quoteNumber: quote.quoteNumber,
      quoteDate: quote.quoteDate,
      validUntil: quote.validUntil,
      status: quote.status,
      total: quote.total,
      availableItems: quote.availableItems.map((item) => ({
        _id: item._id.toString(),
        itemType: item.itemType,
        product: item.product
          ? {
              id: item.product.id?.toString(),
              sku: item.product.sku,
              name: item.product.name,
            }
          : null,
        description: item.description,
        unit: item.unit,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
        discountPercentage: item.discountPercentage,
        quotedQuantity: item.quantity,
        invoicedQuantity: item.invoicedQuantity,
        availableQuantity: item.quantity - item.invoicedQuantity,
        relatedRequest: item.relatedRequest
          ? {
              requestId: item.relatedRequest.requestId?.toString(),
              requestNumber: item.relatedRequest.requestNumber,
              technicianName: item.relatedRequest.technicianName,
            }
          : null,
      })),
    }));

    return { success: true, quotes: serialized };
  } catch (error) {
    console.error("Get active quotes error:", error);
    return { success: false, error: error.message, quotes: [] };
  }
}

// ============================================
// GET QUOTE STATS
// ============================================
export async function getQuoteStats() {
  // Auth check with tenant context
  let companyId, isSuperAdmin;
  try {
    ({ companyId, isSuperAdmin } = await getTenantContext());
  } catch (error) {
    return { success: false, error: error.message };
  }

  const dbConnect = (await import("@/app/config/dbConnect")).default;
  await dbConnect();

  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const sevenDaysAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Build tenant match condition
    const tenantMatch = buildTenantMatch(companyId, isSuperAdmin);

    const [statusCounts, monthlyStats, expiringCount, conversionRate] =
      await Promise.all([
        // Count by status (tenant-scoped)
        Quote.aggregate([
          { $match: { ...tenantMatch, status: { $nin: ["cancelled"] } } },
          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
              total: { $sum: "$total" },
            },
          },
        ]),

        // This month stats (tenant-scoped)
        Quote.aggregate([
          {
            $match: {
              ...tenantMatch,
              quoteDate: { $gte: startOfMonth },
              status: { $ne: "cancelled" },
            },
          },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              totalValue: { $sum: "$total" },
            },
          },
        ]),

        // Expiring soon count (tenant-scoped)
        Quote.countDocuments(
          withTenantScope({
            status: { $in: ["draft", "sent"] },
            validUntil: { $gte: now, $lte: sevenDaysAhead },
          }, companyId, isSuperAdmin)
        ),

        // Conversion rate (this month, tenant-scoped)
        Quote.aggregate([
          {
            $match: {
              ...tenantMatch,
              quoteDate: { $gte: startOfMonth },
              status: { $ne: "cancelled" },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              converted: {
                $sum: {
                  $cond: [
                    { $in: ["$status", ["converted", "accepted"]] },
                    1,
                    0,
                  ],
                },
              },
            },
          },
          {
            $project: {
              rate: {
                $cond: [
                  { $eq: ["$total", 0] },
                  0,
                  {
                    $multiply: [{ $divide: ["$converted", "$total"] }, 100],
                  },
                ],
              },
            },
          },
        ]),
      ]);

    return {
      success: true,
      data: {
        byStatus: statusCounts,
        thisMonth: monthlyStats[0] || { count: 0, totalValue: 0 },
        expiringCount,
        conversionRate: conversionRate[0]?.rate || 0,
      },
    };
  } catch (error) {
    console.error("Get quote stats error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// DELETE QUOTE (Draft only)
// ============================================
export async function deleteQuote(quoteId) {
  // Auth check with tenant context
  let companyId, isSuperAdmin;
  try {
    ({ companyId, isSuperAdmin } = await getTenantContext());
  } catch (error) {
    return { success: false, error: error.message };
  }

  const dbConnect = (await import("@/app/config/dbConnect")).default;
  await dbConnect();

  try {
    // Find quote with tenant scoping
    const quote = await Quote.findOne(
      withTenantScope({ _id: quoteId }, companyId, isSuperAdmin)
    );
    if (!quote) {
      return { success: false, error: "Quote not found" };
    }

    if (quote.status !== "draft") {
      return {
        success: false,
        error: "Only draft quotes can be deleted. Cancel instead.",
      };
    }

    // Delete with tenant scoping
    await Quote.findOneAndDelete(
      withTenantScope({ _id: quoteId }, companyId, isSuperAdmin)
    );

    revalidatePath("/dashboard/quotes");

    return { success: true };
  } catch (error) {
    console.error("Delete quote error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// CLONE QUOTE
// ============================================
export async function cloneQuote(quoteId) {
  // Auth check with tenant context
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return { success: false, error: error.message };
  }

  const dbConnect = (await import("@/app/config/dbConnect")).default;
  await dbConnect();

  try {
    // Find original quote with tenant scoping
    const originalQuote = await Quote.findOne(
      withTenantScope({ _id: quoteId }, companyId, isSuperAdmin)
    ).lean();
    if (!originalQuote) {
      return { success: false, error: "Quote not found" };
    }

    // Generate new quote number (tenant-scoped)
    const quoteNumber = await Quote.generateQuoteNumber(originalQuote.companyId);

    // Create cloned quote with same tenant
    const newQuote = new Quote({
      companyId: originalQuote.companyId,
      quoteNumber,
      quoteDate: new Date(),
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      customer: originalQuote.customer,
      salesPerson: originalQuote.salesPerson,
      items: originalQuote.items.map((item) => ({
        ...item,
        _id: undefined,
        invoicedQuantity: 0,
        invoices: [],
      })),
      notes: originalQuote.notes,
      termsAndConditions: originalQuote.termsAndConditions,
      internalNotes: `Cloned from ${originalQuote.quoteNumber}`,
      createdBy: formatUser({ user }),
      status: "draft",
    });

    await newQuote.save();

    revalidatePath("/dashboard/quotes");

    return {
      success: true,
      quoteId: newQuote._id.toString(),
      quoteNumber: newQuote.quoteNumber,
    };
  } catch (error) {
    console.error("Clone quote error:", error);
    return { success: false, error: error.message };
  }
}
