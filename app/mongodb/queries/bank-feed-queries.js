import { BankStatement, BankFeedLine } from "../../models/bankFeed";
import Account from "../../models/account";
import dbConnect from "../../config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import { serializeBsonType } from "@/lib/utils";

// ============================================
// BANK FEED QUERIES
// Read operations for bank statements and feed lines
// ============================================

/**
 * Get all bank statements for the company
 */
export async function getBankStatements(page = 1, limit = 20) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();
  const skip = (page - 1) * limit;

  const query = withTenantScope({}, companyId, isSuperAdmin);

  const [statements, total] = await Promise.all([
    BankStatement.find(query)
      .populate("bankAccountId", "accountCode accountName")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    BankStatement.countDocuments(query),
  ]);

  return {
    statements: statements.map((s) => ({
      ...s,
      _id: s._id.toString(),
      companyId: s.companyId.toString(),
      bankAccountId: s.bankAccountId?._id?.toString() || s.bankAccountId?.toString(),
      bankAccountName: s.bankAccountId?.accountName,
      bankAccountCode: s.bankAccountId?.accountCode,
    })),
    pagination: {
      page,
      totalPages: Math.ceil(total / limit),
      total,
      hasMore: skip + statements.length < total,
    },
  };
}

/**
 * Get a single bank statement by ID
 */
export async function getBankStatementById(statementId) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const statement = await BankStatement.findOne(
    withTenantScope({ _id: statementId }, companyId, isSuperAdmin)
  )
    .populate("bankAccountId", "accountCode accountName")
    .lean();

  if (!statement) return null;

  return {
    ...statement,
    _id: statement._id.toString(),
    companyId: statement.companyId.toString(),
    bankAccountId: statement.bankAccountId?._id?.toString(),
    bankAccountName: statement.bankAccountId?.accountName,
    bankAccountCode: statement.bankAccountId?.accountCode,
  };
}

/**
 * Get bank feed lines for a statement
 */
export async function getBankFeedLines(
  statementId,
  filters = {},
  page = 1,
  limit = 50
) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();
  const skip = (page - 1) * limit;

  let query = withTenantScope({ statementId }, companyId, isSuperAdmin);

  // Apply filters
  if (filters.status) {
    query.status = filters.status;
  }

  if (filters.type === "debit") {
    query.debitAmount = { $gt: 0 };
  } else if (filters.type === "credit") {
    query.creditAmount = { $gt: 0 };
  }

  if (filters.search) {
    query.$or = [
      { description: { $regex: filters.search, $options: "i" } },
      { reference: { $regex: filters.search, $options: "i" } },
    ];
  }

  if (filters.startDate || filters.endDate) {
    query.transactionDate = {};
    if (filters.startDate) {
      query.transactionDate.$gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      query.transactionDate.$lte = new Date(filters.endDate);
    }
  }

  const [lines, total] = await Promise.all([
    BankFeedLine.find(query)
      .sort({ transactionDate: -1, rowNumber: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    BankFeedLine.countDocuments(query),
  ]);

  return {
    lines: serializeBsonType(lines),
    pagination: {
      page,
      totalPages: Math.ceil(total / limit),
      total,
      hasMore: skip + lines.length < total,
    },
  };
}

/**
 * Get a single bank feed line by ID
 */
export async function getBankFeedLineById(lineId) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const line = await BankFeedLine.findOne(
    withTenantScope({ _id: lineId }, companyId, isSuperAdmin)
  ).lean();

  if (!line) return null;

  return {
    ...line,
    _id: line._id.toString(),
    statementId: line.statementId.toString(),
    companyId: line.companyId.toString(),
    bankAccountId: line.bankAccountId.toString(),
    journalEntryId: line.journalEntryId?.toString(),
  };
}

/**
 * Get bank accounts (for dropdown)
 */
export async function getBankAccounts() {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const accounts = await Account.find(
    withTenantScope(
      {
        subType: { $in: ["bank", "cash", "mpesa"] },
        isActive: true,
        canPost: true,
      },
      companyId,
      isSuperAdmin
    )
  )
    .sort({ accountCode: 1 })
    .select("accountCode accountName subType bankDetails")
    .lean();

  return accounts.map((a) => ({
    ...a,
    _id: a._id.toString(),
  }));
}

/**
 * Get statement summary stats
 */
