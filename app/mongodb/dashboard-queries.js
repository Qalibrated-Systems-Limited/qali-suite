import Product from "../models/product";
import { StockRequest } from "../models/requests";
import { ItemCheckout } from "../models/checkouts";
import { StockMovement } from "../models/stockmovement";
import dbConnect from "../config/dbConnect";

// ============================================
// DASHBOARD OVERVIEW STATS
// ============================================
dbConnect();
export const getDashboardStats = async () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    totalProducts,
    lowStockCount,
    outOfStockCount,
    totalStockValue,
    pendingRequests,
    activeCheckouts,
    overdueCheckouts,
    monthlyMovements,
  ] = await Promise.all([
    // Total products
    Product.countDocuments(),

    // Low stock items (1-9)
    Product.countDocuments({ stock: { $gte: 1, $lte: 9 } }),

    // Out of stock
    Product.countDocuments({ stock: 0 }),

    // Total stock value
    Product.aggregate([
      {
        $group: {
          _id: null,
          totalValue: {
            $sum: { $multiply: ["$stock", "$price"] },
          },
        },
      },
    ]).then((result) => result[0]?.totalValue || 0),

    // Pending requests
    StockRequest.countDocuments({ status: "pending" }),

    // Active checkouts
    ItemCheckout.countDocuments({ status: "checked_out" }),

    // Overdue checkouts
    ItemCheckout.countDocuments({
      status: "checked_out",
      expectedReturnDate: { $lt: now },
    }),

    // This month's movements
    StockMovement.countDocuments({
      createdAt: { $gte: startOfMonth },
    }),
  ]);

  return {
    totalProducts,
    lowStockCount,
    outOfStockCount,
    totalStockValue,
    pendingRequests,
    activeCheckouts,
    overdueCheckouts,
    monthlyMovements,
  };
};

// ============================================
// STOCK MOVEMENT TREND (Last 7 days)
// ============================================
export const getMovementTrend = async (days = 7) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const movements = await StockMovement.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          direction: "$direction",
        },
        count: { $sum: 1 },
        quantity: { $sum: "$quantity" },
      },
    },
    {
      $sort: { "_id.date": 1 },
    },
  ]);

  // Format data for Recharts
  const trendData = {};
  movements.forEach((item) => {
    const date = item._id.date;
    if (!trendData[date]) {
      trendData[date] = { date, in: 0, out: 0 };
    }
    trendData[date][item._id.direction] = item.quantity;
  });

  return Object.values(trendData);
};

// ============================================
// STOCK BY CATEGORY
// ============================================
export const getStockByCategory = async () => {
  const categoryData = await Product.aggregate([
    {
      $group: {
        _id: "$category",
        totalItems: { $sum: 1 },
        totalStock: { $sum: "$stock" },
        totalValue: { $sum: { $multiply: ["$stock", "$price"] } },
      },
    },
    {
      $sort: { totalValue: -1 },
    },
  ]);

  return categoryData.map((item) => ({
    category: item._id || "Uncategorized",
    totalItems: item.totalItems,
    totalStock: item.totalStock,
    totalValue: item.totalValue,
  }));
};

// ============================================
// RECENT REQUESTS (Latest 5)
// ============================================
export const getRecentRequests = async (limit = 5) => {
  const requests = await StockRequest.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return requests.map((request) => ({
    _id: request._id.toString(),
    requestNumber: request.requestNumber,
    requester: request.requester,
    status: request.status,
    priority: request.priority,
    itemCount: request.items?.length || 0,
    createdAt: request.createdAt.toISOString(),
  }));
};

// ============================================
// RECENT MOVEMENTS (Latest 10)
// ============================================
export const getRecentMovements = async (limit = 10) => {
  const movements = await StockMovement.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return movements.map((movement) => ({
    _id: movement._id.toString(),
    movementNumber: movement.movementNumber,
    productSnapshot: movement.productSnapshot,
    movementType: movement.movementType,
    direction: movement.direction,
    quantity: movement.quantity,
    performedBy: movement.performedBy,
    createdAt: movement.createdAt.toISOString(),
  }));
};

// ============================================
// LOW STOCK ALERTS
// ============================================
export const getLowStockAlerts = async (threshold = 10) => {
  const lowStockItems = await Product.find({
    stock: { $lte: threshold, $gte: 1 },
  })
    .sort({ stock: 1 })
    .limit(10)
    .lean();

  return lowStockItems.map((product) => ({
    _id: product._id.toString(),
    name: product.name,
    SKU: product.SKU,
    stock: product.stock,
    category: product.category,
    reorderLevel: product.reorderLevel || threshold,
  }));
};

// ============================================
// OVERDUE CHECKOUTS
// ============================================
export const getOverdueCheckouts = async () => {
  const now = new Date();

  const overdueItems = await ItemCheckout.find({
    status: "checked_out",
    expectedReturnDate: { $lt: now },
  })
    .sort({ expectedReturnDate: 1 })
    .limit(10)
    .lean();

  return overdueItems.map((checkout) => {
    const daysOverdue = Math.floor(
      (now - new Date(checkout.expectedReturnDate)) / (1000 * 60 * 60 * 24)
    );

    return {
      _id: checkout._id.toString(),
      checkoutNumber: checkout.checkoutNumber,
      productSnapshot: checkout.productSnapshot,
      checkedOutTo: checkout.checkedOutTo,
      expectedReturnDate: checkout.expectedReturnDate.toISOString(),
      daysOverdue,
    };
  });
};

// ============================================
// TOP PRODUCTS (Most Moved)
// ============================================
export const getTopProducts = async (limit = 5) => {
  const topProducts = await StockMovement.aggregate([
    {
      $group: {
        _id: "$productId",
        totalMovements: { $sum: 1 },
        totalQuantity: { $sum: "$quantity" },
        productName: { $first: "$productSnapshot.name" },
        productSKU: { $first: "$productSnapshot.SKU" },
      },
    },
    {
      $sort: { totalMovements: -1 },
    },
    {
      $limit: limit,
    },
  ]);

  return topProducts.map((item) => ({
    productId: item._id.toString(),
    name: item.productName,
    SKU: item.productSKU,
    totalMovements: item.totalMovements,
    totalQuantity: item.totalQuantity,
  }));
};

// ============================================
// REQUEST STATUS BREAKDOWN
// ============================================
export const getRequestStatusBreakdown = async () => {
  const breakdown = await StockRequest.aggregate([
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  const statusMap = {
    pending: 0,
    approved: 0,
    rejected: 0,
    fulfilled: 0,
    partially_fulfilled: 0,
    cancelled: 0,
  };

  breakdown.forEach((item) => {
    statusMap[item._id] = item.count;
  });

  return statusMap;
};

// ============================================
// MASTER DASHBOARD DATA (Parallel Fetch)
// ============================================
// export const getDashboardData = async () => {
//   const [topProducts, requestBreakdown] = await Promise.all([
//     getTopProducts(5),
//     getRequestStatusBreakdown(),
//   ]);

//   return {
//     topProducts,
//     requestBreakdown,
//   };
// };
