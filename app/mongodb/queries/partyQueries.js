import Party from "../../models/parties";
import JournalEntry from "../../models/JournalEntry";
import Account from "../../models/account";
import connectDB from "../../config/dbConnect";
import { unstable_noStore as noStore } from "next/cache";
import User from "@/app/models/user";
import {
  getTenantContext,
  withTenantScope,
  withTenantPipeline,
} from "@/lib/utils/tenant-utils";
import { ObjectId } from "mongodb";
import { serializeBsonType } from "@/lib/utils";

const ITEMS_PER_PAGE = 20;

// ============================================
// PARTY QUERIES - FOLLOWING YOUR PATTERN
// ============================================

/**
 * Get paginated parties (following stock pattern)
 * @param {string} searchTerm - Search query
 * @param {number} page - Page number
 * @param {string} type - Party type filter
 * @returns {array} Parties
 */
export async function getPartiesPaginated(
  searchTerm = "",
  page = 1,
  type = null,
) {
  noStore();
  await connectDB();

  // Get tenant context for scoping
  const { companyId, isSuperAdmin } = await getTenantContext();

  const skipRecords = (page - 1) * ITEMS_PER_PAGE;

  // Build filter query with tenant scope
  let matchQuery = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  // Type filter
  if (type) {
    if (type === "customer") {
      matchQuery.type = { $in: ["customer", "both"] };
    } else if (type === "supplier") {
      matchQuery.type = { $in: ["supplier", "both"] };
    } else if (type === "employee") {
      matchQuery.type = "employee";
    } else {
      matchQuery.type = type;
    }
  }

  // Search filter
  if (searchTerm && searchTerm.length > 0) {
    matchQuery.$or = [
      { name: { $regex: searchTerm, $options: "i" } },
      { displayName: { $regex: searchTerm, $options: "i" } },
      { email: { $regex: searchTerm, $options: "i" } },
      { taxPin: { $regex: searchTerm, $options: "i" } },
      { employeeNumber: { $regex: searchTerm, $options: "i" } },
    ];
  }

  const searchStage = { $match: matchQuery };
  const sortStage = { $sort: { name: 1 } };
  const paginationStage = [{ $skip: skipRecords }, { $limit: ITEMS_PER_PAGE }];

  const pipeline = [searchStage, sortStage, ...paginationStage];

  let result = await Party.aggregate(pipeline);

  result = result.map((res) => ({
    ...res,
    _id: res._id.toString(),
    userId: res.userId ? res.userId.toString() : null,
    createdAt: res.createdAt ? res.createdAt.toISOString() : null,
    updatedAt: res.updatedAt ? res.updatedAt.toISOString() : null,
  }));

  return serializeBsonType(result);
}

/**
 * Get total pages for pagination
 * @param {string} searchTerm - Search query
 * @param {string} type - Party type filter
 * @returns {number} Total pages
 */
export async function fetchPartyPages(searchTerm = "", type = null) {
  noStore();
  await connectDB();

  // Get tenant context for scoping
  const { companyId, isSuperAdmin } = await getTenantContext();

  // Build filter query with tenant scope
  let matchQuery = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  // Type filter
  if (type) {
    if (type === "customer") {
      matchQuery.type = { $in: ["customer", "both"] };
    } else if (type === "supplier") {
      matchQuery.type = { $in: ["supplier", "both"] };
    } else if (type === "employee") {
      matchQuery.type = "employee";
    } else {
      matchQuery.type = type;
    }
  }

  // Search filter
  if (searchTerm && searchTerm.length > 0) {
    matchQuery.$or = [
      { name: { $regex: searchTerm, $options: "i" } },
      { displayName: { $regex: searchTerm, $options: "i" } },
      { email: { $regex: searchTerm, $options: "i" } },
      { taxPin: { $regex: searchTerm, $options: "i" } },
      { employeeNumber: { $regex: searchTerm, $options: "i" } },
    ];
  }

  const searchStage = { $match: matchQuery };
  const countStage = { $count: "totalRecords" };

  const pipeline = [searchStage, countStage];

  const result = await Party.aggregate(pipeline);

  let count = 0;
  if (result && result.length > 0) {
    count = result[0].totalRecords;
  }

  const noOfPages = Math.ceil(Number(count) / ITEMS_PER_PAGE);
  return noOfPages;
}

/**
 * Get party by ID
 * @param {string} partyId - Party ID
 * @returns {object} Party
 */
