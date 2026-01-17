"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

import PurchaseOrder from "@/app/models/purchas-order";
import Party from "@/app/models/parties";
import Product from "@/app/models/product";
import { z } from "zod";
import dbConnect from "@/app/config/dbConnect";
dbConnect();

// ============================================
// VALIDATION SCHEMAS
// ============================================
const POItemSchema = z.object({
  productId: z.string().optional(),
  productSKU: z.string().optional(),
  productName: z.string().optional(),
  description: z.string().min(1, "Description is required"),
  unit: z.string().default("pcs"),
  quantity: z.coerce.number().positive("Quantity must be positive"),
  unitPrice: z.coerce.number().min(0, "Unit price cannot be negative"),
  taxRate: z.coerce.number().min(0).max(100).default(16),
});

const CreatePOSchema = z.object({
  supplierId: z.string().min(1, "Supplier is required"),
  poDate: z.coerce.date(),
  expectedDeliveryDate: z.coerce.date().optional().nullable(),
  items: z.array(POItemSchema).min(1, "At least one item is required"),
  notes: z.string().optional(),
  internalNotes: z.string().optional(),
  deliveryAddress: z
    .object({
      line1: z.string().optional(),
      line2: z.string().optional(),
      city: z.string().optional(),
      postalCode: z.string().optional(),
      contactPerson: z.string().optional(),
      contactPhone: z.string().optional(),
    })
    .optional(),
  paymentTermsDays: z.coerce.number().min(0).default(30),
});

const ReceiveItemsSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        quantity: z.coerce.number().positive(),
      })
    )
    .min(1, "At least one item must be received"),
  notes: z.string().optional(),
});

// ============================================
// HELPER: Format user for audit
// ============================================
function formatUser(session) {
  return {
    name: session?.user?.name || "Unknown",
    id: session?.user?.id || "unknown",
  };
}

// ============================================
// HELPER: Parse form data to object
// ============================================
function parseFormData(formData) {
  const data = {};

  for (const [key, value] of formData.entries()) {
    // Handle nested keys like "deliveryAddress.city"
    if (key.includes(".")) {
      const parts = key.split(".");
      let current = data;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) current[parts[i]] = {};
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = value;
    }
    // Handle array items like "items[0].description"
    else if (key.includes("[")) {
      const match = key.match(/^(\w+)\[(\d+)\]\.?(.*)$/);
      if (match) {
        const [, arrayName, index, prop] = match;
        if (!data[arrayName]) data[arrayName] = [];
        if (!data[arrayName][index]) data[arrayName][index] = {};
        if (prop) {
          data[arrayName][index][prop] = value;
        } else {
          data[arrayName][index] = value;
        }
      }
    } else {
      data[key] = value;
    }
  }

  return data;
}

// ============================================
// CREATE PURCHASE ORDER
// ============================================
export async function createPurchaseOrder(prevState, formData) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    // Parse form data
    const rawData = parseFormData(formData);

    // Validate
    const validationResult = CreatePOSchema.safeParse(rawData);
    if (!validationResult.success) {
      const errors = validationResult.error.flatten();
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: errors.fieldErrors,
      };
    }

    const data = validationResult.data;

    // Get supplier details
    const supplier = await Party.findById(data.supplierId).lean();
    if (!supplier) {
      return { success: false, error: "Supplier not found" };
    }

    if (!supplier.isActive) {
      return { success: false, error: "Supplier is inactive" };
    }

    // Process items - fetch product details if productId provided
    const processedItems = await Promise.all(
      data.items.map(async (item) => {
        let productData = {};

        if (item.productId) {
          const product = await Product.findById(item.productId).lean();
          if (product) {
            productData = {
              productId: product._id,
              productSKU: product.SKU,
              productName: product.name,
              unit: product.unit || item.unit,
            };
          }
        }

        const amount = item.quantity * item.unitPrice;
        const taxAmount = (amount * item.taxRate) / 100;

        return {
          ...productData,
          description: item.description,
          unit: productData.unit || item.unit || "pcs",
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount,
          taxRate: item.taxRate,
          taxAmount,
          lineTotal: amount + taxAmount,
          receivedQuantity: 0,
          pendingQuantity: item.quantity,
          status: "pending",
        };
      })
    );

    // Calculate totals
    const subtotal = processedItems.reduce((sum, item) => sum + item.amount, 0);
    const taxAmount = processedItems.reduce(
      (sum, item) => sum + item.taxAmount,
      0
    );
    const total = subtotal + taxAmount;

    // Generate PO number
    const poNumber = await PurchaseOrder.generatePONumber();

    // Create PO
    const po = new PurchaseOrder({
      poNumber,
      poDate: data.poDate,
      expectedDeliveryDate: data.expectedDeliveryDate || null,
      supplier: {
        id: supplier._id.toString(),
        partyId: supplier._id,
        name: supplier.name,
        email: supplier.email,
        phone: supplier.phone,
        address: supplier.address
          ? `${supplier.address.line1 || ""} ${supplier.address.city || ""}`
          : "",
        taxPin: supplier.taxPin,
      },
      deliveryAddress: data.deliveryAddress || {},
      items: processedItems,
      subtotal,
      taxAmount,
      total,
      currency: "KES",
      status: "draft",
      notes: data.notes,
      internalNotes: data.internalNotes,
      paymentTerms: {
        termsDays: data.paymentTermsDays,
        description: `Net ${data.paymentTermsDays}`,
      },
      createdBy: formatUser(session),
    });

    await po.save();

    revalidatePath("/purchase-orders");

    return {
      success: true,
      data: { id: po._id.toString(), poNumber: po.poNumber },
    };
  } catch (error) {
    console.error("Create PO error:", error);
    return {
      success: false,
      error: error.message || "Failed to create purchase order",
    };
  }
}

