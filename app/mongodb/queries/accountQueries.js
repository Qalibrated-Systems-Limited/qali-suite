import Account from "../../models/account";
import JournalEntry from "../../models/JournalEntry";
import AccountService from "../services/accountService";
import dbConnect from "../../config/dbConnect";
import { getTenantContext, withTenantScope, buildTenantMatch } from "@/lib/utils/tenant-utils";
import { serializeBsonType } from "@/lib/utils";

const ITEMS_PER_PAGE = 20;

// ============================================
// ACCOUNT QUERIES - READ OPERATIONS
// Following industry best practices
// ============================================

/**
 * Get paginated accounts with filters and search
 * Best Practice: Pagination (20/page), Smart Filters, Search
 */
export async function getAccounts(page = 1, filters = {}) {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  const skip = (page - 1) * ITEMS_PER_PAGE;
  let query = { isActive: true };

  // Apply filters
  if (filters.accountType) query.accountType = filters.accountType;
  if (filters.canPost !== undefined) {
    query.canPost = filters.canPost === "true" || filters.canPost === true;
  }
  if (filters.subType) query.subType = filters.subType;
  if (filters.search) {
    query.$or = [
      { accountCode: { $regex: filters.search, $options: "i" } },
      { accountName: { $regex: filters.search, $options: "i" } },
    ];
  }

  // Apply tenant scoping
  query = withTenantScope(query, companyId, isSuperAdmin);

  // Parallel queries for performance
  const [accounts, total] = await Promise.all([
    Account.find(query)
      .sort({ accountCode: 1 })
      .skip(skip)
      .limit(ITEMS_PER_PAGE)
      .select(
        "accountCode accountName accountType subType canPost cachedBalance balanceUpdatedAt systemAccount",
      )
      .lean(), // Performance optimization
    Account.countDocuments(query),
  ]);

  return {
    accounts,
    pagination: {
      page,
      totalPages: Math.ceil(total / ITEMS_PER_PAGE),
      total,
      hasMore: skip + accounts.length < total,
    },
  };
}

/**
 * Get Chart of Accounts (hierarchical tree)
 * Best Practice: Hierarchical data structure for expand/collapse UI
 */
export async function getChartOfAccounts() {
  await dbConnect();
  return await AccountService.getChartOfAccounts();
}

/**
 * Get account details with recent transactions
 * Best Practice: Drill-down support
 */
export async function getAccountById(accountId, includeTransactions = false) {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  const account = await Account.findOne(
    withTenantScope({ _id: accountId }, companyId, isSuperAdmin),
  ).lean();
  if (!account) return null;

  if (includeTransactions) {
    const recentTransactions = await JournalEntry.find(
      withTenantScope(
        { status: "posted", "lines.accountId": accountId },
        companyId,
        isSuperAdmin,
      ),
    )
      .sort({ entryDate: -1 })
      .limit(10)
      .select("entryNumber entryDate description lines")
      .lean();

    account.recentTransactions = recentTransactions.map((entry) => {
      const line = entry.lines.find(
        (l) => l.accountId.toString() === accountId.toString(),
      );
      return {
        entryNumber: entry.entryNumber,
        date: entry.entryDate,
        description: entry.description,
        debit: line?.debit || 0,
        credit: line?.credit || 0,
      };
    });
  }

  // Serialize ObjectIds for Next.js
  return serializeBsonType(account);
}

/**
 * Get account summary with statistics
 * Best Practice: Dashboard summaries
 */
export async function getAccountDetails(accountId, startDate, endDate) {
  await dbConnect();
  return await AccountService.getAccountSummary(accountId, startDate, endDate);
}

/**
 * Search accounts (autocomplete)
 * Best Practice: Fast search for dropdowns, limit 50
 */
export async function searchAccounts(searchTerm, limit = 50) {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  if (!searchTerm || searchTerm.trim().length === 0) return [];

  const query = withTenantScope(
    {
      isActive: true,
      $or: [
        { accountCode: { $regex: searchTerm, $options: "i" } },
        { accountName: { $regex: searchTerm, $options: "i" } },
      ],
    },
    companyId,
    isSuperAdmin,
  );

  return await Account.find(query)
    .sort({ accountCode: 1 })
    .limit(limit)
    .select("accountCode accountName accountType subType canPost")
    .lean();
}

/**
 * Get postable accounts
 * Best Practice: Use schema methods where available
 */
