"use server";

import dbConnect from "@/app/config/dbConnect";
import Invoice from "@/app/models/invoice";
import Bill from "@/app/models/bill";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";

/**
 * Get AR Aging Report (from Invoices)
 * Groups unpaid/partial invoices by customer and aging bucket
 */
export async function getARAgingReport(asOfDate = new Date()) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const dateObj = new Date(asOfDate);

  // Get all unpaid/partial completed invoices
  const result = await Invoice.aggregate([
    {
      $match: withTenantScope(
        {
          status: "completed",
          paymentStatus: { $in: ["unpaid", "partial"] },
          invoiceDate: { $lte: dateObj },
        },
        companyId,
        isSuperAdmin
      ),
    },
    {
      $addFields: {
        balanceDue: { $subtract: ["$total", "$amountPaid"] },
        daysOverdue: {
          $floor: {
            $divide: [
              { $subtract: [dateObj, "$dueDate"] },
              1000 * 60 * 60 * 24,
            ],
          },
        },
      },
    },
    {
      $addFields: {
        agingBucket: {
          $switch: {
            branches: [
              { case: { $lte: ["$daysOverdue", 0] }, then: "current" },
              { case: { $lte: ["$daysOverdue", 30] }, then: "1-30" },
              { case: { $lte: ["$daysOverdue", 60] }, then: "31-60" },
              { case: { $lte: ["$daysOverdue", 90] }, then: "61-90" },
            ],
            default: "90+",
          },
        },
      },
    },
    {
      $group: {
        _id: {
          customerId: "$customer.id",
          customerName: "$customer.name",
        },
        current: {
          $sum: {
            $cond: [{ $eq: ["$agingBucket", "current"] }, "$balanceDue", 0],
          },
        },
        days1_30: {
          $sum: {
            $cond: [{ $eq: ["$agingBucket", "1-30"] }, "$balanceDue", 0],
          },
        },
        days31_60: {
          $sum: {
            $cond: [{ $eq: ["$agingBucket", "31-60"] }, "$balanceDue", 0],
          },
        },
        days61_90: {
          $sum: {
            $cond: [{ $eq: ["$agingBucket", "61-90"] }, "$balanceDue", 0],
          },
        },
        days90plus: {
          $sum: {
            $cond: [{ $eq: ["$agingBucket", "90+"] }, "$balanceDue", 0],
          },
        },
        total: { $sum: "$balanceDue" },
        invoiceCount: { $sum: 1 },
        oldestInvoice: { $min: "$invoiceDate" },
      },
    },
    {
      $project: {
        _id: 0,
        customerId: "$_id.customerId",
        customerName: "$_id.customerName",
        current: 1,
        days1_30: 1,
        days31_60: 1,
        days61_90: 1,
        days90plus: 1,
        total: 1,
        invoiceCount: 1,
        oldestInvoice: 1,
      },
    },
    { $match: { total: { $gt: 0.01 } } },
    { $sort: { total: -1 } },
  ]);

  // Calculate summary
  const summary = result.reduce(
    (acc, row) => ({
      current: acc.current + row.current,
      days1_30: acc.days1_30 + row.days1_30,
      days31_60: acc.days31_60 + row.days31_60,
      days61_90: acc.days61_90 + row.days61_90,
      days90plus: acc.days90plus + row.days90plus,
      total: acc.total + row.total,
      customerCount: acc.customerCount + 1,
      invoiceCount: acc.invoiceCount + row.invoiceCount,
    }),
    {
      current: 0,
      days1_30: 0,
      days31_60: 0,
      days61_90: 0,
      days90plus: 0,
      total: 0,
      customerCount: 0,
      invoiceCount: 0,
    }
  );

  summary.overdueTotal =
    summary.days1_30 + summary.days31_60 + summary.days61_90 + summary.days90plus;
  summary.overduePercent =
    summary.total > 0 ? (summary.overdueTotal / summary.total) * 100 : 0;

  return {
    reportName: "Accounts Receivable Aging",
    asOfDate: dateObj,
    customers: result,
    summary,
  };
}

/**
 * Get AP Aging Report (from Bills)
 * Groups unpaid/partial bills by supplier and aging bucket
 */
