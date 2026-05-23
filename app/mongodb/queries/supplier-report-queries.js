import "server-only";
import mongoose from "mongoose";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import Bill from "@/app/models/bill";

const { ObjectId } = mongoose.Types;

function tenantMatch(companyId, isSuperAdmin) {
  return isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };
}

// Bills count toward "spend" once they're approved (posted to AP) and
// not later cancelled. Drafts/submitted/rejected/cancelled are excluded.
const COUNTABLE_STATUSES = ["approved", "paid"];

/**
 * Supplier purchase report — top suppliers in a date range plus
 * spend-by-account breakdown.
 *
 * Uses Bill collection (`(companyId, billDate, status)` index). AP aging
 * buckets aren't broken out here — link to /dashboard/reports/ap-aging.
 */
export async function getSupplierPurchaseReport(startDate, endDate) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const start = startDate
    ? new Date(startDate)
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const end = endDate ? new Date(endDate) : new Date();
  end.setHours(23, 59, 59, 999);

  const match = {
    ...tenantMatch(companyId, isSuperAdmin),
    billDate: { $gte: start, $lte: end },
    status: { $in: COUNTABLE_STATUSES },
  };

  const [supplierRows, categoryRows] = await Promise.all([
    // -- TOP SUPPLIERS --
    Bill.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$supplier.partyId",
          supplierName: { $first: "$supplier.name" },
          billCount: { $sum: 1 },
          totalSpend: { $sum: "$amounts.total" },
          totalNetPayable: { $sum: "$amounts.netPayable" },
          totalPaid: { $sum: "$amounts.paid" },
          outstanding: { $sum: "$amounts.balance" },
          lastBillDate: { $max: "$billDate" },
          firstBillDate: { $min: "$billDate" },
        },
      },
      {
        $project: {
          _id: 0,
          supplierId: "$_id",
          supplierName: 1,
          billCount: 1,
          totalSpend: 1,
          totalNetPayable: 1,
          totalPaid: 1,
          outstanding: 1,
          lastBillDate: 1,
          firstBillDate: 1,
          averageBillValue: {
            $cond: [
              { $gt: ["$billCount", 0] },
              { $divide: ["$totalSpend", "$billCount"] },
              0,
            ],
          },
        },
      },
      { $sort: { totalSpend: -1 } },
    ]),

    // -- SPEND BY EXPENSE / ASSET ACCOUNT --
    Bill.aggregate([
      { $match: match },
      { $unwind: "$lines" },
      {
        $group: {
          _id: "$lines.account.code",
          accountCode: { $first: "$lines.account.code" },
          accountName: { $first: "$lines.account.name" },
          accountType: { $first: "$lines.account.type" },
          totalSpend: { $sum: "$lines.amount" },
          lineCount: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          accountCode: 1,
          accountName: 1,
          accountType: 1,
          totalSpend: 1,
          lineCount: 1,
        },
      },
      { $sort: { totalSpend: -1 } },
      { $limit: 25 },
    ]),
  ]);

  const totalSpend = supplierRows.reduce((s, r) => s + (r.totalSpend || 0), 0);
  const totalOutstanding = supplierRows.reduce(
    (s, r) => s + (r.outstanding || 0),
    0,
  );
  const totalBills = supplierRows.reduce((s, r) => s + (r.billCount || 0), 0);
  const topShare =
    totalSpend > 0 && supplierRows.length > 0
      ? (supplierRows[0].totalSpend / totalSpend) * 100
      : 0;
  const topFiveShare =
    totalSpend > 0
      ? (supplierRows.slice(0, 5).reduce((s, r) => s + (r.totalSpend || 0), 0) /
          totalSpend) *
        100
      : 0;

  const suppliers = supplierRows.map((r) => ({
    ...r,
    spendShare: totalSpend > 0 ? (r.totalSpend / totalSpend) * 100 : 0,
  }));

  const categories = categoryRows.map((c) => ({
    ...c,
    spendShare: totalSpend > 0 ? (c.totalSpend / totalSpend) * 100 : 0,
  }));

  return {
    period: { startDate: start.toISOString(), endDate: end.toISOString() },
    summary: {
      totalSuppliers: supplierRows.length,
      totalSpend,
      totalOutstanding,
      totalBills,
      topSupplierShare: topShare,
      topFiveShare,
    },
    suppliers,
    categories,
  };
}
