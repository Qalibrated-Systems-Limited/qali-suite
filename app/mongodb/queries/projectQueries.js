import mongoose from "mongoose";
import Project from "../../models/project";
import ProjectBudget from "../../models/projectBudget";
import ProjectCostCode from "../../models/projectCostCode";
import EmployeeClaim from "../../models/employeesClaims";
import Invoice from "../../models/invoice";
import Bill from "../../models/bill";
import Expense from "../../models/expenses";
import { StockRequest } from "../../models/requests";
import dbConnect from "../../config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { ObjectId } from "mongodb";
import { serializeBsonType } from "@/lib/utils";

const ITEMS_PER_PAGE = 20;

// ============================================
// FETCH PROJECT PAGES (for pagination)
// ============================================
export const fetchProjectPages = async (searchTerm = "", filters = {}) => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin
    ? {}
    : { companyId: new ObjectId(companyId) };

  const { status, priority } = filters;

  let additionalFilters = {};
  if (status && status !== "all") additionalFilters.status = status;
  if (priority && priority !== "all") additionalFilters.priority = priority;

  const searchStage = {
    $match: {
      $and: [
        tenantMatch,
        additionalFilters,
        ...(searchTerm
          ? [
              {
                $or: [
                  { projectNumber: { $regex: searchTerm, $options: "i" } },
                  { name: { $regex: searchTerm, $options: "i" } },
                  { "client.name": { $regex: searchTerm, $options: "i" } },
                  { "projectManager.name": { $regex: searchTerm, $options: "i" } },
                ],
              },
            ]
          : []),
      ],
    },
  };

  const result = await Project.aggregate([searchStage, { $count: "totalRecords" }]);
  const count = result?.[0]?.totalRecords || 0;
  return Math.ceil(Number(count) / ITEMS_PER_PAGE);
};

// ============================================
// SEARCH PROJECTS WITH PAGINATION
// ============================================
export const searchProjects = async (
  searchTerm = "",
  page = 1,
  filters = {},
) => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin
    ? {}
    : { companyId: new ObjectId(companyId) };

  const { status, priority } = filters;
  const skipRecords = (page - 1) * ITEMS_PER_PAGE;

  let additionalFilters = {};
  if (status && status !== "all") additionalFilters.status = status;
  if (priority && priority !== "all") additionalFilters.priority = priority;

  const matchStage = {
    $match: {
      $and: [
        tenantMatch,
        additionalFilters,
        ...(searchTerm
          ? [
              {
                $or: [
                  { projectNumber: { $regex: searchTerm, $options: "i" } },
                  { name: { $regex: searchTerm, $options: "i" } },
                  { "client.name": { $regex: searchTerm, $options: "i" } },
                  { "projectManager.name": { $regex: searchTerm, $options: "i" } },
                ],
              },
            ]
          : []),
      ],
    },
  };

  const pipeline = [
    matchStage,
    { $sort: { createdAt: -1 } },
    { $skip: skipRecords },
    { $limit: ITEMS_PER_PAGE },
  ];

  const result = await Project.aggregate(pipeline);
  return serializeBsonType(result);
};

// ============================================
// GET PROJECT STATS
// ============================================
export const getProjectStats = async () => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const [total, planning, active, onHold, completed, closed] =
    await Promise.all([
      Project.countDocuments(tenantMatch),
      Project.countDocuments({ ...tenantMatch, status: "planning" }),
      Project.countDocuments({ ...tenantMatch, status: "active" }),
      Project.countDocuments({ ...tenantMatch, status: "on_hold" }),
      Project.countDocuments({ ...tenantMatch, status: "completed" }),
      Project.countDocuments({ ...tenantMatch, status: "closed" }),
    ]);

  // Budget utilization across all active projects
  const budgetStats = await Project.aggregate([
    { $match: { ...tenantMatch, status: { $in: ["active", "on_hold"] } } },
    {
      $group: {
        _id: null,
        totalBudget: { $sum: "$budget.amount" },
        totalCosts: { $sum: "$financials.totalCosts" },
        totalRevenue: { $sum: "$financials.totalRevenue" },
        totalCommitted: { $sum: "$financials.totalCommitted" },
      },
    },
  ]);

  const budget = budgetStats[0] || {
    totalBudget: 0,
    totalCosts: 0,
    totalRevenue: 0,
    totalCommitted: 0,
  };

  return {
    total,
    planning,
    active,
    onHold,
    completed,
    closed,
    totalBudget: budget.totalBudget,
    totalCosts: budget.totalCosts,
    totalRevenue: budget.totalRevenue,
    totalCommitted: budget.totalCommitted,
  };
};

