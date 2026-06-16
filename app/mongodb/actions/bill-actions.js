"use server";

// ============================================
// BILL ACTIONS - MUTATIONS ONLY
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
// Authorization Matrix (Industry Standard):
// ┌─────────────────┬────────────┬─────────┬───────┐
// │ Action          │ Accountant │ Manager │ Admin │
// ├─────────────────┼────────────┼─────────┼───────┤
// │ Create          │ ✅         │ ✅      │ ✅    │
// │ Update Draft    │ ✅ (own)   │ ✅      │ ✅    │
// │ Delete Draft    │ ✅ (own)   │ ✅      │ ✅    │
// │ Submit          │ ✅ (own)   │ ✅      │ ✅    │
// │ Approve         │ ❌         │ ✅*     │ ✅    │
// │ Reject          │ ❌         │ ✅      │ ✅    │
// │ Cancel          │ ❌         │ ✅      │ ✅    │
// │ Record Payment  │ ✅         │ ✅      │ ✅    │
// └─────────────────┴────────────┴─────────┴───────┘
// * Cannot approve own submissions (separation of duties)
// ============================================

import { formatAddress } from "@/lib/format-address";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { z } from "zod";
import mongoose from "mongoose";
import { roleAllowed } from "@/lib/permissions";

import Bill from "@/app/models/bill";
import Party from "@/app/models/parties";
import Product from "@/app/models/product";
import Account from "@/app/models/account";
import Asset from "@/app/models/asset";
import Project from "@/app/models/project";
import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  getCompanyIdForCreate,
  withTenantScope,
} from "@/lib/utils/tenant-utils";
import { requirePlanAccess } from "@/lib/plan-gate";
import { roundCurrency, applyRate } from "@/lib/money";

// ============================================
// HELPERS
// ============================================
function revalidateProject(projectId) {
  if (projectId) {
    revalidatePath("/dashboard/projects");
    revalidatePath(`/dashboard/projects/${projectId}`);
  }
}

// ============================================
// CONSTANTS
// ============================================
// SuperAdmin / CFO / Finance Manager are added across the board — they
// are the senior finance authority and were missing from every gate.
// Procurement Officer can submit bills for approval (CREATE) but not
// approve / pay them.
const BILL_ROLES = {
  CREATE: ["SuperAdmin", "Admin", "CFO", "Finance Manager", "Manager", "Accountant", "Procurement Officer"],
  APPROVE: ["SuperAdmin", "Admin", "CFO", "Finance Manager", "Manager"],
  CANCEL: ["SuperAdmin", "Admin", "CFO", "Finance Manager", "Manager"],
  PAYMENT: ["SuperAdmin", "Admin", "CFO", "Finance Manager", "Manager", "Accountant"],
};

// ============================================
// VALIDATION SCHEMAS
// ============================================
const BillLineSchema = z.object({
  productId: z.string().optional().nullable(),
  customProductName: z.string().optional().nullable(), // For non-inventory items/services
  description: z.string().min(1, "Description is required"),
  accountId: z.string().min(1, "Account is required"),
  assetId: z.string().optional().nullable(), // Optional link to a fixed asset
  quantity: z.coerce.number().positive("Quantity must be positive"),
  unit: z.string().default("pcs"),
  unitPrice: z.coerce.number().min(0, "Unit price cannot be negative"),
  vatRate: z.coerce.number().min(0).max(100).default(16),
});

const CreateBillSchema = z.object({
  supplierId: z.string().min(1, "Supplier is required"),
  supplierInvoiceNumber: z.string().optional(),
  billDate: z.coerce.date({ required_error: "Bill date is required" }),
  dueDate: z.coerce.date({ required_error: "Due date is required" }),
  lines: z.array(BillLineSchema).min(1, "At least one line item is required"),
  whtApplicable: z
    .string()
    .transform((val) => val === "true")
    .default("false"),
  whtRate: z.coerce.number().min(0).max(30).default(0),
  title: z.string().optional(),
  reference: z.string().optional(),
  description: z.string().optional(),
  internalNotes: z.string().optional(),
});

const RejectBillSchema = z.object({
  reason: z.string().min(1, "Rejection reason is required"),
});

