import mongoose from "mongoose";
import dbConnect from "../../config/dbConnect";
import Product from "../../models/product";
import { StockRequest } from "../../models/requests";
import { StockMovement } from "../../models/stockmovement";
import { ItemCheckout } from "../../models/checkouts";
import {
  getTenantContext,
  withTenantScope,
} from "../../../lib/utils/tenant-utils";

const ObjectId = mongoose.Types.ObjectId;

// Build a `$match` doc for aggregation pipelines that respects SuperAdmin
// cross-tenant access. Returns the matcher you can spread into a `$match`
// stage or merge with other criteria. Casts companyId to ObjectId so the
// composite indexes (companyId, ...) are hit.
function aggTenantMatch(
  companyId: string | null,
  isSuperAdmin: boolean,
): Record<string, unknown> {
  if (isSuperAdmin) return {};
  if (!companyId) throw new Error("companyId required for non-SuperAdmin user");
  return { companyId: new ObjectId(companyId) };
}

// ============================================
// STOCK STATS
// ============================================
export async function getStockStats() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = aggTenantMatch(companyId, isSuperAdmin);

  const [
    totalProducts,
    lowStockProducts,
    totalValue,
    pendingRequests,
    overdueCheckouts,
  ] = await Promise.all([
    Product.countDocuments(
      withTenantScope({ isActive: true }, companyId, isSuperAdmin),
    ),

    Product.countDocuments(
      withTenantScope(
        {
          isActive: true,
          "inventory.reorderLevel": { $gt: 0 },
          $expr: {
            $lte: [
              { $ifNull: ["$inventory.quantityOnHand", 0] },
              "$inventory.reorderLevel",
            ],
          },
        },
        companyId,
        isSuperAdmin,
      ),
    ),

    Product.aggregate([
      { $match: { ...tenantMatch, isActive: true } },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $multiply: [
                { $ifNull: ["$inventory.quantityOnHand", 0] },
                { $ifNull: ["$costing.costPrice", 0] },
              ],
            },
          },
        },
      },
    ]),

    StockRequest.countDocuments(
      withTenantScope({ status: "pending" }, companyId, isSuperAdmin),
    ),

    ItemCheckout.countDocuments(
      withTenantScope(
        {
          status: "checked_out",
          expectedReturnDate: { $lt: new Date() },
        },
        companyId,
        isSuperAdmin,
      ),
    ),
  ]);

  return {
    totalProducts,
    lowStockCount: lowStockProducts,
    totalValue: totalValue[0]?.total || 0,
    pendingRequests,
    overdueCheckouts,
  };
}

// ============================================
// MOVEMENT TREND (Last N days)
// ============================================
export async function getMovementTrend(days = 7) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = aggTenantMatch(companyId, isSuperAdmin);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const data = await StockMovement.aggregate([
    {
      $match: {
        ...tenantMatch,
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          direction: "$direction",
        },
        total: { $sum: "$quantity" },
      },
    },
    { $sort: { "_id.date": 1 } },
  ]);

  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    dates.push(date.toISOString().split("T")[0]);
  }

  return dates.map((date) => {
    const stockIn =
      data.find((d) => d._id.date === date && d._id.direction === "in")
        ?.total || 0;
    const stockOut =
      data.find((d) => d._id.date === date && d._id.direction === "out")
        ?.total || 0;
    return { date, stockIn, stockOut };
  });
}

// ============================================
// CATEGORY DISTRIBUTION
// ============================================
export async function getCategoryDistribution() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = aggTenantMatch(companyId, isSuperAdmin);

  const data = await Product.aggregate([
    { $match: { ...tenantMatch, isActive: true } },
    {
      $group: {
        _id: "$category",
        count: { $sum: 1 },
        value: {
          $sum: {
            $multiply: [
              { $ifNull: ["$inventory.quantityOnHand", 0] },
              { $ifNull: ["$costing.costPrice", 0] },
            ],
          },
        },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 8 },
  ]);

  return data.map((item) => ({
    category: item._id || "Uncategorized",
    count: item.count,
    value: item.value,
  }));
}

// ============================================
// RECENT MOVEMENTS
// ============================================
export async function getRecentMovements(limit = 5) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const movements = await StockMovement.find(
    withTenantScope({}, companyId, isSuperAdmin),
  )
    .sort({ createdAt: -1 })
    .limit(limit)
    .select(
      "movementNumber productId productSnapshot movementType direction quantity createdAt performedBy",
    )
    .lean();

  return movements;
}

// ============================================
// RECENT REQUESTS
// ============================================
export async function getRecentRequests(limit = 5) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const requests = await StockRequest.find(
    withTenantScope({}, companyId, isSuperAdmin),
  )
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return requests;
}

// ============================================
// LOW STOCK PRODUCTS
// ============================================
export async function getLowStockProducts(limit = 10) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const products = await Product.find(
    withTenantScope(
      {
        isActive: true,
        "inventory.reorderLevel": { $gt: 0 },
        $expr: {
          $lte: [
            { $ifNull: ["$inventory.quantityOnHand", 0] },
            "$inventory.reorderLevel",
          ],
        },
      },
      companyId,
      isSuperAdmin,
    ),
  )
    .sort({ "inventory.quantityOnHand": 1 })
    .limit(limit)
    .select("name SKU inventory.quantityOnHand inventory.reorderLevel category")
    .lean();

  return products;
}

// ============================================
// OVERDUE CHECKOUTS
// ============================================
export async function getOverdueCheckouts(limit = 10) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const checkouts = await ItemCheckout.find(
    withTenantScope(
      {
        status: "checked_out",
        expectedReturnDate: { $lt: new Date() },
      },
      companyId,
      isSuperAdmin,
    ),
  )
    .sort({ expectedReturnDate: 1 })
    .limit(limit)
    .populate("product", "name SKU")
    .populate("checkedOutBy", "name")
    .lean();

  return checkouts;
}

// ============================================
// TOP PRODUCTS (Most moved)
// ============================================
export async function getTopMovedProducts(limit = 5) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = aggTenantMatch(companyId, isSuperAdmin);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const data = await StockMovement.aggregate([
    {
      $match: {
        ...tenantMatch,
        createdAt: { $gte: thirtyDaysAgo },
      },
    },
    {
      $group: {
        _id: "$productId",
        totalQuantity: { $sum: "$quantity" },
        movements: { $sum: 1 },
      },
    },
    { $sort: { totalQuantity: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "_id",
        as: "product",
        pipeline: [{ $project: { name: 1, SKU: 1 } }],
      },
    },
    { $unwind: "$product" },
  ]);

  return data.map((item) => ({
    name: item.product.name,
    sku: item.product.SKU,
    quantity: item.totalQuantity,
  }));
}

// ============================================
// REQUEST STATUS DISTRIBUTION
// ============================================
export async function getRequestStatusDistribution() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = aggTenantMatch(companyId, isSuperAdmin);

  const data = await StockRequest.aggregate([
    ...(Object.keys(tenantMatch).length ? [{ $match: tenantMatch }] : []),
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  const statusMap: Record<string, number> = {
    pending: 0,
    approved: 0,
    rejected: 0,
    completed: 0,
  };

  data.forEach((item) => {
    if (Object.prototype.hasOwnProperty.call(statusMap, item._id)) {
      statusMap[item._id] = item.count;
    }
  });

  return Object.entries(statusMap).map(([status, count]) => ({
    status,
    count,
  }));
}
