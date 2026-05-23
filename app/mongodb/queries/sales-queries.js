"use server";

import dbConnect from "@/app/config/dbConnect";
import Invoice from "@/app/models/invoice";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";

/**
 * Get Sales by Customer Report
 */
export async function getSalesByCustomerReport(startDate, endDate) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  // Note: include status "completed" plus any post-draft state that
  // represents recognised revenue (the prior version restricted to
  // "completed" only, which silently undercounted in tenants whose
  // workflow ends at "paid"/"approved"). Drafts and cancelled are still
  // excluded.
  const result = await Invoice.aggregate([
    {
      $match: withTenantScope(
        {
          status: { $nin: ["draft", "cancelled"] },
          invoiceDate: {
            $gte: new Date(startDate),
            $lte: new Date(endDate),
          },
        },
        companyId,
        isSuperAdmin
      ),
    },
    {
      $group: {
        _id: {
          customerId: "$customer.id",
          customerName: "$customer.name",
        },
        customerEmail: { $first: "$customer.email" },
        invoiceCount: { $sum: 1 },
        totalSales: { $sum: "$total" },
        totalCOGS: { $sum: "$totalCOGS" },
        totalPaid: { $sum: "$amountPaid" },
        avgInvoiceValue: { $avg: "$total" },
        firstInvoice: { $min: "$invoiceDate" },
        lastInvoice: { $max: "$invoiceDate" },
      },
    },
    {
      $project: {
        _id: 0,
        customerId: "$_id.customerId",
        customerName: "$_id.customerName",
        customerEmail: 1,
        invoiceCount: 1,
        totalSales: 1,
        totalCOGS: 1,
        grossProfit: { $subtract: ["$totalSales", "$totalCOGS"] },
        grossMarginPct: {
          $cond: [
            { $gt: ["$totalSales", 0] },
            {
              $multiply: [
                {
                  $divide: [
                    { $subtract: ["$totalSales", "$totalCOGS"] },
                    "$totalSales",
                  ],
                },
                100,
              ],
            },
            0,
          ],
        },
        totalPaid: 1,
        totalOutstanding: { $subtract: ["$totalSales", "$totalPaid"] },
        avgInvoiceValue: 1,
        firstInvoice: 1,
        lastInvoice: 1,
      },
    },
    { $sort: { totalSales: -1 } },
  ]);

  const totalSales = result.reduce((sum, c) => sum + (c.totalSales || 0), 0);
  const totalCOGS = result.reduce((sum, c) => sum + (c.totalCOGS || 0), 0);
  const topCustomerShare =
    totalSales > 0 && result.length > 0
      ? (result[0].totalSales / totalSales) * 100
      : 0;
  const topFiveShare =
    totalSales > 0
      ? (result.slice(0, 5).reduce((s, r) => s + (r.totalSales || 0), 0) /
          totalSales) *
        100
      : 0;

  // Decorate each row with its share of total revenue.
  const customers = result.map((r) => ({
    ...r,
    revenueShare: totalSales > 0 ? (r.totalSales / totalSales) * 100 : 0,
  }));

  const summary = {
    totalCustomers: result.length,
    totalSales,
    totalCOGS,
    grossProfit: totalSales - totalCOGS,
    grossMarginPct: totalSales > 0 ? ((totalSales - totalCOGS) / totalSales) * 100 : 0,
    totalPaid: result.reduce((sum, c) => sum + (c.totalPaid || 0), 0),
    totalOutstanding: result.reduce((sum, c) => sum + (c.totalOutstanding || 0), 0),
    totalInvoices: result.reduce((sum, c) => sum + (c.invoiceCount || 0), 0),
    topCustomerShare,
    topFiveShare,
  };

  return {
    reportName: "Sales by Customer",
    period: { startDate: new Date(startDate), endDate: new Date(endDate) },
    customers,
    summary,
  };
}

/**
 * Get Sales by Product Report
 */