export async function getPostableAccounts(accountType = null) {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  let query = { canPost: true, isActive: true };
  if (accountType) query.accountType = accountType;

  // Apply tenant scoping
  query = withTenantScope(query, companyId, isSuperAdmin);

  return await Account.find(query)
    .sort({ accountCode: 1 })
    .select("accountCode accountName accountType subType")
    .lean();
}

/**
 * Get account ledger with pagination
 * Best Practice: Paginated ledger with running balance
 */
export async function getAccountLedger(
  accountId,
  page = 1,
  startDate = null,
  endDate = null,
) {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  const account = await Account.findOne(
    withTenantScope({ _id: accountId }, companyId, isSuperAdmin),
  );
  if (!account) return null;

  const skip = (page - 1) * ITEMS_PER_PAGE;
  let query = {
    status: "posted",
    "lines.accountId": accountId,
  };

  if (startDate || endDate) {
    query.entryDate = {};
    if (startDate) query.entryDate.$gte = new Date(startDate);
    if (endDate) query.entryDate.$lte = new Date(endDate);
  }

  // Apply tenant scoping to journal entries
  query = withTenantScope(query, companyId, isSuperAdmin);

  const [entries, total] = await Promise.all([
    JournalEntry.find(query)
      .sort({ entryDate: 1, entryNumber: 1 })
      .skip(skip)
      .limit(ITEMS_PER_PAGE)
      .lean(),
    JournalEntry.countDocuments(query),
  ]);

  // Calculate running balance
  let runningBalance = 0;
  const normalSide = ["asset", "expense"].includes(account.accountType)
    ? "debit"
    : "credit";

  const transactions = entries
    .map((entry) => {
      const line = entry.lines.find(
        (l) => l.accountId.toString() === accountId.toString(),
      );
      if (!line) return null;

      const debit = line.debit || 0;
      const credit = line.credit || 0;

      if (normalSide === "debit") {
        runningBalance += debit - credit;
      } else {
        runningBalance += credit - debit;
      }

      return {
        date: entry.entryDate,
        entryNumber: entry.entryNumber,
        entryId: entry._id,
        description: entry.description,
        reference: entry.reference,
        debit,
        credit,
        balance: runningBalance,
      };
    })
    .filter(Boolean);

  return {
    account: {
      accountCode: account.accountCode,
      accountName: account.accountName,
      accountType: account.accountType,
      normalBalanceSide: normalSide,
    },
    transactions,
    pagination: {
      page,
      totalPages: Math.ceil(total / ITEMS_PER_PAGE),
      total,
      hasMore: skip + transactions.length < total,
    },
  };
}

/**
 * Get account statistics
 * Best Practice: Dashboard KPIs
 */
export async function getAccountStats() {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantMatch(companyId, isSuperAdmin);

  const baseQuery = withTenantScope(
    { isActive: true },
    companyId,
    isSuperAdmin,
  );
  const postableQuery = withTenantScope(
    { isActive: true, canPost: true },
    companyId,
    isSuperAdmin,
  );

  const [stats, total, postableTotal] = await Promise.all([
    Account.aggregate([
      { $match: { ...tenantMatch, isActive: true } },
      {
        $group: {
          _id: "$accountType",
          count: { $sum: 1 },
          postableCount: { $sum: { $cond: ["$canPost", 1, 0] } },
        },
      },
    ]),
    Account.countDocuments(baseQuery),
    Account.countDocuments(postableQuery),
  ]);

  return {
    total,
    postableTotal,
    byType: stats.reduce((acc, stat) => {
      acc[stat._id] = {
        count: stat.count,
        postable: stat.postableCount,
      };
      return acc;
    }, {}),
  };
}

/**
 * Get accounts by type
 */
export async function getAccountsByType(accountType) {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  const query = withTenantScope(
    { accountType, isActive: true },
    companyId,
    isSuperAdmin,
  );

  // Safety ceiling — a chart of accounts is bounded; cap to avoid an
  // unbounded scan if data is ever pathological.
  return await Account.find(query).sort({ accountCode: 1 }).limit(2000).lean();
}

/**
 * Get root accounts
 */
export async function getRootAccounts() {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  const query = withTenantScope(
    { parentAccount: null, isActive: true },
    companyId,
    isSuperAdmin,
  );

  // Safety ceiling (root accounts are few; guard against pathological data).
  return await Account.find(query).sort({ accountCode: 1 }).limit(2000).lean();
}

/**
 * Get system account
 */
export async function getSystemAccount(systemAccountName) {
  await dbConnect();
  return await AccountService.getSystemAccount(systemAccountName);
}

