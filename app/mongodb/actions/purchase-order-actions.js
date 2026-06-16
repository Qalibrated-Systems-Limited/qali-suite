"use server";

// ============================================
// PURCHASE ORDER ACTIONS - MUTATIONS ONLY
// ============================================
// Next.js 16 Standards:
// ✅ useActionState compatible (prevState, formData)
// ✅ Returns { success, error, fieldErrors } for user feedback
// ✅ redirect() after successful mutations
// ✅ revalidatePath() before redirect
// ✅ No queries - mutations only
// ✅ Never throws - always returns error objects
// ✅ MongoDB transactions for data integrity
//
// Authorization Matrix:
// ┌─────────────────────┬────────────┬─────────┬───────┐
// │ Action              │ Accountant │ Manager │ Admin │
// ├─────────────────────┼────────────┼─────────┼───────┤
// │ Create              │ ✅         │ ✅      │ ✅    │
// │ Update Draft        │ ✅ (own)   │ ✅      │ ✅    │
// │ Delete Draft        │ ✅ (own)   │ ✅      │ ✅    │
// │ Send                │ ✅ (own)   │ ✅      │ ✅    │
// │ Confirm             │ ❌         │ ✅      │ ✅    │
// │ Cancel              │ ❌         │ ✅      │ ✅    │
// │ Convert to Bill     │ ✅         │ ✅      │ ✅    │
// └─────────────────────┴────────────┴─────────┴───────┘
// ============================================

import { formatAddress } from "@/lib/format-address";
import { revalidatePath } from "next/cache";
import { roleAllowed } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import mongoose from "mongoose";

import PurchaseOrder from "@/app/models/purchaseOrder";
import Party from "@/app/models/parties";
import Product from "@/app/models/product";
import Account from "@/app/models/account";
import Company from "@/app/models/Company";
import dbConnect from "@/app/config/dbConnect";
import { sendPurchaseOrderEmail } from "@/lib/email";
import {
  getTenantContext,
  withTenantScope,
} from "@/lib/utils/tenant-utils";
import { requirePlanAccess } from "@/lib/plan-gate";

// ============================================
// CONSTANTS
// ============================================
// CFO / Finance Manager / Procurement Officer added — they were missing
// even though procurement is a core part of their job. SuperAdmin
// implicit via the hasRole helper at use sites (or add explicitly when
// the file's helper does not bypass).
const PO_ROLES = {
  CREATE: ["SuperAdmin", "Admin", "CFO", "Finance Manager", "Manager", "Accountant", "Procurement Officer", "Store Manager"],
  SEND: ["SuperAdmin", "Admin", "CFO", "Finance Manager", "Manager", "Accountant", "Procurement Officer", "Store Manager"],
  CONFIRM: ["SuperAdmin", "Admin", "CFO", "Finance Manager", "Manager", "Procurement Officer"],
  CANCEL: ["SuperAdmin", "Admin", "CFO", "Finance Manager", "Manager"],
  CONVERT_TO_BILL: ["SuperAdmin", "Admin", "CFO", "Finance Manager", "Manager", "Accountant"],
};

// ============================================
// VALIDATION SCHEMAS
// ============================================
const POLineSchema = z.object({
  productId: z.string().optional().nullable(),
  customProductName: z.string().optional().nullable(),
  description: z.string().min(1, "Description is required"),
  accountId: z.string().optional().nullable(), // Optional - for expense categorization
  quantity: z.coerce.number().positive("Quantity must be positive"),
  unit: z.string().default("pcs"),
  unitPrice: z.coerce.number().min(0, "Unit price cannot be negative"),
  vatRate: z.coerce.number().min(0).max(100).default(16),
});

const CreatePOSchema = z.object({
  supplierId: z.string().min(1, "Supplier is required"),
  poDate: z.coerce.date({ required_error: "PO date is required" }),
  expectedDeliveryDate: z.coerce.date().optional().nullable(),
  validUntil: z.coerce.date().optional().nullable(),
  lines: z.array(POLineSchema).min(1, "At least one line item is required"),
  whtApplicable: z
    .string()
    .transform((val) => val === "true")
    .default("false"),
  whtRate: z.coerce.number().min(0).max(30).default(0),
  deliveryAddress: z.string().optional(),
  deliveryInstructions: z.string().optional(),
  notes: z.string().optional(),
  termsAndConditions: z.string().optional(),
  internalNotes: z.string().optional(),
});