export async function getPartyById(partyId) {
  await connectDB();

  // Get tenant context for access validation
  const { companyId, isSuperAdmin } = await getTenantContext();

  const party = await Party.findById(partyId).lean();

  if (!party) {
    return null;
  }

  // Validate tenant access
  if (!isSuperAdmin && party.companyId?.toString() !== companyId) {
    return null;
  }

  // Full BSON round-trip — the previous hand-serialization missed any
  // nested ObjectId (linked.parties, account references, audit refs, etc.)
  // and risked client-component boundary errors.
  return serializeBsonType(party);
}

/**
 * Get active customers for dropdowns
 * @param {boolean} activeOnly - Filter active only
 * @returns {array} Customers
 */
export async function getCustomers(activeOnly = true) {
  await connectDB();

  // Get tenant context for scoping
  const { companyId, isSuperAdmin } = await getTenantContext();

  const query = withTenantScope(
    { type: { $in: ["customer", "both"] } },
    companyId,
    isSuperAdmin,
  );

  if (activeOnly) {
    query.isActive = true;
  }

  const customers = await Party.find(query)
    .sort({ name: 1 })
    .select("name displayName email phone taxPin cachedBalance creditTerms")
    .lean();

  return customers.map((c) => ({
    ...c,
    _id: c._id.toString(),
  }));
}

/**
 * Get active suppliers for dropdowns
 * @param {boolean} activeOnly - Filter active only
 * @returns {array} Suppliers
 */
export async function getSuppliers(activeOnly = true) {
  await connectDB();

  // Get tenant context for scoping
  const { companyId, isSuperAdmin } = await getTenantContext();

  const query = withTenantScope(
    { type: { $in: ["supplier", "both"] } },
    companyId,
    isSuperAdmin,
  );

  if (activeOnly) {
    query.isActive = true;
  }

  const suppliers = await Party.find(query)
    .sort({ name: 1 })
    .select(
      "name displayName email phone taxPin cachedBalance paymentDetails whtApplicable whtRate",
    )
    .lean();

  return suppliers.map((s) => ({
    ...s,
    _id: s._id.toString(),
  }));
}

/**
 * Get active employees for dropdowns
 * @param {boolean} activeOnly - Filter active only
 * @returns {array} Employees
 */
export async function getEmployees(activeOnly = true) {
  await connectDB();

  // Get tenant context for scoping
  const { companyId, isSuperAdmin } = await getTenantContext();

  const query = withTenantScope({ type: "employee" }, companyId, isSuperAdmin);

  if (activeOnly) {
    query.isActive = true;
  }

  const employees = await Party.find(query)
    .sort({ name: 1 })
    .select(
      "name displayName email phone userId employeeNumber department designation cachedBalance",
    )
    .lean();

  return employees.map((e) => ({
    ...e,
    _id: e._id.toString(),
    userId: e.userId ? e.userId.toString() : null,
  }));
}

/**
 * Find employee party by user ID
 * @param {string} userId - User ID
 * @returns {object} Employee party record
 */
export async function getEmployeeByUserId(userId) {
  await connectDB();

  // Get tenant context for scoping
  const { companyId, isSuperAdmin } = await getTenantContext();

  const employee = await Party.findOne(
    withTenantScope({ userId, type: "employee" }, companyId, isSuperAdmin),
  ).lean();

  if (!employee) {
    return null;
  }

  return serializeBsonType(employee);
}

/**
 * Get party statistics for dashboard
 * @returns {object} Dashboard statistics
 */
export async function getPartyStats() {
  noStore();
  await connectDB();

  // Get tenant context for scoping
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantFilter = isSuperAdmin ? {} : { companyId };

  const [customers, suppliers, employees, withBalance] = await Promise.all([
    Party.countDocuments({
      ...tenantFilter,
      type: { $in: ["customer", "both"] },
      isActive: true,
    }),

    Party.countDocuments({
      ...tenantFilter,
      type: { $in: ["supplier", "both"] },
      isActive: true,
    }),

    Party.countDocuments({
      ...tenantFilter,
      type: "employee",
      isActive: true,
    }),

    Party.countDocuments({
      ...tenantFilter,
      cachedBalance: { $ne: 0 },
      isActive: true,
    }),
  ]);

  // Get total AR and AP (accounts are also tenant-scoped)
  const [arAccount, apAccount] = await Promise.all([
    Account.findOne(
      withTenantScope(
        { systemAccount: "accounts_receivable" },
        companyId,
        isSuperAdmin,
      ),
    ),
    Account.findOne(
      withTenantScope(
        { systemAccount: "accounts_payable" },
        companyId,
        isSuperAdmin,
      ),
    ),
  ]);

  let totalAR = 0;
  let totalAP = 0;

  if (arAccount) {
    const arResult = await JournalEntry.aggregate(
      withTenantPipeline(
        [
          {
            $match: {
              status: "posted",
              "lines.accountId": arAccount._id,
            },
          },
          { $unwind: "$lines" },
          { $match: { "lines.accountId": arAccount._id } },
          {
            $group: {
              _id: null,
              totalDebit: { $sum: "$lines.debit" },
              totalCredit: { $sum: "$lines.credit" },
            },
          },
        ],
        companyId,
        isSuperAdmin,
      ),
    );

    if (arResult.length > 0) {
      totalAR = arResult[0].totalDebit - arResult[0].totalCredit;
    }
  }

  if (apAccount) {
    const apResult = await JournalEntry.aggregate(
      withTenantPipeline(
        [
          {
            $match: {
              status: "posted",
              "lines.accountId": apAccount._id,
            },
          },
          { $unwind: "$lines" },
          { $match: { "lines.accountId": apAccount._id } },
          {
            $group: {
              _id: null,
              totalDebit: { $sum: "$lines.debit" },
              totalCredit: { $sum: "$lines.credit" },
            },
          },
        ],
        companyId,
        isSuperAdmin,
      ),
    );

    if (apResult.length > 0) {
      totalAP = apResult[0].totalCredit - apResult[0].totalDebit;
    }
  }

  return {
    totalCustomers: customers,
    totalSuppliers: suppliers,
    totalEmployees: employees,
    partiesWithBalance: withBalance,
    totalAR,
    totalAP,
  };
}