const CancelBillSchema = z.object({
  reason: z.string().min(1, "Cancellation reason is required"),
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
 * Check if user has required role. Wraps the central `roleAllowed`
 * helper from lib/permissions — it auto-grants SuperAdmin so the
 * allowedRoles list doesn't have to mention them explicitly.
 */
function hasRole(user, allowedRoles) {
  return roleAllowed(user?.role, allowedRoles);
}

/**
 * Resolve an optional assetId from a bill line into a snapshot subdoc.
 * Returns null if not provided. Returns an error object if the id is
 * malformed or the asset doesn't belong to the tenant.
 */
async function resolveLineAsset({
  rawAssetId,
  companyId,
  isSuperAdmin,
  mongoSession,
}) {
  if (!rawAssetId || typeof rawAssetId !== "string") {
    return { snapshot: null };
  }
  const assetId = rawAssetId.trim();
  if (!assetId || assetId === "none") {
    return { snapshot: null };
  }
  if (!mongoose.Types.ObjectId.isValid(assetId)) {
    return { error: "Invalid asset reference" };
  }
  const asset = await Asset.findOne(
    withTenantScope({ _id: assetId }, companyId, isSuperAdmin)
  )
    .select("_id assetNumber name")
    .session(mongoSession)
    .lean();
  if (!asset) {
    return { error: "Asset not found" };
  }
  return {
    snapshot: {
      id: asset._id,
      assetNumber: asset.assetNumber,
      name: asset.name,
    },
  };
}

/**
 * Check if user owns the resource
 */
function isOwner(user, createdBy) {
  return user?.id === createdBy?.id;
}

/**
 * Pre-fetch all referenced documents for a set of bill lines in
 * three batched queries (Account, Product, Asset). Replaces N+1
 * findOne-per-line patterns. Returns Maps keyed by ObjectId-string
 * for O(1) lookup inside the validation loop.
 */
async function batchResolveLineRefs({
  lines,
  companyId,
  isSuperAdmin,
  mongoSession,
}) {
  const tenantClause = isSuperAdmin ? {} : { companyId };

  const accountIds = new Set();
  const productIds = new Set();
  const assetIds = new Set();

  for (const line of lines || []) {
    if (
      line.accountId &&
      mongoose.Types.ObjectId.isValid(line.accountId)
    ) {
      accountIds.add(line.accountId.toString());
    }
    const pid = line.productId;
    if (
      pid &&
      pid !== "No Product" &&
      pid !== "none" &&
      pid !== "" &&
      mongoose.Types.ObjectId.isValid(pid)
    ) {
      productIds.add(pid.toString());
    }
    if (line.assetId && typeof line.assetId === "string") {
      const aid = line.assetId.trim();
      if (
        aid &&
        aid !== "none" &&
        mongoose.Types.ObjectId.isValid(aid)
      ) {
        assetIds.add(aid);
      }
    }
  }

  const [accounts, products, assets] = await Promise.all([
    accountIds.size > 0
      ? Account.find({
          ...tenantClause,
          _id: { $in: [...accountIds] },
        })
          .session(mongoSession)
          .lean()
      : [],
    productIds.size > 0
      ? Product.find({
          ...tenantClause,
          _id: { $in: [...productIds] },
        })
          .session(mongoSession)
          .lean()
      : [],
    assetIds.size > 0
      ? Asset.find({
          ...tenantClause,
          _id: { $in: [...assetIds] },
        })
          .select("_id assetNumber name")
          .session(mongoSession)
          .lean()
      : [],
  ]);

  return {
    accounts: new Map(accounts.map((a) => [a._id.toString(), a])),
    products: new Map(products.map((p) => [p._id.toString(), p])),
    assets: new Map(assets.map((a) => [a._id.toString(), a])),
  };
}

/**
 * Resolve a single line's asset reference from a pre-fetched map.
 * Mirrors resolveLineAsset's contract — returns the snapshot or an error.
 */
function resolveLineAssetFromMap(rawAssetId, assetsMap) {
  if (!rawAssetId || typeof rawAssetId !== "string") {
    return { snapshot: null };
  }
  const assetId = rawAssetId.trim();
  if (!assetId || assetId === "none") {
    return { snapshot: null };
  }
  if (!mongoose.Types.ObjectId.isValid(assetId)) {
    return { error: "Invalid asset reference" };
  }
  const asset = assetsMap.get(assetId);
  if (!asset) {
    return { error: "Asset not found" };
  }
  return {
    snapshot: {
      id: asset._id,
      assetNumber: asset.assetNumber,
      name: asset.name,
    },
  };
}

// ============================================
// CREATE BILL
// ============================================
export async function createBill(prevState, formData) {
  let mongoSession = null;
  let createdBillId = null;
  let createdBillNumber = null;

  // 1. Parse form data early to preserve on errors
  const rawData = parseFormData(formData);

  try {
    await requirePlanAccess("purchases");

    // 2. Auth & tenant check
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    // Get companyId for the bill (SuperAdmin must specify, regular users use their own)
    const tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);

    // 3. Role check
    if (!hasRole(user, BILL_ROLES.CREATE)) {
      return {
        success: false,
        error: "You don't have permission to create bills",
        values: rawData,
      };
    }

    await dbConnect();

    // 4. Validate form data
    const validation = CreateBillSchema.safeParse(rawData);

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
        values: rawData,
      };
    }

    const data = validation.data;

    // 4. Start transaction for data integrity
    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    // 6. Validate supplier exists, is correct type, and belongs to tenant
    const supplier = await Party.findOne(
      withTenantScope({ _id: data.supplierId }, tenantCompanyId, isSuperAdmin)
    )
      .session(mongoSession)
      .lean();
    if (!supplier) {
      await mongoSession.abortTransaction();
      return {
        success: false,
        error: "Supplier not found",
        fieldErrors: { supplierId: "Supplier not found" },
        values: rawData,
      };
    }

    if (!["supplier", "both"].includes(supplier.type)) {
      await mongoSession.abortTransaction();
      return {
        success: false,
        error: "Selected party is not a supplier",
        fieldErrors: { supplierId: "Selected party is not a supplier" },
        values: rawData,
      };
    }

    // 7. Process line items
    // Pre-fetch all referenced accounts / products / assets in 3 batched
    // queries instead of N+1 findOne calls per line. For a 50-line bill
    // this is ~3 round-trips instead of ~150.
    const lineRefs = await batchResolveLineRefs({
      lines: data.lines,
      companyId: tenantCompanyId,
      isSuperAdmin,
      mongoSession,
    });
    const processedLines = [];

    for (let i = 0; i < data.lines.length; i++) {
      const line = data.lines[i];

      // Validate account belongs to tenant
      const account =
        line.accountId &&
        mongoose.Types.ObjectId.isValid(line.accountId)
          ? lineRefs.accounts.get(line.accountId.toString())
          : null;
      if (!account) {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: `Line ${i + 1}: Account not found`,
          fieldErrors: { [`lines.${i}.accountId`]: "Account not found" },
          values: rawData,
        };
      }

      if (!["expense", "asset"].includes(account.accountType)) {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: `Line ${i + 1}: Account must be expense or asset type`,
          fieldErrors: {
            [`lines.${i}.accountId`]: "Must be expense or asset account",
          },
          values: rawData,
        };
      }

      // Validate account is a detail account (not a header)
      if (account.canPost === false) {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: `Line ${i + 1}: "${
            account.accountName
          }" is a header account. Please select a detail account.`,
          fieldErrors: {
            [`lines.${i}.accountId`]: "Cannot post to header account",
          },
          values: rawData,
        };
      }

      // Get product if specified, or use custom product name. Pulled
      // from the pre-fetched map — no DB call here.
      let productData = null;
      const pid = line.productId;
      if (
        pid &&
        pid !== "No Product" &&
        pid !== "none" &&
        pid !== "" &&
        mongoose.Types.ObjectId.isValid(pid)
      ) {
        const product = lineRefs.products.get(pid.toString());
        if (product) {
          productData = {
            id: product._id,
            sku: product.SKU,
            name: product.name,
            isInventory: true,
          };
        }
      } else if (line.customProductName && line.customProductName.trim()) {
        // Custom service/expense item (not in inventory)
        productData = {
          id: null,
          sku: null,
          name: line.customProductName.trim(),
          isInventory: false,
        };
      }

      // Resolve optional asset link from pre-fetched map.
      const assetResolution = resolveLineAssetFromMap(
        line.assetId,
        lineRefs.assets,
      );
      if (assetResolution.error) {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: `Line ${i + 1}: ${assetResolution.error}`,
          fieldErrors: { [`lines.${i}.assetId`]: assetResolution.error },
          values: rawData,
        };
      }

      // Calculate amounts (round at line-level so doc totals are clean)
      const amount = roundCurrency(line.quantity * line.unitPrice);
      const vatAmount = applyRate(amount, line.vatRate);

      processedLines.push({
        lineNumber: i + 1,
        product: productData,
        customProductName: line.customProductName?.trim() || null,
        description: line.description,
        account: {
          id: account._id,
          code: account.accountCode,
          name: account.accountName,
          type: account.accountType,
        },
        asset: assetResolution.snapshot || {
          id: null,
          assetNumber: null,
          name: null,
        },
        quantity: line.quantity,
        unit: line.unit || "pcs",
        unitPrice: line.unitPrice,
        amount,
        vat: {
          rate: line.vatRate,
          amount: vatAmount,
        },
        lineTotal: roundCurrency(amount + vatAmount),
      });
    }

    // 7. Generate bill number atomically (tenant-scoped)
    const billNumber = await Bill.generateBillNumber(tenantCompanyId, mongoSession);

    // 8. Calculate fiscal period
    const billDate = new Date(data.billDate);
    const fiscalPeriod = `${billDate.getFullYear()}-${String(
      billDate.getMonth() + 1
    ).padStart(2, "0")}`;

    // 9. Create supplier snapshot (frozen at creation time)
    const supplierSnapshot = {
      partyId: supplier._id,
      name: supplier.name,
      taxPin: supplier.taxPin || "",
      email: supplier.email || "",
      phone: supplier.phone || "",
      address: formatAddress(supplier.address)
        ? `${supplier.address.line1 || ""}, ${
            supplier?.address?.city || ""
          }`.trim()
        : "",
    };

    // 10. Calculate bill amounts — round at every aggregation step
    const subtotal = roundCurrency(
      processedLines.reduce((sum, line) => sum + line.amount, 0),
    );
    const vatTotal = roundCurrency(
      processedLines.reduce((sum, line) => sum + (line.vat?.amount || 0), 0),
    );
    const total = roundCurrency(subtotal + vatTotal);
    const whtAmount = data.whtApplicable
      ? applyRate(subtotal, data.whtRate)
      : 0;
    const netPayable = roundCurrency(total - whtAmount);

    const amounts = {
      subtotal,
      vat: vatTotal,
      total,
      wht: whtAmount,
      netPayable,
      paid: 0,
      balance: netPayable,
    };

    // 11. Resolve project (optional)
    let projectFields = {};
    const rawProjectId = rawData.projectId;
    if (rawProjectId) {
      const project = await Project.findById(rawProjectId)
        .select("projectNumber name status")
        .session(mongoSession)
        .lean();
      if (project && project.status !== "closed") {
        projectFields = {
          projectId: project._id,
          project: { projectNumber: project.projectNumber, name: project.name },
        };
      }
    }

    // 12. Create bill (with tenant companyId)
    const [bill] = await Bill.create(
      [
        {
          companyId: tenantCompanyId,
          billNumber,
          supplierInvoiceNumber: data.supplierInvoiceNumber || "",
          billDate: data.billDate,
          dueDate: data.dueDate,
          fiscalPeriod,
          supplier: supplierSnapshot,
          whtApplicable: data.whtApplicable,
          whtRate: data.whtApplicable ? data.whtRate : 0,
          lines: processedLines,
          amounts,
          title: data.title || "",
          reference: data.reference || "",
          description: data.description || "",
          internalNotes: data.internalNotes || "",
          status: "draft",
          createdBy: formatUser(user),
          ...projectFields,
        },
      ],
      { session: mongoSession }
    );

    // 12. Commit transaction and end session
    await mongoSession.commitTransaction();
    mongoSession.endSession();
    mongoSession = null; // Prevent finally from trying to end again

    // Store for redirect
    createdBillId = bill._id;
    createdBillNumber = billNumber;

    // 13. Revalidate
    revalidatePath("/dashboard/bills");
    revalidateProject(bill.projectId);
  } catch (error) {
    // Abort transaction on error
    if (mongoSession) {
      await mongoSession.abortTransaction();
    }

    console.error("Create bill error:", error);
    return {
      success: false,
      error: error.message || "Failed to create bill. Please try again.",
      values: rawData,
    };
  } finally {
    if (mongoSession) {
      mongoSession.endSession();
    }
  }

  // Redirect outside try/catch (redirect throws NEXT_REDIRECT)
  redirect(`/dashboard/bills/${createdBillId}?success=Bill ${createdBillNumber} created`);
}