const CancelPOSchema = z.object({
  reason: z.string().min(1, "Cancellation reason is required"),
});

const ConvertToBillSchema = z.object({
  supplierInvoiceNumber: z.string().optional(),
  billDate: z.coerce.date({ required_error: "Bill date is required" }),
  dueDate: z.coerce.date({ required_error: "Due date is required" }),
  description: z.string().optional(),
  internalNotes: z.string().optional(),
  // lines will be parsed separately as JSON
});

// ============================================
// HELPERS
// ============================================

/**
 * Format user object for audit trails
 */
function formatUser(session) {
  if (!session?.user) return { name: "System", id: "system" };
  return {
    name: session.user.name || "Unknown",
    id: session.user.id || "unknown",
  };
}

/**
 * Parse FormData with array support (lines[0].description)
 */
function parseFormData(formData) {
  const data = {};

  for (const [key, value] of formData.entries()) {
    const arrayMatch = key.match(/^(\w+)\[(\d+)\]\.(.+)$/);
    if (arrayMatch) {
      const [, arrayName, index, prop] = arrayMatch;
      if (!data[arrayName]) data[arrayName] = [];
      if (!data[arrayName][index]) data[arrayName][index] = {};
      data[arrayName][index][prop] = value;
    } else {
      data[key] = value;
    }
  }

  // Clean sparse arrays
  if (data.lines) {
    data.lines = data.lines.filter(Boolean);
  }

  return data;
}

/**
 * Check if user has required role
 */
function hasRole(user, allowedRoles) {
  return roleAllowed(user?.role, allowedRoles);
}

/**
 * Check if user owns the resource
 */
function isOwner(user, createdBy) {
  return user?.id === createdBy?.id;
}

