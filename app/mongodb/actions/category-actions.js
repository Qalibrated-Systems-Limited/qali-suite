"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import Category from "@/app/models/category";
import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  getCompanyIdForCreate,
  withTenantScope,
} from "@/lib/utils/tenant-utils";

// ============================================
// VALIDATION SCHEMAS
// ============================================

const categorySchema = z.object({
  name: z
    .string()
    .min(1, "Category name is required")
    .max(100, "Name cannot exceed 100 characters"),
  description: z
    .string()
    .max(500, "Description cannot exceed 500 characters")
    .optional(),
  parent: z.string().optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.coerce.boolean().default(true),
  attributes: z
    .array(
      z.object({
        name: z.string().min(1, "Attribute name is required"),
        type: z.enum(["text", "number", "select", "boolean"]).default("text"),
        options: z.array(z.string()).optional(),
        required: z.boolean().default(false),
        unit: z.string().optional(),
      })
    )
    .optional()
    .default([]),
});

// ============================================
// HELPER: Check admin permission (returns error or null)
// ============================================

// Roles allowed to create / edit / delete categories.
// Categories are dual-purpose: product taxonomy (Manager / Store Manager)
// and an accounting hierarchy (Finance roles). Lock out anyone below.
const CATEGORY_MANAGE_ROLES = new Set([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Manager",
  "Store Manager",
]);

function checkAdminPermission(user) {
  if (!user) {
    return {
      error: {
        _form: ["You must be logged in to perform this action"],
      },
    };
  }

  if (!CATEGORY_MANAGE_ROLES.has(user.role)) {
    return {
      error: {
        _form: [
          "You don't have permission to manage categories. Allowed roles: " +
            [...CATEGORY_MANAGE_ROLES].join(", "),
        ],
      },
    };
  }

  return null; // No error
}

// ============================================
// CREATE CATEGORY
// ============================================

export async function createCategory(prevState, formData) {
  // Auth check with tenant context
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return {
      error: { _form: [error.message] },
    };
  }

  // Check permissions
  const permError = checkAdminPermission(user);
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

  await dbConnect();

  // Parse form data ("None" from Select means root category)
  const parentValue = formData.get("parent");
  const rawData = {
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    parent: parentValue && parentValue !== "None" ? parentValue : null,
    sortOrder: formData.get("sortOrder") || 0,
    isActive: formData.get("isActive") === "true",
  };

  // Parse attributes if provided as JSON
  const attributesJson = formData.get("attributes");
  if (attributesJson) {
    try {
      rawData.attributes = JSON.parse(attributesJson);
    } catch {
      rawData.attributes = [];
    }
  }

  // Validate
  const validationResult = categorySchema.safeParse(rawData);

  if (!validationResult.success) {
    return {
      error: validationResult.error.flatten().fieldErrors,
    };
  }

  const validated = validationResult.data;

  // Check for circular reference if parent is set (tenant-scoped)
  if (validated.parent) {
    const parentCategory = await Category.findOne(
      withTenantScope({ _id: validated.parent }, tenantCompanyId, isSuperAdmin)
    );
    if (!parentCategory) {
      return {
        error: {
          parent: ["Parent category not found"],
        },
      };
    }
  }

  // Check for duplicate name (tenant-scoped)
  const existingCategory = await Category.findOne(
    withTenantScope({
      name: { $regex: new RegExp(`^${validated.name}$`, "i") },
      isDeleted: false,
    }, tenantCompanyId, isSuperAdmin)
  );

  if (existingCategory) {
    return {
      error: {
        name: ["A category with this name already exists"],
      },
    };
  }

  // Create category with tenant companyId
  try {
    await Category.create({
      companyId: tenantCompanyId,
      ...validated,
      parent: validated.parent || null,
      createdBy: {
        id: user.id,
        name: user.name,
      },
      lastModifiedBy: {
        id: user.id,
        name: user.name,
      },
    });
  } catch (error) {
    console.error("Create category error:", error);

    if (error.code === 11000) {
      return {
        error: {
          name: ["A category with this name already exists"],
        },
      };
    }

    return {
      error: {
        _form: ["Failed to create category. Please try again."],
      },
    };
  }

  // Success - revalidate and redirect
  revalidatePath("/dashboard/categories");
  revalidatePath("/dashboard/products");
  redirect("/dashboard/categories");
}

// ============================================
// UPDATE CATEGORY
// ============================================

