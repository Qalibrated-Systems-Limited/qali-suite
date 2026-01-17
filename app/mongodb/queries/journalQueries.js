import JournalEntry from "../../models/JournalEntry";

import JournalEntryService from "../services/journalService";
import dbConnect from "../../config/dbConnect";

const ITEMS_PER_PAGE = 20;

// ============================================
// JOURNAL ENTRY QUERIES - READ OPERATIONS
// Following industry best practices
// ============================================

/**
 * Get paginated journal entries with smart filters
 * Best Practice: Pagination, Smart Filters (status, type, date, account)
 */
export async function getJournalEntries(page = 1, filters = {}) {
  await dbConnect();

  const skip = (page - 1) * ITEMS_PER_PAGE;
  const query = {};

  // Status filter
  if (filters.status) {
    query.status = filters.status;
  }

  // Type filter
  if (filters.entryType) {
    query.entryType = filters.entryType;
  }

  // Fiscal period filter
  if (filters.fiscalPeriodId) {
    query.fiscalPeriodId = filters.fiscalPeriodId;
  }

  // Account filter
  if (filters.accountId) {
    query["lines.accountId"] = filters.accountId;
  }

  // Date range filter
  if (filters.startDate || filters.endDate) {
    query.entryDate = {};
    if (filters.startDate) {
      query.entryDate.$gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      const endDate = new Date(filters.endDate);
      endDate.setDate(endDate.getDate() + 1);
      query.entryDate.$lt = endDate;
    }
  }

  // Search filter
  if (filters.search) {
    query.$or = [
      { entryNumber: { $regex: filters.search, $options: "i" } },
      { description: { $regex: filters.search, $options: "i" } },
      { reference: { $regex: filters.search, $options: "i" } },
    ];
  }

  // Parallel queries for performance
  const [entries, total] = await Promise.all([
    JournalEntry.find(query)
      .sort({ entryDate: -1, entryNumber: -1 })
      .skip(skip)
      .limit(ITEMS_PER_PAGE)
      .lean(),
    JournalEntry.countDocuments(query),
  ]);

  return {
    entries,
    pagination: {
      page,
      totalPages: Math.ceil(total / ITEMS_PER_PAGE),
      total,
      hasMore: skip + entries.length < total,
    },
  };
}

/**
 * Get journal entry by ID with full details
 * Best Practice: Drill-down support
 */