export async function getAPAgingReport(asOfDate = new Date()) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const dateObj = new Date(asOfDate);

  // Get all unpaid/partial approved bills
  const result = await Bill.aggregate([
    {
      $match: withTenantScope(
        {
          status: { $in: ["approved", "partial"] },
          paymentStatus: { $in: ["unpaid", "partial"] },
          billDate: { $lte: dateObj },
        },
        companyId,
        isSuperAdmin
      ),
    },
    {
      $addFields: {
        balanceDue: "$amounts.balance",
        daysOverdue: {
          $floor: {
            $divide: [
              { $subtract: [dateObj, "$dueDate"] },
              1000 * 60 * 60 * 24,
            ],
          },
        },
      },
    },
    {
      $addFields: {
        agingBucket: {
          $switch: {
            branches: [
              { case: { $lte: ["$daysOverdue", 0] }, then: "current" },
              { case: { $lte: ["$daysOverdue", 30] }, then: "1-30" },
              { case: { $lte: ["$daysOverdue", 60] }, then: "31-60" },
              { case: { $lte: ["$daysOverdue", 90] }, then: "61-90" },
            ],
            default: "90+",
          },
        },
      },
    },
    {
      $group: {
        _id: {
          supplierId: "$supplier.partyId",
          supplierName: "$supplier.name",
        },
        current: {
          $sum: {
            $cond: [{ $eq: ["$agingBucket", "current"] }, "$balanceDue", 0],
          },
        },
        days1_30: {
          $sum: {
            $cond: [{ $eq: ["$agingBucket", "1-30"] }, "$balanceDue", 0],
          },
        },
        days31_60: {
          $sum: {
            $cond: [{ $eq: ["$agingBucket", "31-60"] }, "$balanceDue", 0],
          },
        },
        days61_90: {
          $sum: {
            $cond: [{ $eq: ["$agingBucket", "61-90"] }, "$balanceDue", 0],
          },
        },
        days90plus: {
          $sum: {
            $cond: [{ $eq: ["$agingBucket", "90+"] }, "$balanceDue", 0],
          },
        },
        total: { $sum: "$balanceDue" },
        billCount: { $sum: 1 },
        oldestBill: { $min: "$billDate" },
      },
    },
    {
      $project: {
        _id: 0,
        supplierId: "$_id.supplierId",
        supplierName: "$_id.supplierName",
        current: 1,
        days1_30: 1,
        days31_60: 1,
        days61_90: 1,
        days90plus: 1,
        total: 1,
        billCount: 1,
        oldestBill: 1,
      },
    },
    { $match: { total: { $gt: 0.01 } } },
    { $sort: { total: -1 } },
  ]);

  // Calculate summary
  const summary = result.reduce(
    (acc, row) => ({
      current: acc.current + row.current,
      days1_30: acc.days1_30 + row.days1_30,
      days31_60: acc.days31_60 + row.days31_60,
      days61_90: acc.days61_90 + row.days61_90,
      days90plus: acc.days90plus + row.days90plus,
      total: acc.total + row.total,
      supplierCount: acc.supplierCount + 1,
      billCount: acc.billCount + row.billCount,
    }),
    {
      current: 0,
      days1_30: 0,
      days31_60: 0,
      days61_90: 0,
      days90plus: 0,
      total: 0,
      supplierCount: 0,
      billCount: 0,
    }
  );

  summary.overdueTotal =
    summary.days1_30 + summary.days31_60 + summary.days61_90 + summary.days90plus;
  summary.overduePercent =
    summary.total > 0 ? (summary.overdueTotal / summary.total) * 100 : 0;

  return {
    reportName: "Accounts Payable Aging",
    asOfDate: dateObj,
    suppliers: result,
    summary,
  };
}

/**
 * Get AR detail for a specific customer
 */
export async function getCustomerARDetail(customerId, asOfDate = new Date()) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const invoices = await Invoice.find(
    withTenantScope(
      {
        "customer.id": customerId,
        status: "completed",
        paymentStatus: { $in: ["unpaid", "partial"] },
        invoiceDate: { $lte: new Date(asOfDate) },
      },
      companyId,
      isSuperAdmin
    )
  )
    .select(
      "invoiceNumber invoiceDate dueDate total amountPaid customer.name"
    )
    .sort({ dueDate: 1 })
    .lean();

  return invoices.map((inv) => ({
    ...inv,
    balanceDue: inv.total - inv.amountPaid,
    daysOverdue: Math.floor(
      (new Date(asOfDate) - new Date(inv.dueDate)) / (1000 * 60 * 60 * 24)
    ),
  }));
}

/**
 * Get AP detail for a specific supplier
 */
export async function getSupplierAPDetail(supplierId, asOfDate = new Date()) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const bills = await Bill.find(
    withTenantScope(
      {
        "supplier.partyId": supplierId,
        status: { $in: ["approved", "partial"] },
        paymentStatus: { $in: ["unpaid", "partial"] },
        billDate: { $lte: new Date(asOfDate) },
      },
      companyId,
      isSuperAdmin
    )
  )
    .select(
      "billNumber billDate dueDate amounts.netPayable amounts.paid amounts.balance supplier.name"
    )
    .sort({ dueDate: 1 })
    .lean();

  return bills.map((bill) => ({
    ...bill,
    balanceDue: bill.amounts?.balance || (bill.amounts?.netPayable - bill.amounts?.paid) || 0,
    daysOverdue: Math.floor(
      (new Date(asOfDate) - new Date(bill.dueDate)) / (1000 * 60 * 60 * 24)
    ),
  }));
}