// ============================================
// UPDATE BILL (Draft/Rejected only)
// ============================================
export async function updateBill(billId, prevState, formData) {
  let mongoSession = null;

  // 1. Parse form data early to preserve on errors
  const rawData = parseFormData(formData);

  try {
    // 2. Auth & tenant check
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    await dbConnect();

    // 3. Get bill (tenant-scoped)
    const bill = await Bill.findOne(
      withTenantScope({ _id: billId }, companyId, isSuperAdmin)
    );
    if (!bill) {
      return { success: false, error: "Bill not found", values: rawData };
    }

    // 4. Check if editable
    if (!bill.canEdit) {
      return {
        success: false,
        error: `Cannot edit bill in ${bill.status} status`,
        values: rawData,
      };
    }

    // 5. Authorization: Owner, Manager, or Admin
    const canEdit =
      isOwner(user, bill.createdBy) || hasRole(user, ["SuperAdmin", "Admin", "Manager"]);

    if (!canEdit) {
      return {
        success: false,
        error: "You can only edit bills you created",
        values: rawData,
      };
    }

    // 6. Validate form data
    const validation = CreateBillSchema.safeParse(rawData);

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
        values: rawData,
      };
    }

    const data = validation.data;

    // 6. Start transaction
    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    // Use bill's companyId for lookups
    const billCompanyId = bill.companyId;

    // 8. Update supplier if changed (with null-safe check, tenant-scoped)
    if (data.supplierId !== bill.supplier?.partyId?.toString()) {
      const supplier = await Party.findOne(
        withTenantScope({ _id: data.supplierId }, billCompanyId, isSuperAdmin)
      )
        .session(mongoSession)
        .lean();
      if (!supplier) {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: "Supplier not found",
          fieldErrors: { supplierId: "Supplier not found" },
          values: rawData,
        };
      }

      if (!["supplier", "both"].includes(supplier.type)) {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: "Selected party is not a supplier",
          fieldErrors: { supplierId: "Selected party is not a supplier" },
          values: rawData,
        };
      }

      bill.supplier = {
        partyId: supplier._id,
        name: supplier.name,
        taxPin: supplier.taxPin || "",
        email: supplier.email || "",
        phone: supplier.phone || "",
        address: formatAddress(supplier.address)
          ? `${supplier.address.line1 || ""}, ${
              supplier.address.city || ""
            }`.trim()
          : "",
      };
    }

    // 9. Process lines — batch-resolve refs in 3 round-trips, then validate.
    const lineRefs = await batchResolveLineRefs({
      lines: data.lines,
      companyId: billCompanyId,
      isSuperAdmin,
      mongoSession,
    });
    const processedLines = [];

    for (let i = 0; i < data.lines.length; i++) {
      const line = data.lines[i];

      const account =
        line.accountId &&
        mongoose.Types.ObjectId.isValid(line.accountId)
          ? lineRefs.accounts.get(line.accountId.toString())
          : null;
      if (!account) {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: `Line ${i + 1}: Account not found`,
          fieldErrors: { [`lines.${i}.accountId`]: "Account not found" },
          values: rawData,
        };
      }

      if (!["expense", "asset"].includes(account.accountType)) {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: `Line ${i + 1}: Account must be expense or asset type`,
          fieldErrors: {
            [`lines.${i}.accountId`]: "Must be expense or asset account",
          },
          values: rawData,
        };
      }

      // Validate account is a detail account (not a header)
      if (account.canPost === false) {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: `Line ${i + 1}: "${
            account.accountName
          }" is a header account. Please select a detail account.`,
          fieldErrors: {
            [`lines.${i}.accountId`]: "Cannot post to header account",
          },
          values: rawData,
        };
      }

      // Get product from pre-fetched map, or use custom product name.
      let productData = null;
      const pid = line.productId;
      if (
        pid &&
        pid !== "No Product" &&
        pid !== "none" &&
        pid !== "" &&
        mongoose.Types.ObjectId.isValid(pid)
      ) {
        const product = lineRefs.products.get(pid.toString());
        if (product) {
          productData = {
            id: product._id,
            sku: product.SKU,
            name: product.name,
            isInventory: true,
          };
        }
      } else if (line.customProductName && line.customProductName.trim()) {
        // Custom service/expense item (not in inventory)
        productData = {
          id: null,
          sku: null,
          name: line.customProductName.trim(),
          isInventory: false,
        };
      }

      // Resolve optional asset link from pre-fetched map.
      const assetResolution = resolveLineAssetFromMap(
        line.assetId,
        lineRefs.assets,
      );
      if (assetResolution.error) {
        await mongoSession.abortTransaction();
        return {
          success: false,
          error: `Line ${i + 1}: ${assetResolution.error}`,
          fieldErrors: { [`lines.${i}.assetId`]: assetResolution.error },
          values: rawData,
        };
      }

      const amount = roundCurrency(line.quantity * line.unitPrice);
      const vatAmount = applyRate(amount, line.vatRate);

      processedLines.push({
        lineNumber: i + 1,
        product: productData,
        customProductName: line.customProductName?.trim() || null,
        description: line.description,
        account: {
          id: account._id,
          code: account.accountCode,
          name: account.accountName,
          type: account.accountType,
        },
        asset: assetResolution.snapshot || {
          id: null,
          assetNumber: null,
          name: null,
        },
        quantity: line.quantity,
        unit: line.unit || "pcs",
        unitPrice: line.unitPrice,
        amount,
        vat: {
          rate: line.vatRate,
          amount: vatAmount,
        },
        lineTotal: roundCurrency(amount + vatAmount),
      });
    }

    // 10. Recalculate bill amounts — round at every aggregation step
    const subtotal = roundCurrency(
      processedLines.reduce((sum, line) => sum + line.amount, 0),
    );
    const vatTotal = roundCurrency(
      processedLines.reduce((sum, line) => sum + (line.vat?.amount || 0), 0),
    );
    const total = roundCurrency(subtotal + vatTotal);
    const whtAmount = data.whtApplicable
      ? applyRate(subtotal, data.whtRate)
      : 0;
    const netPayable = roundCurrency(total - whtAmount);
    const paid = bill.amounts?.paid || 0;

    // 10. Update bill fields
    bill.supplierInvoiceNumber = data.supplierInvoiceNumber || "";
    bill.billDate = data.billDate;
    bill.dueDate = data.dueDate;
    bill.whtApplicable = data.whtApplicable;
    bill.whtRate = data.whtApplicable ? data.whtRate : 0;
    bill.lines = processedLines;
    bill.amounts = {
      subtotal,
      vat: vatTotal,
      total,
      wht: whtAmount,
      netPayable,
      paid,
      balance: netPayable - paid,
    };
    bill.title = data.title || "";
    bill.reference = data.reference || "";
    bill.description = data.description || "";
    bill.internalNotes = data.internalNotes || "";
    bill.lastModifiedBy = formatUser({ user });

    // Update project (optional)
    const oldProjectId = bill.projectId;
    const updatedProjectId = rawData.projectId;
    if (updatedProjectId) {
      const project = await Project.findById(updatedProjectId)
        .select("projectNumber name status")
        .session(mongoSession)
        .lean();
      if (project && project.status !== "closed") {
        bill.projectId = project._id;
        bill.project = { projectNumber: project.projectNumber, name: project.name };
      }
    } else {
      bill.projectId = undefined;
      bill.project = undefined;
    }

    // Update fiscal period
    const billDate = new Date(data.billDate);
    bill.fiscalPeriod = `${billDate.getFullYear()}-${String(
      billDate.getMonth() + 1
    ).padStart(2, "0")}`;

    // If was rejected, reset to draft
    if (bill.status === "rejected") {
      bill.status = "draft";
    }

    await bill.save({ session: mongoSession });

    // 11. Commit transaction and end session
    await mongoSession.commitTransaction();
    mongoSession.endSession();
    mongoSession = null; // Prevent finally from trying to end again

    // 12. Revalidate
    revalidatePath("/dashboard/bills");
    revalidatePath(`/dashboard/bills/${billId}`);
    revalidateProject(oldProjectId);
    revalidateProject(bill.projectId);
  } catch (error) {
    // Abort transaction on error
    if (mongoSession) {
      await mongoSession.abortTransaction();
    }

    console.error("Update bill error:", error);
    return {
      success: false,
      error: error.message || "Failed to update bill. Please try again.",
      values: rawData,
    };
  } finally {
    if (mongoSession) {
      mongoSession.endSession();
    }
  }

  // Redirect outside try/catch (redirect throws NEXT_REDIRECT)
  redirect(`/dashboard/bills/${billId}?success=Bill updated successfully`);
}

