import "server-only";
import { cache } from "react";

import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  buildTenantMatch,
} from "@/lib/utils/tenant-utils";
import Invoice from "@/app/models/invoice";
import Bill from "@/app/models/bill";
import { sumExpensesForPeriodPg } from "@/app/db/actions/expense-actions";
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
      /**
       * Operating expenses, this month against last. Postgres since 0059, and
       * two things change in the numbers.
       *
       * It sums `total`, not `amount` — so the card now reports what actually
       * hit the P&L (net plus VAT less withholding) rather than the bare line
       * amount, which was neither the cash that left nor the cost recognised.
       * And the status filter loses "approved", which nothing has produced
       * since the one-step flow replaced the approval workflow.
       */
      sumExpensesForPeriodPg({
        start: thisMonth.start.toISOString().slice(0, 10),
        end: thisMonth.end.toISOString().slice(0, 10),
      }),
      sumExpensesForPeriodPg({
        start: lastMonth.start.toISOString().slice(0, 10),
        end: lastMonth.end.toISOString().slice(0, 10),
      }),
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
    // The Postgres reads return a row, not a one-element aggregate array, and
    // money comes back as a string from numeric(19,4).
    const row = (r) => ({ total: Number(r?.total || 0), count: r?.count || 0 });

    return {
      revenue: { ...val(revThis), prev: val(revLast).total },
      expenses: { ...row(expThis), prev: row(expLast).total },
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
