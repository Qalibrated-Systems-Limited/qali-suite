import dbConnect from "../../config/dbConnect";
import Product from "../../models/product";
import { StockRequest } from "../../models/requests";
import { ItemCheckout } from "../../models/checkouts";
import { StockMovement } from "../../models/stockmovement";
import EmployeeClaim from "../../models/employeesClaims";
import Invoice from "../../models/invoice";
import Bill from "../../models/bill";
import JournalEntry from "../../models/JournalEntry";
import Account from "../../models/account";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { LOW_STOCK_MATCH } from "@/lib/business-rules";
import mongoose from "mongoose";

const ObjectId = mongoose.Types.ObjectId;

// ============================================
// HELPER: Build tenant filter for queries
// ============================================
function buildTenantFilter(companyId: string | null, isSuperAdmin: boolean) {
  if (isSuperAdmin) return {};
  if (!companyId) throw new Error("companyId required for non-SuperAdmin user");
  return { companyId: new ObjectId(companyId) };
}

// ============================================
// FINANCIAL OVERVIEW (Admin Dashboard)
// ============================================
export const getFinancialOverview = async () => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantFilter(companyId, isSuperAdmin);

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

  // Get key accounts (scoped to company)
  const [
    cashAccount,
    bankAccount,
    arAccount,
    apAccount,
    revenueAccounts,
    expenseAccounts,
  ] = await Promise.all([
    Account.findOne({ ...tenantMatch, systemAccount: "petty_cash" }),
    Account.findOne({ ...tenantMatch, systemAccount: "cash_at_bank" }),
    Account.findOne({ ...tenantMatch, systemAccount: "accounts_receivable" }),
    Account.findOne({ ...tenantMatch, systemAccount: "accounts_payable" }),
    Account.find({ ...tenantMatch, accountType: "revenue", isActive: true }),
    Account.find({ ...tenantMatch, accountType: "expense", isActive: true }),
  ]);

  // Get revenue and expense aggregates (CORRECTED)
  const baseMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const [currentMonthData, lastMonthData] = await Promise.all([
    JournalEntry.aggregate([
      {
        $match: {
          ...baseMatch,
          status: "posted",
          entryDate: { $gte: startOfMonth, $lte: now },
        },
      },
      { $unwind: "$lines" },
      {
        $group: {
          _id: null,
          // Revenue = Credits - Debits (normal balance is credit)
          revenue: {
            $sum: {
              $cond: [
                {
                  $in: ["$lines.accountId", revenueAccounts.map((a) => a._id)],
                },
                { $subtract: ["$lines.credit", "$lines.debit"] },
                0,
              ],
            },
          },
          // Expenses = Debits - Credits (normal balance is debit)
          expenses: {
            $sum: {
              $cond: [
                {
                  $in: ["$lines.accountId", expenseAccounts.map((a) => a._id)],
                },
                { $subtract: ["$lines.debit", "$lines.credit"] },
                0,
              ],
            },
          },
        },
      },
    ]),
    JournalEntry.aggregate([
      {
        $match: {
          ...baseMatch,
          status: "posted",
          entryDate: { $gte: startOfLastMonth, $lte: endOfLastMonth },
        },
      },
      { $unwind: "$lines" },
      {
        $group: {
          _id: null,
          // Revenue = Credits - Debits
          revenue: {
            $sum: {
              $cond: [
                {
                  $in: ["$lines.accountId", revenueAccounts.map((a) => a._id)],
                },
                { $subtract: ["$lines.credit", "$lines.debit"] },
                0,
              ],
            },
          },
          // Expenses = Debits - Credits
          expenses: {
            $sum: {
              $cond: [
                {
                  $in: ["$lines.accountId", expenseAccounts.map((a) => a._id)],
                },
                { $subtract: ["$lines.debit", "$lines.credit"] },
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  const current = currentMonthData[0] || { revenue: 0, expenses: 0 };
  const last = lastMonthData[0] || { revenue: 0, expenses: 0 };

  const revenueTrend = last.revenue
    ? ((current.revenue - last.revenue) / last.revenue) * 100
    : 0;
  const expenseTrend = last.expenses
    ? ((current.expenses - last.expenses) / last.expenses) * 100
    : 0;

  return {
    revenue: {
      current: current.revenue,
      trend: revenueTrend,
    },
    expenses: {
      current: current.expenses,
      trend: expenseTrend,
    },
    profit: {
      current: current.revenue - current.expenses,
      trend:
        last.revenue - last.expenses
          ? ((current.revenue -
              current.expenses -
              (last.revenue - last.expenses)) /
              (last.revenue - last.expenses)) *
            100
          : 0,
    },
    cash: {
      balance:
        (cashAccount?.actualBalance || 0) + (bankAccount?.actualBalance || 0),
      cashOnly: cashAccount?.actualBalance || 0,
      bankOnly: bankAccount?.actualBalance || 0,
    },
  };
};

// ============================================
// KEY METRICS (Admin Dashboard)
// ============================================
export const getKeyMetrics = async () => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantFilter(companyId, isSuperAdmin);

  const [
    stockValue,
    pendingOrders,
    arTotal,
    apTotal,
    claimsPending,
    lowStockCount,
  ] = await Promise.all([
    // Stock Value
    Product.aggregate([
      { $match: { ...tenantMatch, status: "active" } },
      {
        $group: {
          _id: null,
          totalValue: {
            $sum: {
              $multiply: [
                { $ifNull: ["$inventory.quantityOnHand", 0] },
                { $ifNull: ["$costing.costPrice", 0] },
              ],
            },
          },
        },
      },
    ]).then((result) => result[0]?.totalValue || 0),

    // Pending Orders (Stock Requests)
    StockRequest.countDocuments({ ...tenantMatch, status: "pending" }),

    // A/R Outstanding
    Account.findOne({ ...tenantMatch, systemAccount: "accounts_receivable" }).then(
      (acc) => acc?.actualBalance || 0
    ),

    // A/P Outstanding
    Account.findOne({ ...tenantMatch, systemAccount: "accounts_payable" }).then(
      (acc) => acc?.actualBalance || 0
    ),

    // Claims Pending
    EmployeeClaim.countDocuments({ ...tenantMatch, status: "submitted" }),

    // Low Stock Items (at or below reorder level)
    Product.aggregate([
      { $match: { ...tenantMatch, status: "active" } },
      {
        $addFields: {
          currentQty: { $ifNull: ["$inventory.quantityOnHand", 0] },
          reorderAt: { $ifNull: ["$inventory.reorderLevel", 0] },
        },
      },
      {
        $match: {
          reorderAt: { $gt: 0 },
          $expr: { $lte: ["$currentQty", "$reorderAt"] },
        },
      },
      { $count: "count" },
    ]).then((result) => result[0]?.count || 0),
  ]);

  return {
    stockValue,
    pendingOrders,
    arOutstanding: arTotal,
    apOutstanding: apTotal,
    claimsPending,
    lowStockCount,
  };
};

// ============================================
// TOP 5 PRODUCTS (Most Sold/Moved)
// ============================================
export const getTopProducts = async (limit = 5) => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const baseMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const data = await StockMovement.aggregate([
    {
      $match: {
        ...baseMatch,
        direction: "out",
      },
    },
    {
      $group: {
        _id: "$productId",
        totalQuantity: { $sum: "$quantity" },
        productName: { $first: "$productSnapshot.name" },
        productSKU: { $first: "$productSnapshot.SKU" },
      },
    },
    { $sort: { totalQuantity: -1 } },
    { $limit: limit },
  ]);

  return data.map((item) => ({
    name: item.productName,
    sku: item.productSKU,
    quantity: item.totalQuantity,
  }));
};

// ============================================
// STOCK MOVEMENT TREND (Last 7 Days)
// ============================================
export const getStockMovementTrend = async (days = 7) => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const baseMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days + 1);
  startDate.setHours(0, 0, 0, 0);

  const movements = await StockMovement.aggregate([
    {
      $match: {
        ...baseMatch,
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          direction: "$direction",
        },
        count: { $sum: 1 },
        quantity: { $sum: "$quantity" },
      },
    },
    { $sort: { "_id.date": 1 } },
  ]);

  // Format for Recharts
  const trendData: Record<string, { date: string; in: number; out: number }> = {};
  movements.forEach((item) => {
    const date = item._id.date;
    if (!trendData[date]) {
      trendData[date] = { date, in: 0, out: 0 };
    }
    trendData[date][item._id.direction as "in" | "out"] = item.quantity;
  });

  return Object.values(trendData);
};

// ============================================
// SALES BY CUSTOMER (Top 5)
// ============================================
export const getSalesByCustomer = async (limit = 5) => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const baseMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const data = await Invoice.aggregate([
    {
      $match: {
        ...baseMatch,
        status: { $in: ["approved", "paid", "partial"] },
      },
    },
    {
      $group: {
        _id: "$customer.id",
        customerName: { $first: "$customer.name" },
        totalSales: { $sum: "$total" },
        invoiceCount: { $sum: 1 },
      },
    },
    { $sort: { totalSales: -1 } },
    { $limit: limit },
  ]);

  return data.map((item) => ({
    customer: item.customerName,
    sales: item.totalSales,
    invoices: item.invoiceCount,
  }));
};

// ============================================
// RECENT TRANSACTIONS (Last 5)
// ============================================
export const getRecentTransactions = async (limit = 5) => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantFilter(companyId, isSuperAdmin);

  const entries = await JournalEntry.find({ ...tenantMatch, status: "posted" })
    .sort({ entryDate: -1, createdAt: -1 })
    .limit(limit)
    .lean();

  return entries.map((entry: any) => ({
    _id: entry._id.toString(),
    entryNumber: entry.entryNumber,
    entryDate: entry.entryDate.toISOString(),
    entryType: entry.entryType,
    description: entry.description,
    amount: entry.lines.reduce((sum: number, line: any) => sum + (line.debit || 0), 0),
    party: entry.party?.name || null,
  }));
};

// ============================================
// PENDING APPROVALS (By Role)
// ============================================
export const getPendingApprovals = async (role: string) => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantFilter(companyId, isSuperAdmin);

  const results = {
    stockRequests: 0,
    claims: 0,
    invoices: 0,
    bills: 0,
  };

  if (role === "Manager" || role === "Admin") {
    [results.stockRequests, results.claims] = await Promise.all([
      StockRequest.countDocuments({ ...tenantMatch, status: "pending" }),
      EmployeeClaim.countDocuments({ ...tenantMatch, status: "submitted" }),
    ]);
  }

  if (role === "Accountant" || role === "Admin") {
    [results.invoices, results.bills] = await Promise.all([
      Invoice.countDocuments({ ...tenantMatch, status: "draft" }),
      Bill.countDocuments({ ...tenantMatch, status: "draft" }),
    ]);
  }

  return results;
};