// ============================================
// SUBMIT BILL FOR APPROVAL
// ============================================
export async function submitBill(billId) {
  try {
    // Auth & tenant check
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    await dbConnect();

    // Get bill (tenant-scoped)
    const bill = await Bill.findOne(
      withTenantScope({ _id: billId }, companyId, isSuperAdmin)
    );
    if (!bill) {
      return { success: false, error: "Bill not found" };
    }

    // Authorization: Owner, Manager, Admin, or Accountant
    const canSubmit =
      isOwner(user, bill.createdBy) ||
      hasRole(user, ["SuperAdmin", "Admin", "Manager", "Accountant"]);

    if (!canSubmit) {
      return {
        success: false,
        error: "You can only submit bills you created",
      };
    }

    if (!bill.canSubmit) {
      return {
        success: false,
        error: `Cannot submit bill in ${bill.status} status`,
      };
    }

    // Use schema method
    await bill.submit(formatUser({ user }));

    revalidatePath("/dashboard/bills");
    revalidatePath(`/dashboard/bills/${billId}`);
    revalidateProject(bill.projectId);

    return {
      success: true,
      message: `Bill ${bill.billNumber} submitted for approval`,
    };
  } catch (error) {
    console.error("Submit bill error:", error);
    return {
      success: false,
      error: error.message || "Failed to submit bill",
    };
  }
}