// ============================================
// CREATE PURCHASE ORDER
// ============================================
export async function createPurchaseOrder(prevState, formData) {
  let mongoSession = null;

  try {
    await requirePlanAccess("purchases");

    // 1. Auth check
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Please sign in to continue" };
    }

    const user = session.user;

    // 2. Role check
    if (!hasRole(user, PO_ROLES.CREATE)) {
      return {
        success: false,
        error: "You don't have permission to create purchase orders",
      };
    }

    await dbConnect();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();
    if (!companyId && !isSuperAdmin) {
      return { success: false, error: "Company context required" };
    }

    // 3. Parse and validate form data
    const rawData = parseFormData(formData);
    const validation = CreatePOSchema.safeParse(rawData);

    if (!validation.success) {
      const fieldErrors = {};
      for (const [key, messages] of Object.entries(
        validation.error.flatten().fieldErrors
      )) {
        fieldErrors[key] = messages[0];
      }
      return {
        success: false,
        error: "Please fix the validation errors",
        fieldErrors,
      };
    }

    const data = validation.data;

    // 4. Start transaction
    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    // 5. Validate supplier exists and is correct type (tenant-scoped)
    const supplier = await Party.findOne(
      withTenantScope({ _id: data.supplierId }, companyId, isSuperAdmin)
    )
      .session(mongoSession)
      .lean();
    if (!supplier) {
      await mongoSession.abortTransaction();
      return {
        success: false,
        error: "Supplier not found",
        fieldErrors: { supplierId: "Supplier not found" },
      };
    }

    if (!["supplier", "both"].includes(supplier.type)) {
      await mongoSession.abortTransaction();
      return {
        success: false,
        error: "Selected party is not a supplier",
        fieldErrors: { supplierId: "Selected party is not a supplier" },
      };
    }

    // 6. Process line items - batch fetch accounts and products to avoid N+1 queries

    // Collect all unique IDs first
    const accountIds = data.lines
      .filter(line => line.accountId && line.accountId !== "" && line.accountId !== "none")
      .map(line => line.accountId);

    const productIds = data.lines
      .filter(line => line.productId && line.productId !== "No Product" && line.productId !== "none" && line.productId !== "")
      .map(line => line.productId);

    // Batch fetch all accounts and products in parallel
    const [accounts, products] = await Promise.all([
      accountIds.length > 0
        ? Account.find(
            withTenantScope({ _id: { $in: accountIds } }, companyId, isSuperAdmin)
          ).session(mongoSession).lean()
        : [],
      productIds.length > 0
        ? Product.find(
            withTenantScope({ _id: { $in: productIds } }, companyId, isSuperAdmin)
          ).session(mongoSession).lean()
        : [],
    ]);

    // Create lookup maps for O(1) access
    const accountMap = new Map(accounts.map(a => [a._id.toString(), a]));
    const productMap = new Map(products.map(p => [p._id.toString(), p]));

    // Process lines using maps (no additional queries)
    const processedLines = [];
    for (let i = 0; i < data.lines.length; i++) {
      const line = data.lines[i];

      // Get account from map if specified
      let accountData = null;
      if (line.accountId && line.accountId !== "" && line.accountId !== "none") {
        const account = accountMap.get(line.accountId);
        if (account) {
          accountData = {
            id: account._id,
            code: account.accountCode,
            name: account.accountName,
            type: account.accountType,
          };
        }
      }

      // Get product from map if specified
      let productData = null;
      if (line.productId && line.productId !== "No Product" && line.productId !== "none" && line.productId !== "") {
        const product = productMap.get(line.productId);
        if (product) {
          productData = {
            id: product._id,
            sku: product.SKU,
            name: product.name,
          };
        }
      }

      // Calculate amounts
      const amount = line.quantity * line.unitPrice;
      const vatAmount = (amount * line.vatRate) / 100;

      processedLines.push({
        lineNumber: i + 1,
        product: productData,
        description: line.description || productData?.name || line.customProductName || "Item",
        account: accountData,
        quantity: line.quantity,
        unit: line.unit || "pcs",
        unitPrice: line.unitPrice,
        amount,
        vat: {
          rate: line.vatRate,
          amount: vatAmount,
        },
        lineTotal: amount + vatAmount,
        receivedQuantity: 0,
        receivings: [],
      });
    }

    // 7. Generate PO number atomically
    const poNumber = await PurchaseOrder.generatePONumber(mongoSession);

    // 8. Create supplier snapshot (frozen at creation time)
    const supplierSnapshot = {
      partyId: supplier._id,
      name: supplier.name,
      taxPin: supplier.taxPin || "",
      email: supplier.email || "",
      phone: supplier.phone || "",
      address: formatAddress(supplier.address)
        ? `${supplier.address.line1 || ""}, ${supplier.address.city || ""}`.trim()
        : "",
    };

    // 9. Calculate PO amounts
    const subtotal = processedLines.reduce((sum, line) => sum + line.amount, 0);
    const vatTotal = processedLines.reduce(
      (sum, line) => sum + (line.vat?.amount || 0),
      0
    );
    const total = subtotal + vatTotal;
    const whtAmount = data.whtApplicable ? (subtotal * data.whtRate) / 100 : 0;
    const netPayable = total - whtAmount;

    // 10. Create purchase order
    const [po] = await PurchaseOrder.create(
      [
        {
          companyId, // Add tenant context
          poNumber,
          poDate: data.poDate,
          expectedDeliveryDate: data.expectedDeliveryDate || null,
          validUntil: data.validUntil || null,
          supplier: supplierSnapshot,
          whtApplicable: data.whtApplicable,
          whtRate: data.whtApplicable ? data.whtRate : 0,
          lines: processedLines,
          amounts: {
            subtotal,
            vat: vatTotal,
            total,
            wht: whtAmount,
            netPayable,
          },
          deliveryAddress: data.deliveryAddress || "",
          deliveryInstructions: data.deliveryInstructions || "",
          notes: data.notes || "",
          termsAndConditions: data.termsAndConditions || "",
          internalNotes: data.internalNotes || "",
          status: "draft",
          bills: [],
          createdBy: formatUser(session),
        },
      ],
      { session: mongoSession }
    );

    // 11. Commit transaction
    await mongoSession.commitTransaction();
    mongoSession.endSession();
    mongoSession = null;

    // 12. Revalidate and redirect
    revalidatePath("/dashboard/purchase-orders");
    redirect(`/dashboard/purchase-orders/${po._id}?success=PO ${poNumber} created`);
  } catch (error) {
    // Handle redirect (it throws NEXT_REDIRECT)
    if (error?.digest?.startsWith("NEXT_REDIRECT")) {
      throw error;
    }

    // Abort transaction on error
    if (mongoSession) {
      await mongoSession.abortTransaction();
    }

    console.error("Create purchase order error:", error);
    return {
      success: false,
      error: error.message || "Failed to create purchase order. Please try again.",
    };
  } finally {
    if (mongoSession) {
      mongoSession.endSession();
    }
  }
}