export async function updateCategory(categoryId, prevState, formData) {
  // Auth check with tenant context
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return {
      error: { _form: [error.message] },
    };
  }

  // Check permissions
  const permError = checkAdminPermission(user);
  if (permError) return permError;

  await dbConnect();

  // Find category with tenant scoping
  const category = await Category.findOne(
    withTenantScope({ _id: categoryId }, companyId, isSuperAdmin)
  );
  if (!category) {
    return {
      error: {
        _form: ["Category not found"],
      },
    };
  }

  // Parse form data ("None" from Select means root category)
  const parentValue = formData.get("parent");
  const rawData = {
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    parent: parentValue && parentValue !== "None" ? parentValue : null,
    sortOrder: formData.get("sortOrder") || 0,
    isActive: formData.get("isActive") === "true",
  };

  // Parse attributes if provided
  const attributesJson = formData.get("attributes");
  if (attributesJson) {
    try {
      rawData.attributes = JSON.parse(attributesJson);
    } catch {
      rawData.attributes = category.attributes;
    }
  }

  // Validate
  const validationResult = categorySchema.safeParse(rawData);

  if (!validationResult.success) {
    return {
      error: validationResult.error.flatten().fieldErrors,
    };
  }

  const validated = validationResult.data;

  // Prevent setting self as parent
  if (validated.parent === categoryId) {
    return {
      error: {
        parent: ["Category cannot be its own parent"],
      },
    };
  }

  // Check for circular reference
  if (validated.parent && validated.parent !== category.parent?.toString()) {
    const descendants = await category.getDescendants();
    const descendantIds = descendants.map((d) => d._id.toString());

    if (descendantIds.includes(validated.parent)) {
      return {
        error: {
          parent: ["Cannot set a descendant as parent (circular reference)"],
        },
      };
    }
  }

  // Check for duplicate name (excluding current category, tenant-scoped)
  const existingCategory = await Category.findOne(
    withTenantScope({
      name: { $regex: new RegExp(`^${validated.name}$`, "i") },
      _id: { $ne: categoryId },
      isDeleted: false,
    }, companyId, isSuperAdmin)
  );

  if (existingCategory) {
    return {
      error: {
        name: ["A category with this name already exists"],
      },
    };
  }

  // Update
  try {
    const nameChanged = category.name !== validated.name;
    const parentChanged = category.parent?.toString() !== validated.parent;

    category.name = validated.name;
    category.description = validated.description;
    category.parent = validated.parent || null;
    category.sortOrder = validated.sortOrder;
    category.isActive = validated.isActive;
    category.attributes = validated.attributes;
    category.lastModifiedBy = {
      id: user.id,
      name: user.name,
    };

    await category.save();

    // Update children paths if name or parent changed (tenant-scoped)
    // Optimized: batch fetch all descendants instead of N+1 individual queries
    if (nameChanged || parentChanged) {
      const descendants = await category.getDescendants();
      if (descendants.length > 0) {
        const descendantIds = descendants.map(d => d._id);
        // Batch fetch all descendants as Mongoose documents in one query
        const descCategories = await Category.find(
          withTenantScope({ _id: { $in: descendantIds } }, companyId, isSuperAdmin)
        );
        // Save all descendants to trigger pre-save hook (updates path)
        await Promise.all(descCategories.map(dc => dc.save()));
      }
    }
  } catch (error) {
    console.error("Update category error:", error);
    return {
      error: {
        _form: ["Failed to update category. Please try again."],
      },
    };
  }

  // Success - revalidate and redirect
  revalidatePath("/dashboard/categories");
  revalidatePath("/dashboard/products");
  redirect("/dashboard/categories");
}

// ============================================
// DELETE CATEGORY
// ============================================

export async function deleteCategory(categoryId) {
  // Auth check with tenant context
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return {
      error: { _form: [error.message] },
    };
  }

  // Check permissions
  const permError = checkAdminPermission(user);
  if (permError) return permError;

  await dbConnect();

  // Find category with tenant scoping
  const category = await Category.findOne(
    withTenantScope({ _id: categoryId }, companyId, isSuperAdmin)
  );
  if (!category) {
    return {
      error: {
        _form: ["Category not found"],
      },
    };
  }

  // Check for products using this category
  if (category.productCount > 0) {
    return {
      error: {
        _form: [
          `Cannot delete category with ${category.productCount} products. Reassign products first.`,
        ],
      },
    };
  }

  // Check for child categories (tenant-scoped)
  const childCount = await Category.countDocuments(
    withTenantScope({
      parent: category._id,
      isDeleted: false,
    }, companyId, isSuperAdmin)
  );

  if (childCount > 0) {
    return {
      error: {
        _form: [
          `Cannot delete category with ${childCount} subcategories. Delete or reassign subcategories first.`,
        ],
      },
    };
  }

  // Soft delete
  try {
    category.isDeleted = true;
    category.lastModifiedBy = { id: user.id, name: user.name };
    await category.save();
  } catch (error) {
    console.error("Delete category error:", error);
    return {
      error: {
        _form: ["Failed to delete category. Please try again."],
      },
    };
  }

  // Success - revalidate and redirect
  revalidatePath("/dashboard/categories");
  revalidatePath("/dashboard/products");
  redirect("/dashboard/categories");
}

