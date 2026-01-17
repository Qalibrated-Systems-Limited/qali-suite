"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import Category from "@/app/models/category";
import { auth } from "@/auth";
import dbConnect from "@/app/config/dbConnect";
dbConnect();

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
// HELPER: Get current user
// ============================================

async function getCurrentUser() {
  const session = await auth();
  if (!session?.user) {
    return null;
  }
  return session.user;
}

// ============================================
// HELPER: Check admin permission (returns error or null)
// ============================================

function checkAdminPermission(user) {
  if (!user) {
    return {
      error: {
        _form: ["You must be logged in to perform this action"],
      },
    };
  }

  if (!["admin", "manager"].includes(user.role.toLowerCase())) {
    return {
      error: {
        _form: ["Admin or Manager role required to manage categories"],
      },
    };
  }

  return null; // No error
}

// ============================================
// CREATE CATEGORY
// ============================================

export async function createCategory(prevState, formData) {
  const user = await getCurrentUser();

  // Check permissions
  const permError = checkAdminPermission(user);
  if (permError) return permError;

  await dbConnect();

  // Parse form data
  const rawData = {
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    parent: formData.get("parent") || null,
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

  // Check for circular reference if parent is set
  if (validated.parent) {
    const parentCategory = await Category.findById(validated.parent);
    if (!parentCategory) {
      return {
        error: {
          parent: ["Parent category not found"],
        },
      };
    }
  }

  // Check for duplicate name
  const existingCategory = await Category.findOne({
    name: { $regex: new RegExp(`^${validated.name}$`, "i") },
    isDeleted: false,
  });

  if (existingCategory) {
    return {
      error: {
        name: ["A category with this name already exists"],
      },
    };
  }

  // Create category
  try {
    await Category.create({
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
  const user = await getCurrentUser();

  // Check permissions
  const permError = checkAdminPermission(user);
  if (permError) return permError;

  await dbConnect();

  const category = await Category.findById(categoryId);
  if (!category) {
    return {
      error: {
        _form: ["Category not found"],
      },
    };
  }

  // Parse form data
  const rawData = {
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    parent: formData.get("parent") || null,
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

  // Check for duplicate name (excluding current category)
  const existingCategory = await Category.findOne({
    name: { $regex: new RegExp(`^${validated.name}$`, "i") },
    _id: { $ne: categoryId },
    isDeleted: false,
  });

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

    // Update children paths if name or parent changed
    if (nameChanged || parentChanged) {
      const descendants = await category.getDescendants();
      for (const desc of descendants) {
        const descCategory = await Category.findById(desc._id);
        if (descCategory) {
          await descCategory.save(); // Triggers pre-save to update path
        }
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
  const user = await getCurrentUser();

  // Check permissions
  const permError = checkAdminPermission(user);
  if (permError) return permError;

  await dbConnect();

  const category = await Category.findById(categoryId);
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

  // Check for child categories
  const childCount = await Category.countDocuments({
    parent: category._id,
    isDeleted: false,
  });

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
    await dbConnect();

    const category = await Category.findById(categoryId).lean();

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
    await dbConnect();
    const categories = await Category.getFlatList(includeInactive);

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
    await dbConnect();
    const categories = await Category.search(query, 15);

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
    const query = activeOnly ? { isActive: true } : {};
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
// ============================================
// SEED DEFAULT CATEGORIES
// ============================================

export async function seedDefaultCategories() {
  const user = await getCurrentUser();

  // Check permissions
  const permError = checkAdminPermission(user);
  if (permError) return permError;

  // Check if categories already exist
  const existingCount = await Category.countDocuments({ isDeleted: false });
  if (existingCount > 0) {
    return {
      error: {
        _form: ["Categories already exist. Delete existing categories first."],
      },
    };
  }

  const defaultCategories = [
    {
      name: "Loadcells",
      description: "Force measurement sensors and load cells",
      sortOrder: 1,
      attributes: [
        { name: "Capacity", type: "number", unit: "kg", required: true },
        { name: "Output", type: "text" },
        {
          name: "Material",
          type: "select",
          options: ["Aluminum", "Steel", "Stainless Steel"],
        },
      ],
    },
    {
      name: "Indicators",
      description: "Digital weighing indicators and controllers",
      sortOrder: 2,
      attributes: [
        {
          name: "Display Type",
          type: "select",
          options: ["LCD", "LED", "OLED"],
        },
        {
          name: "Communication",
          type: "select",
          options: ["RS232", "RS485", "USB", "Ethernet"],
        },
      ],
    },
    {
      name: "Platforms",
      description: "Weighing platforms and floor scales",
      sortOrder: 3,
      attributes: [
        { name: "Platform Size", type: "text" },
        { name: "Capacity", type: "number", unit: "kg", required: true },
      ],
    },
    {
      name: "Scales",
      description: "Complete weighing scale systems",
      sortOrder: 4,
    },
    {
      name: "Spare Parts",
      description: "Replacement parts and components",
      sortOrder: 5,
    },
    {
      name: "Cables",
      description: "Cables and connectors",
      sortOrder: 6,
      attributes: [
        { name: "Length", type: "number", unit: "m" },
        { name: "Connector Type", type: "text" },
      ],
    },
    {
      name: "Accessories",
      description: "Weighing accessories and add-ons",
      sortOrder: 7,
    },
    {
      name: "Software",
      description: "Software licenses and subscriptions",
      sortOrder: 8,
    },
    {
      name: "Services",
      description: "Service items and labor",
      sortOrder: 9,
    },
  ];

  try {
    for (const catData of defaultCategories) {
      await Category.create({
        ...catData,
        createdBy: { id: user.id, name: user.name },
        lastModifiedBy: { id: user.id, name: user.name },
      });
    }
  } catch (error) {
    console.error("Seed categories error:", error);
    return {
      error: {
        _form: ["Failed to seed categories. Please try again."],
      },
    };
  }

  // Success - revalidate and redirect
  revalidatePath("/dashboard/categories");
  redirect("/dashboard/categories");
}