// ============================================
// MANAGER WORKLOAD
// ============================================
export const getManagerWorkload = async () => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantFilter(companyId, isSuperAdmin);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    pendingRequests,
    pendingClaims,
    approvedRequestsToday,
    approvedClaimsToday,
    rejectedRequestsToday,
    rejectedClaimsToday,
  ] = await Promise.all([
    StockRequest.countDocuments({ ...tenantMatch, status: "pending" }),
    EmployeeClaim.countDocuments({ ...tenantMatch, status: "submitted" }),
    StockRequest.countDocuments({
      ...tenantMatch,
      status: "approved",
      updatedAt: { $gte: today },
    }),
    EmployeeClaim.countDocuments({
      ...tenantMatch,
      status: "approved",
      approvedAt: { $gte: today },
    }),
    StockRequest.countDocuments({
      ...tenantMatch,
      status: "rejected",
      updatedAt: { $gte: today },
    }),
    EmployeeClaim.countDocuments({
      ...tenantMatch,
      status: "rejected",
      rejectedAt: { $gte: today },
    }),
  ]);

  return {
    pendingApprovals: pendingRequests + pendingClaims,
    approvedToday: approvedRequestsToday + approvedClaimsToday,
    rejectedToday: rejectedRequestsToday + rejectedClaimsToday,
    teamMembers: 12, // Placeholder - would come from User model
  };
};