/**
 * Search parties for autocomplete (for invoices/bills)
 * @param {string} searchTerm - Search term
 * @param {string} type - "customer", "supplier", or null for all
 * @param {number} limit - Results limit
 * @returns {array} Matching parties
 */
export async function searchParties(searchTerm, type = null, limit = 50) {
  await connectDB();

  // Get tenant context for scoping
  const { companyId, isSuperAdmin } = await getTenantContext();

  const query = withTenantScope({ isActive: true }, companyId, isSuperAdmin);

  if (type) {
    if (type === "customer") {
      query.type = { $in: ["customer", "both"] };
    } else if (type === "supplier") {
      query.type = { $in: ["supplier", "both"] };
    } else if (type === "employee") {
      query.type = "employee";
    }
  }

  if (searchTerm) {
    query.$or = [
      { name: { $regex: searchTerm, $options: "i" } },
      { displayName: { $regex: searchTerm, $options: "i" } },
      { email: { $regex: searchTerm, $options: "i" } },
    ];
  }

  const parties = await Party.find(query)
    .sort({ name: 1 })
    .limit(limit)
    .select("name displayName type email phone cachedBalance")
    .lean();

  return parties.map((p) => ({
    ...p,
    _id: p._id.toString(),
  }));
}

/**
 * Get customers with AR aging report
 * @param {Date} asOfDate - As of date
 * @returns {array} Customers with aging buckets
 */
export async function getCustomersWithAging(asOfDate = new Date()) {
  noStore();
  await connectDB();

  // Get tenant context for scoping
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantFilter = isSuperAdmin ? {} : { companyId };

  const arAccount = await Account.findOne(
    withTenantScope(
      { systemAccount: "accounts_receivable" },
      companyId,
      isSuperAdmin,
    ),
  );

  if (!arAccount) {
    throw new Error("Accounts Receivable account not configured");
  }

  const result = await JournalEntry.aggregate([
    {
      $match: {
        ...tenantFilter,
        status: "posted",
        entryDate: { $lte: new Date(asOfDate) },
        "party.type": "customer",
      },
    },
    { $unwind: "$lines" },
    { $match: { "lines.accountId": arAccount._id } },
    {
      $addFields: {
        amount: {
          $cond: [
            { $gt: ["$lines.debit", 0] },
            "$lines.debit",
            { $multiply: ["$lines.credit", -1] },
          ],
        },
        daysOverdue: {
          $cond: [
            { $ne: ["$dueDate", null] },
            {
              $floor: {
                $divide: [
                  { $subtract: [asOfDate, "$dueDate"] },
                  1000 * 60 * 60 * 24,
                ],
              },
            },
            0,
          ],
        },
      },
    },
    {
      $addFields: {
        agingBucket: {
          $switch: {
            branches: [
              { case: { $lte: ["$daysOverdue", 0] }, then: "current" },
              { case: { $lte: ["$daysOverdue", 30] }, then: "0-30" },
              { case: { $lte: ["$daysOverdue", 60] }, then: "31-60" },
              { case: { $lte: ["$daysOverdue", 90] }, then: "61-90" },
            ],
            default: "90+",
          },
        },
      },
    },
    {
      $group: {
        _id: {
          customerId: "$party.id",
          customerName: "$party.name",
        },
        current: {
          $sum: { $cond: [{ $eq: ["$agingBucket", "current"] }, "$amount", 0] },
        },
        days0_30: {
          $sum: { $cond: [{ $eq: ["$agingBucket", "0-30"] }, "$amount", 0] },
        },
        days31_60: {
          $sum: { $cond: [{ $eq: ["$agingBucket", "31-60"] }, "$amount", 0] },
        },
        days61_90: {
          $sum: { $cond: [{ $eq: ["$agingBucket", "61-90"] }, "$amount", 0] },
        },
        days90plus: {
          $sum: { $cond: [{ $eq: ["$agingBucket", "90+"] }, "$amount", 0] },
        },
        total: { $sum: "$amount" },
      },
    },
    {
      $project: {
        _id: 0,
        customerId: "$_id.customerId",
        customerName: "$_id.customerName",
        current: 1,
        days0_30: 1,
        days31_60: 1,
        days61_90: 1,
        days90plus: 1,
        total: 1,
      },
    },
    { $sort: { total: -1 } },
  ]);

  return result;
}