export async function getStatementSummary(statementId) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const statement = await BankStatement.findOne(
    withTenantScope({ _id: statementId }, companyId, isSuperAdmin)
  ).lean();

  if (!statement) return null;

  // Get detailed breakdown
  const breakdown = await BankFeedLine.aggregate([
    { $match: { statementId: statement._id } },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        totalDebits: { $sum: "$debitAmount" },
        totalCredits: { $sum: "$creditAmount" },
      },
    },
  ]);

  const byStatus = breakdown.reduce((acc, b) => {
    acc[b._id] = {
      count: b.count,
      totalDebits: b.totalDebits,
      totalCredits: b.totalCredits,
    };
    return acc;
  }, {});

  // Reconciliation: opening + credits - debits should equal closing.
  // If we have all three numbers, compute drift; if not, return nulls
  // so the UI can show "Not available — enter manually".
  const opening = statement.openingBalance;
  const closing = statement.closingBalance;
  const totalCredits = statement.stats?.totalCredits || 0;
  const totalDebits = statement.stats?.totalDebits || 0;
  const computedClosing =
    opening != null
      ? Math.round((opening + totalCredits - totalDebits) * 100) / 100
      : null;
  const drift =
    closing != null && computedClosing != null
      ? Math.round((closing - computedClosing) * 100) / 100
      : null;
  // Tolerance of 1 cent — float arithmetic can drift even when rounded.
  const balanced = drift != null && Math.abs(drift) <= 0.01;

  return {
    ...statement.stats,
    byStatus,
    progressPercent:
      statement.stats.totalLines > 0
        ? Math.round(
            ((statement.stats.allocatedLines + statement.stats.excludedLines) /
              statement.stats.totalLines) *
              100
          )
        : 0,
    reconciliation: {
      openingBalance: opening,
      closingBalance: closing,
      computedClosing,
      drift,
      balanced,
      source: statement.balanceSource || "unavailable",
      totalCredits,
      totalDebits,
      netChange:
        Math.round((totalCredits - totalDebits) * 100) / 100,
    },
  };
}

/**
 * Get unallocated lines count (for dashboard)
 */
export async function getUnallocatedCount() {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const count = await BankFeedLine.countDocuments(
    withTenantScope({ status: "unallocated" }, companyId, isSuperAdmin)
  );

  return count;
}

/**
 * Get all unallocated lines across all statements
 */
export async function getAllUnallocatedLines(filters = {}, page = 1, limit = 50) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();
  const skip = (page - 1) * limit;

  let query = withTenantScope({ status: "unallocated" }, companyId, isSuperAdmin);

  // Apply filters
  if (filters.type === "debit") {
    query.debitAmount = { $gt: 0 };
  } else if (filters.type === "credit") {
    query.creditAmount = { $gt: 0 };
  }

  if (filters.search) {
    query.$or = [
      { description: { $regex: filters.search, $options: "i" } },
      { reference: { $regex: filters.search, $options: "i" } },
    ];
  }

  if (filters.bankAccountId) {
    query.bankAccountId = filters.bankAccountId;
  }

  if (filters.startDate || filters.endDate) {
    query.transactionDate = {};
    if (filters.startDate) {
      query.transactionDate.$gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      query.transactionDate.$lte = new Date(filters.endDate);
    }
  }

  const [lines, total] = await Promise.all([
    BankFeedLine.find(query)
      .populate("statementId", "fileName")
      .populate("bankAccountId", "accountCode accountName")
      .sort({ transactionDate: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    BankFeedLine.countDocuments(query),
  ]);

  return {
    lines: lines.map((l) => ({
      ...l,
      _id: l._id.toString(),
      statementId: l.statementId?._id?.toString() || l.statementId?.toString(),
      statementName: l.statementId?.fileName,
      companyId: l.companyId.toString(),
      bankAccountId: l.bankAccountId?._id?.toString() || l.bankAccountId?.toString(),
      bankAccountName: l.bankAccountId?.accountName,
      bankAccountCode: l.bankAccountId?.accountCode,
      journalEntryId: l.journalEntryId?.toString(),
      suggestions: l.suggestions?.map((s) => ({
        ...s,
        documentId: s.documentId?.toString(),
      })),
    })),
    pagination: {
      page,
      totalPages: Math.ceil(total / limit),
      total,
      hasMore: skip + lines.length < total,
    },
  };
}

/**
 * Search for matching invoices (for allocation)
 */
export async function searchMatchingInvoices(amount, searchTerm = "") {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();
  const Invoice = (await import("../../models/invoice")).default;

  let query = withTenantScope(
    {
      status: { $in: ["sent", "partially_paid"] },
      balanceDue: { $gt: 0 },
    },
    companyId,
    isSuperAdmin
  );

  if (searchTerm) {
    query.$or = [
      { invoiceNumber: { $regex: searchTerm, $options: "i" } },
      { "customer.name": { $regex: searchTerm, $options: "i" } },
    ];
  }

  const invoices = await Invoice.find(query)
    .sort({ dueDate: 1 })
    .limit(20)
    .select("invoiceNumber customer total balanceDue dueDate status")
    .lean();

  // Sort by amount closeness
  return invoices
    .map((inv) => ({
      ...inv,
      _id: inv._id.toString(),
      amountDiff: Math.abs(inv.balanceDue - amount),
    }))
    .sort((a, b) => a.amountDiff - b.amountDiff);
}

/**
 * Search for matching bills (for allocation)
 */
export async function searchMatchingBills(amount, searchTerm = "") {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();
  const Bill = (await import("../../models/bill")).default;

  let query = withTenantScope(
    {
      status: { $in: ["pending", "partially_paid"] },
      balanceDue: { $gt: 0 },
    },
    companyId,
    isSuperAdmin
  );

  if (searchTerm) {
    query.$or = [
      { billNumber: { $regex: searchTerm, $options: "i" } },
      { "supplier.name": { $regex: searchTerm, $options: "i" } },
    ];
  }

  const bills = await Bill.find(query)
    .sort({ dueDate: 1 })
    .limit(20)
    .select("billNumber supplier total balanceDue dueDate status")
    .lean();

  // Sort by amount closeness
  return bills
    .map((bill) => ({
      ...bill,
      _id: bill._id.toString(),
      amountDiff: Math.abs(bill.balanceDue - amount),
    }))
    .sort((a, b) => a.amountDiff - b.amountDiff);
}

/**
 * Get expense accounts (for direct expense allocation)
 */
export async function getExpenseAccounts() {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const accounts = await Account.find(
    withTenantScope(
      {
        accountType: "Expense",
        isActive: true,
        canPost: true,
      },
      companyId,
      isSuperAdmin
    )
  )
    .sort({ accountCode: 1 })
    .select("accountCode accountName subType")
    .lean();

  return accounts.map((a) => ({
    ...a,
    _id: a._id.toString(),
  }));
}

/**
 * Get income/revenue accounts (for direct income allocation)
 */
export async function getIncomeAccounts() {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const accounts = await Account.find(
    withTenantScope(
      {
        accountType: "Revenue",
        isActive: true,
        canPost: true,
      },
      companyId,
      isSuperAdmin
    )
  )
    .sort({ accountCode: 1 })
    .select("accountCode accountName subType")
    .lean();

  return accounts.map((a) => ({
    ...a,
    _id: a._id.toString(),
  }));
}

/**
 * Get transfer accounts (other bank/cash accounts excluding current)
 */
export async function getTransferAccounts(excludeAccountId) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const query = withTenantScope(
    {
      subType: { $in: ["bank", "cash", "mpesa"] },
      isActive: true,
      canPost: true,
    },
    companyId,
    isSuperAdmin
  );

  if (excludeAccountId) {
    query._id = { $ne: excludeAccountId };
  }

  const accounts = await Account.find(query)
    .sort({ accountCode: 1 })
    .select("accountCode accountName subType")
    .lean();

  return accounts.map((a) => ({
    ...a,
    _id: a._id.toString(),
  }));
}