// ============================================
// UPDATE PURCHASE ORDER (Draft only)
// ============================================
export async function updatePurchaseOrder(poId, prevState, formData) {
  let mongoSession = null;

  try {
    // 1. Auth check
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Please sign in to continue" };
    }

    const user = session.user;

    await dbConnect();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();

    // 2. Get PO (tenant-scoped)
    const po = await PurchaseOrder.findOne(
      withTenantScope({ _id: poId }, companyId, isSuperAdmin)
    );
    if (!po) {
      return { success: false, error: "Purchase order not found" };
    }

    // 3. Check if editable
    if (!po.canEdit) {
      return {
        success: false,
        error: `Cannot edit purchase order in ${po.status} status`,
      };
    }

    // 4. Authorization: Owner, Manager, or Admin
    const canEdit =
      isOwner(user, po.createdBy) || hasRole(user, ["SuperAdmin", "Admin", "Manager"]);

    if (!canEdit) {
      return {
        success: false,
        error: "You can only edit purchase orders you created",
      };
    }

    // 5. Parse and validate
    const rawData = parseFormData(formData);
    const validation = CreatePOSchema.safeParse(rawData);

    if (!validation.success) {
      const fieldErrors = {};
      for (const [key, messages] of Object.entries(
        validation.error.flatten().fieldErrors
      )) {
        fieldErrors[key] = messages[0];
      }
      return {
        success: false,
        error: "Please fix the validation errors",
        fieldErrors,
      };
    }

    const data = validation.data;

    // 6. Start transaction
    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    // 7. Update supplier if changed (tenant-scoped)
    if (data.supplierId !== po.supplier?.partyId?.toString()) {
      const supplier = await Party.findOne(
        withTenantScope({ _id: data.supplierId }, companyId, isSuperAdmin)
      )
        .session(mongoSession)
        .lean();
      if (!supplier) {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: "Supplier not found",
          fieldErrors: { supplierId: "Supplier not found" },
        };
      }

      if (!["supplier", "both"].includes(supplier.type)) {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: "Selected party is not a supplier",
          fieldErrors: { supplierId: "Selected party is not a supplier" },
        };
      }

      po.supplier = {
        partyId: supplier._id,
        name: supplier.name,
        taxPin: supplier.taxPin || "",
        email: supplier.email || "",
        phone: supplier.phone || "",
        address: formatAddress(supplier.address)
          ? `${supplier.address.line1 || ""}, ${supplier.address.city || ""}`.trim()
          : "",
      };
    }

    // 8. Process lines (tenant-scoped lookups)
    const processedLines = [];

    for (let i = 0; i < data.lines.length; i++) {
      const line = data.lines[i];

      let accountData = null;
      if (line.accountId && line.accountId !== "" && line.accountId !== "none") {
        const account = await Account.findOne(
          withTenantScope({ _id: line.accountId }, companyId, isSuperAdmin)
        )
          .session(mongoSession)
          .lean();
        if (account) {
          accountData = {
            id: account._id,
            code: account.accountCode,
            name: account.accountName,
            type: account.accountType,
          };
        }
      }

      let productData = null;
      if (
        line.productId &&
        line.productId !== "No Product" &&
        line.productId !== "none" &&
        line.productId !== ""
      ) {
        const product = await Product.findOne(
          withTenantScope({ _id: line.productId }, companyId, isSuperAdmin)
        )
          .session(mongoSession)
          .lean();
        if (product) {
          productData = {
            id: product._id,
            sku: product.SKU,
            name: product.name,
          };
        }
      }

      const amount = line.quantity * line.unitPrice;
      const vatAmount = (amount * line.vatRate) / 100;

      processedLines.push({
        lineNumber: i + 1,
        product: productData,
        description: line.description || productData?.name || "Item",
        account: accountData,
        quantity: line.quantity,
        unit: line.unit || "pcs",
        unitPrice: line.unitPrice,
        amount,
        vat: {
          rate: line.vatRate,
          amount: vatAmount,
        },
        lineTotal: amount + vatAmount,
        receivedQuantity: 0,
        receivings: [],
      });
    }

    // 9. Update PO fields
    po.poDate = data.poDate;
    po.expectedDeliveryDate = data.expectedDeliveryDate || null;
    po.validUntil = data.validUntil || null;
    po.whtApplicable = data.whtApplicable;
    po.whtRate = data.whtApplicable ? data.whtRate : 0;
    po.lines = processedLines;
    po.deliveryAddress = data.deliveryAddress || "";
    po.deliveryInstructions = data.deliveryInstructions || "";
    po.notes = data.notes || "";
    po.termsAndConditions = data.termsAndConditions || "";
    po.internalNotes = data.internalNotes || "";
    po.lastModifiedBy = formatUser(session);

    // Amounts will be recalculated in pre-save hook
    await po.save({ session: mongoSession });

    // 10. Commit transaction
    await mongoSession.commitTransaction();
    mongoSession.endSession();
    mongoSession = null;

    // 11. Revalidate and redirect
    revalidatePath("/dashboard/purchase-orders");
    revalidatePath(`/dashboard/purchase-orders/${poId}`);
    redirect(`/dashboard/purchase-orders/${poId}?success=PO updated successfully`);
  } catch (error) {
    if (error?.digest?.startsWith("NEXT_REDIRECT")) {
      throw error;
    }

    if (mongoSession) {
      await mongoSession.abortTransaction();
    }

    console.error("Update purchase order error:", error);
    return {
      success: false,
      error: error.message || "Failed to update purchase order. Please try again.",
    };
  } finally {
    if (mongoSession) {
      mongoSession.endSession();
    }
  }
}

