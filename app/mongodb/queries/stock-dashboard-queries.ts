import dbConnect from "../../config/dbConnect";
import Product from "../../models/product";
import { StockRequest } from "../../models/requests";
import { StockMovement } from "../../models/stockmovement";
import { ItemCheckout } from "../../models/checkouts";

// ============================================
// STOCK STATS
// ============================================
export async function getStockStats() {
  await dbConnect();

  const [
    totalProducts,
    lowStockProducts,
    totalValue,
    pendingRequests,
    overdueCheckouts,
  ] = await Promise.all([
    // Total products count
    Product.countDocuments({ isActive: true }),

    // Low stock count
    Product.countDocuments({
      isActive: true,
      $expr: { $lte: ["$quantity", "$reorderLevel"] },
    }),

    // Total stock value
    Product.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: null,
          total: { $sum: { $multiply: ["$quantity", "$unitPrice"] } },
        },
      },
    ]),

    // Pending requests
    StockRequest.countDocuments({ status: "pending" }),

    // Overdue checkouts
    ItemCheckout.countDocuments({
      status: "checked_out",
      expectedReturnDate: { $lt: new Date() },
    }),
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

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const data = await StockMovement.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          type: "$type",
        },
        total: { $sum: "$quantity" },
      },
    },
    { $sort: { "_id.date": 1 } },
  ]);

  // Build date range
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    dates.push(date.toISOString().split("T")[0]);
  }

  // Map data to dates
  return dates.map((date) => {
    const stockIn =
      data.find(
        (d) =>
          d._id.date === date &&
          (d._id.type === "in" || d._id.type === "stock_in")
      )?.total || 0;
    const stockOut =
      data.find(
        (d) =>
          d._id.date === date &&
          (d._id.type === "out" || d._id.type === "stock_out")
      )?.total || 0;

    return { date, stockIn, stockOut };
  });
}

// ============================================
// CATEGORY DISTRIBUTION
// ============================================
export async function getCategoryDistribution() {
  await dbConnect();

  const data = await Product.aggregate([
    { $match: { isActive: true } },
    {
      $group: {
        _id: "$category",
        count: { $sum: 1 },
        value: { $sum: { $multiply: ["$quantity", "$unitPrice"] } },
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

  const movements = await StockMovement.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("productId", "name sku")
    .populate("performedBy", "name")
    .lean();

  return movements;
}

// ============================================
// RECENT REQUESTS
// ============================================
export async function getRecentRequests(limit = 5) {
  await dbConnect();

  const requests = await StockRequest.find()
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

  const products = await Product.find({
    isActive: true,
    $expr: { $lte: ["$quantity", "$reorderLevel"] },
  })
    .sort({ quantity: 1 })
    .limit(limit)
    .select("name sku quantity reorderLevel category")
    .lean();

  return products;
}

// ============================================
// OVERDUE CHECKOUTS
// ============================================
export async function getOverdueCheckouts(limit = 10) {
  await dbConnect();

  const checkouts = await ItemCheckout.find({
    status: "checked_out",
    expectedReturnDate: { $lt: new Date() },
  })
    .sort({ expectedReturnDate: 1 })
    .limit(limit)
    .populate("product", "name sku")
    .populate("checkedOutBy", "name")
    .lean();

  return checkouts;
}

// ============================================
// TOP PRODUCTS (Most moved)
// ============================================
export async function getTopMovedProducts(limit = 5) {
  await dbConnect();

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const data = await StockMovement.aggregate([
    {
      $match: {
        createdAt: { $gte: thirtyDaysAgo },
      },
    },
    {
      $group: {
        _id: "$product",
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
      },
    },
    { $unwind: "$product" },
  ]);

  return data.map((item) => ({
    name: item.product.name,
    sku: item.product.sku,
    quantity: item.totalQuantity,
  }));
}

// ============================================
// REQUEST STATUS DISTRIBUTION
// ============================================
export async function getRequestStatusDistribution() {
  await dbConnect();

  const data = await StockRequest.aggregate([
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
    if (statusMap.hasOwnProperty(item._id)) {
      statusMap[item._id] = item.count;
    }
  });

  return Object.entries(statusMap).map(([status, count]) => ({
    status,
    count,
  }));
}