/**
 * Get accounts with balances
 * Best Practice: Aggregation for performance
 */
export async function getAccountsWithBalances(
  accountType = null,
  startDate = null,
  endDate = null,
) {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  let query = { canPost: true, isActive: true };
  if (accountType) query.accountType = accountType;

  // Apply tenant scoping
  query = withTenantScope(query, companyId, isSuperAdmin);

  const accounts = await Account.find(query).lean();
  if (accounts.length === 0) return [];

  // Previously: per-account aggregation in Promise.all → N round trips
  // and N $unwind+$group passes over JournalEntry.lines. Now one pipeline:
  // match all posted JEs in range whose lines touch any of these accounts,
  // unwind, filter to those accountIds, group by accountId.
  const accountIds = accounts.map((a) => a._id);

  let jeQuery = {
    status: "posted",
    "lines.accountId": { $in: accountIds },
  };
  if (startDate || endDate) {
    jeQuery.entryDate = {};
    if (startDate) jeQuery.entryDate.$gte = new Date(startDate);
    if (endDate) jeQuery.entryDate.$lte = new Date(endDate);
  }
  jeQuery = withTenantScope(jeQuery, companyId, isSuperAdmin);

  const totalsByAccount = await JournalEntry.aggregate([
    { $match: jeQuery },
    { $unwind: "$lines" },
    { $match: { "lines.accountId": { $in: accountIds } } },
    {
      $group: {
        _id: "$lines.accountId",
        totalDebit: { $sum: "$lines.debit" },
        totalCredit: { $sum: "$lines.credit" },
      },
    },
  ]);

  const totalsMap = new Map(
    totalsByAccount.map((t) => [t._id.toString(), t]),
  );

  const accountsWithBalances = accounts.map((account) => {
    const totals = totalsMap.get(account._id.toString());
    if (!totals) return { ...account, balance: 0 };

    const { totalDebit = 0, totalCredit = 0 } = totals;
    const normalSide = ["asset", "expense"].includes(account.accountType)
      ? "debit"
      : "credit";
    const balance =
      normalSide === "debit"
        ? totalDebit - totalCredit
        : totalCredit - totalDebit;
    return { ...account, balance };
  });

  return accountsWithBalances.filter((acc) => Math.abs(acc.balance) > 0.01);
}

/**
 * Get accounts grouped by type with hierarchical structure
 * Returns tree structure for expand/collapse UI
 */
export async function getAccountsGrouped() {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  const query = withTenantScope({ isActive: true }, companyId, isSuperAdmin);

  // Fetch all active accounts
  const accounts = await Account.find(query)
    .sort({ accountCode: 1 })
    .select(
      "_id accountCode accountName accountType subType parentId canPost cachedBalance isActive systemAccount",
    )
    .lean();

  // Serialize for client
  const serialized = accounts.map((acc) => ({
    ...acc,
    _id: acc._id.toString(),
    parentId: acc.parentId ? acc.parentId.toString() : null,
  }));

  // Build hierarchy
  const accountMap = new Map();
  const rootsByType = {
    asset: [],
    liability: [],
    equity: [],
    revenue: [],
    expense: [],
  };

  // First pass: create map
  serialized.forEach((account) => {
    accountMap.set(account._id, {
      ...account,
      children: [],
    });
  });

  // Second pass: build hierarchy
  serialized.forEach((account) => {
    const node = accountMap.get(account._id);
    if (account.parentId) {
      const parent = accountMap.get(account.parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        // Orphaned account - add to root
        rootsByType[account.accountType]?.push(node);
      }
    } else {
      // Root account
      rootsByType[account.accountType]?.push(node);
    }
  });

  return rootsByType;
}

/**
 * Get postable expense accounts for internal use expensing
 * Returns only active, postable expense accounts for the expense dialog
 */
export async function getExpenseAccountsForDialog() {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  const query = withTenantScope(
    {
      accountType: "expense",
      canPost: true,
      isActive: true,
    },
    companyId,
    isSuperAdmin,
  );

  const accounts = await Account.find(query)
    .sort({ accountCode: 1 })
    .select("_id accountCode accountName subType")
    .lean();

  return serializeBsonType(accounts);
}

export default {
  getAccounts,
  getChartOfAccounts,
  getAccountById,
  getAccountDetails,
  searchAccounts,
  getPostableAccounts,
  getAccountsByType,
  getRootAccounts,
  getSystemAccount,
  getAccountLedger,
  getAccountStats,
  getAccountsWithBalances,
  getExpenseAccountsForDialog,
};
