import "server-only";
import { cache } from "react";
import mongoose from "mongoose";

import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  withTenantScope,
} from "@/lib/utils/tenant-utils";
import PurchaseOrder from "@/app/models/purchaseOrder";
import Bill from "@/app/models/bill";
import Party from "@/app/models/parties";
import Product from "@/app/models/product";

// ============================================
// PROCUREMENT DASHBOARD QUERIES
// ============================================
// Each public query is wrapped in React.cache() so multiple Suspense
// boundaries within the same render share results. Keep args primitive.

const VIEW_ROLES = new Set([
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Procurement Officer",
  "Manager",
  "Store Manager",
  "Accountant",
]);
const authorized = (role) => role && VIEW_ROLES.has(role);

export const getProcurementSummary = cache(async () => {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    if (!authorized(user.role)) {
      return { success: false, error: "Access denied" };
    }
    await dbConnect();

    const tenantMatch = isSuperAdmin
      ? {}
      : { companyId: new mongoose.Types.ObjectId(companyId) };

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      openPOs,
      partialPOs,
      pendingBills,
      mtdSpend,
      activeSuppliers,
      lowStockCount,
    ] = await Promise.all([
      PurchaseOrder.countDocuments({
        ...tenantMatch,
        status: { $in: ["sent", "confirmed"] },
      }),
      PurchaseOrder.countDocuments({ ...tenantMatch, status: "partial" }),
      Bill.countDocuments({
        ...tenantMatch,
        status: { $in: ["draft", "submitted"] },
      }),
      Bill.aggregate([
        {
          $match: {
            ...tenantMatch,
            status: { $nin: ["draft", "rejected", "cancelled"] },
            billDate: { $gte: startOfMonth, $lte: now },
          },
        },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]),
      Party.countDocuments({
        ...tenantMatch,
        type: { $in: ["supplier", "both"] },
        isActive: { $ne: false },
      }),
      Product.aggregate([
        { $match: { ...tenantMatch, status: "active" } },
        {
          $project: {
            qty: { $ifNull: ["$inventory.quantityOnHand", 0] },
            reorderAt: { $ifNull: ["$inventory.reorderLevel", 0] },
          },
        },
        {
          $match: {
            reorderAt: { $gt: 0 },
            $expr: { $lte: ["$qty", "$reorderAt"] },
          },
        },
        { $count: "count" },
      ]),
    ]);

    return {
      success: true,
      openPOs,
      partialPOs,
      pendingBills,
      mtdSpend: mtdSpend[0]?.total || 0,
      activeSuppliers,
      lowStockCount: lowStockCount[0]?.count || 0,
    };
  } catch (error) {
    console.error("getProcurementSummary error:", error);
    return { success: false, error: error.message };
  }
});

export const getRecentPurchaseOrders = cache(async (limit = 8) => {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    if (!authorized(user.role)) {
      return { success: false, error: "Access denied", rows: [] };
    }
    await dbConnect();

    const filter = withTenantScope(
      { status: { $nin: ["cancelled", "expired"] } },
      companyId,
      isSuperAdmin,
    );

    const pos = await PurchaseOrder.find(filter)
      .select(
        "poNumber poDate status totalAmount supplier.name expectedDeliveryDate",
      )
      .sort({ poDate: -1 })
      .limit(limit)
      .lean();

    return {
      success: true,
      rows: pos.map((p) => ({
        _id: p._id.toString(),
        poNumber: p.poNumber,
        poDate: p.poDate?.toISOString?.() ?? p.poDate ?? null,
        status: p.status,
        totalAmount: p.totalAmount || 0,
        supplierName: p.supplier?.name || "—",
        expectedDeliveryDate:
          p.expectedDeliveryDate?.toISOString?.() ??
          p.expectedDeliveryDate ??
          null,
      })),
    };
  } catch (error) {
    console.error("getRecentPurchaseOrders error:", error);
    return { success: false, error: error.message, rows: [] };
  }
});

export const getTopSuppliersBySpend = cache(async (limit = 6) => {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    if (!authorized(user.role)) {
      return { success: false, error: "Access denied", rows: [] };
    }
    await dbConnect();

    const tenantMatch = isSuperAdmin
      ? {}
      : { companyId: new mongoose.Types.ObjectId(companyId) };

    const now = new Date();
    const yearAgo = new Date(now);
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);

    const rows = await Bill.aggregate([
      {
        $match: {
          ...tenantMatch,
          status: { $nin: ["draft", "rejected", "cancelled"] },
          billDate: { $gte: yearAgo, $lte: now },
        },
      },
      {
        $group: {
          _id: { id: "$supplier.partyId", name: "$supplier.name" },
          total: { $sum: "$totalAmount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
      { $limit: limit },
    ]);

    return {
      success: true,
      rows: rows.map((r) => ({
        supplierId: r._id?.id?.toString?.() ?? null,
        supplierName: r._id?.name || "—",
        total: r.total || 0,
        billCount: r.count || 0,
      })),
    };
  } catch (error) {
    console.error("getTopSuppliersBySpend error:", error);
    return { success: false, error: error.message, rows: [] };
  }
});
