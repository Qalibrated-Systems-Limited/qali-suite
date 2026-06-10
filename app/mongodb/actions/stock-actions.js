"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import Product from "@/app/models/product";
import { StockMovement } from "../../models/stockmovement";
import InventoryAdjustment from "@/app/models/inventoryAdjustment";
import dbConnect from "@/app/config/dbConnect";
import Category from "@/app/models/category";
import mongoose from "mongoose";
import { fetchStockData } from "@/app/mongodb/queries/product-queries";
import {
  getTenantContext,
  getCompanyIdForCreate,
  withTenantScope,
} from "@/lib/utils/tenant-utils";

// ============================================
// AUTH HELPERS
// ============================================

// Default product/inventory write authority — who can create/edit the
// product master at all. Store Manager included so they can register
// new items they handle; cost / price gating is a separate concern
// below (split from this list to match standard ERP SoD).
const DEFAULT_PRODUCT_ROLES = [
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Manager",
  "Store Manager",
];

// Who can set / update purchase cost (touches COGS + GL via opening
// balance + landed cost flows). Operational + finance roles.
// Excludes Sales Manager — they shouldn't touch cost (SoD: same
// person shouldn't set both their own cost and their selling price).
const COST_ROLES = [
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Procurement Officer",
];

// Who can set / update selling price (commercial decision). Sales
// Manager included; Manager kept here (typical SMB "GM" interpretation)
// but excluded from COST_ROLES.
const PRICE_ROLES = [
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Sales Manager",
  "Manager",
];

// Pricing policy — minimum price floor, costing method, discount caps.
// Tightest set: changing these re-prices history or moves the margin
// floor, so finance leadership only.
// eslint-disable-next-line no-unused-vars
const PRICING_POLICY_ROLES = [
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
];

function checkPermission(user, allowedRoles = DEFAULT_PRODUCT_ROLES) {
  if (!user) {
    return {
      error: { _form: ["You must be logged in to perform this action"] },
    };
  }
  if (!allowedRoles.includes(user.role)) {
    return { error: { _form: ["You don't have permission for this action"] } };
  }
  return null;
}

// ============================================
// VALIDATION SCHEMAS
// ============================================

const addProductSchema = z.object({
  name: z.string().min(1, "Product name is required").max(200),
  sku: z.string().min(1, "SKU is required").max(50),
  description: z.string().max(1000, "Description is too long").optional(),
  category: z.string().min(1, "Category is required"),
  type: z.enum(["product", "service", "kit"]).default("product"),
  unit: z.string().default("piece"),
  costPrice: z.coerce.number().min(0, "Cost price must be positive").optional(),
  sellingPrice: z.coerce
    .number()
    .min(0, "Selling price must be positive")
    .optional(),
  taxRate: z.coerce.number().min(0).max(100).default(16),
  initialStock: z.coerce.number().int("Stock must be a whole number").min(0).default(0),
  reorderLevel: z.coerce.number().int("Reorder level must be a whole number").min(0).default(10),
  reorderQuantity: z.coerce.number().int("Reorder quantity must be a whole number").min(0).default(20),
  costingMethod: z
    .enum(["average", "weighted_average", "fifo", "lifo", "specific"])
    .default("average"),
  location: z.string().optional(),
  binNumber: z.string().optional(),
  trackInventory: z.coerce.boolean().default(true),
  allowNegativeStock: z.coerce.boolean().default(false),
  isActive: z.coerce.boolean().default(true),
});

