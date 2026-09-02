import {
  getAssetById,
  listAssetBillCostsPg,
} from "@/app/db/actions/asset-actions";
import { getExpensesByAssetPg } from "@/app/db/actions/expense-actions";

/**
 * What an asset has cost to run, from both sides of the split.
 *
 * THERE IS NO LONGER A SPLIT. This used to be the one query that reached into
 * both stores — bills and the asset register on Postgres (0056), expenses on
 * Mongo — and the note here said it lived on the Mongo side "because that is
 * the half that will be deleted when expenses move". Expenses moved (0059),
 * so both halves are one store and the Mongo half is gone.
 *
 * The file stays where it is only because `app/dashboard/assets/[id]/page.jsx`
 * imports it from here. It belongs in app/db/actions/asset-actions.ts beside
 * listAssetBillCostsPg, and nothing but the import path is stopping it.
 */

export async function getAssetExpenses(assetId) {
  try {
    if (!assetId || !/^[0-9a-f-]{36}$/i.test(assetId)) {
      return { success: false, error: "Invalid asset id", entries: [], total: 0 };
    }

    // Both halves are Postgres, and both are tenant-scoped by RLS rather than
    // by a `isSuperAdmin ? {} : { companyId }` the query has to remember. The
    // void filter moves into the repository, where `status <> 'void'` is the
    // only exclusion there is — `rejected` was one of the legacy statuses and
    // is gone with 0059.
    const [billEntries, expenses] = await Promise.all([
      listAssetBillCostsPg(assetId),
      getExpensesByAssetPg(assetId),
    ]);

    const expenseEntries = expenses.map((e) => {
      // A string from numeric(19,4), and `total` is a generated column, so
      // the `total || amount` fallback the Mongo version needed is gone: the
      // figure cannot be missing.
      const amount = Number(e.total);
      return {
        source: "expense",
        expenseId: e.id,
        // Alias, so the existing detail-page links keep working.
        billId: e.id,
        billNumber: e.expenseNumber,
        billDate: e.expenseDate,
        billStatus: e.status,
        paymentStatus: e.paymentStatus,
        supplierName: e.payeeNameAtExpense || "—",
        lineDescription: e.description || "",
        accountName: e.accountNameAtExpense || "",
        accountCode: e.accountCodeAtExpense || "",
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
