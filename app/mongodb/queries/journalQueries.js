import JournalEntry from "../../models/JournalEntry";

import JournalEntryService from "../services/journalService";
import dbConnect from "../../config/dbConnect";
import {
  getTenantContext,
  withTenantScope,
  buildTenantMatch,
} from "@/lib/utils/tenant-utils";

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

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  const skip = (page - 1) * ITEMS_PER_PAGE;
  let query = {};

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

  // Apply tenant scoping
  query = withTenantScope(query, companyId, isSuperAdmin);

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

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  const entry = await JournalEntry.findOne(
    withTenantScope({ _id: entryId }, companyId, isSuperAdmin)
  ).lean();

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

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  const entries = await JournalEntry.find(
    withTenantScope({ status: "draft" }, companyId, isSuperAdmin)
  )
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

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  let query = {};

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

  // Apply tenant scoping
  query = withTenantScope(query, companyId, isSuperAdmin);

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

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  if (!searchTerm || searchTerm.trim().length === 0) {
    return [];
  }

  const query = withTenantScope(
    {
      $or: [
        { entryNumber: { $regex: searchTerm, $options: "i" } },
        { description: { $regex: searchTerm, $options: "i" } },
        { reference: { $regex: searchTerm, $options: "i" } },
      ],
    },
    companyId,
    isSuperAdmin
  );

  return await JournalEntry.find(query)
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

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  return await JournalEntry.find(
    withTenantScope({ status: "posted" }, companyId, isSuperAdmin)
  )
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

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantMatch(companyId, isSuperAdmin);

  const [entries, stats] = await Promise.all([
    JournalEntry.find(
      withTenantScope({ fiscalPeriodId, status: "posted" }, companyId, isSuperAdmin)
    )
      .sort({ entryDate: -1 })
      .select("entryNumber entryDate entryType description")
      .lean(),

    JournalEntry.aggregate([
      { $match: { ...tenantMatch, fiscalPeriodId, status: "posted" } },
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

/**
 * Get journal stats for dashboard cards
 * Returns: total entries, this month count/volume, drafts, reversals
 */
export async function getJournalStatsForDashboard() {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantMatch(companyId, isSuperAdmin);

  // Get current month boundaries
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

  const [totalEntries, thisMonthStats, lastMonthCount, draftCount, reversalCount] =
    await Promise.all([
      // Total entries
      JournalEntry.countDocuments(withTenantScope({}, companyId, isSuperAdmin)),

      // This month entries + volume
      JournalEntry.aggregate([
        {
          $match: {
            ...tenantMatch,
            entryDate: { $gte: startOfMonth },
            status: "posted",
          },
        },
        { $unwind: "$lines" },
        {
          $group: {
            _id: null,
            count: { $addToSet: "$_id" },
            totalDebits: { $sum: "$lines.debit" },
          },
        },
        {
          $project: {
            count: { $size: "$count" },
            totalDebits: 1,
          },
        },
      ]),

      // Last month count (for trend calculation)
      JournalEntry.countDocuments(
        withTenantScope(
          {
            entryDate: { $gte: startOfLastMonth, $lte: endOfLastMonth },
            status: "posted",
          },
          companyId,
          isSuperAdmin
        )
      ),

      // Draft count
      JournalEntry.countDocuments(
        withTenantScope({ status: "draft" }, companyId, isSuperAdmin)
      ),

      // Reversals this month
      JournalEntry.countDocuments(
        withTenantScope(
          {
            status: "reversed",
            reversedAt: { $gte: startOfMonth },
          },
          companyId,
          isSuperAdmin
        )
      ),
    ]);

  const thisMonth = thisMonthStats[0] || { count: 0, totalDebits: 0 };
  const trend =
    lastMonthCount > 0
      ? Math.round(((thisMonth.count - lastMonthCount) / lastMonthCount) * 100)
      : 0;

  return {
    totalEntries,
    thisMonthEntries: thisMonth.count,
    thisMonthVolume: thisMonth.totalDebits,
    draftCount,
    reversalCount,
    trend,
  };
}

/**
 * Get journal entries for timeline view (with full lines)
 * Supports cursor-based pagination for better performance
 */
export async function getJournalEntriesForTimeline(filters = {}, limit = 20, cursor = null) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  let query = {};

  // Cursor-based pagination
  if (cursor) {
    query._id = { $lt: cursor };
  }

  // Status filter
  if (filters.status && filters.status !== "all") {
    query.status = filters.status;
  }

  // Entry type filter
  if (filters.entryType && filters.entryType !== "all") {
    query.entryType = filters.entryType;
  }

  // Period/date filter
  if (filters.period && filters.period !== "all") {
    const now = new Date();
    let startDate, endDate;

    switch (filters.period) {
      case "today":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        break;
      case "this_week":
        const dayOfWeek = now.getDay();
        startDate = new Date(now);
        startDate.setDate(now.getDate() - dayOfWeek);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 7);
        break;
      case "this_month":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        break;
      case "this_quarter":
        const quarter = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), quarter * 3, 1);
        endDate = new Date(now.getFullYear(), quarter * 3 + 3, 1);
        break;
      case "this_year":
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear() + 1, 0, 1);
        break;
    }

    if (startDate && endDate) {
      query.entryDate = { $gte: startDate, $lt: endDate };
    }
  }

  // Custom date range
  if (filters.dateFrom || filters.dateTo) {
    query.entryDate = query.entryDate || {};
    if (filters.dateFrom) query.entryDate.$gte = new Date(filters.dateFrom);
    if (filters.dateTo) {
      const endDate = new Date(filters.dateTo);
      endDate.setDate(endDate.getDate() + 1);
      query.entryDate.$lt = endDate;
    }
  }

  // Search filter
  if (filters.search && filters.search.trim()) {
    query.$or = [
      { entryNumber: { $regex: filters.search, $options: "i" } },
      { description: { $regex: filters.search, $options: "i" } },
      { reference: { $regex: filters.search, $options: "i" } },
      { "party.name": { $regex: filters.search, $options: "i" } },
    ];
  }

  // Apply tenant scoping
  query = withTenantScope(query, companyId, isSuperAdmin);

  // Fetch entries with lines (needed for timeline display)
  const entries = await JournalEntry.find(query)
    .sort({ entryDate: -1, _id: -1 })
    .limit(limit + 1) // Fetch one extra to check if there are more
    .lean();

  // Calculate totals for each entry
  const entriesWithTotals = entries.slice(0, limit).map((entry) => ({
    ...entry,
    totalDebits: entry.lines?.reduce((sum, line) => sum + (line.debit || 0), 0) || 0,
    totalCredits: entry.lines?.reduce((sum, line) => sum + (line.credit || 0), 0) || 0,
  }));

  return {
    entries: entriesWithTotals,
    hasMore: entries.length > limit,
    nextCursor: entries.length > limit ? entries[limit - 1]._id : null,
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
  getJournalStatsForDashboard,
  getJournalEntriesForTimeline,
};