import "server-only";
import { cache } from "react";

import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  buildTenantMatch,
} from "@/lib/utils/tenant-utils";
import Invoice from "@/app/models/invoice";
import Bill from "@/app/models/bill";
import Expense from "@/app/models/expenses";
import Account from "@/app/models/account";
import Opportunity from "@/app/models/opportunity";
import SalesOrder from "@/app/models/salesOrder";

// ============================================
// EXECUTIVE SNAPSHOT — one read for the whole business's direction
// ============================================
// Eight headline numbers + month-over-month deltas, every aggregate
// matching an existing compound index:
//   revenue      Invoice  (companyId, status, invoiceDate)
//   AR           Invoice  (companyId, paymentStatus, dueDate)
//   AP           Bill     (companyId, ...paymentStatus)
//   expenses     Expense  (companyId, expenseDate, status)
//   cash         Account  cachedBalance over cash/bank/mpesa subtypes
//   pipeline     Opportunity (companyId, stage)
//   backlog      SalesOrder  (companyId, status)
// Direction = this month vs last month on the flow numbers.

const OPEN_STAGES = ["qualification", "needs_analysis", "proposal", "negotiation"];

function monthRange(offset = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  return { start, end };
}

export const cExecutiveSnapshot = cache(async () => {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();
    const tenant = buildTenantMatch(companyId, isSuperAdmin);

    const thisMonth = monthRange(0);
    const lastMonth = monthRange(-1);

    const sumTotal = { $group: { _id: null, total: { $sum: "$total" }, count: { $sum: 1 } } };

    const [
      revThis,
      revLast,
      ar,
      ap,
      expThis,
      expLast,
      cashAccounts,
      pipeline,
      backlog,
    ] = await Promise.all([
      // Revenue = completed/sent invoices by invoice date
      Invoice.aggregate([
        { $match: { ...tenant, status: { $in: ["sent", "completed"] }, invoiceDate: { $gte: thisMonth.start, $lt: thisMonth.end } } },
        sumTotal,
      ]),
      Invoice.aggregate([
        { $match: { ...tenant, status: { $in: ["sent", "completed"] }, invoiceDate: { $gte: lastMonth.start, $lt: lastMonth.end } } },
        sumTotal,
      ]),
      // Outstanding AR / AP
      Invoice.aggregate([
        { $match: { ...tenant, status: { $in: ["sent", "completed"] }, paymentStatus: { $in: ["unpaid", "partial", "overdue"] } } },
        { $group: { _id: null, total: { $sum: "$amountDue" }, count: { $sum: 1 } } },
      ]),
      Bill.aggregate([
        { $match: { ...tenant, status: "approved", paymentStatus: { $in: ["unpaid", "partial"] } } },
        { $group: { _id: null, total: { $sum: "$amounts.balance" }, count: { $sum: 1 } } },
      ]),
      // Operating expenses (posted/approved) this vs last month
      Expense.aggregate([
        { $match: { ...tenant, status: { $in: ["approved", "posted", "paid"] }, expenseDate: { $gte: thisMonth.start, $lt: thisMonth.end } } },
        { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
      Expense.aggregate([
        { $match: { ...tenant, status: { $in: ["approved", "posted", "paid"] }, expenseDate: { $gte: lastMonth.start, $lt: lastMonth.end } } },
        { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
      // Cash position — cached balances of money accounts
      Account.aggregate([
        { $match: { ...tenant, subType: { $in: ["cash", "bank", "mpesa"] }, isActive: { $ne: false } } },
        { $group: { _id: null, total: { $sum: "$cachedBalance" }, count: { $sum: 1 } } },
      ]),
      // Open pipeline value
      Opportunity.aggregate([
        { $match: { ...tenant, stage: { $in: OPEN_STAGES } } },
        { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
      // Confirmed-not-invoiced order backlog
      SalesOrder.aggregate([
        { $match: { ...tenant, status: "confirmed" } },
        sumTotal,
      ]),
    ]);

    const val = (r) => ({ total: r[0]?.total || 0, count: r[0]?.count || 0 });

    return {
      revenue: { ...val(revThis), prev: val(revLast).total },
      expenses: { ...val(expThis), prev: val(expLast).total },
      ar: val(ar),
      ap: val(ap),
      cash: val(cashAccounts),
      pipeline: val(pipeline),
      backlog: val(backlog),
      asOf: new Date().toISOString(),
    };
  } catch (error) {
    console.error("cExecutiveSnapshot error:", error);
    return null;
  }
});