// ============================================
// GET PROJECT BY ID
// ============================================
export const getProjectById = async (projectId) => {
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) return null;

  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const project = await Project.findOne({
    ...tenantMatch,
    _id: new mongoose.Types.ObjectId(projectId),
  }).lean();

  if (!project) return null;
  return serializeBsonType(project);
};

// ============================================
// GET ACTIVE PROJECTS (for picker dropdowns)
// ============================================
export const getActiveProjects = async () => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const projects = await Project.find({
    ...tenantMatch,
    status: { $in: ["planning", "active"] },
  })
    .select("_id projectNumber name budget financials status")
    .sort({ name: 1 })
    .lean();

  return serializeBsonType(projects);
};

// ============================================
// GET PROJECT FINANCIAL SUMMARY (live aggregation)
// ============================================
export const getProjectFinancialSummary = async (projectId) => {
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) return null;

  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const pid = new mongoose.Types.ObjectId(projectId);

  const [
    claimCosts, claimCommitted,
    revenuePipeline,
    billCosts, billCommitted,
    expenseCosts, expenseCommitted,
    requestCommitted,
    invoiceCOGS,
  ] = await Promise.all([
    // Paid claims (actual costs) — exclude settlements (advance_return is reconciliation, cost already counted at advance payment)
    EmployeeClaim.aggregate([
      { $match: { ...tenantMatch, projectId: pid, claimType: { $ne: "advance_return" }, status: { $in: ["paid", "settled"] } } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]),
    // Committed claims (submitted/approved but not paid) — exclude settlements
    EmployeeClaim.aggregate([
      { $match: { ...tenantMatch, projectId: pid, claimType: { $ne: "advance_return" }, status: { $in: ["submitted", "approved"] } } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]),
    // Revenue from invoices
    Invoice.aggregate([
      { $match: { ...tenantMatch, projectId: pid, status: { $in: ["completed", "posted"] } } },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]),
    // Bill costs (paid)
    Bill.aggregate([
      { $match: { ...tenantMatch, projectId: pid, paymentStatus: "paid" } },
      { $group: { _id: null, total: { $sum: "$amounts.netPayable" } } },
    ]),
    // Bill committed (approved but not paid)
    Bill.aggregate([
      { $match: { ...tenantMatch, projectId: pid, status: "approved", paymentStatus: { $ne: "paid" } } },
      { $group: { _id: null, total: { $sum: "$amounts.netPayable" } } },
    ]),
    // Expense costs (paid)
    Expense.aggregate([
      { $match: { ...tenantMatch, projectId: pid, status: "paid" } },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]),
    // Expense committed (approved but not paid)
    Expense.aggregate([
      { $match: { ...tenantMatch, projectId: pid, status: "approved" } },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]),
    // Stock request committed (approved/partially fulfilled)
    StockRequest.aggregate([
      { $match: { ...tenantMatch, projectId: pid, status: { $in: ["approved", "partially_fulfilled"] } } },
      { $group: { _id: null, total: { $sum: "$totalValue" } } },
    ]),
    // Invoice COGS — direct-store items only (tech stock COGS already counted via stock requests)
    Invoice.aggregate([
      { $match: { ...tenantMatch, projectId: pid, status: { $in: ["completed", "posted"] } } },
      { $unwind: "$items" },
      { $match: {
        "items.itemType": "product",
        "items.relatedCheckout.checkoutId": { $exists: false },
        "items.relatedRequest.requestId": { $exists: false },
      }},
      { $group: { _id: null, total: { $sum: "$items.costing.totalCost" } } },
    ]),
  ]);

  return {
    costs: (claimCosts[0]?.total || 0) + (billCosts[0]?.total || 0) + (expenseCosts[0]?.total || 0) + (invoiceCOGS[0]?.total || 0),
    committed: (claimCommitted[0]?.total || 0) + (billCommitted[0]?.total || 0) + (expenseCommitted[0]?.total || 0) + (requestCommitted[0]?.total || 0),
    revenue: revenuePipeline[0]?.total || 0,
  };
};

// ============================================
// GET PROJECT BUDGET VS ACTUAL
// ============================================
export const getProjectBudgetVsActual = async (projectId) => {
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) return null;

  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const pid = new mongoose.Types.ObjectId(projectId);

  // Get approved budget
  const budget = await ProjectBudget.findOne({
    ...tenantMatch,
    projectId: pid,
    status: "approved",
  })
    .sort({ version: -1 })
    .lean();

  if (!budget || !budget.lines?.length) return null;

  // Aggregate actuals and committed from all cost sources per expense account
  const [
    claimActuals, claimCommitted,
    billActuals, billCommitted,
    expenseActuals, expenseCommitted,
  ] = await Promise.all([
    // Claims — paid (actual) — exclude settlements
    EmployeeClaim.aggregate([
      { $match: { ...tenantMatch, projectId: pid, claimType: { $ne: "advance_return" }, status: { $in: ["paid", "settled"] } } },
      { $unwind: "$items" },
      { $group: { _id: "$items.expenseAccountId", total: { $sum: "$items.amount" } } },
    ]),
    // Claims — committed — exclude settlements
    EmployeeClaim.aggregate([
      { $match: { ...tenantMatch, projectId: pid, claimType: { $ne: "advance_return" }, status: { $in: ["submitted", "approved"] } } },
      { $unwind: "$items" },
      { $group: { _id: "$items.expenseAccountId", total: { $sum: "$items.amount" } } },
    ]),
    // Bills — paid (actual) per line account
    Bill.aggregate([
      { $match: { ...tenantMatch, projectId: pid, paymentStatus: "paid" } },
      { $unwind: "$lines" },
      { $group: { _id: "$lines.account.id", total: { $sum: "$lines.amount" } } },
    ]),
    // Bills — committed (approved, not paid) per line account
    Bill.aggregate([
      { $match: { ...tenantMatch, projectId: pid, status: "approved", paymentStatus: { $ne: "paid" } } },
      { $unwind: "$lines" },
      { $group: { _id: "$lines.account.id", total: { $sum: "$lines.amount" } } },
    ]),
    // Expenses — paid (actual) per account
    Expense.aggregate([
      { $match: { ...tenantMatch, projectId: pid, status: "paid" } },
      { $group: { _id: "$accountId", total: { $sum: "$amount" } } },
    ]),
    // Expenses — committed (approved, not paid)
    Expense.aggregate([
      { $match: { ...tenantMatch, projectId: pid, status: "approved" } },
      { $group: { _id: "$accountId", total: { $sum: "$amount" } } },
    ]),
  ]);

  // Merge all sources into maps
  const actualMap = {};
  const committedMap = {};

  const addToMap = (map, entries) => {
    entries.forEach((e) => {
      if (e._id) {
        const key = e._id.toString();
        map[key] = (map[key] || 0) + e.total;
      }
    });
  };

  addToMap(actualMap, claimActuals);
  addToMap(actualMap, billActuals);
  addToMap(actualMap, expenseActuals);

  addToMap(committedMap, claimCommitted);
  addToMap(committedMap, billCommitted);
  addToMap(committedMap, expenseCommitted);

  // Build comparison
  const lines = budget.lines.map((line) => {
    const accountId = line.accountId.toString();
    const actual = actualMap[accountId] || 0;
    const committed = committedMap[accountId] || 0;
    const available = line.amount - actual - committed;
    const percentUsed =
      line.amount > 0 ? Math.round(((actual + committed) / line.amount) * 100) : 0;

    return {
      accountId,
      accountCode: line.accountCode,
      accountName: line.accountName,
      description: line.description,
      budgeted: line.amount,
      actual,
      committed,
      available,
      percentUsed,
    };
  });

  return serializeBsonType({
    budgetId: budget._id,
    version: budget.version,
    totalBudgeted: budget.totalAmount,
    lines,
  });
};