// ============================================
// SEND PURCHASE ORDER
// ============================================
export async function sendPurchaseOrder(poId) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Please sign in to continue" };
    }

    const user = session.user;

    // Role check
    if (!hasRole(user, PO_ROLES.SEND)) {
      return {
        success: false,
        error: "You don't have permission to send purchase orders",
      };
    }

    await dbConnect();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();

    const po = await PurchaseOrder.findOne(
      withTenantScope({ _id: poId }, companyId, isSuperAdmin)
    );
    if (!po) {
      return { success: false, error: "Purchase order not found" };
    }

    // Authorization: Owner, Manager, or Admin
    const canSend =
      isOwner(user, po.createdBy) || hasRole(user, ["SuperAdmin", "Admin", "Manager"]);

    if (!canSend) {
      return {
        success: false,
        error: "You can only send purchase orders you created",
      };
    }

    if (!po.canSend) {
      return {
        success: false,
        error: `Cannot send purchase order in ${po.status} status`,
      };
    }

    // Resolve the supplier email. We require it before flipping the
    // status — if there's no email on file, "send" is meaningless.
    const supplierParty = po.supplier?.partyId
      ? await Party.findById(po.supplier.partyId).select("email name").lean()
      : null;
    const supplierEmail = supplierParty?.email?.trim();
    if (!supplierEmail) {
      return {
        success: false,
        error:
          "Supplier has no email on file. Add an email to the supplier record, then try again.",
      };
    }

    // Flip status synchronously so the UI reflects the user's action
    // immediately. The actual outbound email is dispatched via after()
    // so a slow Resend call doesn't block the page response.
    await po.send(formatUser(session));
    po.sentTo = supplierEmail;
    await po.save();

    revalidatePath("/dashboard/purchase-orders");
    revalidatePath(`/dashboard/purchase-orders/${poId}`);

    after(async () => {
      try {
        // Render the PO PDF via the existing reusable component, then
        // hand it to Resend as an attachment. Pulled inline so we don't
        // pay the @react-pdf import cost on the hot path.
        const [{ renderToBuffer }, { PurchaseOrderPDF }, freshPO, company] =
          await Promise.all([
            import("@react-pdf/renderer"),
            import("@/lib/pdf"),
            PurchaseOrder.findById(poId).lean(),
            Company.findById(po.companyId)
              .select("name email phone address bankName accountNumber settings")
              .lean(),
          ]);
        if (!freshPO) return;

        const pdfBuffer = await renderToBuffer(
          PurchaseOrderPDF({ purchaseOrder: freshPO, company }),
        );

        await sendPurchaseOrderEmail({
          to: supplierEmail,
          replyTo: company?.email || undefined,
          supplierName: supplierParty?.name || po.supplier?.name,
          senderCompany: company?.name || "Our Company",
          poNumber: po.poNumber,
          poDate: po.poDate,
          expectedDeliveryDate: po.expectedDeliveryDate,
          total: po.amounts?.total || 0,
          currency: company?.settings?.currency || "KES",
          pdfBuffer,
        });

        // Success — stamp delivery confirmation.
        await PurchaseOrder.findByIdAndUpdate(poId, {
          $set: {
            deliveredAt: new Date(),
            lastDeliveryError: null,
          },
          $inc: { deliveryAttempts: 1 },
        });
        revalidatePath(`/dashboard/purchase-orders/${poId}`);
      } catch (err) {
        console.error("[sendPurchaseOrder] email dispatch failed:", err);
        await PurchaseOrder.findByIdAndUpdate(poId, {
          $set: { lastDeliveryError: err.message || "Email send failed" },
          $inc: { deliveryAttempts: 1 },
        });
        revalidatePath(`/dashboard/purchase-orders/${poId}`);
      }
    });

    return {
      success: true,
      message: `PO ${po.poNumber} sent to ${supplierEmail}`,
    };
  } catch (error) {
    console.error("Send purchase order error:", error);
    return {
      success: false,
      error: error.message || "Failed to send purchase order",
    };
  }
}