export async function getSalesByProductReport(startDate, endDate) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const result = await Invoice.aggregate([
    {
      $match: withTenantScope(
        {
          status: "completed",
          invoiceDate: {
            $gte: new Date(startDate),
            $lte: new Date(endDate),
          },
        },
        companyId,
        isSuperAdmin
      ),
    },
    { $unwind: "$items" },
    {
      $group: {
        _id: {
          productId: "$items.productId",
          productName: "$items.productName",
          productSKU: "$items.productSKU",
        },
        quantitySold: { $sum: "$items.quantity" },
        totalRevenue: { $sum: "$items.amount" },
        invoiceCount: { $addToSet: "$_id" },
        avgPrice: { $avg: "$items.unitPrice" },
      },
    },
    {
      $project: {
        _id: 0,
        productId: "$_id.productId",
        productName: "$_id.productName",
        productSKU: "$_id.productSKU",
        quantitySold: 1,
        totalRevenue: 1,
        invoiceCount: { $size: "$invoiceCount" },
        avgPrice: 1,
      },
    },
    { $sort: { totalRevenue: -1 } },
  ]);

  const summary = {
    totalProducts: result.length,
    totalRevenue: result.reduce((sum, p) => sum + p.totalRevenue, 0),
    totalQuantity: result.reduce((sum, p) => sum + p.quantitySold, 0),
  };

  return {
    reportName: "Sales by Product",
    period: { startDate: new Date(startDate), endDate: new Date(endDate) },
    products: result,
    summary,
  };
}

/**
 * Get Sales Trend Report (monthly)
 */
export async function getSalesTrendReport(startDate, endDate) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const result = await Invoice.aggregate([
    {
      $match: withTenantScope(
        {
          status: "completed",
          invoiceDate: {
            $gte: new Date(startDate),
            $lte: new Date(endDate),
          },
        },
        companyId,
        isSuperAdmin
      ),
    },
    {
      $group: {
        _id: {
          year: { $year: "$invoiceDate" },
          month: { $month: "$invoiceDate" },
        },
        invoiceCount: { $sum: 1 },
        totalSales: { $sum: "$total" },
        totalPaid: { $sum: "$amountPaid" },
      },
    },
    {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        period: {
          $dateToString: {
            format: "%Y-%m",
            date: {
              $dateFromParts: {
                year: "$_id.year",
                month: "$_id.month",
                day: 1,
              },
            },
          },
        },
        invoiceCount: 1,
        totalSales: 1,
        totalPaid: 1,
      },
    },
    { $sort: { year: 1, month: 1 } },
  ]);

  return {
    reportName: "Sales Trend",
    period: { startDate: new Date(startDate), endDate: new Date(endDate) },
    months: result,
  };
}

/**
 * Get Top Customers
 */
export async function getTopCustomers(limit = 10, startDate = null, endDate = null) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const match = { status: "completed" };
  if (startDate && endDate) {
    match.invoiceDate = {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    };
  }

  const result = await Invoice.aggregate([
    { $match: withTenantScope(match, companyId, isSuperAdmin) },
    {
      $group: {
        _id: {
          customerId: "$customer.id",
          customerName: "$customer.name",
        },
        totalSales: { $sum: "$total" },
        invoiceCount: { $sum: 1 },
      },
    },
    { $sort: { totalSales: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        customerId: "$_id.customerId",
        customerName: "$_id.customerName",
        totalSales: 1,
        invoiceCount: 1,
      },
    },
  ]);

  return result;
}

/**
 * Get Top Products
 */
export async function getTopProducts(limit = 10, startDate = null, endDate = null) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const match = { status: "completed" };
  if (startDate && endDate) {
    match.invoiceDate = {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    };
  }

  const result = await Invoice.aggregate([
    { $match: withTenantScope(match, companyId, isSuperAdmin) },
    { $unwind: "$items" },
    {
      $group: {
        _id: {
          productId: "$items.productId",
          productName: "$items.productName",
        },
        totalRevenue: { $sum: "$items.amount" },
        quantitySold: { $sum: "$items.quantity" },
      },
    },
    { $sort: { totalRevenue: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        productId: "$_id.productId",
        productName: "$_id.productName",
        totalRevenue: 1,
        quantitySold: 1,
      },
    },
  ]);

  return result;
}

/**
 * Get Sales Stats (optimized for stats cards)
 */
export async function getSalesStats(startDate, endDate) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const [result] = await Invoice.aggregate([
    {
      $match: withTenantScope(
        {
          status: "completed",
          invoiceDate: {
            $gte: new Date(startDate),
            $lte: new Date(endDate),
          },
        },
        companyId,
        isSuperAdmin
      ),
    },
    {
      $group: {
        _id: null,
        totalSales: { $sum: "$total" },
        totalPaid: { $sum: "$amountPaid" },
        invoiceCount: { $sum: 1 },
        customerIds: { $addToSet: "$customer.id" },
      },
    },
    {
      $project: {
        _id: 0,
        totalSales: 1,
        totalPaid: 1,
        totalOutstanding: { $subtract: ["$totalSales", "$totalPaid"] },
        invoiceCount: 1,
        customerCount: { $size: "$customerIds" },
      },
    },
  ]);

  return result || {
    totalSales: 0,
    totalPaid: 0,
    totalOutstanding: 0,
    invoiceCount: 0,
    customerCount: 0,
  };
}