const updateProductSchema = z.object({
  name: z.string().min(1, "Product name is required").max(200),
  sku: z.string().min(1, "SKU is required").max(50),
  description: z.string().max(1000).optional(),
  category: z.string().min(1, "Category is required"),
  // Accept any string for type - database has various values like "Inventory Item", "product", etc.
  type: z.string().default("Inventory Item"),
  unit: z.string().default("piece"),
  costPrice: z.coerce.number().min(0).optional(),
  sellingPrice: z.coerce.number().min(0).optional(),
  taxRate: z.coerce.number().min(0).max(100).default(16),
  taxExempt: z.coerce.boolean().default(false),
  reorderLevel: z.coerce.number().int("Reorder level must be a whole number").min(0).default(10),
  reorderQuantity: z.coerce.number().int("Reorder quantity must be a whole number").min(0).default(20),
  costingMethod: z
    .enum(["average", "weighted_average", "fifo", "lifo", "specific"])
    .default("average"),
  location: z.string().optional(),
  binNumber: z.string().optional(),
  trackInventory: z.coerce.boolean().default(true),
  allowNegativeStock: z.coerce.boolean().default(false),
  isActive: z.coerce.boolean().default(true),
  supplierName: z.string().optional(),
  supplierCode: z.string().optional(),
  leadTime: z.coerce.number().int("Lead time must be a whole number").min(0).optional(),
});

// ============================================
// ADD PRODUCT
// ============================================

