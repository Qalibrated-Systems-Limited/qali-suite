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

  // Single round-trip aggregation — one index scan over the tenant's
  // non-deleted categories, all 5 counts computed inline. Beats five
  // parallel countDocuments which each open their own cursor and hit the
  // (companyId, isDeleted) index five times.
  const [stats = {}] = await Category.aggregate([
    { $match: baseMatch },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        active: { $sum: { $cond: [{ $eq: ["$isActive", true] }, 1, 0] } },
        inactive: { $sum: { $cond: [{ $eq: ["$isActive", false] }, 1, 0] } },
        withProducts: {
          $sum: { $cond: [{ $gt: [{ $ifNull: ["$productCount", 0] }, 0] }, 1, 0] },
        },
        rootCategories: {
          $sum: { $cond: [{ $eq: ["$parent", null] }, 1, 0] },
        },
      },
    },
    { $project: { _id: 0 } },
  ]);

  return {
    total: stats.total || 0,
    active: stats.active || 0,
    inactive: stats.inactive || 0,
    withProducts: stats.withProducts || 0,
    rootCategories: stats.rootCategories || 0,
  };
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