// ============================================
// GET PROJECT TRANSACTIONS
// ============================================
export const getProjectTransactions = async (projectId, type = "all", limit = 20) => {
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) return [];

  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const pid = new mongoose.Types.ObjectId(projectId);

  const results = {};

  if (type === "all" || type === "claims") {
    const claims = await EmployeeClaim.find({
      ...tenantMatch,
      projectId: pid,
    })
      .select(
        "claimNumber claimType status totalAmount employee.name claimDate description",
      )
      .sort({ claimDate: -1 })
      .limit(limit)
      .lean();
    results.claims = serializeBsonType(claims);
  }

  if (type === "all" || type === "invoices") {
    const invoices = await Invoice.find({
      ...tenantMatch,
      projectId: pid,
    })
      .select("invoiceNumber status total customer.name invoiceDate")
      .sort({ invoiceDate: -1 })
      .limit(limit)
      .lean();
    results.invoices = serializeBsonType(invoices);
  }

  if (type === "all" || type === "bills") {
    const bills = await Bill.find({
      ...tenantMatch,
      projectId: pid,
    })
      .select("billNumber status paymentStatus amounts.total amounts.netPayable vendor.name billDate")
      .sort({ billDate: -1 })
      .limit(limit)
      .lean();
    results.bills = serializeBsonType(bills);
  }

  if (type === "all" || type === "expenses") {
    const expenses = await Expense.find({
      ...tenantMatch,
      projectId: pid,
    })
      .select("expenseNumber status total accountName category expenseDate employee.name")
      .sort({ expenseDate: -1 })
      .limit(limit)
      .lean();
    results.expenses = serializeBsonType(expenses);
  }

  if (type === "all" || type === "requests") {
    const requests = await StockRequest.find({
      ...tenantMatch,
      projectId: pid,
    })
      .select("requestNumber requestType status totalValue requester.name createdAt")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    results.requests = serializeBsonType(requests);
  }

  return results;
};