export async function addProduct(prevState, formData) {
  // Auth check with tenant context
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return {
      error: { _form: [error.message] },
    };
  }

  const permError = checkPermission(user, DEFAULT_PRODUCT_ROLES);
  if (permError) return permError;

  // Get tenant companyId for create
  let tenantCompanyId;
  try {
    tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);
  } catch (error) {
    return {
      error: { _form: [error.message] },
    };
  }

  // Parse form data
  const rawData = {
    name: formData.get("name"),
    sku: formData.get("sku"),
    description: formData.get("description"),
    category: formData.get("category"),
    type: formData.get("type"),
    unit: formData.get("unit"),
    costPrice: formData.get("costPrice"),
    sellingPrice: formData.get("sellingPrice"),
    taxRate: formData.get("taxRate"),
    initialStock: formData.get("initialStock"),
    reorderLevel: formData.get("reorderLevel"),
    reorderQuantity: formData.get("reorderQuantity"),
    costingMethod: formData.get("costingMethod"),
    location: formData.get("location"),
    binNumber: formData.get("binNumber"),
    trackInventory: formData.get("trackInventory") === "true",
    allowNegativeStock: formData.get("allowNegativeStock") === "true",
    isActive: formData.get("isActive") !== "false",
  };

  // Validate
  const validationResult = addProductSchema.safeParse(rawData);
  if (!validationResult.success) {
    return {
      error: validationResult.error.flatten().fieldErrors,
    };
  }

  const data = validationResult.data;

  // Connect to database
  await dbConnect();

  // Validate category exists (tenant-scoped)
  const category = await Category.findOne(
    withTenantScope({ _id: new mongoose.Types.ObjectId(data.category) }, tenantCompanyId, isSuperAdmin)
  );
  if (!category) {
    return {
      error: {
        category: ["Invalid category"],
      },
    };
  }

  // Check for duplicate SKU (tenant-scoped)
  const existingProduct = await Product.findOne(
    withTenantScope({ SKU: data.sku }, tenantCompanyId, isSuperAdmin)
  );
  if (existingProduct) {
    return {
      error: {
        sku: ["A product with this SKU already exists"],
      },
    };
  }

  // Split pricing authority by SoD: cost vs selling are different
  // decisions made by different people. See COST_ROLES / PRICE_ROLES
  // declarations at the top of this file.
  const canSetCost = COST_ROLES.includes(user.role);
  const canSetPrice = PRICE_ROLES.includes(user.role);
  if (!canSetCost) {
    data.costPrice = 0;
  }
  if (!canSetPrice) {
    data.sellingPrice = 0;
  }

  // Guard: a non-cost-setter cannot register opening stock — the
  // resulting opening-balance adjustment would have zero value and
  // skip the GL post, leaving inventory off the books. Force them to
  // either create with zero stock (so a manager can backfill cost
  // first) or hand the create over to someone with cost rights.
  if (data.initialStock > 0 && !canSetCost) {
    return {
      error: {
        initialStock: [
          "Cost price must be set before adding initial stock. Save with zero stock and ask a manager with cost-pricing rights to add stock via Adjustments, or have them create the product.",
        ],
      },
    };
  }

  // Even when the user CAN set cost, refuse zero-cost initial stock —
  // the opening-balance JE would be skipped and the balance sheet
  // wouldn't reflect the inventory value.
  if (data.initialStock > 0 && (!data.costPrice || data.costPrice <= 0)) {
    return {
      error: {
        initialStock: [
          "Initial stock requires a non-zero cost price. The opening-balance journal entry cannot post without a valuation.",
        ],
      },
    };
  }

  // Create product + (optionally) post the opening-balance adjustment in a
  // single transaction. Industry standard: opening stock must hit the GL
  // through a journaled adjustment so the balance sheet's Inventory
  // account always agrees with physical quantity × cost. The product
  // itself is created with quantityOnHand = 0 — the adjustment.approve()
  // path is the only thing that mutates inventory and posts the JE.
  const session = await mongoose.startSession();
  session.startTransaction();
  let product;
  try {
    const costing = {
      costPrice: canSetCost ? data.costPrice || 0 : 0,
      costingMethod: data.costingMethod,
    };
    const pricing = {
      sellingPrice: canSetPrice ? data.sellingPrice || 0 : 0,
    };
    const storeInfo = {
      location: data.location || "",
      binNumber: data.binNumber || "",
      trackInventory: data.trackInventory,
      allowNegativeStock: data.allowNegativeStock,
    };

    const [createdProduct] = await Product.create(
      [
        {
          companyId: tenantCompanyId,
          name: data.name,
          SKU: data.sku,
          description: data.description || "",
          category: category.name,
          type: data.type,
          unit: data.unit,
          taxRate: data.taxRate,
          isActive: data.isActive,
          costing,
          pricing,
          inventory: {
            quantityOnHand: 0,
            quantityAvailable: 0,
            quantityCommitted: 0,
            reorderLevel: data.reorderLevel || 0,
            reorderQuantity: data.reorderQuantity || 0,
          },
          storeInfo,
          createdBy: { id: user.id, name: user.name },
        },
      ],
      { session },
    );
    product = createdProduct;

    // Opening balance: route through InventoryAdjustment.approve() so the
    // inventory mutation, the StockMovement audit row, and the journal
    // entry (DR Inventory / CR Opening Balance Equity || Inventory
    // Adjustment) all happen atomically inside our session.
    if (data.initialStock > 0 && data.trackInventory) {
      // canSetCost is guaranteed true here — guarded above. Falling back
      // to the raw value rather than zero so the guard remains the
      // single source of truth.
      const unitCost = data.costPrice || 0;
      // Counter generation is intentionally non-transactional — the Counter
      // model auto-increments outside our session so concurrent products
      // don't deadlock on the same counter doc.
      const adjustmentNumber =
        await InventoryAdjustment.generateAdjustmentNumber(tenantCompanyId);

      const [adjustment] = await InventoryAdjustment.create(
        [
          {
            companyId: tenantCompanyId,
            adjustmentNumber,
            adjustmentDate: new Date(),
            adjustmentType: "opening_balance",
            description: `Opening balance for ${product.SKU}`,
            notes:
              "Initial stock seeded at product creation. Posts DR Inventory / CR Opening Balance Equity.",
            lines: [
              {
                productId: product._id,
                productSKU: product.SKU,
                productName: product.name,
                productUnit: product.unit,
                systemQuantity: 0,
                physicalQuantity: data.initialStock,
                adjustmentQuantity: data.initialStock,
                unitCost,
                adjustmentValue: unitCost * data.initialStock,
                reason: "Opening balance",
              },
            ],
            status: "draft",
            createdBy: { id: user.id, name: user.name },
          },
        ],
        { session },
      );

      // Opening balance is an explicit, industry-accepted SoD exception:
      // the creator IS the approver since this is a setup/migration step
      // (mirrors Odoo, QuickBooks, Zoho). The adjustment number provides
      // the audit trail.
      await adjustment.approve(
        { name: user.name, id: user.id },
        session,
      );
    }

    await session.commitTransaction();
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    console.error("Failed to create product:", error);
    return {
      error: {
        _form: [
          `Failed to create product${
            error?.message ? `: ${error.message}` : ""
          }. Please try again.`,
        ],
      },
    };
  } finally {
    session.endSession();
  }

  revalidatePath("/dashboard/stocks");
  redirect(
    `/dashboard/stocks?success=${encodeURIComponent(
      `Product "${data.name}" created successfully`,
    )}`,
  );
}

