import mongoose from "mongoose";
import Project from "../../models/project";
import ProjectBudget from "../../models/projectBudget";
import ProjectCostCode from "../../models/projectCostCode";
import ProjectAssignment from "../../models/projectAssignment";
import {
  getProjectClaimTotalsPg,
  getProjectClaimsByAccountPg,
  listClaimsPg,
} from "@/app/db/actions/claim-actions";
import Invoice from "../../models/invoice";
import Bill from "../../models/bill";
import { sumCreditForInvoicesPg } from "@/app/db/actions/credit-note-actions";
import {
  getProjectExpenseTotalsPg,
  getProjectExpensesByAccountPg,
  listProjectExpensesPg,
} from "@/app/db/actions/expense-actions";
import { StockRequest } from "../../models/requests";
import { StockMovement } from "../../models/stockmovement";
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
// GET PROJECT ASSIGNMENTS (the labor roster)
// ============================================
// Active + inactive members of a project (excludes soft-removed). Tenant-scoped.
export const getProjectAssignments = async (projectId) => {
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) return [];

  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const assignments = await ProjectAssignment.find({
    ...tenantMatch,
    projectId: new ObjectId(projectId),
    status: { $ne: "removed" },
  })
    .sort({ status: 1, "party.name": 1 })
    .lean();

  return serializeBsonType(assignments);
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

  return computeProjectActuals(
    new mongoose.Types.ObjectId(projectId),
    tenantMatch,
  );
};

// ============================================
// COMPUTE PROJECT ACTUALS — single source of truth
// ============================================
// The authoritative { revenue, costs, committed } for a project, aggregated
// live from source documents. Used by the detail view AND by
// recomputeProjectFinancials() so the displayed numbers and the cached
// counters can never disagree by construction.
//
// `pid` must be an ObjectId; `tenantMatch` is {} for SuperAdmin or
// { companyId: ObjectId } otherwise.
export const computeProjectActuals = async (pid, tenantMatch) => {
  // This project's recognised invoices — needed both for revenue and to net
  // the credit notes raised against them (credit notes reference the invoice,
  // not the project, so we match by these ids).
  const projectInvoiceIds = await Invoice.find({
    ...tenantMatch,
    projectId: pid,
    status: { $in: ["completed", "posted"] },
  }).distinct("_id");

  const [
    claimTotals,
    revenuePipeline,
    creditNotes,
    billCosts, billCommitted,
    expenseTotals,
    requestCommitted,
    invoiceCOGS,
    returnedCOGS,
  ] = await Promise.all([
    // Claims come from Postgres since the port — the Mongo collection is no
    // longer written to, so aggregating it would zero every project's claim
    // spend. Settlements stay excluded: an advance_return reconciles an
    // advance whose cost was counted when it was paid.
    getProjectClaimTotalsPg(String(pid)),
    // Revenue from invoices
    Invoice.aggregate([
      { $match: { ...tenantMatch, projectId: pid, status: { $in: ["completed", "posted"] } } },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]),
    // Credit notes raised against this project's invoices — REVERSE revenue.
    // issued + applied are economically real; draft/void are not.
    // Postgres since §9L. The Mongo CreditNote collection is no longer
    // written to, so this returned nothing and every project's revenue was
    // overstated by whatever had been credited back.
    sumCreditForInvoicesPg(projectInvoiceIds.map(String)),
    // Bill costs (paid) — exclude cancelled bills that were paid before cancellation
    Bill.aggregate([
      { $match: { ...tenantMatch, projectId: pid, paymentStatus: "paid", status: { $ne: "cancelled" } } },
      { $group: { _id: null, total: { $sum: "$amounts.netPayable" } } },
    ]),
    // Bill committed (approved but not paid)
    Bill.aggregate([
      { $match: { ...tenantMatch, projectId: pid, status: "approved", paymentStatus: { $ne: "paid" } } },
      { $group: { _id: null, total: { $sum: "$amounts.netPayable" } } },
    ]),
    /**
     * Expense actual and committed, from Postgres (0059), in one query.
     *
     * The committed half NEVER WORKED. It asked for `status: "approved"` — a
     * legacy status the one-step flow stopped producing — so a project's
     * committed cost from expenses has always been zero, and its variance
     * against budget wrong by exactly the accruals. Committed is now what it
     * means: posted and not yet paid.
     */
    getProjectExpenseTotalsPg(String(pid)),
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
    // Returned COGS — restoreInventory credit notes record a posted "return"
    // StockMovement against the original invoice. The returned cost must come
    // back OUT of project cost (the original COGS is still in invoiceCOGS).
    StockMovement.aggregate([
      { $match: { ...tenantMatch, "relatedDocuments.invoiceId": { $in: projectInvoiceIds }, movementType: "return", status: "posted" } },
      { $group: { _id: null, total: { $sum: "$costing.totalCost" } } },
    ]),
  ]);
  // NB: petty cash spend is NOT aggregated here — it is recorded as Expenses
  // (paid from the petty cash account) which are already counted above via
  // expenseCosts. Counting petty cash separately would double-count.

  const revenue = Math.max(
    0,
    // A string from numeric(19,4), not a one-element aggregate array.
    (revenuePipeline[0]?.total || 0) - Number(creditNotes || 0),
  );

  const costs = Math.max(
    0,
    claimTotals.actual +
      (billCosts[0]?.total || 0) +
      Number(expenseTotals?.paid || 0) +
      (invoiceCOGS[0]?.total || 0) -
      (returnedCOGS[0]?.total || 0),
  );

  return {
    costs,
    committed:
      claimTotals.committed +
      (billCommitted[0]?.total || 0) +
      Number(expenseTotals?.committed || 0) +
      (requestCommitted[0]?.total || 0),
    revenue,
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
    claimsByAccount,
    billActuals, billCommitted,
    expenseByAccount,
  ] = await Promise.all([
    // One call for both arms; the $unwind is a GROUP BY now that items are rows.
    getProjectClaimsByAccountPg(String(projectId)),
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
    // Expenses per account, actual and committed together. Same two fixes as
    // above: `status: "approved"` never matched anything, and this summed
    // `amount` where the cost that hits the account is `total`.
    getProjectExpensesByAccountPg(String(pid)),
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

  addToMap(actualMap, claimsByAccount.actuals);
  addToMap(actualMap, billActuals);

  addToMap(committedMap, claimsByAccount.committed);
  addToMap(committedMap, billCommitted);

  // Postgres rows: `accountId` rather than `_id`, and both halves in one row.
  for (const e of expenseByAccount) {
    if (!e.accountId) continue;
    const key = String(e.accountId);
    actualMap[key] = (actualMap[key] || 0) + Number(e.actual || 0);
    committedMap[key] = (committedMap[key] || 0) + Number(e.committed || 0);
  }

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
    const { claims } = await listClaimsPg({ projectId: String(projectId), limit });
    results.claims = claims;
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
    results.expenses = await listProjectExpensesPg(String(pid), limit);
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
