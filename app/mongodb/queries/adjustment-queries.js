"use server";

import dbConnect from "@/app/config/dbConnect";
import InventoryAdjustment from "@/app/models/inventoryAdjustment";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import { serializeBsonType } from "@/lib/utils";

/**
 * Get paginated list of adjustments
 */
export async function getAdjustments({
  page = 1,
  limit = 20,
  status = null,
  adjustmentType = null,
  search = null,
  startDate = null,
  endDate = null,
} = {}) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  // Build filter
  const filter = {};

  if (status && status !== "all") {
    filter.status = status;
  }

  if (adjustmentType && adjustmentType !== "all") {
    filter.adjustmentType = adjustmentType;
  }

  if (startDate || endDate) {
    filter.adjustmentDate = {};
    if (startDate) filter.adjustmentDate.$gte = new Date(startDate);
    if (endDate) filter.adjustmentDate.$lte = new Date(endDate);
  }

  if (search) {
    filter.$or = [
      { adjustmentNumber: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
      { "lines.productName": { $regex: search, $options: "i" } },
      { "lines.productSKU": { $regex: search, $options: "i" } },
    ];
  }

  const scopedFilter = withTenantScope(filter, companyId, isSuperAdmin);

  const skip = (page - 1) * limit;

  const [adjustments, total] = await Promise.all([
    InventoryAdjustment.find(scopedFilter)
      .sort({ adjustmentDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    InventoryAdjustment.countDocuments(scopedFilter),
  ]);

  return {
    adjustments: serializeBsonType(adjustments),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
}

/**
 * Get adjustment by ID
 */
export async function getAdjustmentById(id) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const adjustment = await InventoryAdjustment.findOne(
    withTenantScope({ _id: id }, companyId, isSuperAdmin)
  )
    .populate("journalEntryId")
    .lean();

  if (!adjustment) return null;

  return serializeBsonType(adjustment);
}

/**
 * Get adjustment statistics
 */
export async function getAdjustmentStats({
  startDate = null,
  endDate = null,
} = {}) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  // Default to current month if no dates provided
  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const dateFilter = {
    adjustmentDate: {
      $gte: startDate ? new Date(startDate) : defaultStart,
      $lte: endDate ? new Date(endDate) : defaultEnd,
    },
  };

  const scopedFilter = withTenantScope(
    { ...dateFilter, status: "approved" },
    companyId,
    isSuperAdmin
  );

  const result = await InventoryAdjustment.aggregate([
    { $match: scopedFilter },
    {
      $group: {
        _id: null,
        totalAdjustments: { $sum: 1 },
        totalIncreaseValue: { $sum: "$totalIncreaseValue" },
        totalDecreaseValue: { $sum: "$totalDecreaseValue" },
        totalItems: { $sum: { $size: "$lines" } },
      },
    },
  ]);

  // Get counts by type
  const byType = await InventoryAdjustment.aggregate([
    { $match: scopedFilter },
    {
      $group: {
        _id: "$adjustmentType",
        count: { $sum: 1 },
        value: { $sum: "$totalAdjustmentValue" },
      },
    },
    { $sort: { count: -1 } },
  ]);

  // Get counts by status (all time)
  const statusFilter = withTenantScope({}, companyId, isSuperAdmin);
  const byStatus = await InventoryAdjustment.aggregate([
    { $match: statusFilter },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  const stats = result[0] || {
    totalAdjustments: 0,
    totalIncreaseValue: 0,
    totalDecreaseValue: 0,
    totalItems: 0,
  };

  return {
    ...stats,
    netValue: stats.totalIncreaseValue - stats.totalDecreaseValue,
    byType,
    byStatus: byStatus.reduce((acc, s) => {
      acc[s._id] = s.count;
      return acc;
    }, {}),
  };
}

/**
 * Get recent adjustments for dashboard
 */
export async function getRecentAdjustments(limit = 5) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const adjustments = await InventoryAdjustment.find(
    withTenantScope({}, companyId, isSuperAdmin)
  )
    .sort({ createdAt: -1 })
    .limit(limit)
    .select("adjustmentNumber adjustmentDate adjustmentType status totalAdjustmentValue totalIncreaseValue totalDecreaseValue lines createdBy")
    .lean();

  return serializeBsonType(adjustments);
}