export async function getJournalEntryById(entryId) {
  await dbConnect();

  const entry = await JournalEntry.findById(entryId).lean();

  if (!entry) {
    return null;
  }

  // Calculate totals
  const totalDebit = entry.lines.reduce((sum, line) => sum + (line.debit || 0), 0);
  const totalCredit = entry.lines.reduce((sum, line) => sum + (line.credit || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return {
    ...entry,
    totals: {
      debit: totalDebit,
      credit: totalCredit,
      isBalanced,
    },
  };
}

/**
 * Get draft entries (needs review)
 * Best Practice: Dashboard summaries - pending actions
 */
export async function getDraftEntries() {
  await dbConnect();

  const entries = await JournalEntry.find({ status: "draft" })
    .sort({ createdAt: -1 })
    .limit(50)
    .select("entryNumber entryDate entryType description createdBy createdAt")
    .lean();

  return entries;
}

/**
 * Get entry statistics
 * Best Practice: Dashboard KPIs
 */
export async function getEntryStats(filters = {}) {
  await dbConnect();

  const query = {};

  // Date range
  if (filters.startDate || filters.endDate) {
    query.entryDate = {};
    if (filters.startDate) query.entryDate.$gte = new Date(filters.startDate);
    if (filters.endDate) query.entryDate.$lte = new Date(filters.endDate);
  }

  // Fiscal period
  if (filters.fiscalPeriodId) {
    query.fiscalPeriodId = filters.fiscalPeriodId;
  }

  const [statusStats, typeStats, total] = await Promise.all([
    // Count by status
    JournalEntry.aggregate([
      { $match: query },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),

    // Count by type
    JournalEntry.aggregate([
      { $match: { ...query, status: "posted" } },
      { $group: { _id: "$entryType", count: { $sum: 1 } } },
    ]),

    // Total count
    JournalEntry.countDocuments(query),
  ]);

  return {
    total,
    byStatus: statusStats.reduce((acc, stat) => {
      acc[stat._id] = stat.count;
      return acc;
    }, {}),
    byType: typeStats.reduce((acc, stat) => {
      acc[stat._id] = stat.count;
      return acc;
    }, {}),
  };
}

/**
 * Get general ledger for account
 * Best Practice: Use service method for complex calculations
 */
export async function getGeneralLedger(accountId, startDate, endDate) {
  await dbConnect();
  return await JournalEntryService.getGeneralLedger(accountId, startDate, endDate);
}

/**
 * Search journal entries
 * Best Practice: Fast search
 */
export async function searchJournalEntries(searchTerm, limit = 50) {
  await dbConnect();

  if (!searchTerm || searchTerm.trim().length === 0) {
    return [];
  }

  return await JournalEntry.find({
    $or: [
      { entryNumber: { $regex: searchTerm, $options: "i" } },
      { description: { $regex: searchTerm, $options: "i" } },
      { reference: { $regex: searchTerm, $options: "i" } },
    ],
  })
    .sort({ entryDate: -1 })
    .limit(limit)
    .select("entryNumber entryDate entryType description status")
    .lean();
}

/**
 * Get recent entries for dashboard
 * Best Practice: Dashboard recent activity
 */
export async function getRecentEntries(limit = 10) {
  await dbConnect();

  return await JournalEntry.find({ status: "posted" })
    .sort({ postedAt: -1 })
    .limit(limit)
    .select("entryNumber entryDate entryType description postedBy postedAt")
    .lean();
}

/**
 * Get AR Aging Report
 * Best Practice: Use schema static method if available
 */
export async function getARAgingReport(asOfDate = new Date()) {
  await dbConnect();

  if (typeof JournalEntry.getARAgingReport === "function") {
    return await JournalEntry.getARAgingReport(asOfDate);
  }

  // Fallback: Basic message
  return {
    message: "AR Aging report not available in schema",
    asOfDate,
  };
}

/**
 * Get AP Aging Report
 * Best Practice: Use schema static method if available
 */
export async function getAPAgingReport(asOfDate = new Date()) {
  await dbConnect();

  if (typeof JournalEntry.getAPAgingReport === "function") {
    return await JournalEntry.getAPAgingReport(asOfDate);
  }

  // Fallback: Basic message
  return {
    message: "AP Aging report not available in schema",
    asOfDate,
  };
}

/**
 * Get statement of account for party
 * Best Practice: Use schema static method if available
 */
export async function getStatementOfAccount(partyId) {
  await dbConnect();

  if (typeof JournalEntry.getStatementOfAccount === "function") {
    return await JournalEntry.getStatementOfAccount(partyId);
  }

  // Fallback: Basic message
  return {
    message: "Statement of account not available in schema",
    partyId,
  };
}

/**
 * Get entries by fiscal period with summary
 * Best Practice: Period-specific reporting
 */
export async function getEntriesByPeriod(fiscalPeriodId) {
  await dbConnect();

  const [entries, stats] = await Promise.all([
    JournalEntry.find({ fiscalPeriodId, status: "posted" })
      .sort({ entryDate: -1 })
      .select("entryNumber entryDate entryType description")
      .lean(),

    JournalEntry.aggregate([
      { $match: { fiscalPeriodId, status: "posted" } },
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
      {
        $group: {
          _id: "$account.accountType",
          totalDebit: { $sum: "$lines.debit" },
          totalCredit: { $sum: "$lines.credit" },
        },
      },
    ]),
  ]);

  return {
    entries,
    statistics: stats.reduce((acc, stat) => {
      acc[stat._id] = {
        debit: stat.totalDebit,
        credit: stat.totalCredit,
      };
      return acc;
    }, {}),
  };
}

export default {
  getJournalEntries,
  getJournalEntryById,
  getDraftEntries,
  getEntryStats,
  getGeneralLedger,
  searchJournalEntries,
  getRecentEntries,
  getARAgingReport,
  getAPAgingReport,
  getStatementOfAccount,
  getEntriesByPeriod,
};