// ============================================
// UPDATE PRODUCT
// ============================================

export async function updateProduct(productId, prevState, formData) {
  // Auth check with tenant context
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return {
      error: { _form: [error.message] },
    };
  }

  const permError = checkPermission(user, DEFAULT_PRODUCT_ROLES);
  if (permError) return permError;

  // Validate product ID
  if (!productId) {
    console.log("error", "");
    return {
      error: {
        _form: ["Product ID is required"],
      },
    };
  }

  // Parse form data
  const rawData = {
    name: formData.get("name"),
    sku: formData.get("sku"),
    description: formData.get("description"),
    category: formData.get("category"),
    type: formData.get("type"),
    unit: formData.get("unit"),
    costPrice: formData.get("costPrice"),
    sellingPrice: formData.get("sellingPrice"),
    taxRate: formData.get("taxRate"),
    taxExempt: formData.get("taxExempt") === "true",
    reorderLevel: formData.get("reorderLevel"),
    reorderQuantity: formData.get("reorderQuantity"),
    costingMethod: formData.get("costingMethod"),
    location: formData.get("location"),
    binNumber: formData.get("binNumber"),
    trackInventory: formData.get("trackInventory") === "true",
    allowNegativeStock: formData.get("allowNegativeStock") === "true",
    isActive: formData.get("isActive") !== "false",
    supplierName: formData.get("supplierName"),
    supplierCode: formData.get("supplierCode"),
    leadTime: formData.get("leadTime"),
  };

  // Validate
  const validationResult = updateProductSchema.safeParse(rawData);

  console.log(rawData);
  if (!validationResult.success) {
    console.log(validationResult.error.flatten());
    return {
      error: validationResult.error.flatten().fieldErrors,
    };
  }

  const data = validationResult.data;

  // Connect to database
  await dbConnect();

  // Validate category exists and get category name (tenant-scoped)
  const category = await Category.findOne(
    withTenantScope({ _id: new mongoose.Types.ObjectId(data.category) }, companyId, isSuperAdmin)
  );
  if (!category) {
    return {
      error: {
        category: ["Invalid category"],
      },
    };
  }

  // Find product (tenant-scoped)
  const product = await Product.findOne(
    withTenantScope({ _id: productId }, companyId, isSuperAdmin)
  );
  if (!product) {
    return {
      error: {
        _form: ["Product not found"],
      },
    };
  }

  // Check SKU uniqueness (if changed, tenant-scoped)
  if (data.sku !== product.SKU) {
    const existingProduct = await Product.findOne(
      withTenantScope({
        SKU: data.sku,
        _id: { $ne: productId },
      }, companyId, isSuperAdmin)
    );
    if (existingProduct) {
      return {
        error: {
          sku: ["A product with this SKU already exists"],
        },
      };
    }
  }

  const costing = {
    ...product.costing,
    costPrice: data.costPrice > 0 ? data.costPrice : product.costing.costPrice,
    costingMethod: data.costingMethod,
  };
  const pricing = {
    ...product.pricing,
    sellingPrice:
      data.sellingPrice > 0 ? data.sellingPrice : product.pricing.sellingPrice,
  };

  const inventory = {
    ...product.inventory,

    reorderLevel: data.reorderLevel,
    reorderQuantity: data.reorderQuantity,
  };
  const supplier = product.supplier;
  if (data.supplierName) {
    supplier.name = data.supplierName;
  }

  if (data.supplierCode) {
    supplier.code = data.supplierCode;
  }

  const storeInfo = {
    ...product.storeInfo,
    location: data.location || "",
    binNumber: data.binNumber || "",
    trackInventory: data.trackInventory,
    allowNegativeStock: data.allowNegativeStock,
  };

  // Build update object
  const updateData = {
    storeInfo,
    inventory,
    name: data.name,
    SKU: data.sku,
    description: data.description || "",
    category: category.name, // ✅ Save category NAME, not ID
    type: data.type,
    unit: data.unit,
    taxRate: data.taxRate,
    taxExempt: data.taxExempt,
    reorderLevel: data.reorderLevel,
    reorderQuantity: data.reorderQuantity,
    costingMethod: data.costingMethod,
    location: data.location || "",
    binNumber: data.binNumber || "",
    trackInventory: data.trackInventory,
    allowNegativeStock: data.allowNegativeStock,
    isActive: data.isActive,
    supplier,
    lastModifiedBy: {
      id: user.id,
      name: user.name,
    },
  };

  // Split: cost edits and selling-price edits go through different
  // role gates (same SoD as create). A Sales Manager can change
  // selling price but not cost; a Procurement Officer can change cost
  // but not selling price.
  const canSetCost = COST_ROLES.includes(user.role);
  const canSetPrice = PRICE_ROLES.includes(user.role);
  if (canSetCost) {
    updateData.costing = costing;
  }
  if (canSetPrice) {
    updateData.pricing = pricing;
  }

  // Update supplier info if provided
  if (data.supplierName || data.supplierCode) {
    updateData.supplier = {
      name: data.supplierName || "",
      code: data.supplierCode || "",
      leadTime: data.leadTime || 0,
    };
  }

  // Update product (tenant-scoped)
  try {
    await Product.findOneAndUpdate(
      withTenantScope({ _id: productId }, companyId, isSuperAdmin),
      updateData
    );
  } catch (error) {
    console.error("Failed to update product:", error);
    return {
      error: {
        _form: ["Failed to update product. Please try again."],
      },
    };
  }

  // Success - revalidate and redirect with success message
  revalidatePath("/dashboard/stocks");
  revalidatePath(`/dashboard/stocks/${productId}`);
  redirect(
    `/dashboard/stocks/${productId}?success=${encodeURIComponent(
      `Product "${data.name}" updated successfully`
    )}`
  );
}