// ============================================
// ACCOUNTANT WORKLOAD
// ============================================
export const getAccountantWorkload = async () => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantFilter(companyId, isSuperAdmin);

  const now = new Date();
  const weekAhead = new Date(now);
  weekAhead.setDate(weekAhead.getDate() + 7);

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const [overdueInvoices, dueThisWeek, claimsToPay, paidToday] =
    await Promise.all([
      Invoice.find({
        ...tenantMatch,
        paymentStatus: { $in: ["unpaid", "partial"] },
        dueDate: { $lt: now },
      })
        .lean()
        .then((invoices) => ({
          count: invoices.length,
          total: invoices.reduce((sum, inv: any) => sum + inv.amountDue, 0),
        })),
      Invoice.find({
        ...tenantMatch,
        paymentStatus: { $in: ["unpaid", "partial"] },
        dueDate: { $gte: now, $lte: weekAhead },
      })
        .lean()
        .then((invoices) => ({
          count: invoices.length,
          total: invoices.reduce((sum, inv: any) => sum + inv.amountDue, 0),
        })),
      EmployeeClaim.find({
        ...tenantMatch,
        status: "approved",
        paidAt: null,
      })
        .lean()
        .then((claims) => ({
          count: claims.length,
          total: claims.reduce((sum, claim: any) => sum + claim.totalAmount, 0),
        })),
      EmployeeClaim.countDocuments({
        ...tenantMatch,
        status: "paid",
        paidAt: { $gte: todayStart },
      }),
    ]);

  return {
    overdueInvoices,
    dueThisWeek,
    claimsToPay,
    paidToday,
  };
};

