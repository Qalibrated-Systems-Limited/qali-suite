import PurchaseOrder from "@/app/models/purchaseOrder";
import dbConnect from "@/app/config/dbConnect";
import { serializeBsonType } from "@/lib/utils";

// ============================================
// SEARCH PURCHASE ORDERS
// ============================================
export async function searchPurchaseOrders(
  query = "",
  page = 1,
  filters = {}
) {
  await dbConnect();

  const ITEMS_PER_PAGE = 10;
  const skip = (page - 1) * ITEMS_PER_PAGE;

  // Build filter query
  const filterQuery = {};

  // Search by PO number or supplier name
  if (query) {
    filterQuery.$or = [
      { poNumber: { $regex: query, $options: "i" } },
      { "supplier.name": { $regex: query, $options: "i" } },
    ];
  }

  // Status filter
  if (filters.status && filters.status !== "all") {
    filterQuery.status = filters.status;
  }

  // Date range filter
  if (filters.startDate) {
    filterQuery.poDate = filterQuery.poDate || {};
    filterQuery.poDate.$gte = new Date(filters.startDate);
  }
  if (filters.endDate) {
    filterQuery.poDate = filterQuery.poDate || {};
    filterQuery.poDate.$lte = new Date(filters.endDate);
  }

  // Supplier filter
  if (filters.supplierId) {
    filterQuery["supplier.partyId"] = filters.supplierId;
  }

  const purchaseOrders = await PurchaseOrder.find(filterQuery)
    .sort({ poDate: -1, createdAt: -1 })
    .skip(skip)
    .limit(ITEMS_PER_PAGE)
    .lean();

  // Serialize for client
  return purchaseOrders.map((po) => serializeBsonType(po));
}

// ============================================
// FETCH PURCHASE ORDER PAGES
// ============================================
export async function fetchPOPages(query = "", filters = {}) {
  await dbConnect();

  const ITEMS_PER_PAGE = 10;

  const filterQuery = {};

  if (query) {
    filterQuery.$or = [
      { poNumber: { $regex: query, $options: "i" } },
      { "supplier.name": { $regex: query, $options: "i" } },
    ];
  }

  if (filters.status && filters.status !== "all") {
    filterQuery.status = filters.status;
  }

  if (filters.startDate) {
    filterQuery.poDate = filterQuery.poDate || {};
    filterQuery.poDate.$gte = new Date(filters.startDate);
  }
  if (filters.endDate) {
    filterQuery.poDate = filterQuery.poDate || {};
    filterQuery.poDate.$lte = new Date(filters.endDate);
  }

  if (filters.supplierId) {
    filterQuery["supplier.partyId"] = filters.supplierId;
  }

  const count = await PurchaseOrder.countDocuments(filterQuery);
  return Math.ceil(count / ITEMS_PER_PAGE);
}

// ============================================
// GET PURCHASE ORDER STATS
// ============================================
export async function getPOStats(filters = {}) {
  await dbConnect();

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Build base query
  const baseQuery = {};
  if (filters.startDate) {
    baseQuery.poDate = baseQuery.poDate || {};
    baseQuery.poDate.$gte = new Date(filters.startDate);
  }
  if (filters.endDate) {
    baseQuery.poDate = baseQuery.poDate || {};
    baseQuery.poDate.$lte = new Date(filters.endDate);
  }

  const [stats] = await PurchaseOrder.aggregate([
    { $match: { ...baseQuery, status: { $ne: "cancelled" } } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        totalValue: { $sum: "$amounts.total" },
        draft: {
          $sum: { $cond: [{ $eq: ["$status", "draft"] }, 1, 0] },
        },
        sent: {
          $sum: { $cond: [{ $eq: ["$status", "sent"] }, 1, 0] },
        },
        confirmed: {
          $sum: { $cond: [{ $eq: ["$status", "confirmed"] }, 1, 0] },
        },
        partial: {
          $sum: { $cond: [{ $eq: ["$status", "partial"] }, 1, 0] },
        },
        received: {
          $sum: { $cond: [{ $eq: ["$status", "received"] }, 1, 0] },
        },
        expired: {
          $sum: { $cond: [{ $eq: ["$status", "expired"] }, 1, 0] },
        },
        draftValue: {
          $sum: {
            $cond: [{ $eq: ["$status", "draft"] }, "$amounts.total", 0],
          },
        },
        openValue: {
          $sum: {
            $cond: [
              { $in: ["$status", ["sent", "confirmed", "partial"]] },
              "$amounts.total",
              0,
            ],
          },
        },
      },
    },
  ]);

  // Get overdue count
  const overdueCount = await PurchaseOrder.countDocuments({
    ...baseQuery,
    status: { $in: ["sent", "confirmed", "partial"] },
    expectedDeliveryDate: { $lt: now },
  });

  return {
    total: stats?.total || 0,
    totalValue: stats?.totalValue || 0,
    draft: stats?.draft || 0,
    sent: stats?.sent || 0,
    confirmed: stats?.confirmed || 0,
    partial: stats?.partial || 0,
    received: stats?.received || 0,
    expired: stats?.expired || 0,
    draftValue: stats?.draftValue || 0,
    openValue: stats?.openValue || 0,
    overdueCount,
  };
}

// ============================================
// GET PURCHASE ORDER BY ID
// ============================================
export async function getPurchaseOrderById(id) {
  await dbConnect();

  const po = await PurchaseOrder.findById(id).lean();
  if (!po) return null;

  return serializeBsonType(po);
}

// ============================================
// GET OPEN POS FOR SUPPLIER (for Bill creation)
// ============================================
export async function getOpenPOsForSupplier(supplierId) {
  await dbConnect();

  const pos = await PurchaseOrder.find({
    "supplier.partyId": supplierId,
    status: { $in: ["sent", "confirmed", "partial"] },
  })
    .sort({ poDate: -1 })
    .lean();

  return pos.map((po) => serializeBsonType(po));
}

// ============================================
// GET RECENT PURCHASE ORDERS
// ============================================
export async function getRecentPurchaseOrders(limit = 5) {
  await dbConnect();

  const pos = await PurchaseOrder.find({
    status: { $ne: "cancelled" },
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return pos.map((po) => serializeBsonType(po));
}

// ============================================
// GET POS EXPIRING SOON
// ============================================
export async function getExpiringPOs(daysAhead = 7) {
  await dbConnect();

  const now = new Date();
  const futureDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const pos = await PurchaseOrder.find({
    status: { $in: ["draft", "sent"] },
    validUntil: { $gte: now, $lte: futureDate },
  })
    .sort({ validUntil: 1 })
    .lean();

  return pos.map((po) => serializeBsonType(po));
}