// ============================================
// APPROVE BILL
// ============================================
export async function approveBill(billId) {
  try {
    // Auth & tenant check
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    // Role check: Only Manager and Admin
    if (!hasRole(user, BILL_ROLES.APPROVE)) {
      return {
        success: false,
        error: "Only Managers and Admins can approve bills",
      };
    }

    await dbConnect();

    // Get bill (tenant-scoped)
    const bill = await Bill.findOne(
      withTenantScope({ _id: billId }, companyId, isSuperAdmin)
    );
    if (!bill) {
      return { success: false, error: "Bill not found" };
    }

    // Separation of duties: Cannot approve own submission
    if (isOwner(user, bill.submittedBy) && user.role !== "Admin") {
      return {
        success: false,
        error: "You cannot approve bills you submitted. Ask another manager.",
      };
    }

    if (!bill.canApprove) {
      return {
        success: false,
        error: `Cannot approve bill in ${bill.status} status`,
      };
    }

    // Use schema method (creates JE, stock movements, tax transactions)
    // The approve method should use its own transaction internally
    await bill.approve(formatUser({ user }));

    // Update project financials — bill approved = committed cost
    if (bill.projectId) {
      await Project.findByIdAndUpdate(bill.projectId, {
        $inc: { "financials.totalCommitted": bill.amounts?.netPayable || 0 },
      });
    }

    revalidatePath("/dashboard/bills");
    revalidatePath(`/dashboard/bills/${billId}`);
    revalidatePath("/dashboard/journal");
    revalidatePath("/dashboard/stocks");
    revalidateProject(bill.projectId);

    return {
      success: true,
      message: `Bill ${bill.billNumber} approved and posted`,
      data: {
        journalEntryId: bill.accounting?.journalEntryId?.toString(),
      },
    };
  } catch (error) {
    console.error("Approve bill error:", error);
    return {
      success: false,
      error: error.message || "Failed to approve bill",
    };
  }
}

