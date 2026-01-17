import FiscalPeriod from "../../models/fiscalPeriod";
import JournalEntry from "../../models/JournalEntry";

import dbConnect from "../../config/dbConnect";

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

  const query = {};

  if (filters.status) {
    query.status = filters.status;
  }

  if (filters.year) {
    query.year = parseInt(filters.year);
  }

  if (filters.periodType) {
    query.periodType = filters.periodType;
  }

  const periods = await FiscalPeriod.find(query).sort({ startDate: -1 }).lean();

  return periods;
}

/**
 * Get fiscal period by ID with details
 */
export async function getFiscalPeriodById(periodId) {
  await dbConnect();

  const period = await FiscalPeriod.findById(periodId).lean();

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

  if (typeof FiscalPeriod.getCurrentPeriod === "function") {
    return await FiscalPeriod.getCurrentPeriod();
  }

  // Fallback
  const now = new Date();
  return await FiscalPeriod.findOne({
    startDate: { $lte: now },
    endDate: { $gte: now },
    status: "open",
  }).lean();
}

/**
 * Get open fiscal periods
 * Best Practice: Use schema static method
 */
export async function getOpenFiscalPeriods() {
  await dbConnect();

  if (typeof FiscalPeriod.getOpenPeriods === "function") {
    return await FiscalPeriod.getOpenPeriods();
  }

  // Fallback
  return await FiscalPeriod.find({ status: "open" })
    .sort({ startDate: 1 })
    .lean();
}

/**
 * Get fiscal period by date
 * Best Practice: Use schema static method
 */
export async function getPeriodByDate(date) {
  await dbConnect();

  if (typeof FiscalPeriod.getPeriodByDate === "function") {
    return await FiscalPeriod.getPeriodByDate(date);
  }

  // Fallback
  return await FiscalPeriod.findOne({
    startDate: { $lte: new Date(date) },
    endDate: { $gte: new Date(date) },
  }).lean();
}

/**
 * Get period summary with statistics
 * Best Practice: Period details with KPIs
 */
export async function getPeriodSummary(periodId) {
  await dbConnect();

  const period = await FiscalPeriod.findById(periodId).lean();

  if (!period) {
    return null;
  }

  // Get journal entry statistics
  const [entryStats, revenue, expenses] = await Promise.all([
    JournalEntry.aggregate([
      { $match: { fiscalPeriodId: period._id } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]),

    // Calculate revenue
    JournalEntry.aggregate([
      { $match: { fiscalPeriodId: period._id, status: "posted" } },
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
      { $match: { fiscalPeriodId: period._id, status: "posted" } },
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

  const period = await FiscalPeriod.findById(periodId).lean();

  if (!period) {
    return null;
  }

  // Check for draft entries
  const draftCount = await JournalEntry.countDocuments({
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

  return await FiscalPeriod.find({ year }).sort({ startDate: 1 }).lean();
}

/**
 * Get fiscal period statistics for dashboard
 * Best Practice: Dashboard KPIs
 */
export async function getFiscalPeriodStats() {
  await dbConnect();

  const [total, open, closed, locked, current] = await Promise.all([
    FiscalPeriod.countDocuments(),
    FiscalPeriod.countDocuments({ status: "open" }),
    FiscalPeriod.countDocuments({ status: "closed" }),
    FiscalPeriod.countDocuments({ status: "locked" }),
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