// ============================================
// DELETE PRODUCT
// ============================================

export async function deleteProduct(productId) {
  // Auth check with tenant context
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return {
      error: { _form: [error.message] },
    };
  }

  const permError = checkPermission(user, [
    "SuperAdmin",
    "Admin",
    "CFO",
    "Finance Manager",
    "Manager",
  ]);
  if (permError) return permError;

  // Validate product ID
  if (!productId) {
    return {
      error: {
        _form: ["Product ID is required"],
      },
    };
  }

  await dbConnect();

  // Find product (tenant-scoped)
  const product = await Product.findOne(
    withTenantScope({ _id: productId }, companyId, isSuperAdmin)
  );
  if (!product) {
    return {
      error: {
        _form: ["Product not found"],
      },
    };
  }

  // Check if product has stock
  const onHand = product.inventory?.quantityOnHand ?? 0;
  if (onHand > 0) {
    return {
      error: {
        _form: [
          `Cannot delete product with ${onHand} units in stock. Use Stock Adjustment to zero out inventory first.`,
        ],
      },
    };
  }

  // Check for related movements (tenant-scoped)
  const movementCount = await StockMovement.countDocuments(
    withTenantScope({ productId: productId }, companyId, isSuperAdmin)
  );
  if (movementCount > 0) {
    // Soft delete instead (tenant-scoped)
    try {
      await Product.findOneAndUpdate(
        withTenantScope({ _id: productId }, companyId, isSuperAdmin),
        {
          isActive: false,
          deletedAt: new Date(),
          deletedBy: {
            id: user.id,
            name: user.name,
          },
        }
      );
    } catch (error) {
      console.error("Failed to deactivate product:", error);
      return {
        error: {
          _form: ["Failed to deactivate product. Please try again."],
        },
      };
    }

    revalidatePath("/dashboard/products");
    redirect(
      "/dashboard/products?success=Product+deactivated+successfully+(has+history)"
    );
  }

  // Hard delete if no history (tenant-scoped)
  try {
    await Product.findOneAndDelete(
      withTenantScope({ _id: productId }, companyId, isSuperAdmin)
    );
  } catch (error) {
    console.error("Failed to delete product:", error);
    return {
      error: {
        _form: ["Failed to delete product. Please try again."],
      },
    };
  }

  // Success - revalidate and redirect
  revalidatePath("/dashboard/products");
  redirect("/dashboard/products?success=Product+deleted+successfully");
}