// ============================================
// EMPLOYEE FINANCIAL SUMMARY
// ============================================
export const getEmployeeFinancialSummary = async (userId: string) => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const baseMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [advancesGiven, reimbursedMTD] = await Promise.all([
    EmployeeClaim.aggregate([
      {
        $match: {
          ...baseMatch,
          "employee.userId": userId,
          claimType: "advance_request",
          status: "paid",
          settlementClaimId: null,
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$totalAmount" },
        },
      },
    ]).then((result) => result[0]?.total || 0),
    EmployeeClaim.aggregate([
      {
        $match: {
          ...baseMatch,
          "employee.userId": userId,
          claimType: "reimbursement",
          status: "paid",
          paidAt: { $gte: startOfMonth },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$totalAmount" },
        },
      },
    ]).then((result) => result[0]?.total || 0),
  ]);

  return {
    advancesGiven,
    reimbursedMTD,
  };
};

// ============================================
// STOCK/INVENTORY QUERIES
// ============================================

/**
 * Get comprehensive stock statistics
 */
export async function getStockStats() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantFilter(companyId, isSuperAdmin);
  const baseMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const [
    valueResult,
    lowStockCount,
    outOfStockCount,
    pendingRequests,
    overdueCheckouts,
  ] = await Promise.all([
    // Total inventory value
    Product.aggregate([
      { $match: { ...baseMatch, status: "active" } },
      {
        $group: {
          _id: null,
          totalValue: {
            $sum: {
              $multiply: [
                { $ifNull: ["$inventory.quantityOnHand", 0] },
                { $ifNull: ["$costing.costPrice", 0] },
              ],
            },
          },
          totalProducts: { $sum: 1 },
          totalQuantity: {
            $sum: { $ifNull: ["$inventory.quantityOnHand", 0] },
          },
        },
      },
    ]),

    // Low stock count - products AT or BELOW reorder level
    Product.aggregate([
      { $match: { ...tenantMatch, status: "active" } },
      {
        $addFields: {
          currentQty: { $ifNull: ["$inventory.quantityOnHand", 0] },
          reorderAt: { $ifNull: ["$inventory.reorderLevel", 0] },
        },
      },
      {
        $match: {
          reorderAt: { $gt: 0 },
          $expr: { $lte: ["$currentQty", "$reorderAt"] },
        },
      },
      { $count: "count" },
    ]).then((result) => result[0]?.count || 0),

    // Out of stock count
    Product.countDocuments({
      ...tenantMatch,
      status: "active",
      "inventory.quantityOnHand": { $lte: 0 },
    }),

    // Pending stock requests
    StockRequest.countDocuments({ ...tenantMatch, status: "pending" }),

    // Overdue checkouts
    ItemCheckout.countDocuments({
      ...tenantMatch,
      status: { $in: ["checked_out", "overdue"] },
      expectedReturnDate: { $lt: new Date() },
    }),
  ]);

  return {
    totalValue: valueResult[0]?.totalValue || 0,
    totalProducts: valueResult[0]?.totalProducts || 0,
    totalQuantity: valueResult[0]?.totalQuantity || 0,
    lowStockCount,
    outOfStockCount,
    pendingRequests,
    overdueCheckouts,
  };
}

