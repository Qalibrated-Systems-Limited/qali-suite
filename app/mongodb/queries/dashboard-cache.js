import "server-only";
import { cache } from "react";

import {
  getFinancialOverview,
  getKeyMetrics,
  getTopProducts,
  getStockMovementTrend,
  getRecentTransactions,
  getStockStats,
  getLowStockProducts,
  getRecentMovements,
  getRecentRequests,
  getOverdueCheckouts,
  getRevenueTrend,
  getDashboardAlerts,
  getARAgingSummary,
  getAPAgingSummary,
} from "./erp-dashboard-queries";

// ============================================
// CACHED DASHBOARD QUERIES
// ============================================
// React.cache() dedupes calls within a single server render — so when
// multiple Suspense boundaries on the same dashboard need the same data,
// only one DB call runs per request. Cache keys are primitives (numbers,
// strings) — never object literals — so equality comparison works.

export const cFinancialOverview = cache(async () => getFinancialOverview());
export const cKeyMetrics = cache(async () => getKeyMetrics());
export const cTopProducts = cache(async (limit = 5) => getTopProducts(limit));
export const cStockMovementTrend = cache(async (days = 7) =>
  getStockMovementTrend(days),
);
export const cRecentTransactions = cache(async (limit = 5) =>
  getRecentTransactions(limit),
);
export const cStockStats = cache(async () => getStockStats());
export const cLowStockProducts = cache(async (limit = 10) =>
  getLowStockProducts(limit),
);
export const cRecentMovements = cache(async (limit = 5) =>
  getRecentMovements(limit),
);
export const cRecentRequests = cache(async (limit = 5) =>
  getRecentRequests(limit),
);
export const cOverdueCheckouts = cache(async (limit = 10) =>
  getOverdueCheckouts(limit),
);
export const cRevenueTrend = cache(async (months = 6) =>
  getRevenueTrend(months),
);
export const cDashboardAlerts = cache(async () => getDashboardAlerts());
export const cARAgingSummary = cache(async () => getARAgingSummary());
export const cAPAgingSummary = cache(async () => getAPAgingSummary());

// Today's stock movements — small count query. Cached so multiple
// boundaries on the same dashboard share it.
import mongoose from "mongoose";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { StockMovement } from "@/app/models/stockmovement";

export const cTodayMovementCount = cache(async () => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const filter = { createdAt: { $gte: start } };
  if (!isSuperAdmin && companyId) {
    filter.companyId = new mongoose.Types.ObjectId(companyId);
  }
  return StockMovement.countDocuments(filter);
});
