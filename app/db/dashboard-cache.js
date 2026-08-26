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
  getTodayMovementCount,
} from "@/app/db/actions/dashboard-actions";

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
//
// This one used to reach Mongo directly and build its own tenant filter.
// Postgres scopes it through RLS, so there is no filter to write and no
// fail-closed branch to remember.
export const cTodayMovementCount = cache(async () => getTodayMovementCount());