/**
 * Get suppliers with AP aging report
 * @param {Date} asOfDate - As of date
 * @returns {array} Suppliers with aging buckets
 */
export async function getSuppliersWithAging(asOfDate = new Date()) {
  noStore();
  await connectDB();

  // Get tenant context for scoping
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantFilter = isSuperAdmin ? {} : { companyId };

  const apAccount = await Account.findOne(
    withTenantScope(
      { systemAccount: "accounts_payable" },
      companyId,
      isSuperAdmin,
    ),
  );

  if (!apAccount) {
    throw new Error("Accounts Payable account not configured");
  }

  const result = await JournalEntry.aggregate([
    {
      $match: {
        ...tenantFilter,
        status: "posted",
        entryDate: { $lte: new Date(asOfDate) },
        "party.type": "supplier",
      },
    },
    { $unwind: "$lines" },
    { $match: { "lines.accountId": apAccount._id } },
    {
      $addFields: {
        amount: {
          $cond: [
            { $gt: ["$lines.credit", 0] },
            "$lines.credit",
            { $multiply: ["$lines.debit", -1] },
          ],
        },
        daysOverdue: {
          $cond: [
            { $ne: ["$dueDate", null] },
            {
              $floor: {
                $divide: [
                  { $subtract: [asOfDate, "$dueDate"] },
                  1000 * 60 * 60 * 24,
                ],
              },
            },
            0,
          ],
        },
      },
    },
    {
      $addFields: {
        agingBucket: {
          $switch: {
            branches: [
              { case: { $lte: ["$daysOverdue", 0] }, then: "current" },
              { case: { $lte: ["$daysOverdue", 30] }, then: "0-30" },
              { case: { $lte: ["$daysOverdue", 60] }, then: "31-60" },
              { case: { $lte: ["$daysOverdue", 90] }, then: "61-90" },
            ],
            default: "90+",
          },
        },
      },
    },
    {
      $group: {
        _id: {
          supplierId: "$party.id",
          supplierName: "$party.name",
        },
        current: {
          $sum: { $cond: [{ $eq: ["$agingBucket", "current"] }, "$amount", 0] },
        },
        days0_30: {
          $sum: { $cond: [{ $eq: ["$agingBucket", "0-30"] }, "$amount", 0] },
        },
        days31_60: {
          $sum: { $cond: [{ $eq: ["$agingBucket", "31-60"] }, "$amount", 0] },
        },
        days61_90: {
          $sum: { $cond: [{ $eq: ["$agingBucket", "61-90"] }, "$amount", 0] },
        },
        days90plus: {
          $sum: { $cond: [{ $eq: ["$agingBucket", "90+"] }, "$amount", 0] },
        },
        total: { $sum: "$amount" },
      },
    },
    {
      $project: {
        _id: 0,
        supplierId: "$_id.supplierId",
        supplierName: "$_id.supplierName",
        current: 1,
        days0_30: 1,
        days31_60: 1,
        days61_90: 1,
        days90plus: 1,
        total: 1,
      },
    },
    { $sort: { total: -1 } },
  ]);

  return result;
}

/**
 * Get all active users for linking to employee parties
 * @returns {array} Active users
 */
export async function getUsers() {
  await connectDB();

  // Get tenant context for scoping
  const { companyId, isSuperAdmin } = await getTenantContext();

  const users = await User.find(
    withTenantScope({ status: "Active" }, companyId, isSuperAdmin),
  )
    .select("name email role department")
    .sort({ name: 1 })
    .lean();

  return users.map((user) => ({
    ...user,
    _id: user._id.toString(),
  }));
}