/**
 * Get low stock products
 * Returns products where current stock <= reorder level
 */
export async function getLowStockProducts(limit = 10) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const baseMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  // Use aggregation for complex comparison
  const products = await Product.aggregate([
    { $match: { ...baseMatch, status: "active" } },
    {
      $addFields: {
        currentQty: { $ifNull: ["$inventory.quantityOnHand", 0] },
        reorderAt: { $ifNull: ["$inventory.reorderLevel", 0] },
      },
    },
    {
      $match: {
        reorderAt: { $gt: 0 }, // Only products with reorder level set
        $expr: { $lte: ["$currentQty", "$reorderAt"] },
      },
    },
    { $sort: { currentQty: 1 } }, // Most critical first
    { $limit: limit },
    {
      $project: {
        _id: 1,
        name: 1,
        SKU: 1,
        category: 1,
        stock: "$currentQty",
        reorderLevel: "$reorderAt",
        reorderQuantity: "$inventory.reorderQuantity",
        costPrice: "$costing.costPrice",
        supplier: "$supplier.name",
      },
    },
  ]);

  return products;
}

/**
 * Get out of stock products
 */
export async function getOutOfStockProducts(limit = 10) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantFilter(companyId, isSuperAdmin);

  return Product.find({
    ...tenantMatch,
    status: "active",
    "inventory.quantityOnHand": { $lte: 0 },
  })
    .sort({ name: 1 })
    .limit(limit)
    .select("name SKU category inventory.quantityOnHand supplier.name")
    .lean();
}

/**
 * Get stock movement trend (last N days)
 * Groups by date and direction
 */
export async function getMovementTrend(days = 7) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const baseMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const movements = await StockMovement.aggregate([
    {
      $match: {
        ...baseMatch,
        createdAt: { $gte: startDate },
        status: { $ne: "reversed" }, // Exclude reversed movements
      },
    },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          direction: "$direction",
        },
        totalQuantity: { $sum: "$quantity" },
        count: { $sum: 1 },
      },
    },
    { $sort: { "_id.date": 1 } },
  ]);

  // Transform to chart-friendly format
  const dateMap = new Map();

  // Initialize all dates
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];
    dateMap.set(dateStr, { date: dateStr, stockIn: 0, stockOut: 0 });
  }

  // Fill in actual data
  movements.forEach((m) => {
    const dateData = dateMap.get(m._id.date);
    if (dateData) {
      if (m._id.direction === "in") {
        dateData.stockIn = m.totalQuantity;
      } else {
        dateData.stockOut = m.totalQuantity;
      }
    }
  });

  return Array.from(dateMap.values());
}

/**
 * Get top moved products (most activity)
 */
export async function getTopMovedProducts(limit = 5) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const baseMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const result = await StockMovement.aggregate([
    {
      $match: {
        ...baseMatch,
        createdAt: { $gte: thirtyDaysAgo },
        status: { $ne: "reversed" },
      },
    },
    {
      $group: {
        _id: "$productId",
        totalQuantity: { $sum: "$quantity" },
        inQuantity: {
          $sum: { $cond: [{ $eq: ["$direction", "in"] }, "$quantity", 0] },
        },
        outQuantity: {
          $sum: { $cond: [{ $eq: ["$direction", "out"] }, "$quantity", 0] },
        },
        movements: { $sum: 1 },
        // Get product info from snapshot
        productName: { $first: "$productSnapshot.name" },
        productSKU: { $first: "$productSnapshot.SKU" },
      },
    },
    { $sort: { totalQuantity: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        productId: "$_id",
        name: "$productName",
        sku: "$productSKU",
        quantity: "$totalQuantity",
        inQty: "$inQuantity",
        outQty: "$outQuantity",
        movements: 1,
      },
    },
  ]);

  return result;
}

/**
 * Get category distribution
 */
