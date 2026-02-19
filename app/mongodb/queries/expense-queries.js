import Expense from "../../models/expenses";
import dbConnect from "../../config/dbConnect";
import { ObjectId } from "mongodb";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";

const ITEMS_PER_PAGE = 20;

// ============================================
// EXPENSE QUERIES - READ OPERATIONS
// ============================================

/**
 * Get paginated expenses with filters
 */
export async function getExpenses(page = 1, filters = {}) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const skip = (page - 1) * ITEMS_PER_PAGE;
  let query = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  // Status filter
  if (filters.status) {
    query.status = filters.status;
  }

  // Category filter
  if (filters.category) {
    query.category = filters.category;
  }

  // Payment method filter
  if (filters.paymentMethod) {
    query.paymentMethod = filters.paymentMethod;
  }

  // Reimbursable filter
  if (filters.isReimbursable !== undefined) {
    query.isReimbursable =
      filters.isReimbursable === "true" || filters.isReimbursable === true;
  }

  // Date range filter
  if (filters.startDate || filters.endDate) {
    query.expenseDate = {};
    if (filters.startDate) {
      query.expenseDate.$gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      query.expenseDate.$lte = new Date(filters.endDate);
    }
  }

  // Search filter
  if (filters.search) {
    query.$or = [
      { expenseNumber: { $regex: filters.search, $options: "i" } },
      { description: { $regex: filters.search, $options: "i" } },
      { "vendor.name": { $regex: filters.search, $options: "i" } },
      { reference: { $regex: filters.search, $options: "i" } },
    ];
  }

  // Parallel queries for performance
  const [expenses, total] = await Promise.all([
    Expense.find(query)
      .sort({ expenseDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(ITEMS_PER_PAGE)
      .lean(),
    Expense.countDocuments(query),
  ]);

  // Serialize for client components
  const serializedExpenses = expenses.map((exp) => ({
    _id: exp._id.toString(),
    companyId: exp.companyId?.toString(),
    expenseNumber: exp.expenseNumber,
    expenseDate: exp.expenseDate?.toISOString(),
    category: exp.category,
    accountCode: exp.accountCode,
    accountName: exp.accountName,
    amount: exp.amount,
    taxAmount: exp.taxAmount || 0,
    withholdingTax: exp.withholdingTax || 0,
    total: exp.total,
    currency: exp.currency,
    paymentMethod: exp.paymentMethod,
    vendor: exp.vendor
      ? {
          id: exp.vendor.id,
          name: exp.vendor.name,
          taxPin: exp.vendor.taxPin,
        }
      : null,
    description: exp.description,
    reference: exp.reference,
    status: exp.status,
    isReimbursable: exp.isReimbursable,
    employeeName: exp.employeeName,
    hasReceipts: exp.receipts?.length > 0,
    createdBy: exp.createdBy,
    approvedBy: exp.approvedBy,
    approvedAt: exp.approvedAt?.toISOString(),
  }));

  return {
    expenses: serializedExpenses,
    pagination: {
      page,
      totalPages: Math.ceil(total / ITEMS_PER_PAGE),
      total,
      hasMore: skip + expenses.length < total,
    },
  };
}

/**
 * Get expense by ID
 */
export async function getExpenseById(expenseId) {
  // Validate ObjectId format
  if (!expenseId || !ObjectId.isValid(expenseId)) {
    return null;
  }

  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const query = withTenantScope({ _id: expenseId }, companyId, isSuperAdmin);
  const expense = await Expense.findOne(query).lean();

  if (!expense) return null;

  return {
    _id: expense._id.toString(),
    companyId: expense.companyId?.toString(),
    expenseNumber: expense.expenseNumber,
    expenseDate: expense.expenseDate?.toISOString(),
    category: expense.category,
    accountId: expense.accountId?.toString(),
    accountCode: expense.accountCode,
    accountName: expense.accountName,
    amount: expense.amount,
    taxAmount: expense.taxAmount || 0,
    taxRate: expense.taxRate || 0,
    withholdingTax: expense.withholdingTax || 0,
    subtotal: expense.subtotal,
    total: expense.total,
    currency: expense.currency,
    paymentMethod: expense.paymentMethod,
    paidFrom: expense.paidFrom?.toString(),
    paidAt: expense.paidAt?.toISOString(),
    vendor: expense.vendor,
    description: expense.description,
    reference: expense.reference,
    invoiceNumber: expense.invoiceNumber,
    receipts:
      expense.receipts?.map((r) => ({
        filename: r.filename,
        url: r.url,
        uploadedAt: r.uploadedAt?.toISOString(),
      })) || [],
    isReimbursable: expense.isReimbursable,
    employeeId: expense.employeeId,
    employeeName: expense.employeeName,
    reimbursedAt: expense.reimbursedAt?.toISOString(),
    status: expense.status,
    submittedAt: expense.submittedAt?.toISOString(),
    submittedBy: expense.submittedBy,
    approvedAt: expense.approvedAt?.toISOString(),
    approvedBy: expense.approvedBy,
    rejectedAt: expense.rejectedAt?.toISOString(),
    rejectedBy: expense.rejectedBy,
    rejectionReason: expense.rejectionReason,
    journalEntryId: expense.journalEntryId?.toString(),
    isRecurring: expense.isRecurring,
    recurringFrequency: expense.recurringFrequency,
    notes: expense.notes,
    createdBy: expense.createdBy,
    createdAt: expense.createdAt?.toISOString(),
    updatedAt: expense.updatedAt?.toISOString(),
  };
}

/**
 * Get pending expenses for approval
 */
export async function getPendingExpenses() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const query = withTenantScope({ status: "pending" }, companyId, isSuperAdmin);

  const expenses = await Expense.find(query).sort({ submittedAt: -1 }).lean();

  return expenses.map((exp) => ({
    _id: exp._id.toString(),
    expenseNumber: exp.expenseNumber,
    expenseDate: exp.expenseDate?.toISOString(),
    category: exp.category,
    amount: exp.amount,
    total: exp.total,
    vendor: exp.vendor?.name,
    description: exp.description,
    submittedBy: exp.submittedBy,
    submittedAt: exp.submittedAt?.toISOString(),
    isReimbursable: exp.isReimbursable,
    employeeName: exp.employeeName,
    hasReceipts: exp.receipts?.length > 0,
  }));
}

