import mongoose from "mongoose";
import dbConnect from "@/app/config/dbConnect";
import Expense from "@/app/models/expenses";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import {
  getAssetById,
  listAssetBillCostsPg,
} from "@/app/db/actions/asset-actions";

/**
 * What an asset has cost to run, from both sides of the split.
 *
 * BILLS ARE ON POSTGRES and so is the asset register (0056); EXPENSES ARE
 * STILL ON MONGO. This is the one query that has to reach into both, so it is
 * the one place the seam is visible — and it lives here, on the Mongo side,
 * because that is the half that will be deleted when expenses move.
 *
 * `expenses.asset.id` is a String rather than an ObjectId for the same reason:
 * asset ids are UUIDs now, and Mongoose cannot cast one.
 */

const VOIDED = ["void", "rejected"];

export async function getAssetExpenses(assetId) {
  try {
    if (!assetId || !/^[0-9a-f-]{36}$/i.test(assetId)) {
      return { success: false, error: "Invalid asset id", entries: [], total: 0 };
    }

    const billEntries = await listAssetBillCostsPg(assetId);

    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();
    const match = isSuperAdmin
      ? { "asset.id": assetId, status: { $nin: VOIDED } }
      : {
          companyId: new mongoose.Types.ObjectId(companyId),
          "asset.id": assetId,
          status: { $nin: VOIDED },
        };

    const expenses = await Expense.find(match)
      .select(
        "expenseNumber expenseDate status paymentStatus paymentMethod vendor.name description amount total accountCode accountName",
      )
      .sort({ expenseDate: -1 })
      .lean();

    const expenseEntries = expenses.map((e) => {
      const amount = e.total || e.amount || 0;
      return {
        source: "expense",
        expenseId: e._id.toString(),
        // Alias, so the existing detail-page links keep working.
        billId: e._id.toString(),
        billNumber: e.expenseNumber,
        billDate: e.expenseDate?.toISOString?.() ?? e.expenseDate ?? null,
        billStatus: e.status,
        paymentStatus: e.paymentStatus || e.paymentMethod || null,
        supplierName: e.vendor?.name || "—",
        lineDescription: e.description || "",
        accountName: e.accountName || "",
        accountCode: e.accountCode || "",
        amount,
        lineTotal: amount,
      };
    });

    const entries = [...billEntries, ...expenseEntries].sort((a, b) => {
      const da = a.billDate ? new Date(a.billDate).getTime() : 0;
      const db = b.billDate ? new Date(b.billDate).getTime() : 0;
      return db - da;
    });

    const total = entries.reduce((s, e) => s + (e.amount || 0), 0);
    return { success: true, entries, total };
  } catch (error) {
    console.error("getAssetExpenses error:", error);
    return {
      success: false,
      error: "Failed to load asset expenses",
      entries: [],
      total: 0,
    };
  }
}

/**
 * Cost per kilometre or per hour: what has been spent, over how far it has
 * gone. Usage readings are on the asset in Postgres; the spend is the merged
 * figure above.
 */
export async function getAssetRunningCosts(assetId) {
  try {
    const asset = await getAssetById(assetId);
    if (!asset) {
      return { success: false, error: "Asset not found", totalCost: 0 };
    }

    const { entries, total } = await getAssetExpenses(assetId);

    const readings = asset.usageReadings || [];
    // Distance covered, not the odometer figure: an asset bought second-hand
    // starts at whatever its meter already said.
    const first = readings.length ? Number(readings[readings.length - 1].reading) : 0;
    const last = readings.length ? Number(readings[0].reading) : 0;
    const distance = Math.max(0, last - first);

    return {
      success: true,
      totalCost: total,
      entryCount: entries.length,
      usageUnit: asset.usageUnit,
      currentUsage: asset.currentUsage,
      distanceCovered: distance,
      costPerUnit: distance > 0 ? total / distance : null,
    };
  } catch (error) {
    console.error("getAssetRunningCosts error:", error);
    return { success: false, error: "Failed to load running costs", totalCost: 0 };
  }
}