export async function getCategoryDistribution() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const baseMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  return Product.aggregate([
    { $match: { ...baseMatch, status: "active" } },
    {
      $group: {
        _id: { $ifNull: ["$category", "Uncategorized"] },
        count: { $sum: 1 },
        totalQty: {
          $sum: { $ifNull: ["$inventory.quantityOnHand", 0] },
        },
        totalValue: {
          $sum: {
            $multiply: [
              { $ifNull: ["$inventory.quantityOnHand", 0] },
              { $ifNull: ["$costing.costPrice", 0] },
            ],
          },
        },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 8 },
    {
      $project: {
        _id: 0,
        category: "$_id",
        count: 1,
        totalQty: 1,
        value: "$totalValue",
      },
    },
  ]);
}

/**
 * Get recent stock movements
 */
export async function getRecentMovements(limit = 5) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantFilter(companyId, isSuperAdmin);

  return StockMovement.find({ ...tenantMatch, status: { $ne: "reversed" } })
    .sort({ createdAt: -1 })
    .limit(7)
    .select(
      "movementNumber productSnapshot direction quantity movementType performedBy createdAt"
    )
    .lean();
}

/**
 * Get recent stock requests
 */
export async function getRecentRequests(limit = 5) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantFilter(companyId, isSuperAdmin);

  return StockRequest.find(tenantMatch)
    .sort({ createdAt: -1 })
    .limit(limit)
    .select("requestNumber requester status priority items createdAt")
    .lean();
}

// ============================================
// CHECKOUT QUERIES
// ============================================

/**
 * Get overdue checkouts with full details
 */
export async function getOverdueCheckouts(limit = 10) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantFilter(companyId, isSuperAdmin);

  const now = new Date();

  return ItemCheckout.find({
    ...tenantMatch,
    status: { $in: ["checked_out", "overdue"] },
    expectedReturnDate: { $lt: now },
  })
    .sort({ expectedReturnDate: 1 }) // Most overdue first
    .limit(limit)
    .select(
      "checkoutNumber productId productSnapshot quantity checkedOutTo expectedReturnDate status"
    )
    .lean();
}

/**
 * Get checkout summary stats
 */
export async function getCheckoutStats() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantFilter(companyId, isSuperAdmin);
  const baseMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const now = new Date();
  const sevenDaysFromNow = new Date();
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

  const [activeCheckouts, overdueCount, dueSoonCount, totalValueOut] =
    await Promise.all([
      // Active checkouts
      ItemCheckout.countDocuments({
        ...tenantMatch,
        status: { $in: ["checked_out", "overdue"] },
      }),

      // Overdue
      ItemCheckout.countDocuments({
        ...tenantMatch,
        status: { $in: ["checked_out", "overdue"] },
        expectedReturnDate: { $lt: now },
      }),

      // Due within 7 days
      ItemCheckout.countDocuments({
        ...tenantMatch,
        status: "checked_out",
        expectedReturnDate: { $gte: now, $lte: sevenDaysFromNow },
      }),

      // Total value of items checked out
      ItemCheckout.aggregate([
        { $match: { ...baseMatch, status: { $in: ["checked_out", "overdue"] } } },
        {
          $lookup: {
            from: "products",
            localField: "productId",
            foreignField: "_id",
            as: "product",
          },
        },
        { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: null,
            totalValue: {
              $sum: {
                $multiply: [
                  "$quantity",
                  { $ifNull: ["$product.costing.costPrice", 0] },
                ],
              },
            },
          },
        },
      ]),
    ]);

  return {
    activeCheckouts,
    overdueCount,
    dueSoonCount,
    totalValueOut: totalValueOut[0]?.totalValue || 0,
  };
}

/**
 * Get user's checkouts (scoped to company + user)
 */
export async function getUserCheckouts(userId: string, activeOnly = true) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantFilter(companyId, isSuperAdmin);

  const query: any = { ...tenantMatch, "checkedOutTo.id": userId };

  if (activeOnly) {
    query.status = { $in: ["checked_out", "overdue"] };
  }

  return ItemCheckout.find(query)
    .sort({ expectedReturnDate: 1 })
    .select(
      "checkoutNumber productSnapshot quantity status expectedReturnDate purpose"
    )
    .lean();
}

/**
 * Get revenue trend (last N months)
 */