// ============================================
// UPDATE PURCHASE ORDER
// ============================================
export async function updatePurchaseOrder(id, prevState, formData) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    await connectDB();

    const po = await PurchaseOrder.findById(id);
    if (!po) {
      return { success: false, error: "Purchase order not found" };
    }

    if (!po.canEdit) {
      return {
        success: false,
        error: `Cannot edit PO in status: ${po.status}`,
      };
    }

    // Parse and validate
    const rawData = parseFormData(formData);
    const validationResult = CreatePOSchema.safeParse(rawData);

    if (!validationResult.success) {
      const errors = validationResult.error.flatten();
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: errors.fieldErrors,
      };
    }

    const data = validationResult.data;

    // Update supplier if changed
    if (data.supplierId !== po.supplier.id) {
      const supplier = await Party.findById(data.supplierId).lean();
      if (!supplier) {
        return { success: false, error: "Supplier not found" };
      }

      po.supplier = {
        id: supplier._id.toString(),
        partyId: supplier._id,
        name: supplier.name,
        email: supplier.email,
        phone: supplier.phone,
        address: supplier.address
          ? `${supplier.address.line1 || ""} ${supplier.address.city || ""}`
          : "",
        taxPin: supplier.taxPin,
      };
    }

    // Process items
    const processedItems = await Promise.all(
      data.items.map(async (item) => {
        let productData = {};

        if (item.productId) {
          const product = await Product.findById(item.productId).lean();
          if (product) {
            productData = {
              productId: product._id,
              productSKU: product.SKU,
              productName: product.name,
              unit: product.unit || item.unit,
            };
          }
        }

        const amount = item.quantity * item.unitPrice;
        const taxAmount = (amount * item.taxRate) / 100;

        return {
          ...productData,
          description: item.description,
          unit: productData.unit || item.unit || "pcs",
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount,
          taxRate: item.taxRate,
          taxAmount,
          lineTotal: amount + taxAmount,
          receivedQuantity: 0,
          pendingQuantity: item.quantity,
          status: "pending",
        };
      })
    );

    // Update PO
    po.poDate = data.poDate;
    po.expectedDeliveryDate = data.expectedDeliveryDate || null;
    po.deliveryAddress = data.deliveryAddress || {};
    po.items = processedItems;
    po.notes = data.notes;
    po.internalNotes = data.internalNotes;
    po.paymentTerms = {
      termsDays: data.paymentTermsDays,
      description: `Net ${data.paymentTermsDays}`,
    };
    po.lastModifiedBy = formatUser(session);

    await po.save();

    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${id}`);

    return { success: true, data: { id: po._id.toString() } };
  } catch (error) {
    console.error("Update PO error:", error);
    return {
      success: false,
      error: error.message || "Failed to update purchase order",
    };
  }
}

// ============================================
// SUBMIT FOR APPROVAL
// ============================================
export async function submitPOForApproval(id) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    await connectDB();

    const po = await PurchaseOrder.findById(id);
    if (!po) {
      return { success: false, error: "Purchase order not found" };
    }

    await po.submitForApproval(formatUser(session));

    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${id}`);

    return {
      success: true,
      data: {
        status: po.status,
        message:
          po.status === "approved"
            ? "PO auto-approved"
            : "PO submitted for approval",
      },
    };
  } catch (error) {
    console.error("Submit PO error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// APPROVE PURCHASE ORDER
// ============================================
export async function approvePurchaseOrder(id) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    // Check role (you can customize this based on your role system)
    const allowedRoles = ["admin", "manager", "accountant"];
    if (!allowedRoles.includes(session.user.role)) {
      return { success: false, error: "Not authorized to approve POs" };
    }

    await connectDB();

    const po = await PurchaseOrder.findById(id);
    if (!po) {
      return { success: false, error: "Purchase order not found" };
    }

    await po.approve(formatUser(session));

    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${id}`);

    return { success: true, data: { status: po.status } };
  } catch (error) {
    console.error("Approve PO error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// REJECT PURCHASE ORDER
// ============================================
export async function rejectPurchaseOrder(id, prevState, formData) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    await connectDB();

    const po = await PurchaseOrder.findById(id);
    if (!po) {
      return { success: false, error: "Purchase order not found" };
    }

    const reason = formData.get("reason") || "No reason provided";
    await po.reject(formatUser(session), reason);

    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${id}`);

    return { success: true, data: { status: po.status } };
  } catch (error) {
    console.error("Reject PO error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// SEND TO SUPPLIER
// ============================================
export async function sendPurchaseOrder(id, prevState, formData) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    await connectDB();

    const po = await PurchaseOrder.findById(id);
    if (!po) {
      return { success: false, error: "Purchase order not found" };
    }

    const method = formData?.get("method") || "email";
    await po.send(formatUser(session), method);

    // TODO: Actually send email to supplier if method is "email"
    // You can integrate with your email service here

    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${id}`);

    return {
      success: true,
      data: { status: po.status, sentVia: po.sentVia },
    };
  } catch (error) {
    console.error("Send PO error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// CONFIRM (Supplier confirmed)
// ============================================
export async function confirmPurchaseOrder(id, prevState, formData) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    await connectDB();

    const po = await PurchaseOrder.findById(id);
    if (!po) {
      return { success: false, error: "Purchase order not found" };
    }

    const supplierReference = formData?.get("supplierReference") || null;
    await po.confirm(formatUser(session), supplierReference);

    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${id}`);

    return { success: true, data: { status: po.status } };
  } catch (error) {
    console.error("Confirm PO error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// RECEIVE ITEMS
// ============================================
export async function receiveItems(id, prevState, formData) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    await connectDB();

    const po = await PurchaseOrder.findById(id);
    if (!po) {
      return { success: false, error: "Purchase order not found" };
    }

    // Parse items from form data
    const rawData = parseFormData(formData);
    const validationResult = ReceiveItemsSchema.safeParse(rawData);

    if (!validationResult.success) {
      const errors = validationResult.error.flatten();
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: errors.fieldErrors,
      };
    }

    const { items, notes } = validationResult.data;

    const result = await po.receiveItems(items, formatUser(session), notes);

    // Update product inventory if items have productId
    for (const item of items) {
      const poItem = po.items.find((i) => i._id.toString() === item.itemId);
      if (poItem?.productId) {
        const product = await Product.findById(poItem.productId);
        if (product && product.increaseInventory) {
          await product.increaseInventory(
            item.quantity,
            poItem.unitPrice,
            `Received from PO ${po.poNumber}`
          );
        }
      }
    }

    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${id}`);
    revalidatePath("/products");

    return {
      success: true,
      data: {
        receivingId: result.receivingId.toString(),
        status: result.poStatus,
        isFullyReceived: result.isFullyReceived,
      },
    };
  } catch (error) {
    console.error("Receive items error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// CONVERT TO BILL
// ============================================
export async function convertToBill(id, prevState, formData) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    await connectDB();

    const po = await PurchaseOrder.findById(id);
    if (!po) {
      return { success: false, error: "Purchase order not found" };
    }

    const billData = {
      supplierInvoiceNumber: formData?.get("supplierInvoiceNumber"),
      billDate: formData?.get("billDate")
        ? new Date(formData.get("billDate"))
        : new Date(),
      notes: formData?.get("notes"),
    };

    const bill = await po.convertToBill(formatUser(session), billData);

    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${id}`);
    revalidatePath("/bills");

    return {
      success: true,
      data: {
        billId: bill._id.toString(),
        billNumber: bill.billNumber,
      },
    };
  } catch (error) {
    console.error("Convert to bill error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// CANCEL PURCHASE ORDER
// ============================================
export async function cancelPurchaseOrder(id, prevState, formData) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    await connectDB();

    const po = await PurchaseOrder.findById(id);
    if (!po) {
      return { success: false, error: "Purchase order not found" };
    }

    const reason = formData?.get("reason") || "No reason provided";
    await po.cancel(formatUser(session), reason);

    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${id}`);

    return { success: true, data: { status: po.status } };
  } catch (error) {
    console.error("Cancel PO error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// CLOSE PURCHASE ORDER
// ============================================
export async function closePurchaseOrder(id, prevState, formData) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    await connectDB();

    const po = await PurchaseOrder.findById(id);
    if (!po) {
      return { success: false, error: "Purchase order not found" };
    }

    const reason = formData?.get("reason") || "Manually closed";
    await po.close(formatUser(session), reason);

    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${id}`);

    return { success: true, data: { status: po.status } };
  } catch (error) {
    console.error("Close PO error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// CLONE PURCHASE ORDER
// ============================================
export async function clonePurchaseOrder(id) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    await connectDB();

    const po = await PurchaseOrder.findById(id);
    if (!po) {
      return { success: false, error: "Purchase order not found" };
    }

    const newPO = await po.clone(formatUser(session));

    revalidatePath("/purchase-orders");

    return {
      success: true,
      data: {
        id: newPO._id.toString(),
        poNumber: newPO.poNumber,
      },
    };
  } catch (error) {
    console.error("Clone PO error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// DELETE PURCHASE ORDER (Draft only)
// ============================================
export async function deletePurchaseOrder(id) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    await connectDB();

    const po = await PurchaseOrder.findById(id);
    if (!po) {
      return { success: false, error: "Purchase order not found" };
    }

    if (po.status !== "draft") {
      return {
        success: false,
        error: "Only draft POs can be deleted. Cancel instead.",
      };
    }

    await PurchaseOrder.findByIdAndDelete(id);

    revalidatePath("/purchase-orders");

    return { success: true };
  } catch (error) {
    console.error("Delete PO error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// QUERY ACTIONS
// ============================================

/**
 * Get PO list with filters
 */
export async function getPurchaseOrders(filters = {}) {
  try {
    await connectDB();

    const query = {};

    if (filters.status) {
      query.status = Array.isArray(filters.status)
        ? { $in: filters.status }
        : filters.status;
    }

    if (filters.supplierId) {
      query["supplier.id"] = filters.supplierId;
    }

    if (filters.startDate || filters.endDate) {
      query.poDate = {};
      if (filters.startDate) query.poDate.$gte = new Date(filters.startDate);
      if (filters.endDate) query.poDate.$lte = new Date(filters.endDate);
    }

    if (filters.search) {
      query.$or = [
        { poNumber: { $regex: filters.search, $options: "i" } },
        { "supplier.name": { $regex: filters.search, $options: "i" } },
      ];
    }

    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    const [purchaseOrders, total] = await Promise.all([
      PurchaseOrder.find(query)
        .sort({ poDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      PurchaseOrder.countDocuments(query),
    ]);

    // Serialize for Next.js
    const serialized = purchaseOrders.map((po) => ({
      ...po,
      _id: po._id.toString(),
      supplier: {
        ...po.supplier,
        partyId: po.supplier.partyId?.toString(),
      },
      items: po.items.map((item) => ({
        ...item,
        _id: item._id?.toString(),
        productId: item.productId?.toString(),
      })),
    }));

    return {
      success: true,
      data: serialized,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    console.error("Get POs error:", error);
    return { success: false, error: error.message, data: [] };
  }
}

/**
 * Get single PO by ID
 */
export async function getPurchaseOrder(id) {
  try {
    await connectDB();

    const po = await PurchaseOrder.findById(id).lean();
    if (!po) {
      return { success: false, error: "Purchase order not found" };
    }

    // Serialize
    const serialized = {
      ...po,
      _id: po._id.toString(),
      supplier: {
        ...po.supplier,
        partyId: po.supplier.partyId?.toString(),
      },
      items: po.items.map((item) => ({
        ...item,
        _id: item._id?.toString(),
        productId: item.productId?.toString(),
      })),
      bills: po.bills?.map((bill) => ({
        ...bill,
        billId: bill.billId?.toString(),
      })),
      receivings: po.receivings?.map((r) => ({
        ...r,
        receivingId: r.receivingId?.toString(),
        billId: r.billId?.toString(),
        items: r.items?.map((i) => ({
          ...i,
          productId: i.productId?.toString(),
        })),
      })),
    };

    return { success: true, data: serialized };
  } catch (error) {
    console.error("Get PO error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get PO stats for dashboard
 */
export async function getPOStats() {
  try {
    await connectDB();

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [statusCounts, monthlyStats, overdueCount] = await Promise.all([
      // Count by status
      PurchaseOrder.aggregate([
        { $match: { status: { $ne: "cancelled" } } },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            total: { $sum: "$total" },
          },
        },
      ]),

      // This month stats
      PurchaseOrder.aggregate([
        {
          $match: {
            poDate: { $gte: startOfMonth },
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

      // Overdue count
      PurchaseOrder.countDocuments({
        status: { $in: ["sent", "confirmed", "partial"] },
        expectedDeliveryDate: { $lt: now },
      }),
    ]);

    return {
      success: true,
      data: {
        byStatus: statusCounts,
        thisMonth: monthlyStats[0] || { count: 0, totalValue: 0 },
        overdueCount,
      },
    };
  } catch (error) {
    console.error("Get PO stats error:", error);
    return { success: false, error: error.message };
  }
}
