import "server-only";
import { cache } from "react";
import mongoose from "mongoose";

import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  withTenantScope,
} from "@/lib/utils/tenant-utils";
import { requirePlanAccess } from "@/lib/plan-gate";
import { safeErrorMessage } from "@/lib/safe-error";
import Asset from "@/app/models/asset";
import Bill from "@/app/models/bill";
import Expense from "@/app/models/expenses";

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
async function rollupRunningCosts({
  assetIds,
  start,
  end,
  companyId,
  isSuperAdmin,
}) {
  if (assetIds.length === 0) return new Map();

  const idObjs = assetIds.map((id) => new mongoose.Types.ObjectId(id));
  const tenantClause = isSuperAdmin ? {} : { companyId };

  const [billRows, expenseRows] = await Promise.all([
    Bill.aggregate([
      {
        $match: {
          ...tenantClause,
          status: { $ne: "cancelled" },
          billDate: { $gte: start, $lte: end },
          "lines.asset.id": { $in: idObjs },
        },
      },
      { $unwind: "$lines" },
      { $match: { "lines.asset.id": { $in: idObjs } } },
      {
        $group: {
          _id: "$lines.asset.id",
          total: { $sum: { $ifNull: ["$lines.amount", 0] } },
        },
      },
    ]),
    Expense.aggregate([
      {
        $match: {
          ...tenantClause,
          status: { $nin: ["void", "rejected"] },
          expenseDate: { $gte: start, $lte: end },
          "asset.id": { $in: idObjs },
        },
      },
      {
        $group: {
          _id: "$asset.id",
          total: { $sum: { $ifNull: ["$total", "$amount"] } },
        },
      },
    ]),
  ]);

  const result = new Map();
  for (const id of assetIds) result.set(id.toString(), 0);
  for (const row of billRows) {
    const k = row._id.toString();
    result.set(k, (result.get(k) || 0) + (row.total || 0));
  }
  for (const row of expenseRows) {
    const k = row._id.toString();
    result.set(k, (result.get(k) || 0) + (row.total || 0));
  }
  return result;
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
    await dbConnect();

    const filter = withTenantScope(
      {
        status: { $in: ACTIVE_STATUSES },
        ...(category ? { category } : {}),
      },
      companyId,
      isSuperAdmin,
    );
    const count = await Asset.countDocuments(filter);
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
    await dbConnect();

    const now = new Date();
    const windowEnd = new Date(now);
    const windowStart = new Date(now);
    windowStart.setFullYear(windowStart.getFullYear() - 1);

    const filter = withTenantScope(
      {
        status: { $in: ACTIVE_STATUSES },
        ...(category ? { category } : {}),
      },
      companyId,
      isSuperAdmin,
    );

    // Aggregation that projects only readings inside the window — keeps
    // payload small for assets with hundreds of historical readings.
    const assets = await Asset.aggregate([
      { $match: filter },
      {
        $project: {
          assetNumber: 1,
          name: 1,
          category: 1,
          status: 1,
          bookValue: 1,
          acquisitionCost: 1,
          usageUnit: 1,
          currentUsage: 1,
          registrationNumber: 1,
          lastReadingAt: 1,
          windowReadings: {
            $filter: {
              input: { $ifNull: ["$usageReadings", []] },
              as: "r",
              cond: {
                $and: [
                  { $gte: ["$$r.recordedAt", windowStart] },
                  { $lte: ["$$r.recordedAt", windowEnd] },
                ],
              },
            },
          },
        },
      },
    ]);

    if (assets.length === 0) {
      return {
        success: true,
        rows: [],
        categoryMedians: {},
        summary: emptySummary(),
        window: {
          start: windowStart.toISOString(),
          end: windowEnd.toISOString(),
        },
      };
    }

    const totals = await rollupRunningCosts({
      assetIds: assets.map((a) => a._id.toString()),
      start: windowStart,
      end: windowEnd,
      companyId,
      isSuperAdmin,
    });

    // Per-category peer medians, computed only over assets with spend > 0.
    const categoryGroups = new Map();
    for (const a of assets) {
      const total = totals.get(a._id.toString()) || 0;
      if (!categoryGroups.has(a.category)) categoryGroups.set(a.category, []);
      if (total > 0) categoryGroups.get(a.category).push(total);
    }
    const categoryMedians = new Map();
    for (const [cat, vals] of categoryGroups.entries()) {
      categoryMedians.set(cat, median(vals));
    }

    const rows = assets.map((a) => {
      const total = totals.get(a._id.toString()) || 0;
      const bookValue = Number(a.bookValue) || 0;
      const peerMedian = categoryMedians.get(a.category) ?? null;
      const ratio =
        peerMedian && peerMedian > 0 ? total / peerMedian : null;
      const totalPctOfBook =
        bookValue > 0 ? (total / bookValue) * 100 : null;

      // windowReadings is projected pre-sorted-by-insert; sort defensively.
      const inWindow = (a.windowReadings || []).slice().sort((x, y) => {
        const dx = x.recordedAt ? new Date(x.recordedAt).getTime() : 0;
        const dy = y.recordedAt ? new Date(y.recordedAt).getTime() : 0;
        return dx - dy;
      });
      let costPerUnit = null;
      let distance = null;
      if (inWindow.length >= 2) {
        const delta =
          (inWindow[inWindow.length - 1].reading || 0) -
          (inWindow[0].reading || 0);
        if (delta > 0) {
          distance = delta;
          costPerUnit = total / delta;
        }
      }

      let health = "healthy";
      if (ratio !== null && ratio > 1.5) health = "high";
      else if (ratio !== null && ratio > 1.0) health = "watch";
      if (totalPctOfBook !== null && totalPctOfBook > 100) health = "high";

      const lastReading = a.lastReadingAt ? new Date(a.lastReadingAt) : null;
      const daysSinceReading = lastReading
        ? Math.floor((now - lastReading) / (1000 * 60 * 60 * 24))
        : null;

      return {
        _id: a._id.toString(),
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
