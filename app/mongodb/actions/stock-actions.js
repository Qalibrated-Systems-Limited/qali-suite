"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";

import Product from "@/app/models/product";
import { StockMovement } from "../../models/stockmovement";
import dbConnect from "@/app/config/dbConnect";
import Category from "@/app/models/category";
import mongoose from "mongoose";

// ============================================
// AUTH HELPERS
// ============================================

async function getCurrentUser() {
  const session = await auth();
  if (!session?.user) return null;
  return session.user;
}

function checkPermission(
  user,
  allowedRoles = ["admin", "manager", "store_manager"]
) {
  if (!user) {
    return {
      error: { _form: ["You must be logged in to perform this action"] },
    };
  }
  if (!allowedRoles.includes(user.role.toLowerCase())) {
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
  initialStock: z.coerce.number().min(0).default(0),
  reorderLevel: z.coerce.number().min(0).default(10),
  reorderQuantity: z.coerce.number().min(0).default(20),
  costingMethod: z
    .enum(["weighted_average", "fifo", "lifo"])
    .default("weighted_average"),
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
  reorderLevel: z.coerce.number().min(0).default(10),
  reorderQuantity: z.coerce.number().min(0).default(20),
  costingMethod: z
    .enum(["weighted_average", "fifo", "lifo"])
    .default("weighted_average"),
  location: z.string().optional(),
  binNumber: z.string().optional(),
  trackInventory: z.coerce.boolean().default(true),
  allowNegativeStock: z.coerce.boolean().default(false),
  isActive: z.coerce.boolean().default(true),
  supplierName: z.string().optional(),
  supplierCode: z.string().optional(),
  leadTime: z.coerce.number().min(0).optional(),
});

// ============================================
// ADD PRODUCT
// ============================================

export async function addProduct(prevState, formData) {
  // Auth check
  const user = await getCurrentUser();
  const permError = checkPermission(user, [
    "admin",
    "manager",
    "store manager",
  ]);
  if (permError) return permError;

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

  const category = await Category.findOne({
    _id: new mongoose.Types.ObjectId(data.category),
  });
  if (!category) {
    return {
      error: {
        category: ["Invalid category"],
      },
    };
  }

  // Connect to database
  dbConnect();

  // Check for duplicate SKU
  const existingProduct = await Product.findOne({ sku: data.sku });
  if (existingProduct) {
    return {
      error: {
        sku: ["A product with this SKU already exists"],
      },
    };
  }

  // Only admins/managers can set pricing

  const canSetPricing = ["admin", "manager"].includes(user.role?.toLowerCase());
  if (!canSetPricing) {
    data.costPrice = 0;
    data.sellingPrice = 0;
  }

  // Create product
  let product;
  try {
    const costing = {
      costPrice: canSetPricing ? data.costPrice || 0 : 0,
      costingMethod: data.costingMethod,
    };
    const pricing = {
      sellingPrice: canSetPricing ? data.sellingPrice || 0 : 0,
    };

    const inventory = {
      quantityOnHand: data.initialStock || 0,
      quantityCommitted: 0,
      quantityOnOrder: 0,
      reorderLevel: data.reorderLevel,
      reorderQuantity: data.reorderQuantity,
    };
    const storeInfo = {
      location: data.location || "",
      binNumber: data.binNumber || "",
      trackInventory: data.trackInventory,
      allowNegativeStock: data.allowNegativeStock,
    };
    product = await Product.create({
      name: data.name,
      SKU: data.sku,
      costing,
      pricing,
      storeInfo,
      inventory,

      description: data.description || "",
      category: category.name,
      type: data.type,
      unit: data.unit,
      costPrice: data.costPrice || 0,
      sellingPrice: data.sellingPrice || 0,
      taxRate: data.taxRate,
      reorderLevel: data.reorderLevel,
      reorderQuantity: data.reorderQuantity,
      costingMethod: data.costingMethod,
      location: data.location || "",
      binNumber: data.binNumber || "",
      trackInventory: data.trackInventory,
      allowNegativeStock: data.allowNegativeStock,
      isActive: data.isActive,
      // Initialize inventory
      inventory: {
        quantityOnHand: data.initialStock || 0,
        quantityCommitted: 0,
        quantityOnOrder: 0,
      },
      // Audit
      createdBy: {
        id: user.id,
        name: user.name,
      },
    });
  } catch (error) {
    console.error("Failed to create product:", error);
    return {
      error: {
        _form: ["Failed to create product. Please try again."],
      },
    };
  }

  // Create initial stock movement if there's initial stock
  if (data.initialStock > 0 && data.trackInventory) {
    try {
      const movementNumber = await generateMovementNumber();
      const productSnapshot = {
        name: product.name,
        SKU: product.SKU,
        category: product.category,
        unit: product.unit,
      };
      const costing = {
        unitCost: canSetPricing ? data.costPrice || 0 : 0,
        totalCost:
          (canSetPricing ? data.costPrice || 0 : 0) * data.initialStock,
      };

      await StockMovement.create({
        movementNumber,
        movementDate: new Date(),
        movementType: "initial",
        direction: "in",
        previousStock: 0,
        newStock: data.initialStock,
        costing,
        productId: product._id,
        productSKU: product.SKU,
        productSnapshot,
        productName: product.name,
        quantity: data.initialStock,
        unitCost: data.costPrice || 0,
        totalCost: (data.costPrice || 0) * data.initialStock,
        balanceBefore: 0,
        balanceAfter: data.initialStock,
        reference: `Initial stock for ${product.sku}`,
        status: "posted",
        performedBy: {
          id: user.id,
          name: user.name,
        },
        postedAt: new Date(),
      });
    } catch (error) {
      console.error("Failed to create initial stock movement:", error);
      return {
        error: {
          _form: ["Failed to create initial stock movement:", error],
        },
      };

      // Don't fail the whole operation - product is already created
    }
  }

  // Success - revalidate and redirect with success message
  revalidatePath("/dashboard/stocks");
  redirect(
    `/dashboard/stocks?success=${encodeURIComponent(
      `Product "${data.name}" created successfully`
    )}`
  );
}