// ============================================
// HELPER: Generate Movement Number
// ============================================

async function generateMovementNumber(tenantCompanyId) {
  const today = new Date();
  const dateStr = today.toISOString().slice(2, 10).replace(/-/g, "");
  const prefix = `MOV-${dateStr}`;

  // Find the highest number for today (tenant-scoped)
  const lastMovement = await StockMovement.findOne({
    companyId: tenantCompanyId,
    movementNumber: { $regex: `^${prefix}` },
  })
    .sort({ movementNumber: -1 })
    .select("movementNumber");

  let sequence = 1;
  if (lastMovement) {
    const lastSeq = parseInt(lastMovement.movementNumber.split("-").pop(), 10);
    sequence = lastSeq + 1;
  }

  return `${prefix}-${sequence.toString().padStart(4, "0")}`;
}

// ============================================
// GET PRODUCTS (For lists/dropdowns)
// No auth needed - read only
// ============================================

export async function getProducts(options = {}) {
  const {
    category,
    type,
    isActive = true,
    search,
    page = 1,
    limit = 20,
    sortBy = "name",
    sortOrder = "asc",
  } = options;

  // Get tenant context
  let companyId, isSuperAdmin;
  try {
    ({ companyId, isSuperAdmin } = await getTenantContext());
  } catch (error) {
    return {
      products: [],
      pagination: { page: 1, limit, total: 0, totalPages: 0 },
    };
  }

  await dbConnect();

  // Build query with tenant scoping
  let query = {};
  if (isActive !== undefined) query.isActive = isActive;
  if (category) query.category = category;
  if (type) query.type = type;
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { SKU: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }

  // Apply tenant scope
  query = withTenantScope(query, companyId, isSuperAdmin);

  // Execute query
  const skip = (page - 1) * limit;
  const sortDir = sortOrder === "desc" ? -1 : 1;

  const [products, total] = await Promise.all([
    Product.find(query)
      .sort({ [sortBy]: sortDir })
      .skip(skip)
      .limit(limit)
      .populate("category", "name")
      .lean(),
    Product.countDocuments(query),
  ]);

  // Serialize for client
  const serialized = products.map((p) => ({
    ...p,
    _id: p._id.toString(),
    category: p.category
      ? {
          _id: p.category._id.toString(),
          name: p.category.name,
        }
      : null,
    createdAt: p.createdAt?.toISOString(),
    updatedAt: p.updatedAt?.toISOString(),
  }));

  return {
    products: serialized,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

// ============================================
// GET SINGLE PRODUCT
// No auth needed - read only
// ============================================

export async function getProduct(productId) {
  if (!productId) return null;

  // Get tenant context
  let companyId, isSuperAdmin;
  try {
    ({ companyId, isSuperAdmin } = await getTenantContext());
  } catch (error) {
    return null;
  }

  await dbConnect();

  // Find product with tenant scoping
  const product = await Product.findOne(
    withTenantScope({ _id: productId }, companyId, isSuperAdmin)
  )
    .populate("category", "name")
    .lean();

  if (!product) return null;

  // Serialize for client
  return {
    ...product,
    _id: product._id.toString(),
    category: product.category
      ? {
          _id: product.category?._id?.toString(),
          name: product.category?.name,
        }
      : null,
    createdAt: product.createdAt?.toISOString(),
    updatedAt: product.updatedAt?.toISOString(),
  };
}

// ============================================
// PRICING UPDATE — markup-driven, audit-logged
// ============================================
// Industry-standard segregation: pricing decisions belong to commercial /
// finance roles, not stockkeepers. Storekeeper / Employee never reach this.
//
// Modes:
//   "markup" — caller sets markupPercent; selling price is derived
//              (cost × (1 + markup/100)). Recomputes whenever cost changes.
//   "manual" — caller pins a specific selling price. Markup is reflected.
//
// Optional minimum-margin floor: if pricing.minimumPrice > 0 and the new
// selling price would fall below it, the change is rejected unless the
// caller is Admin / CFO (override authority).
const PRICING_ROLES = [
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Sales Manager",
];

const PRICING_OVERRIDE_ROLES = ["SuperAdmin", "Admin", "CFO"];

const PricingSchema = z.object({
  priceMode: z.enum(["manual", "markup"]),
  markupPercent: z.coerce.number().min(0).max(10000).optional(),
  sellingPrice: z.coerce.number().min(0).optional(),
  minimumPrice: z.coerce.number().min(0).optional(),
  reason: z.string().max(500).optional().default(""),
});

export async function updateProductPricing(productId, prevState, formData) {
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return { success: false, error: "Unauthorized" };
  }

  if (!PRICING_ROLES.includes(user.role)) {
    return {
      success: false,
      error:
        "Only Sales Manager, Finance Manager, CFO, or Admin can change pricing.",
    };
  }

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    return { success: false, error: "Invalid product id" };
  }

  const raw = Object.fromEntries(formData.entries());
  const parsed = PricingSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid pricing input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  try {
    await dbConnect();

    const filter = isSuperAdmin
      ? { _id: productId }
      : { _id: productId, companyId };
    const product = await Product.findOne(filter);
    if (!product) return { success: false, error: "Product not found" };

    const cost = Number(product.costing?.costPrice) || 0;
    const previousPrice = Number(product.pricing?.sellingPrice) || 0;
    const previousMarkup = Number(product.pricing?.markupPercentage) || 0;

    // Compute the prospective new selling price for validation purposes.
    let nextSelling;
    let nextMarkup;
    if (data.priceMode === "markup") {
      if (data.markupPercent === undefined) {
        return {
          success: false,
          error: "Markup percent is required in markup mode",
        };
      }
      nextMarkup = Number(data.markupPercent);
      nextSelling =
        cost > 0 ? Math.round(cost * (1 + nextMarkup / 100) * 100) / 100 : 0;
    } else {
      if (data.sellingPrice === undefined) {
        return {
          success: false,
          error: "Selling price is required in manual mode",
        };
      }
      nextSelling = Number(data.sellingPrice);
      nextMarkup = cost > 0 ? ((nextSelling - cost) / cost) * 100 : 0;
    }

    // Floor / below-cost / below-margin guards. The first two are
    // per-product (minimumPrice on the product doc); margin floor is
    // company-wide (Company.settings.approvalThresholds.minimumMarginPercent).
    // If the caller can override (Admin/CFO), apply directly. Otherwise
    // route the change through the approval engine.
    const effectiveFloor =
      data.minimumPrice !== undefined
        ? data.minimumPrice
        : Number(product.pricing?.minimumPrice) || 0;
    const belowFloor = effectiveFloor > 0 && nextSelling < effectiveFloor;
    const belowCost = cost > 0 && nextSelling < cost;

    // Margin floor — per-tenant configurable
    const { getCompanyThresholds } = await import(
      "@/app/mongodb/queries/threshold-queries"
    );
    const thresholds = await getCompanyThresholds(
      companyId?.toString?.() || companyId,
    );
    const proposedMargin =
      nextSelling > 0 ? ((nextSelling - cost) / nextSelling) * 100 : 0;
    const belowMarginFloor =
      thresholds.minimumMarginPercent > 0 &&
      cost > 0 &&
      nextSelling > 0 &&
      proposedMargin < thresholds.minimumMarginPercent;

    const needsApproval =
      (belowFloor || belowCost || belowMarginFloor) &&
      !PRICING_OVERRIDE_ROLES.includes(user.role);

    if (needsApproval) {
      // Submit an approval request and DO NOT apply the change yet.
      const { submitApproval } = await import("./approval-actions");

      // Already pending? Don't stack competing requests for the same product —
      // approving two would apply the price change twice. (Mirrors the guard
      // on bill_payment / credit_note.) Include "applying" so an in-flight
      // lease also blocks a fresh submission.
      const { default: ApprovalRequest } = await import(
        "@/app/models/approvalRequest"
      );
      const existingApproval = await ApprovalRequest.findOne({
        companyId,
        type: "price_change",
        status: { $in: ["submitted", "applying"] },
        "targetRef.kind": "Product",
        "targetRef.id": product._id,
      })
        .select("_id requestNumber")
        .lean();
      if (existingApproval) {
        return {
          success: false,
          error: `Approval ${existingApproval.requestNumber} is already pending for this product.`,
        };
      }

      const reasonParts = [];
      if (belowCost) reasonParts.push("Selling price below cost");
      if (belowFloor)
        reasonParts.push(
          `Selling price ${nextSelling.toFixed(2)} below floor ${effectiveFloor.toFixed(2)}`,
        );
      if (belowMarginFloor)
        reasonParts.push(
          `Margin ${proposedMargin.toFixed(1)}% below company minimum ${thresholds.minimumMarginPercent}%`,
        );
      const result = await submitApproval({
        type: "price_change",
        targetRef: {
          kind: "Product",
          id: product._id,
          label: `${product.SKU} — ${product.name}`,
        },
        payload: {
          priceMode: data.priceMode,
          markupPercent: data.markupPercent,
          sellingPrice: data.sellingPrice,
          minimumPrice: data.minimumPrice,
        },
        reason: reasonParts.join("; "),
        requesterNote: data.reason || "",
        context: {
          cost,
          previousPrice,
          previousMarkup,
          floor: effectiveFloor,
          marginFloorPercent: thresholds.minimumMarginPercent,
          proposedSelling: nextSelling,
          proposedMarkup: nextMarkup,
          proposedMargin,
        },
      });
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return {
        success: true,
        requiresApproval: true,
        approval: result.approval,
      };
    }

    // Apply changes (pre-save hook will recompute margins consistently).
    product.pricing.priceMode = data.priceMode;
    if (data.minimumPrice !== undefined) {
      product.pricing.minimumPrice = data.minimumPrice;
    }
    if (data.priceMode === "markup") {
      product.pricing.markupPercentage = nextMarkup;
      // sellingPrice is (re)derived by the pre-save hook.
    } else {
      product.pricing.sellingPrice = nextSelling;
    }
    product.pricing.lastPriceUpdate = new Date();

    // Audit trail — append-only.
    product.pricing.priceHistory = product.pricing.priceHistory || [];
    product.pricing.priceHistory.push({
      previousPrice,
      newPrice: nextSelling,
      previousMarkup,
      newMarkup: nextMarkup,
      costAtChange: cost,
      mode: data.priceMode,
      reason: data.reason || "",
      changedBy: {
        name: user.name || user.email || "System",
        id: user.id || user._id?.toString?.() || "",
        role: user.role || "",
      },
      changedAt: new Date(),
    });

    await product.save();

    revalidatePath("/dashboard/stocks");
    revalidatePath(`/dashboard/stocks/${productId}`);

    return {
      success: true,
      pricing: {
        sellingPrice: product.pricing.sellingPrice,
        markupPercentage: product.pricing.markupPercentage,
        marginPercentage: product.pricing.marginPercentage,
        priceMode: product.pricing.priceMode,
      },
    };
  } catch (error) {
    console.error("updateProductPricing error:", error);
    return {
      success: false,
      error: error.message || "Failed to update pricing",
    };
  }
}

// ============================================
// STOCK PDF DATA (lazy — invoked on user click)
// ============================================
//
// Previously fetchStockData() was called inside StockPDFExportServer on
// every /dashboard/stocks render so a button could be "ready" with the
// data baked in. That meant a full-collection projection on every page
// load. This action lets the client fetch the data only when the user
// actually clicks "Export PDF", removing the heaviest query from the
// SSR critical path.
export async function getStockPdfData() {
  try {
    const data = await fetchStockData();
    return { success: true, data };
  } catch (error) {
    console.error("getStockPdfData error:", error);
    return {
      success: false,
      error: error?.message || "Failed to load stock data",
    };
  }
}