// ============================================
// REJECT BILL
// ============================================
export async function rejectBill(billId, prevState, formData) {
  try {
    // Auth & tenant check
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    // Role check
    if (!hasRole(user, BILL_ROLES.APPROVE)) {
      return {
        success: false,
        error: "Only Managers and Admins can reject bills",
      };
    }

    // Validate reason
    const rawData = Object.fromEntries(formData.entries());
    const validation = RejectBillSchema.safeParse(rawData);

    if (!validation.success) {
      return {
        success: false,
        error: "Please provide a rejection reason",
        fieldErrors: { reason: "Rejection reason is required" },
      };
    }

    await dbConnect();

    // Get bill (tenant-scoped)
    const bill = await Bill.findOne(
      withTenantScope({ _id: billId }, companyId, isSuperAdmin)
    );
    if (!bill) {
      return { success: false, error: "Bill not found" };
    }

    if (bill.status !== "submitted") {
      return {
        success: false,
        error: `Cannot reject bill in ${bill.status} status`,
      };
    }

    await bill.reject(formatUser({ user }), validation.data.reason);

    revalidatePath("/dashboard/bills");
    revalidatePath(`/dashboard/bills/${billId}`);
    revalidateProject(bill.projectId);

    return {
      success: true,
      message: `Bill ${bill.billNumber} rejected`,
    };
  } catch (error) {
    console.error("Reject bill error:", error);
    return {
      success: false,
      error: error.message || "Failed to reject bill",
    };
  }
}

// ============================================
// CANCEL BILL
// ============================================
export async function cancelBill(billId, prevState, formData) {
  try {
    // Auth & tenant check
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    // Role check
    if (!hasRole(user, BILL_ROLES.CANCEL)) {
      return {
        success: false,
        error: "Only Managers and Admins can cancel bills",
      };
    }

    // Validate reason
    const rawData = Object.fromEntries(formData.entries());
    const validation = CancelBillSchema.safeParse(rawData);

    if (!validation.success) {
      return {
        success: false,
        error: "Please provide a cancellation reason",
        fieldErrors: { reason: "Cancellation reason is required" },
      };
    }

    await dbConnect();

    // Get bill (tenant-scoped)
    const bill = await Bill.findOne(
      withTenantScope({ _id: billId }, companyId, isSuperAdmin)
    );
    if (!bill) {
      return { success: false, error: "Bill not found" };
    }

    if (!bill.canCancel) {
      return {
        success: false,
        error:
          bill.amounts?.paid > 0
            ? "Cannot cancel bill with payments. Reverse payments first."
            : `Cannot cancel bill in ${bill.status} status`,
      };
    }

    await bill.cancel(formatUser({ user }), validation.data.reason);

    revalidatePath("/dashboard/bills");
    revalidatePath(`/dashboard/bills/${billId}`);
    revalidatePath("/dashboard/journal");
    revalidateProject(bill.projectId);

    return {
      success: true,
      message: `Bill ${bill.billNumber} cancelled`,
    };
  } catch (error) {
    console.error("Cancel bill error:", error);
    return {
      success: false,
      error: error.message || "Failed to cancel bill",
    };
  }
}