// ============================================
// GET CATEGORIES (For dropdowns/combobox)
// No auth needed - read only
// ============================================
// ============================================
// GET SINGLE CATEGORY
// ============================================

export async function getCategory(categoryId) {
  try {
    // Get tenant context
    let companyId, isSuperAdmin;
    try {
      ({ companyId, isSuperAdmin } = await getTenantContext());
    } catch (error) {
      return { error: error.message };
    }

    await dbConnect();

    // Find category with tenant scoping
    const category = await Category.findOne(
      withTenantScope({ _id: categoryId }, companyId, isSuperAdmin)
    ).lean();

    if (!category) {
      return { error: "Category not found" };
    }

    // Serialize ObjectIds for client
    return {
      category: {
        ...category,
        _id: category._id.toString(),
        parent: category.parent?.toString() || null,
        path: Array.isArray(category.path)
          ? category.path.map((p) => p.toString())
          : [],
      },
    };
  } catch (error) {
    console.error("Get category error:", error);
    return { error: "Failed to fetch category" };
  }
}

export async function getCategories(includeInactive = false) {
  try {
    // Get tenant context
    let companyId, isSuperAdmin;
    try {
      ({ companyId, isSuperAdmin } = await getTenantContext());
    } catch (error) {
      return { error: { _form: [error.message] }, categories: [] };
    }

    await dbConnect();
    // Pass tenant context to getFlatList (model method should handle it)
    const categories = await Category.getFlatList(includeInactive, companyId, isSuperAdmin);

    return {
      categories: categories.map((cat) => ({
        _id: cat._id.toString(),
        name: cat.name,
        path: Array.isArray(cat.path) ? cat.path.map((p) => p.toString()) : [],
        level: cat.level,
        displayName: cat.displayName,
        productCount: cat.productCount,
      })),
    };
  } catch (error) {
    console.error("Get categories error:", error);
    return {
      error: {
        _form: ["Failed to load categories"],
      },
      categories: [],
    };
  }
}

// ============================================
// SEARCH CATEGORIES (For combobox)
// No auth needed - read only
// ============================================

export async function searchCategories(query) {
  try {
    // Get tenant context
    let companyId, isSuperAdmin;
    try {
      ({ companyId, isSuperAdmin } = await getTenantContext());
    } catch (error) {
      return { categories: [] };
    }

    await dbConnect();
    // Pass tenant context to search method
    const categories = await Category.search(query, 15, companyId, isSuperAdmin);

    return {
      categories: categories.map((cat) => ({
        _id: cat._id.toString(),
        name: cat.name,
        path: Array.isArray(cat.path) ? cat.path.map((p) => p.toString()) : [],
        level: cat.level,
        displayName: cat.displayName || cat.path || cat.name,
      })),
    };
  } catch (error) {
    console.error("Search categories error:", error);
    return {
      categories: [],
    };
  }
}

// ============================================
// GET CATEGORY TREE (For management UI)
// No auth needed - read only
// ============================================

// ============================================
// GET CATEGORY TREE
// ============================================

export async function getCategoryTree(activeOnly = false) {
  try {
    // Get tenant context
    let companyId, isSuperAdmin;
    try {
      ({ companyId, isSuperAdmin } = await getTenantContext());
    } catch (error) {
      return { error: error.message, tree: [] };
    }

    await dbConnect();

    // Build query with tenant scoping
    let query = activeOnly ? { isActive: true } : {};
    query = withTenantScope(query, companyId, isSuperAdmin);

    const categories = await Category.find(query)
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    // Deep serialize to remove all ObjectIds and MongoDB types
    const serializeCategory = (cat) => {
      const serialized = {
        _id: cat._id.toString(),
        name: cat.name,
        description: cat.description || "",
        parent: cat.parent?.toString() || null,
        path: Array.isArray(cat.path) ? cat.path.map((p) => p.toString()) : [],
        level: cat.level || 0,
        sortOrder: cat.sortOrder || 0,
        isActive: cat.isActive ?? true,
        productCount: cat.productCount || 0,
        children: [],
      };

      // Only include fields you need - don't spread the whole object
      return serialized;
    };

    // Build tree structure
    const categoryMap = new Map();
    const roots = [];

    // First pass: create map with serialized categories
    categories.forEach((cat) => {
      const serialized = serializeCategory(cat);
      categoryMap.set(serialized._id, serialized);
    });

    // Second pass: build tree
    categoryMap.forEach((cat) => {
      if (cat.parent && categoryMap.has(cat.parent)) {
        categoryMap.get(cat.parent).children.push(cat);
      } else {
        roots.push(cat);
      }
    });

    return { tree: roots };
  } catch (error) {
    console.error("Get category tree error:", error);
    return { error: "Failed to fetch category tree", tree: [] };
  }
}