/**
 * Get expense summary/stats
 */
export async function getExpenseSummary(startDate = null, endDate = null) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  // Default to current month
  if (!startDate || !endDate) {
    const now = new Date();
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  }

  const tenantMatch = isSuperAdmin
    ? {}
    : { companyId: new ObjectId(companyId) };

  const [byStatus, byCategory, totals] = await Promise.all([
    // Count by status
    Expense.aggregate([
      { $match: { ...tenantMatch } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          total: { $sum: "$total" },
        },
      },
    ]),

    // Sum by category for the period
    Expense.aggregate([
      {
        $match: {
          ...tenantMatch,
          status: "paid",
          expenseDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
        },
      },
      {
        $group: {
          _id: "$category",
          total: { $sum: "$total" },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ]),

    // Overall totals for the period
    Expense.aggregate([
      {
        $match: {
          ...tenantMatch,
          status: "paid",
          expenseDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
        },
      },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: "$total" },
          totalTax: { $sum: "$taxAmount" },
          totalWHT: { $sum: "$withholdingTax" },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  // Transform results
  const statusCounts = {};
  byStatus.forEach((s) => {
    statusCounts[s._id] = { count: s.count, total: s.total };
  });

  const categoryBreakdown = byCategory.map((c) => ({
    category: c._id,
    total: c.total,
    count: c.count,
  }));

  const periodTotals = totals[0] || {
    totalAmount: 0,
    totalTax: 0,
    totalWHT: 0,
    count: 0,
  };

  return {
    period: {
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
    },
    byStatus: statusCounts,
    byCategory: categoryBreakdown,
    totals: periodTotals,
  };
}

/**
 * Get expense categories (for dropdown)
 */
export function getExpenseCategories() {
  return [
    { value: "utilities", label: "Utilities (Water, Electricity, etc.)" },
    { value: "rent", label: "Rent & Lease" },
    { value: "salaries", label: "Salaries & Wages" },
    { value: "transport", label: "Transport & Fuel" },
    { value: "office_supplies", label: "Office Supplies" },
    { value: "insurance", label: "Insurance" },
    { value: "maintenance", label: "Repairs & Maintenance" },
    { value: "marketing", label: "Marketing & Advertising" },
    { value: "legal_professional", label: "Legal & Professional Fees" },
    { value: "bank_charges", label: "Bank Charges" },
    { value: "depreciation", label: "Depreciation" },
    { value: "meals_entertainment", label: "Meals & Entertainment" },
    { value: "telecommunications", label: "Telecommunications" },
    { value: "training", label: "Training & Development" },
    { value: "materials", label: "Materials & Supplies" },
    { value: "subscriptions", label: "Subscriptions & Licenses" },
    { value: "security", label: "Security Services" },
    { value: "cleaning", label: "Cleaning & Janitorial" },
    { value: "licenses_permits", label: "Licenses & Permits" },
    { value: "printing_stationery", label: "Printing & Stationery" },
    { value: "courier_postage", label: "Courier & Postage" },
    { value: "other", label: "Other Expenses" },
  ];
}

/**
 * Get reimbursable expenses for an employee
 */
export async function getReimbursableExpenses(employeeId = null) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  let query = {
    isReimbursable: true,
    status: "approved",
    reimbursedAt: null,
  };

  if (employeeId) {
    query.employeeId = employeeId;
  }

  query = withTenantScope(query, companyId, isSuperAdmin);

  const expenses = await Expense.find(query).sort({ expenseDate: -1 }).lean();

  return expenses.map((exp) => ({
    _id: exp._id.toString(),
    expenseNumber: exp.expenseNumber,
    expenseDate: exp.expenseDate?.toISOString(),
    category: exp.category,
    total: exp.total,
    description: exp.description,
    employeeId: exp.employeeId,
    employeeName: exp.employeeName,
    approvedAt: exp.approvedAt?.toISOString(),
  }));
}

export default {
  getExpenses,
  getExpenseById,
  getPendingExpenses,
  getExpenseSummary,
  getExpenseCategories,
  getReimbursableExpenses,
};
