import FiscalPeriod from "../../models/fiscalPeriod";
import JournalEntry from "../../models/JournalEntry";

import dbConnect from "../../config/dbConnect";
import {
  getTenantContext,
  withTenantScope,
  buildTenantMatch,
} from "@/lib/utils/tenant-utils";

// ============================================
// FISCAL PERIOD QUERIES - READ OPERATIONS
// Following industry best practices
// ============================================

/**
 * Get all fiscal periods with filters
 * Best Practice: List with summaries
 */
export async function getFiscalPeriods(filters = {}) {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  let query = {};

  if (filters.status) {
    query.status = filters.status;
  }

  if (filters.year) {
    query.year = parseInt(filters.year);
  }

  if (filters.periodType) {
    query.periodType = filters.periodType;
  }

  // Apply tenant scoping
  query = withTenantScope(query, companyId, isSuperAdmin);

  const periods = await FiscalPeriod.find(query).sort({ startDate: -1 }).lean();

  return periods;
}

/**
 * Get fiscal period by ID with details
 */
export async function getFiscalPeriodById(periodId) {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  const period = await FiscalPeriod.findOne(
    withTenantScope({ _id: periodId }, companyId, isSuperAdmin)
  ).lean();

  if (!period) {
    return null;
  }

  return period;
}

/**
 * Get current fiscal period
 * Best Practice: Use schema static method
 */
export async function getCurrentFiscalPeriod() {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  // Fallback - use tenant-scoped query
  const now = new Date();
  return await FiscalPeriod.findOne(
    withTenantScope(
      {
        startDate: { $lte: now },
        endDate: { $gte: now },
        status: "open",
      },
      companyId,
      isSuperAdmin
    )
  ).lean();
}

/**
 * Get open fiscal periods
 * Best Practice: Use schema static method
 */
export async function getOpenFiscalPeriods() {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  // Fallback - use tenant-scoped query
  return await FiscalPeriod.find(
    withTenantScope({ status: "open" }, companyId, isSuperAdmin)
  )
    .sort({ startDate: 1 })
    .lean();
}

/**
 * Get fiscal period by date
 * Best Practice: Use schema static method
 */
export async function getPeriodByDate(date) {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  // Fallback - use tenant-scoped query
  return await FiscalPeriod.findOne(
    withTenantScope(
      {
        startDate: { $lte: new Date(date) },
        endDate: { $gte: new Date(date) },
      },
      companyId,
      isSuperAdmin
    )
  ).lean();
}

/**
 * Get period summary with statistics
 * Best Practice: Period details with KPIs
 */
export async function getPeriodSummary(periodId) {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantMatch(companyId, isSuperAdmin);

  const period = await FiscalPeriod.findOne(
    withTenantScope({ _id: periodId }, companyId, isSuperAdmin)
  ).lean();

  if (!period) {
    return null;
  }

  // Get journal entry statistics
  const [entryStats, revenue, expenses] = await Promise.all([
    JournalEntry.aggregate([
      { $match: { ...tenantMatch, fiscalPeriodId: period._id } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]),

    // Calculate revenue
    JournalEntry.aggregate([
      { $match: { ...tenantMatch, fiscalPeriodId: period._id, status: "posted" } },
      { $unwind: "$lines" },
      {
        $lookup: {
          from: "accounts",
          localField: "lines.accountId",
          foreignField: "_id",
          as: "account",
        },
      },
      { $unwind: "$account" },
      { $match: { "account.accountType": "revenue" } },
      {
        $group: {
          _id: null,
          total: { $sum: "$lines.credit" },
        },
      },
    ]),

    // Calculate expenses
    JournalEntry.aggregate([
      { $match: { ...tenantMatch, fiscalPeriodId: period._id, status: "posted" } },
      { $unwind: "$lines" },
      {
        $lookup: {
          from: "accounts",
          localField: "lines.accountId",
          foreignField: "_id",
          as: "account",
        },
      },
      { $unwind: "$account" },
      { $match: { "account.accountType": "expense" } },
      {
        $group: {
          _id: null,
          total: { $sum: "$lines.debit" },
        },
      },
    ]),
  ]);

  const totalRevenue = revenue[0]?.total || 0;
  const totalExpenses = expenses[0]?.total || 0;
  const netIncome = totalRevenue - totalExpenses;

  return {
    ...period,
    statistics: {
      entries: entryStats.reduce((acc, stat) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {}),
      revenue: totalRevenue,
      expenses: totalExpenses,
      netIncome,
    },
  };
}

/**
 * Get pre-closing checklist
 * Best Practice: Validation before period close
 */
export async function getPeriodClosingChecklist(periodId) {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantMatch(companyId, isSuperAdmin);

  const period = await FiscalPeriod.findOne(
    withTenantScope({ _id: periodId }, companyId, isSuperAdmin)
  ).lean();

  if (!period) {
    return null;
  }

  // Check for draft entries
  const draftCount = await JournalEntry.countDocuments({
    ...tenantMatch,
    fiscalPeriodId: period._id,
    status: "draft",
  });

  // Check for unposted invoices (if applicable)
  // ... add your specific checks

  const checklist = {
    periodName: period.periodName,
    status: period.status,
    checks: {
      noDraftEntries: {
        passed: draftCount === 0,
        count: draftCount,
        message:
          draftCount > 0
            ? `${draftCount} draft entries need to be posted or deleted`
            : "All entries are posted",
      },
      // Add more checks as needed
    },
    canClose: draftCount === 0,
  };

  return checklist;
}

/**
 * Get periods by year
 * Best Practice: Year-based filtering
 */
export async function getPeriodsByYear(year) {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  return await FiscalPeriod.find(
    withTenantScope({ year }, companyId, isSuperAdmin)
  )
    .sort({ startDate: 1 })
    .lean();
}

/**
 * Get fiscal period statistics for dashboard
 * Best Practice: Dashboard KPIs
 */
export async function getFiscalPeriodStats() {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantMatch(companyId, isSuperAdmin);

  const [total, open, closed, locked, current] = await Promise.all([
    FiscalPeriod.countDocuments(tenantMatch),
    FiscalPeriod.countDocuments({ ...tenantMatch, status: "open" }),
    FiscalPeriod.countDocuments({ ...tenantMatch, status: "closed" }),
    FiscalPeriod.countDocuments({ ...tenantMatch, status: "locked" }),
    getCurrentFiscalPeriod(),
  ]);

  return {
    total,
    open,
    closed,
    locked,
    currentPeriod: current
      ? {
          id: current._id,
          name: current.periodName,
          startDate: current.startDate,
          endDate: current.endDate,
        }
      : null,
  };
}

export default {
  getFiscalPeriods,
  getFiscalPeriodById,
  getCurrentFiscalPeriod,
  getOpenFiscalPeriods,
  getPeriodByDate,
  getPeriodSummary,
  getPeriodClosingChecklist,
  getPeriodsByYear,
  getFiscalPeriodStats,
};