// ============================================
// CONFIRM PURCHASE ORDER (Supplier confirmed)
// ============================================
export async function confirmPurchaseOrder(poId) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Please sign in to continue" };
    }

    const user = session.user;

    // Role check: Only Manager and Admin
    if (!hasRole(user, PO_ROLES.CONFIRM)) {
      return {
        success: false,
        error: "Only Managers and Admins can confirm purchase orders",
      };
    }

    await dbConnect();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();

    const po = await PurchaseOrder.findOne(
      withTenantScope({ _id: poId }, companyId, isSuperAdmin)
    );
    if (!po) {
      return { success: false, error: "Purchase order not found" };
    }

    if (!po.canConfirm) {
      return {
        success: false,
        error: `Cannot confirm purchase order in ${po.status} status. PO must be sent first.`,
      };
    }

    // Use schema method
    await po.confirm(formatUser(session));

    revalidatePath("/dashboard/purchase-orders");
    revalidatePath(`/dashboard/purchase-orders/${poId}`);

    return {
      success: true,
      message: `PO ${po.poNumber} confirmed`,
    };
  } catch (error) {
    console.error("Confirm purchase order error:", error);
    return {
      success: false,
      error: error.message || "Failed to confirm purchase order",
    };
  }
}

// ============================================
// CANCEL PURCHASE ORDER
// ============================================
export async function cancelPurchaseOrder(poId, prevState, formData) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Please sign in to continue" };
    }

    const user = session.user;

    // Role check
    if (!hasRole(user, PO_ROLES.CANCEL)) {
      return {
        success: false,
        error: "Only Managers and Admins can cancel purchase orders",
      };
    }

    // Validate reason
    const rawData = Object.fromEntries(formData.entries());
    const validation = CancelPOSchema.safeParse(rawData);

    if (!validation.success) {
      return {
        success: false,
        error: "Please provide a cancellation reason",
        fieldErrors: { reason: "Cancellation reason is required" },
      };
    }

    await dbConnect();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();

    const po = await PurchaseOrder.findOne(
      withTenantScope({ _id: poId }, companyId, isSuperAdmin)
    );
    if (!po) {
      return { success: false, error: "Purchase order not found" };
    }

    if (!po.canCancel) {
      return {
        success: false,
        error:
          po.bills && po.bills.length > 0
            ? "Cannot cancel PO with bills. Cancel/void the bills first."
            : `Cannot cancel purchase order in ${po.status} status`,
      };
    }

    await po.cancel(formatUser(session), validation.data.reason);

    revalidatePath("/dashboard/purchase-orders");
    revalidatePath(`/dashboard/purchase-orders/${poId}`);

    return {
      success: true,
      message: `PO ${po.poNumber} cancelled`,
    };
  } catch (error) {
    console.error("Cancel purchase order error:", error);
    return {
      success: false,
      error: error.message || "Failed to cancel purchase order",
    };
  }
}

