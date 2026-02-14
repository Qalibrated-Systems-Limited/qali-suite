import mongoose from "mongoose";
import dbConnect from "@/app/config/dbConnect";
import Category from "@/app/models/category";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import { serializeBsonType } from "@/lib/utils";

const { ObjectId } = mongoose.Types;

// ============================================
// CATEGORY STATS
// ============================================

export async function getCategoryStats() {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const baseMatch = { ...tenantMatch, isDeleted: false };

  const [total, active, inactive, withProducts, rootCategories] = await Promise.all([
    Category.countDocuments(baseMatch),
    Category.countDocuments({ ...baseMatch, isActive: true }),
    Category.countDocuments({ ...baseMatch, isActive: false }),
    Category.countDocuments({ ...baseMatch, productCount: { $gt: 0 } }),
    Category.countDocuments({ ...baseMatch, parent: null }),
  ]);

  return { total, active, inactive, withProducts, rootCategories };
}

// ============================================
// CATEGORY TREE (For display)
// ============================================

export async function getCategoryTree(activeOnly = false) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  let query = { isDeleted: false };
  if (activeOnly) {
    query.isActive = true;
  }
  query = withTenantScope(query, companyId, isSuperAdmin);

  const categories = await Category.find(query)
    .sort({ sortOrder: 1, name: 1 })
    .lean();

  // Build tree structure
  const categoryMap = new Map();
  const roots = [];

  // First pass: serialize and create map
  categories.forEach((cat) => {
    const serialized = {
      _id: cat._id.toString(),
      name: cat.name,
      description: cat.description || "",
      parent: cat.parent?.toString() || null,
      level: cat.level || 0,
      sortOrder: cat.sortOrder || 0,
      isActive: cat.isActive ?? true,
      productCount: cat.productCount || 0,
      children: [],
    };
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

  return roots;
}

// ============================================
// FLAT CATEGORY LIST (For dropdowns)
// ============================================

export async function getCategoryList(includeInactive = false) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  let query = { isDeleted: false };
  if (!includeInactive) {
    query.isActive = true;
  }
  query = withTenantScope(query, companyId, isSuperAdmin);

  const categories = await Category.find(query)
    .sort({ path: 1, sortOrder: 1 })
    .lean();

  return categories.map((cat) => ({
    _id: cat._id.toString(),
    name: cat.name,
    path: cat.path,
    level: cat.level,
    displayName: cat.level > 0 ? `${"── ".repeat(cat.level)}${cat.name}` : cat.name,
    productCount: cat.productCount || 0,
  }));
}

// ============================================
// SEARCH CATEGORIES
// ============================================

export async function searchCategories(searchTerm, limit = 20) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  if (!searchTerm || searchTerm.trim().length < 2) {
    return getCategoryList(true);
  }

  const regex = new RegExp(searchTerm.trim(), "i");

  let query = {
    isDeleted: false,
    $or: [
      { name: regex },
      { description: regex },
      { path: regex },
    ],
  };
  query = withTenantScope(query, companyId, isSuperAdmin);

  const categories = await Category.find(query)
    .sort({ level: 1, name: 1 })
    .limit(limit)
    .lean();

  return categories.map((cat) => ({
    _id: cat._id.toString(),
    name: cat.name,
    description: cat.description || "",
    path: cat.path,
    level: cat.level,
    isActive: cat.isActive ?? true,
    productCount: cat.productCount || 0,
  }));
}

// ============================================
// GET SINGLE CATEGORY
// ============================================

export async function getCategoryById(categoryId) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const category = await Category.findOne(
    withTenantScope({ _id: categoryId }, companyId, isSuperAdmin)
  ).lean();

  if (!category) return null;

  return serializeBsonType(category);
}
