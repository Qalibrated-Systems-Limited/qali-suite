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
      return { "inventory.quantityOnHand": { $gte: 10 } };
    case "low-stock":
      return { "inventory.quantityOnHand": { $gte: 1, $lte: 9 } };
    case "out-of-stock":
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

  const [totalItems, lowStock, outOfStock, inStock] = await Promise.all([
    Product.countDocuments(tenantMatch),
    Product.countDocuments({
      ...tenantMatch,
      "inventory.quantityOnHand": { $gte: 1, $lte: 9 },
    }),
    Product.countDocuments({
      ...tenantMatch,
      "inventory.quantityOnHand": { $lte: 0 },
    }),
    Product.countDocuments({
      ...tenantMatch,
      "inventory.quantityOnHand": { $gte: 10 },
    }),
  ]);

  return { totalItems, lowStock, outOfStock, inStock };
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