// ============================================
// DELETE PURCHASE ORDER (Draft only)
// ============================================
export async function deletePurchaseOrder(poId) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Please sign in to continue" };
    }

    const user = session.user;

    await dbConnect();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();

    const po = await PurchaseOrder.findOne(
      withTenantScope({ _id: poId }, companyId, isSuperAdmin)
    );
    if (!po) {
      return { success: false, error: "Purchase order not found" };
    }

    // Only drafts can be deleted
    if (po.status !== "draft") {
      return {
        success: false,
        error:
          "Only draft purchase orders can be deleted. Use cancel for sent POs.",
      };
    }

    // Authorization: Owner, Manager, or Admin
    const canDelete =
      isOwner(user, po.createdBy) || hasRole(user, ["SuperAdmin", "Admin", "Manager"]);

    if (!canDelete) {
      return {
        success: false,
        error: "You can only delete purchase orders you created",
      };
    }

    const poNumber = po.poNumber;
    await PurchaseOrder.findByIdAndDelete(poId);

    revalidatePath("/dashboard/purchase-orders");

    return {
      success: true,
      message: `PO ${poNumber} deleted`,
    };
  } catch (error) {
    console.error("Delete purchase order error:", error);
    return {
      success: false,
      error: error.message || "Failed to delete purchase order",
    };
  }
}