export async function getRevenueTrend(months = 6) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const baseMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months + 1);
  startDate.setDate(1);
  startDate.setHours(0, 0, 0, 0);

  const data = await JournalEntry.aggregate([
    {
      $match: {
        ...baseMatch,
        status: "posted",
        entryDate: { $gte: startDate },
      },
    },
    { $unwind: "$lines" },
    {
      $match: {
        "lines.accountType": { $in: ["revenue", "expense"] },
      },
    },
    {
      $group: {
        _id: {
          month: { $dateToString: { format: "%Y-%m", date: "$entryDate" } },
          type: "$lines.accountType",
        },
        totalDebit: { $sum: "$lines.debit" },
        totalCredit: { $sum: "$lines.credit" },
      },
    },
    { $sort: { "_id.month": 1 } },
  ]);

  // Create month map
  const monthMap = new Map();
  for (let i = 0; i < months; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - (months - 1 - i));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}`;
    monthMap.set(key, { month: key, revenue: 0, expenses: 0 });
  }

  // Fill data from aggregation
  data.forEach((item: any) => {
    const entry = monthMap.get(item._id.month);
    if (entry) {
      if (item._id.type === "revenue") {
        // Revenue: Credit - Debit
        entry.revenue = (item.totalCredit || 0) - (item.totalDebit || 0);
      } else if (item._id.type === "expense") {
        // Expense: Debit - Credit
        entry.expenses = (item.totalDebit || 0) - (item.totalCredit || 0);
      }
    }
  });

  return Array.from(monthMap.values());
}

/**
 * Get expense breakdown by account
 * SOURCE: Journal Entries (Expense accounts)
 */
export async function getExpenseBreakdown() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const baseMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const thisMonthStart = new Date();
  thisMonthStart.setDate(1);
  thisMonthStart.setHours(0, 0, 0, 0);

  const expenses = await JournalEntry.aggregate([
    {
      $match: {
        ...baseMatch,
        status: "posted",
        entryDate: { $gte: thisMonthStart },
      },
    },
    { $unwind: "$lines" },
    {
      $match: {
        "lines.accountType": "expense",
      },
    },
    {
      $group: {
        _id: "$lines.accountId", // Group by account ID
        accountCode: { $first: "$lines.accountCode" }, // Include code
        accountName: { $first: "$lines.accountName" },
        accountType: { $first: "$lines.accountType" },
        totalDebit: { $sum: "$lines.debit" },
        totalCredit: { $sum: "$lines.credit" },
      },
    },
    {
      $project: {
        _id: 0,
        category: "$accountName",
        // Expense = Debit - Credit
        value: { $subtract: ["$totalDebit", "$totalCredit"] },
      },
    },
    {
      $match: {
        value: { $gt: 0 }, // Only positive expenses
      },
    },
    { $sort: { value: -1 } },
    { $limit: 8 },
  ]);

  return expenses;
}

/**
 * Get dashboard alerts
 */
export async function getDashboardAlerts() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantFilter(companyId, isSuperAdmin);
  const baseMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const now = new Date();

  const [
    overdueInvoices,
    lowStockCount,
    pendingClaims,
    overdueCheckouts,
    pendingRequests,
  ] = await Promise.all([
    // Overdue invoices
    Invoice.countDocuments({
      ...tenantMatch,
      paymentStatus: { $in: ["unpaid", "partial"] },
      dueDate: { $lt: now },
      status: { $ne: "cancelled" },
    }),

    // Low stock — see LOW_STOCK_MATCH in @/lib/business-rules for the
    // canonical definition. Same predicate used by the stocks-page
    // filter and the StockStats aggregation, so all three KPIs agree.
    Product.aggregate([
      { $match: { ...baseMatch, ...LOW_STOCK_MATCH } },
      { $count: "count" },
    ]),

    // Pending claims
    EmployeeClaim.countDocuments({ ...tenantMatch, status: "submitted" }),

    // Overdue checkouts
    ItemCheckout.countDocuments({
      ...tenantMatch,
      status: { $in: ["checked_out", "overdue"] },
      expectedReturnDate: { $lt: now },
    }),

    // Pending stock requests
    StockRequest.countDocuments({ ...tenantMatch, status: "pending" }),
  ]);

  return {
    overdueInvoices,
    lowStockCount: lowStockCount[0]?.count || 0,
    pendingClaims,
    overdueCheckouts,
    pendingRequests,
    overdueClaims: 0, // TODO: Add if you have claim due dates
    total:
      overdueInvoices +
      (lowStockCount[0]?.count || 0) +
      pendingClaims +
      overdueCheckouts +
      pendingRequests,
  };
}

// ============================================
// AR/AP AGING
// ============================================

/**
 * Accounts Receivable Aging
 */
export async function getARAgingSummary() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantFilter(companyId, isSuperAdmin);

  const now = new Date();

  const invoices = await Invoice.find({
    ...tenantMatch,
    paymentStatus: { $in: ["unpaid", "partial"] },
    status: { $ne: "cancelled" },
  })
    .select("invoiceNumber customer dueDate amountDue totalAmount")
    .lean();

  const buckets: Record<string, number> = {
    current: 0,
    "1-30": 0,
    "31-60": 0,
    "61-90": 0,
    "90+": 0,
  };

  invoices.forEach((inv: any) => {
    const dueDate = new Date(inv.dueDate);
    const daysOverdue = Math.floor(
      (now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    const amount = inv.amountDue || inv.totalAmount || 0;

    if (daysOverdue <= 0) {
      buckets.current += amount;
    } else if (daysOverdue <= 30) {
      buckets["1-30"] += amount;
    } else if (daysOverdue <= 60) {
      buckets["31-60"] += amount;
    } else if (daysOverdue <= 90) {
      buckets["61-90"] += amount;
    } else {
      buckets["90+"] += amount;
    }
  });

  return Object.entries(buckets).map(([bucket, amount]) => ({
    bucket,
    amount,
  }));
}

/**
 * Accounts Payable Aging
 */
export async function getAPAgingSummary() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantFilter(companyId, isSuperAdmin);

  const now = new Date();

  const bills = await Bill.find({
    ...tenantMatch,
    paymentStatus: { $in: ["unpaid", "partial"] },
    status: { $ne: "cancelled" },
  })
    .select("billNumber vendor dueDate amountDue totalAmount")
    .lean();

  const buckets: Record<string, number> = {
    current: 0,
    "1-30": 0,
    "31-60": 0,
    "61-90": 0,
    "90+": 0,
  };

  bills.forEach((bill: any) => {
    const dueDate = new Date(bill.dueDate);
    const daysOverdue = Math.floor(
      (now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    const amount = bill.amountDue || bill.totalAmount || 0;

    if (daysOverdue <= 0) {
      buckets.current += amount;
    } else if (daysOverdue <= 30) {
      buckets["1-30"] += amount;
    } else if (daysOverdue <= 60) {
      buckets["31-60"] += amount;
    } else if (daysOverdue <= 90) {
      buckets["61-90"] += amount;
    } else {
      buckets["90+"] += amount;
    }
  });

  return Object.entries(buckets).map(([bucket, amount]) => ({
    bucket,
    amount,
  }));
}

// ============================================
// EMPLOYEE-SPECIFIC QUERIES
// ============================================

/**
 * Get employee's financial summary (scoped to company + user)
 */
export async function getEmployeeSummary(userId: string) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantFilter(companyId, isSuperAdmin);
  const baseMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const [pendingClaims, approvedClaims, paidClaims, totalAdvances] =
    await Promise.all([
      EmployeeClaim.countDocuments({
        ...tenantMatch,
        "employee.userId": userId,
        status: "submitted",
      }),
      EmployeeClaim.countDocuments({
        ...tenantMatch,
        "employee.userId": userId,
        status: "approved",
      }),
      EmployeeClaim.countDocuments({
        ...tenantMatch,
        "employee.userId": userId,
        status: "paid",
      }),
      EmployeeClaim.aggregate([
        {
          $match: {
            ...baseMatch,
            "employee.userId": userId,
            claimType: "advance_request",
            status: { $in: ["approved", "paid"] },
          },
        },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]),
    ]);

  return {
    pendingClaims,
    approvedClaims,
    paidClaims,
    totalAdvances: totalAdvances[0]?.total || 0,
  };
}

/**
 * Get employee's borrowed items (scoped to company + user)
 */
export async function getEmployeeBorrowedItems(userId: string) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantFilter(companyId, isSuperAdmin);

  return ItemCheckout.find({
    ...tenantMatch,
    "checkedOutTo.id": userId,
    status: { $in: ["checked_out", "overdue"] },
  })
    .sort({ expectedReturnDate: 1 })
    .select(
      "checkoutNumber productSnapshot quantity status expectedReturnDate purpose"
    )
    .lean();
}