// ============================================
// UPDATE PRODUCT
// ============================================

export async function updateProduct(productId, prevState, formData) {
  // Auth check
  const user = await getCurrentUser();
  const permError = checkPermission(user, [
    "admin",
    "manager",
    "store_manager",
  ]);
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

  // Validate category exists and get category name
  const category = await Category.findOne({
    _id: new mongoose.Types.ObjectId(data.category),
  });
  if (!category) {
    return {
      error: {
        category: ["Invalid category"],
      },
    };
  }

  // Find product
  const product = await Product.findById(productId);
  if (!product) {
    return {
      error: {
        _form: ["Product not found"],
      },
    };
  }

  // Check SKU uniqueness (if changed)
  if (data.sku !== product.SKU) {
    const existingProduct = await Product.findOne({
      SKU: data.sku,
      _id: { $ne: productId },
    });
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

  // Only admins/managers can update pricing
  const canSetPricing = ["admin", "manager"].includes(user.role.toLowerCase());
  if (canSetPricing) {
    updateData.pricing = pricing;
    updateData.costing = costing;
  }

  // Update supplier info if provided
  if (data.supplierName || data.supplierCode) {
    updateData.supplier = {
      name: data.supplierName || "",
      code: data.supplierCode || "",
      leadTime: data.leadTime || 0,
    };
  }

  // Update product
  try {
    await Product.findByIdAndUpdate(productId, updateData);
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
  // Auth check
  const user = await getCurrentUser();
  const permError = checkPermission(user, ["admin", "manager"]);
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

  // Find product
  const product = await Product.findById(productId);
  if (!product) {
    return {
      error: {
        _form: ["Product not found"],
      },
    };
  }

  // Check if product has stock
  const onHand = product.inventory?.quantityOnHand ?? product.stock ?? 0;
  if (onHand > 0) {
    return {
      error: {
        _form: [
          `Cannot delete product with ${onHand} units in stock. Use Stock Adjustment to zero out inventory first.`,
        ],
      },
    };
  }

  // Check for related movements
  const movementCount = await StockMovement.countDocuments({
    product: productId,
  });
  if (movementCount > 0) {
    // Soft delete instead
    try {
      await Product.findByIdAndUpdate(productId, {
        isActive: false,
        deletedAt: new Date(),
        deletedBy: {
          id: user.id,
          name: user.name,
        },
      });
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

  // Hard delete if no history
  try {
    await Product.findByIdAndDelete(productId);
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

async function generateMovementNumber() {
  const today = new Date();
  const dateStr = today.toISOString().slice(2, 10).replace(/-/g, "");
  const prefix = `MOV-${dateStr}`;

  // Find the highest number for today
  const lastMovement = await StockMovement.findOne({
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

  await dbConnect();

  // Build query
  const query = {};
  if (isActive !== undefined) query.isActive = isActive;
  if (category) query.category = category;
  if (type) query.type = type;
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { sku: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }

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

  await dbConnect();

  const product = await Product.findById(productId)
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