// ============================================
// DELETE BILL (Draft only)
// ============================================
export async function deleteBill(billId) {
  try {
    // Auth & tenant check
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    await dbConnect();

    // Get bill (tenant-scoped)
    const bill = await Bill.findOne(
      withTenantScope({ _id: billId }, companyId, isSuperAdmin)
    );
    if (!bill) {
      return { success: false, error: "Bill not found" };
    }

    // Only drafts can be deleted
    if (bill.status !== "draft") {
      return {
        success: false,
        error:
          "Only draft bills can be deleted. Use cancel for submitted bills.",
      };
    }

    // Authorization: Owner, Manager, or Admin
    const canDelete =
      isOwner(user, bill.createdBy) || hasRole(user, ["SuperAdmin", "Admin", "Manager"]);

    if (!canDelete) {
      return {
        success: false,
        error: "You can only delete bills you created",
      };
    }

    // Defensive: refuse if any line has been capitalized into a fixed asset.
    // Capitalization should only happen on approved bills going forward, but
    // legacy data may contain drafts with capitalized lines — block those
    // rather than orphan the asset.
    const capitalizedLine = (bill.lines || []).find(
      (l) => l.capitalizedAssetId
    );
    if (capitalizedLine) {
      return {
        success: false,
        error:
          "Cannot delete: a line on this bill has been capitalized into a fixed asset. Dispose or write off the asset first.",
        capitalizedAssetId: capitalizedLine.capitalizedAssetId.toString(),
      };
    }

    const billNumber = bill.billNumber;
    const deletedProjectId = bill.projectId;
    await Bill.findByIdAndDelete(billId);

    revalidatePath("/dashboard/bills");
    revalidateProject(deletedProjectId);

    return {
      success: true,
      message: `Bill ${billNumber} deleted`,
    };
  } catch (error) {
    console.error("Delete bill error:", error);
    return {
      success: false,
      error: error.message || "Failed to delete bill",
    };
  }
}

