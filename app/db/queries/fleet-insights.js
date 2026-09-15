import "server-only";
import { cache } from "react";

import {
  countFleetAssetsPg,
  getFleetUsagePg,
  sumAssetBillCostsPg,
} from "@/app/db/actions/asset-actions";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { requirePlanAccess } from "@/lib/plan-gate";
import { safeErrorMessage } from "@/lib/safe-error";
import { sumExpensesByAssetPg } from "@/app/db/actions/expense-actions";

// ============================================
// SHARED INSIGHTS QUERIES
// ============================================
// Each function is wrapped in React's cache() so multiple Suspense
// boundaries within the same request share a single in-flight promise
// (true request-scoped deduplication, not cross-request caching).
//
// We keep these out of the "use server" actions file so they can be
// imported by server components directly without going through the
// Server Action plumbing.

const VIEW_ROLES = ["SuperAdmin", "Admin", "Accountant", "Manager"];
const ACTIVE_STATUSES = ["active", "idle", "in_maintenance"];

function authorized(user) {
  return user.role === "SuperAdmin" || VIEW_ROLES.includes(user.role);
}

function median(values) {
  const sorted = [...values]
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function emptySummary() {
  return {
    totalAssets: 0,
    totalSpend: 0,
    flagged: 0,
    missingReadings: 0,
  };
}

/**
 * Sum trailing 12-month spend per asset across Bills + Expenses in a single
 * pair of aggregations. Indexed on (companyId, lines.asset.id, billDate) and
 * (companyId, asset.id, expenseDate).
 */
/**
 * What each asset has cost inside the window.
 *
 * BILLS ARE ON POSTGRES since the port, and so is the asset register (0056).
 * EXPENSES ARE STILL ON MONGO. Aggregating the Mongo bills collection here
 * would have reported nothing, because nothing writes to it.
 */
async function rollupRunningCosts({ assetIds, start, end, companyId, isSuperAdmin }) {
  if (assetIds.length === 0) return new Map();

  const since = start.toISOString().slice(0, 10);
  const until = end.toISOString().slice(0, 10);

  const billTotals = await sumAssetBillCostsPg({ assetIds, since, until });

  // Postgres since 0059, and the asset link is a real uuid FK now rather than
  // a String the query has to hope matches. `total` is a generated column, so
  // the $ifNull-inside-$ifNull fallback has nothing left to fall back to.
  const expenseRows = await sumExpensesByAssetPg({ assetIds, since, until });

  const totals = new Map(Object.entries(billTotals));
  for (const row of expenseRows) {
    const key = String(row.assetId);
    totals.set(key, (totals.get(key) || 0) + Number(row.total || 0));
  }
  return totals;
}

// ============================================
// LIGHT QUERY: just count active assets
// ============================================
// Independent of the heavy compute — streams in fast.
//
// Note on the signature: React.cache() compares args with Object.is, so
// passing an object literal like `{ category: "" }` would create a new
// cache entry on every call (different reference each time, even with the
// same value). We take a primitive `category` string so the dedupe works.
export const loadFleetAssetCount = cache(async (category = "") => {
  try {
    await requirePlanAccess("finance");
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    if (!authorized(user)) {
      return { success: false, error: "Access denied", count: 0 };
    }
    // POSTGRES since 0056. Counting the Mongo collection would report zero
    // however many assets are in service.
    const count = await countFleetAssetsPg(category);
    return { success: true, count };
  } catch (error) {
    console.error("loadFleetAssetCount error:", error);
    return {
      success: false,
      error: safeErrorMessage(error, "Failed to count assets"),
      count: 0,
    };
  }
});

// ============================================
// HEAVY QUERY: full insights (rows + summary)
// ============================================
// Used by the Watchlist + Flagged + Stale + 12mo-spend cards.
// Wrapped in cache() so all 4 Suspense boundaries share one promise.
// Argument is a primitive string so cache key compares by value
// (see note on loadFleetAssetCount above).
export const loadFleetInsights = cache(async (category = "") => {
  try {
    await requirePlanAccess("finance");
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    if (!authorized(user)) {
      return {
        success: false,
        error: "Access denied",
        rows: [],
        categoryMedians: {},
        summary: emptySummary(),
        window: null,
      };
    }
    const now = new Date();
    const windowEnd = new Date(now);
    const windowStart = new Date(now);
    windowStart.setFullYear(windowStart.getFullYear() - 1);

    // POSTGRES. The Mongo version is one aggregation with a $filter over the
    // embedded usageReadings array; readings are rows now, and only the first
    // and last inside the window are needed to derive distance, so that is all
    // listFleetUsage returns.
    const assets = await getFleetUsagePg({
      category: category || undefined,
      since: windowStart.toISOString(),
      until: windowEnd.toISOString(),
    });

    const totals = await rollupRunningCosts({
      assetIds: assets.map((a) => a._id),
      start: windowStart,
      end: windowEnd,
      companyId,
      isSuperAdmin,
    });

    // Per-category peer medians, computed only over assets with spend > 0.
    const categoryGroups = new Map();
    for (const a of assets) {
      const total = totals.get(a._id) || 0;
      if (!categoryGroups.has(a.category)) categoryGroups.set(a.category, []);
      if (total > 0) categoryGroups.get(a.category).push(total);
    }
    const categoryMedians = new Map();
    for (const [cat, vals] of categoryGroups.entries()) {
      categoryMedians.set(cat, median(vals));
    }

    const rows = assets.map((a) => {
      const total = totals.get(a._id) || 0;
      const bookValue = Number(a.bookValue) || 0;
      const peerMedian = categoryMedians.get(a.category) ?? null;
      const ratio =
        peerMedian && peerMedian > 0 ? total / peerMedian : null;
      const totalPctOfBook =
        bookValue > 0 ? (total / bookValue) * 100 : null;

      // Distance covered inside the window, derived in SQL from the first and
      // last readings — see listFleetUsage. Null unless there are two.
      const distance = a.windowDistance ?? null;
      const costPerUnit = distance && distance > 0 ? total / distance : null;

      let health = "healthy";
      if (ratio !== null && ratio > 1.5) health = "high";
      else if (ratio !== null && ratio > 1.0) health = "watch";
      if (totalPctOfBook !== null && totalPctOfBook > 100) health = "high";

      const lastReading = a.lastReadingAt ? new Date(a.lastReadingAt) : null;
      const daysSinceReading = lastReading
        ? Math.floor((now - lastReading) / (1000 * 60 * 60 * 24))
        : null;

      return {
        _id: a._id,
        assetNumber: a.assetNumber,
        name: a.name,
        category: a.category,
        status: a.status,
        registrationNumber: a.registrationNumber || "",
        bookValue,
        acquisitionCost: Number(a.acquisitionCost) || 0,
        trailing12Total: total,
        peerMedian,
        ratio,
        totalPctOfBook,
        usageUnit: a.usageUnit || "km",
        currentUsage: Number(a.currentUsage) || 0,
        distance,
        costPerUnit,
        daysSinceReading,
        health,
      };
    });

    const summary = {
      totalAssets: rows.length,
      totalSpend: rows.reduce((s, r) => s + r.trailing12Total, 0),
      flagged: rows.filter((r) => r.health !== "healthy").length,
      missingReadings: rows.filter(
        (r) => r.daysSinceReading === null || r.daysSinceReading > 60,
      ).length,
    };

    return {
      success: true,
      rows,
      categoryMedians: Object.fromEntries(categoryMedians.entries()),
      summary,
      window: {
        start: windowStart.toISOString(),
        end: windowEnd.toISOString(),
      },
    };
  } catch (error) {
    console.error("loadFleetInsights error:", error);
    return {
      success: false,
      error: safeErrorMessage(error, "Failed to load fleet insights"),
      rows: [],
      categoryMedians: {},
      summary: emptySummary(),
      window: null,
    };
  }
});