// ============================================
// CONVERT PO TO BILL
// ============================================
export async function convertPOToBill(poId, prevState, formData) {
  let mongoSession = null;

  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Please sign in to continue" };
    }

    const user = session.user;

    // Role check
    if (!hasRole(user, PO_ROLES.CONVERT_TO_BILL)) {
      return {
        success: false,
        error: "You don't have permission to create bills from purchase orders",
      };
    }

    await dbConnect();

    // Parse form data
    const rawData = Object.fromEntries(formData.entries());

    // Parse selected lines from form data
    // Format: lines[0][lineId], lines[0][quantity], lines[1][lineId], etc.
    const selectedLines = [];
    const linePattern = /^lines\[(\d+)\]\[(\w+)\]$/;

    for (const [key, value] of formData.entries()) {
      const match = key.match(linePattern);
      if (match) {
        const index = parseInt(match[1], 10);
        const field = match[2];

        if (!selectedLines[index]) {
          selectedLines[index] = {};
        }

        if (field === "quantity") {
          selectedLines[index][field] = parseFloat(value);
        } else {
          selectedLines[index][field] = value;
        }
      }
    }

    // Filter out empty entries and validate
    const validLines = selectedLines.filter(
      (line) => line && line.lineId && line.quantity > 0
    );

    if (validLines.length === 0) {
      return {
        success: false,
        error: "Please select at least one line to bill",
      };
    }

    // Validate form data (excluding selectedLines which is already parsed)
    const validation = ConvertToBillSchema.safeParse({
      ...rawData,
    });

    if (!validation.success) {
      const fieldErrors = {};
      for (const [key, messages] of Object.entries(
        validation.error.flatten().fieldErrors
      )) {
        fieldErrors[key] = messages[0];
      }
      return {
        success: false,
        error: "Please fix the validation errors",
        fieldErrors,
      };
    }

    const data = validation.data;

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();

    // Start transaction
    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    // Get PO (tenant-scoped)
    const po = await PurchaseOrder.findOne(
      withTenantScope({ _id: poId }, companyId, isSuperAdmin)
    ).session(mongoSession);
    if (!po) {
      await mongoSession.abortTransaction();
      return { success: false, error: "Purchase order not found" };
    }

    if (!po.canConvertToBill) {
      await mongoSession.abortTransaction();
      return {
        success: false,
        error: `Cannot create bill from PO in ${po.status} status`,
      };
    }

    // Validate selected lines
    for (const selection of validLines) {
      const poLine = po.lines.find(
        (l) => l._id.toString() === selection.lineId.toString()
      );

      if (!poLine) {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: `Line not found on PO: ${selection.lineId}`,
        };
      }

      // Available to bill = ordered but not yet received
      // (In this model, receiving happens when creating a bill)
      const availableQty = poLine.quantity - (poLine.receivedQuantity || 0);

      if (selection.quantity > availableQty) {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: `Quantity ${selection.quantity} exceeds available ${availableQty} for "${poLine.description}"`,
        };
      }
    }

    // Get default inventory account for product lines (tenant-scoped)
    const inventoryAccount = await Account.findOne(
      withTenantScope({ systemAccount: "inventory" }, companyId, isSuperAdmin)
    ).session(mongoSession);

    // Use schema method to convert
    const bill = await po.convertToBill(
      validLines,
      {
        supplierInvoiceNumber: data.supplierInvoiceNumber,
        billDate: data.billDate,
        dueDate: data.dueDate,
        description: data.description,
        internalNotes: data.internalNotes,
        defaultAccountId: inventoryAccount?._id,
        defaultAccountCode: inventoryAccount?.accountCode,
        defaultAccountName: inventoryAccount?.accountName,
        defaultAccountType: "asset",
      },
      formatUser(session)
    );

    await mongoSession.commitTransaction();
    mongoSession.endSession();
    mongoSession = null;

    revalidatePath("/dashboard/purchase-orders");
    revalidatePath(`/dashboard/purchase-orders/${poId}`);
    revalidatePath("/dashboard/bills");

    redirect(`/dashboard/bills/${bill._id}?success=Bill ${bill.billNumber} created from PO`);
  } catch (error) {
    if (error?.digest?.startsWith("NEXT_REDIRECT")) {
      throw error;
    }

    if (mongoSession) {
      await mongoSession.abortTransaction();
    }

    console.error("Convert PO to bill error:", error);
    return {
      success: false,
      error: error.message || "Failed to create bill from purchase order",
    };
  } finally {
    if (mongoSession) {
      mongoSession.endSession();
    }
  }
}

// ============================================
// GET AVAILABLE PO LINES (For bill creation from PO)
// ============================================
export async function getAvailablePOLines(poId) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Please sign in to continue" };
    }

    await dbConnect();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();

    const po = await PurchaseOrder.findOne(
      withTenantScope({ _id: poId }, companyId, isSuperAdmin)
    ).lean();
    if (!po) {
      return { success: false, error: "Purchase order not found" };
    }

    if (!["sent", "confirmed", "partial"].includes(po.status)) {
      return {
        success: false,
        error: `Cannot receive items for PO in ${po.status} status`,
      };
    }

    // Get available lines
    const availableLines = po.lines
      .filter((line) => line.receivedQuantity < line.quantity)
      .map((line) => ({
        lineId: line._id.toString(),
        product: line.product
          ? {
              id: line.product.id?.toString(),
              sku: line.product.sku,
              name: line.product.name,
            }
          : null,
        description: line.description,
        account: line.account
          ? {
              id: line.account.id?.toString(),
              code: line.account.code,
              name: line.account.name,
              type: line.account.type,
            }
          : null,
        unit: line.unit,
        unitPrice: line.unitPrice,
        vat: line.vat,
        orderedQuantity: line.quantity,
        receivedQuantity: line.receivedQuantity,
        availableQuantity: line.quantity - line.receivedQuantity,
      }));

    return {
      success: true,
      data: {
        poNumber: po.poNumber,
        supplier: po.supplier,
        availableLines,
      },
    };
  } catch (error) {
    console.error("Get available PO lines error:", error);
    return {
      success: false,
      error: error.message || "Failed to get available lines",
    };
  }
}