/**
 * Get liability accounts (for loan payments)
 */
export async function getLiabilityAccounts() {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const accounts = await Account.find(
    withTenantScope(
      {
        accountType: "Liability",
        isActive: true,
        canPost: true,
      },
      companyId,
      isSuperAdmin
    )
  )
    .sort({ accountCode: 1 })
    .select("accountCode accountName subType")
    .lean();

  return accounts.map((a) => ({
    ...a,
    _id: a._id.toString(),
  }));
}

/**
 * Get equity accounts (for owner drawings/capital)
 */
export async function getEquityAccounts() {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const accounts = await Account.find(
    withTenantScope(
      {
        accountType: "Equity",
        isActive: true,
        canPost: true,
      },
      companyId,
      isSuperAdmin
    )
  )
    .sort({ accountCode: 1 })
    .select("accountCode accountName subType")
    .lean();

  return accounts.map((a) => ({
    ...a,
    _id: a._id.toString(),
  }));
}

/**
 * Get all postable accounts grouped by type (for split allocations)
 */
export async function getAllPostableAccounts() {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const accounts = await Account.find(
    withTenantScope(
      {
        isActive: true,
        canPost: true,
      },
      companyId,
      isSuperAdmin
    )
  )
    .sort({ accountType: 1, accountCode: 1 })
    .select("accountCode accountName accountType subType")
    .lean();

  // Group by account type
  const grouped = accounts.reduce((acc, account) => {
    const type = account.accountType;
    if (!acc[type]) {
      acc[type] = [];
    }
    acc[type].push({
      ...account,
      _id: account._id.toString(),
    });
    return acc;
  }, {});

  return grouped;
}

export default {
  getBankStatements,
  getBankStatementById,
  getBankFeedLines,
  getBankFeedLineById,
  getBankAccounts,
  getStatementSummary,
  getUnallocatedCount,
  getAllUnallocatedLines,
  searchMatchingInvoices,
  searchMatchingBills,
  getExpenseAccounts,
  getIncomeAccounts,
  getTransferAccounts,
  getLiabilityAccounts,
  getEquityAccounts,
  getAllPostableAccounts,
};
