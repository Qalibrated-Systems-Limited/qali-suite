import mongoose from "mongoose";
import dbConnect from "@/app/config/dbConnect";
import Product from "@/app/models/product";
import { sanitizeSearchTerm } from "@/lib/utils/sanitize";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { serializeBsonType } from "@/lib/utils";

const { ObjectId } = mongoose.Types;
const ITEMS_PER_PAGE = 20;

// ============================================
// SHARED FILTER BUILDERS
// ============================================

function buildQuantityFilter(quantity) {
  if (!quantity) return {};

  switch (quantity) {
    case "in-stock":
      // On-hand AND above the reorder threshold (or no threshold set).
      // Active products only — matches the dashboard alert definition.
      return {
        status: "active",
        "inventory.quantityOnHand": { $gt: 0 },
        $expr: {
          $or: [
            { $lte: [{ $ifNull: ["$inventory.reorderLevel", 0] }, 0] },
            {
              $gt: [
                { $ifNull: ["$inventory.quantityOnHand", 0] },
                { $ifNull: ["$inventory.reorderLevel", 0] },
              ],
            },
          ],
        },
      };
    case "low-stock":
      // Industry standard: active products with qty on hand > 0 AND at
      // or below the item's reorder level (which must be configured > 0).
      // Mirrors getDashboardAlerts so the dashboard tile and this filter
      // always agree.
      return {
        status: "active",
        "inventory.quantityOnHand": { $gt: 0 },
        "inventory.reorderLevel": { $gt: 0 },
        $expr: {
          $lte: [
            "$inventory.quantityOnHand",
            "$inventory.reorderLevel",
          ],
        },
      };
    case "out-of-stock":
      // qty <= 0 (regardless of status — a soft-deleted out-of-stock
      // product is still worth flagging in the list).
      return { "inventory.quantityOnHand": { $lte: 0 } };
    default:
      return {};
  }
}

function buildProductFilters(filters = {}) {
  const { category, quantity } = filters;
  const additionalFilters = {};

  if (category) {
    additionalFilters.category = category;
  }

  Object.assign(additionalFilters, buildQuantityFilter(quantity));

  return additionalFilters;
}

// ============================================
// STOCK STATS (Fast parallel counts)
// ============================================

export async function getStockStats() {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  // Single pass over the tenant's products, four conditional counts —
  // replaces four parallel countDocuments calls (= four round trips and
  // three COLLSCANs on the schema's older indexes). With the new
  // (companyId, inventory.quantityOnHand) index, the planner can satisfy
  // this from a single index scan.
  const [result] = await Product.aggregate([
    { $match: tenantMatch },
    {
      $addFields: {
        _qty: { $ifNull: ["$inventory.quantityOnHand", 0] },
        _reorder: { $ifNull: ["$inventory.reorderLevel", 0] },
      },
    },
    {
      $group: {
        _id: null,
        totalItems: { $sum: 1 },
        // Active products at or below reorder level (qty > 0). Matches
        // the dashboard "Low stock" alert tile definition.
        lowStock: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$status", "active"] },
                  { $gt: ["$_qty", 0] },
                  { $gt: ["$_reorder", 0] },
                  { $lte: ["$_qty", "$_reorder"] },
                ],
              },
              1,
              0,
            ],
          },
        },
        outOfStock: {
          $sum: { $cond: [{ $lte: ["$_qty", 0] }, 1, 0] },
        },
        // Active products with stock above reorder (or no reorder set).
        inStock: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$status", "active"] },
                  { $gt: ["$_qty", 0] },
                  {
                    $or: [
                      { $lte: ["$_reorder", 0] },
                      { $gt: ["$_qty", "$_reorder"] },
                    ],
                  },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  return {
    totalItems: result?.totalItems || 0,
    lowStock: result?.lowStock || 0,
    outOfStock: result?.outOfStock || 0,
    inStock: result?.inStock || 0,
  };
}

// ============================================
// CATEGORIES (For filter dropdown)
// Fetches from Category model for consistency with /dashboard/categories
// ============================================

export async function getProductCategories() {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  // Import Category model dynamically to avoid circular dependency
  const Category = (await import("@/app/models/category")).default;

  const categories = await Category.find({
    ...tenantMatch,
    isDeleted: false,
    isActive: true,
  })
    .select("name")
    .sort({ sortOrder: 1, name: 1 })
    .lean();

  return categories.map((cat) => cat.name);
}

// ============================================
// SEARCH STOCK (Paginated list)
// ============================================

export const searchStock = async (searchTerm, page = 1, filters = {}) => {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const skipRecords = (page - 1) * ITEMS_PER_PAGE;
  const safeSearchTerm = sanitizeSearchTerm(searchTerm);
  const additionalFilters = buildProductFilters(filters);

  const matchStage = safeSearchTerm
    ? {
        $match: {
          $and: [
            tenantMatch,
            additionalFilters,
            {
              $or: [
                { name: { $regex: safeSearchTerm, $options: "i" } },
                { SKU: { $regex: safeSearchTerm, $options: "i" } },
              ],
            },
          ],
        },
      }
    : { $match: { ...tenantMatch, ...additionalFilters } };

  const result = await Product.aggregate([
    matchStage,
    { $sort: { createdAt: -1 } },
    { $skip: skipRecords },
    { $limit: ITEMS_PER_PAGE },
  ]);

  return serializeBsonType(result);
};

export const fetchStockData = async () => {
  await dbConnect();
  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const projectStage = {
    $project: {
      SKU: 1,
      name: 1,
      unit: 1,
      category: { $toUpper: "$category" },
      quantityOnHand: { $ifNull: ["$inventory.quantityOnHand", 0] },
      sellingPrice: { $ifNull: ["$pricing.sellingPrice", 0] },
    },
  };
  const sortStage = { $sort: { category: 1 } };
  // Organize stock by department

  const pipeline = isSuperAdmin
    ? [projectStage, sortStage]
    : [{ $match: tenantMatch }, projectStage, sortStage];

  const stockItems = await Product.aggregate(pipeline);

  return stockItems.reduce((acc, item) => {
    const dept = item.category || "Uncategorized";
    if (!acc[dept]) acc[dept] = [];
    acc[dept].push({
      name: item.name,
      quantity: item.quantityOnHand,
      SKU: item.SKU,
      price: item.sellingPrice,
      unit: item.unit,
    });
    return acc;
  }, {});
};

// ============================================
// PAGINATION COUNT
// ============================================

export const fetchStockPages = async (searchTerm, filters = {}) => {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const safeSearchTerm = sanitizeSearchTerm(searchTerm);
  const additionalFilters = buildProductFilters(filters);

  const matchStage = safeSearchTerm
    ? {
        $match: {
          $and: [
            tenantMatch,
            additionalFilters,
            {
              $or: [
                { name: { $regex: safeSearchTerm, $options: "i" } },
                { SKU: { $regex: safeSearchTerm, $options: "i" } },
              ],
            },
          ],
        },
      }
    : { $match: { ...tenantMatch, ...additionalFilters } };

  const result = await Product.aggregate([matchStage, { $count: "totalRecords" }]);

  const count = result[0]?.totalRecords || 0;
  return Math.ceil(count / ITEMS_PER_PAGE);
};