// ============================================
// GET PROJECT BUDGETS (all versions)
// ============================================
export const getProjectBudgets = async (projectId) => {
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) return [];

  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const budgets = await ProjectBudget.find({
    ...tenantMatch,
    projectId: new mongoose.Types.ObjectId(projectId),
  })
    .sort({ version: -1 })
    .lean();

  return serializeBsonType(budgets);
};

// ============================================
// GET COST CODES (company-wide or project-specific)
// ============================================
export const getCostCodes = async (projectId = null) => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const query = { ...tenantMatch, isActive: true };

  // Return company-wide codes + project-specific codes
  if (projectId) {
    query.$or = [
      { projectId: null },
      { projectId: new mongoose.Types.ObjectId(projectId) },
    ];
  } else {
    query.projectId = null;
  }

  const codes = await ProjectCostCode.find(query)
    .sort({ code: 1 })
    .lean();

  return serializeBsonType(codes);
};

// ============================================
// GET ALL COST CODES (for management page, includes inactive)
// ============================================
export const getAllCostCodes = async () => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const codes = await ProjectCostCode.find(tenantMatch)
    .sort({ code: 1 })
    .lean();

  return serializeBsonType(codes);
};

// ============================================
// GET SUBPROJECTS (children of a parent project)
// ============================================
export const getSubprojects = async (parentProjectId) => {
  if (!parentProjectId || !mongoose.Types.ObjectId.isValid(parentProjectId))
    return [];

  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const children = await Project.find({
    ...tenantMatch,
    parentProjectId: new mongoose.Types.ObjectId(parentProjectId),
  })
    .select("_id projectNumber name status budget financials progressPercent")
    .sort({ projectNumber: 1 })
    .lean();

  return serializeBsonType(children);
};

// ============================================
// GET PROJECTS FOR PARENT PICKER (excludes self and own children)
// ============================================
export const getProjectsForParentPicker = async (excludeProjectId = null) => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const query = {
    ...tenantMatch,
    status: { $in: ["planning", "active"] },
  };

  if (excludeProjectId) {
    query._id = { $ne: new mongoose.Types.ObjectId(excludeProjectId) };
  }

  const projects = await Project.find(query)
    .select("_id projectNumber name")
    .sort({ name: 1 })
    .lean();

  return serializeBsonType(projects);
};