// ============================================
// QUICK PAYMENT - Creates Payment + Records on Bill
// ============================================
// Creates a full Payment document and allocates it to the bill
// Use this for direct payments from the bill detail page
// ============================================
export async function createBillPayment(billId, prevState, formData) {
  const mongoSession = await mongoose.startSession();

  try {
    // Auth & tenant check
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    // Role check
    if (!hasRole(user, BILL_ROLES.PAYMENT)) {
      return {
        success: false,
        error: "You don't have permission to record payments",
      };
    }

    await dbConnect();

    // Parse form data
    const amount = parseFloat(formData.get("amount"));
    const paymentMethod = formData.get("paymentMethod");
    const accountId = formData.get("accountId");
    const paymentDate = formData.get("paymentDate") || new Date().toISOString();
    const reference = formData.get("reference") || "";
    const notes = formData.get("notes") || "";

    // Validation
    if (!amount || amount <= 0) {
      return {
        success: false,
        error: "Payment amount must be positive",
        fieldErrors: { amount: "Amount must be greater than zero" },
      };
    }

    if (!paymentMethod) {
      return {
        success: false,
        error: "Payment method is required",
        fieldErrors: { paymentMethod: "Please select a payment method" },
      };
    }

    if (!accountId) {
      return {
        success: false,
        error: "Payment account is required",
        fieldErrors: { accountId: "Please select a payment account" },
      };
    }

    mongoSession.startTransaction();

    // Get bill (tenant-scoped)
    const bill = await Bill.findOne(
      withTenantScope({ _id: billId }, companyId, isSuperAdmin)
    ).session(mongoSession);
    if (!bill) {
      await mongoSession.abortTransaction();
      return { success: false, error: "Bill not found" };
    }

    // Use bill's companyId for subsequent lookups
    const billCompanyId = bill.companyId;

    if (!bill.canPay) {
      await mongoSession.abortTransaction();
      return {
        success: false,
        error:
          bill.status !== "approved"
            ? "Bill must be approved before payment"
            : "Bill is already fully paid",
      };
    }

    // Three-way match (SOP §10.1 / industry standard). If the bill was
    // approved under strict mode (requireGRN ON), it posted to GR/IR
    // clearing — payment is blocked until at least one Goods Receipt
    // Note has been accepted, which is what flips bill.accounting
    // .inventoryMoved back to true. This is the audit control that
    // prevents AP from paying for goods nobody received.
    if (
      bill.accounting?.usedGRNI === true &&
      bill.accounting?.inventoryMoved !== true
    ) {
      await mongoSession.abortTransaction();
      return {
        success: false,
        error:
          "This bill is awaiting goods receipt. Create and accept a Goods Receipt Note before recording payment (three-way match).",
      };
    }

    if (amount > bill.amounts?.balance + 0.01) {
      await mongoSession.abortTransaction();
      return {
        success: false,
        error: `Payment amount (${amount.toFixed(
          2
        )}) exceeds balance (${bill.amounts?.balance?.toFixed(2)})`,
        fieldErrors: { amount: "Amount exceeds outstanding balance" },
      };
    }

    // Get payment account (tenant-scoped)
    const paymentAccount = await Account.findOne(
      withTenantScope({ _id: accountId }, billCompanyId, isSuperAdmin)
    ).session(mongoSession);
    if (!paymentAccount) {
      await mongoSession.abortTransaction();
      return {
        success: false,
        error: "Payment account not found",
        fieldErrors: { accountId: "Invalid account selected" },
      };
    }

    if (!["cash", "bank", "mpesa"].includes(paymentAccount.subType)) {
      await mongoSession.abortTransaction();
      return {
        success: false,
        error: "Payment account must be cash, bank, or M-Pesa type",
        fieldErrors: { accountId: "Select a cash, bank, or M-Pesa account" },
      };
    }

    // Import Payment model dynamically to avoid circular deps
    const Payment = (await import("@/app/models/payment")).default;

    // Generate payment number (tenant-scoped)
    const paymentNumber = await Payment.generatePaymentNumber("MADE", billCompanyId, mongoSession);

    // Calculate fiscal period from payment date
    const payDate = new Date(paymentDate);
    const fiscalPeriod = `${payDate.getFullYear()}-${String(
      payDate.getMonth() + 1
    ).padStart(2, "0")}`;

    // Create payment document (with tenant companyId)
    const payment = new Payment({
      companyId: billCompanyId,
      paymentNumber,
      paymentType: "made",
      paymentDate: payDate,
      fiscalPeriod,
      amount,
      paymentMethod,
      account: {
        id: paymentAccount._id,
        code: paymentAccount.accountCode,
        name: paymentAccount.accountName,
        subType: paymentAccount.subType,
      },
      party: {
        partyId: bill.supplier.partyId,
        type: "supplier",
        name: bill.supplier.name,
      },
      allocations: [
        {
          documentType: "bill",
          documentId: bill._id,
          documentNumber: bill.billNumber,
          documentDate: bill.billDate,
          originalAmount: bill.amounts.netPayable,
          balanceBefore: bill.amounts.balance,
          amountAllocated: amount,
        },
      ],
      description: `Payment for ${bill.billNumber}`,
      reference,
      notes,
      status: "draft",
      createdBy: formatUser({ user }),
    });

    await payment.save({ session: mongoSession });

    // Confirm payment (creates JE and updates bill via updateAllocatedDocuments)
    // Pass session so it uses our transaction instead of creating its own
    await payment.confirm(user, mongoSession);

    // Update project financials — payment moves from committed to actual cost
    if (bill.projectId) {
      await Project.findByIdAndUpdate(
        bill.projectId,
        {
          $inc: {
            "financials.totalCosts": amount,
            "financials.totalCommitted": -amount,
          },
        },
        { session: mongoSession }
      );
    }

    await mongoSession.commitTransaction();

    revalidatePath("/dashboard/bills");
    revalidatePath(`/dashboard/bills/${billId}`);
    revalidatePath("/dashboard/payments");
    revalidateProject(bill.projectId);

    return {
      success: true,
      message: `Payment of ${amount.toFixed(2)} recorded successfully`,
      data: {
        paymentId: payment._id.toString(),
        paymentNumber: payment.paymentNumber,
      },
    };
  } catch (error) {
    await mongoSession.abortTransaction();
    console.error("Create bill payment error:", error);
    return {
      success: false,
      error: error.message || "Failed to create payment",
    };
  } finally {
    mongoSession.endSession();
  }
}

// ============================================
// RECORD PAYMENT (For use with Payment module)
// ============================================
// @deprecated This function is no longer needed. Use createBillPayment instead,
// which creates a Payment document and calls payment.confirm() to handle
// the bill update within a transaction. The payment.confirm() method calls
// updateAllocatedDocuments() which properly updates the bill with session support.
// ============================================
export async function recordBillPayment(
  billId,
  paymentId,
  paymentNumber,
  amount,
  method,
  reference
) {
  console.warn(
    "recordBillPayment is deprecated. Use createBillPayment instead."
  );

  // This function should not be called directly anymore.
  // Payment.confirm() handles bill updates via updateAllocatedDocuments()
  return {
    success: false,
    error:
      "This function is deprecated. Use createBillPayment to create and confirm payments.",
  };
}

// ============================================
// REVERSE PAYMENT (For payment cancellation)
// ============================================
export async function reverseBillPayment(billId, paymentId, amount) {
  try {
    // Auth & tenant check
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    // Only Admin can reverse payments
    if (!hasRole(user, ["SuperAdmin", "Admin"])) {
      return {
        success: false,
        error: "Only Admins can reverse payments",
      };
    }

    await dbConnect();

    // Get bill (tenant-scoped)
    const bill = await Bill.findOne(
      withTenantScope({ _id: billId }, companyId, isSuperAdmin)
    );
    if (!bill) {
      return { success: false, error: "Bill not found" };
    }

    await bill.reversePayment(paymentId, amount);

    revalidatePath("/dashboard/bills");
    revalidatePath(`/dashboard/bills/${billId}`);
    revalidatePath("/dashboard/payments");
    revalidateProject(bill.projectId);

    return {
      success: true,
      message: `Payment reversed on bill ${bill.billNumber}`,
      data: {
        paymentStatus: bill.paymentStatus,
        balance: bill.amounts?.balance,
      },
    };
  } catch (error) {
    console.error("Reverse payment error:", error);
    return {
      success: false,
      error: error.message || "Failed to reverse payment",
    };
  }
}
