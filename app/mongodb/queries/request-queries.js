import { StockRequest } from "../../models/requests";
import dbConnect from "../../config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { serializeBsonType } from "@/lib/utils";
import mongoose from "mongoose";

const ObjectId = mongoose.Types.ObjectId;
const ITEMS_PER_PAGE = 10;

// Sanitize search term to prevent ReDoS and NoSQL injection
function sanitizeSearchTerm(term) {
  if (!term) return "";
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 100);
}

// ============================================
// SHARED FILTER BUILDERS
// ============================================

/**
 * Build role-based filter for request visibility.
 *
 * Canonical role names are capitalised. Earlier lowercase comparisons
 * meant `Manager`, `Admin`, `Storekeeper` etc. silently fell through to
 * the "own requests only" branch — managers couldn't see their team's
 * queue, storekeepers couldn't see approved requests waiting to fulfil.
 */
function buildRoleFilter(userRole, userId) {
  if (["SuperAdmin", "Admin", "Manager"].includes(userRole)) {
    return {};
  }

  if (["Store Manager", "Storekeeper"].includes(userRole)) {
    return {
      $or: [
        { status: { $in: ["approved", "fulfilled", "partially_fulfilled"] } },
        { "requester.id": userId },
      ],
    };
  }

  // Regular users can only see their own requests
  return { "requester.id": userId };
}

/**
 * Build additional filters from search params
 */
function buildAdditionalFilters(filters = {}) {
  const { status, priority, requestType, customer, startDate, endDate } = filters;
  const additionalFilters = {};

  if (status && status !== "all") {
    additionalFilters.status = status;
  }

  if (priority && priority !== "all") {
    additionalFilters.priority = priority;
  }

  if (requestType && requestType !== "all") {
    additionalFilters.requestType = requestType;
  }

  if (customer && customer !== "all") {
    additionalFilters["customer.name"] = { $regex: customer, $options: "i" };
  }

  if (startDate || endDate) {
    additionalFilters.createdAt = {};
    if (startDate) {
      additionalFilters.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      const endDateTime = new Date(endDate);
      endDateTime.setDate(endDateTime.getDate() + 1);
      additionalFilters.createdAt.$lt = endDateTime;
    }
  }

  return additionalFilters;
}

/**
 * Build search match stage
 */
function buildSearchMatch(searchTerm, tenantMatch, roleFilter, additionalFilters) {
  const safeSearchTerm = sanitizeSearchTerm(searchTerm);

  // Build the list of non-empty clauses. SuperAdmin with no role
  // restriction and no filters can produce zero clauses — Mongo
  // rejects `$and: []`, so drop the `$and` wrapper entirely in that
  // case and match everything via `$match: {}`.
  const clauses = [tenantMatch, roleFilter, additionalFilters].filter(
    (f) => f && Object.keys(f).length > 0,
  );

  // Require ≥2 chars before triggering the 5-field $regex OR scan.
  if (safeSearchTerm && safeSearchTerm.length >= 2) {
    clauses.push({
      $or: [
        { "requester.name": { $regex: safeSearchTerm, $options: "i" } },
        { "requester.department": { $regex: safeSearchTerm, $options: "i" } },
        { requestNumber: { $regex: safeSearchTerm, $options: "i" } },
        { "customer.name": { $regex: safeSearchTerm, $options: "i" } },
        { "items.productName": { $regex: safeSearchTerm, $options: "i" } },
      ],
    });
  }

  if (clauses.length === 0) return { $match: {} };
  if (clauses.length === 1) return { $match: clauses[0] };
  return { $match: { $and: clauses } };
}

// ============================================
// QUERY FUNCTIONS
// ============================================

/**
 * Get total pages for request pagination
 */
export async function fetchRequestPages(searchTerm, userId, userRole, filters = {}) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const roleFilter = buildRoleFilter(userRole, userId);
  const additionalFilters = buildAdditionalFilters(filters);
  const matchStage = buildSearchMatch(searchTerm, tenantMatch, roleFilter, additionalFilters);

  const result = await StockRequest.aggregate([
    matchStage,
    { $count: "totalRecords" },
  ]);

  const count = result[0]?.totalRecords || 0;
  return Math.ceil(count / ITEMS_PER_PAGE);
}

/**
 * Search and retrieve requests with pagination
 */
export async function searchRequests(searchTerm, page = 1, userId, userRole, filters = {}) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const roleFilter = buildRoleFilter(userRole, userId);
  const additionalFilters = buildAdditionalFilters(filters);
  const matchStage = buildSearchMatch(searchTerm, tenantMatch, roleFilter, additionalFilters);

  const skipRecords = (page - 1) * ITEMS_PER_PAGE;

  const result = await StockRequest.aggregate([
    matchStage,
    { $sort: { createdAt: -1 } },
    { $skip: skipRecords },
    { $limit: ITEMS_PER_PAGE },
  ]);

  return serializeBsonType(result);
}

/**
 * Get a single request by ID
 */
export async function getRequestById(requestId) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();

  const request = await StockRequest.findById(requestId).lean();

  if (!request) return null;

  // Validate tenant access
  if (!isSuperAdmin && request.companyId?.toString() !== companyId) {
    return null;
  }

  return serializeBsonType(request);
}

/**
 * Get requests pending approval (for managers)
 */
export async function getPendingApprovalRequests(limit = 10) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const result = await StockRequest.aggregate([
    {
      $match: {
        ...tenantMatch,
        status: "pending",
      },
    },
    { $sort: { priority: -1, createdAt: 1 } },
    { $limit: limit },
  ]);

  return serializeBsonType(result);
}

/**
 * Get requests pending fulfillment (for store managers)
 */
export async function getPendingFulfillmentRequests(limit = 10) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const result = await StockRequest.aggregate([
    {
      $match: {
        ...tenantMatch,
        status: { $in: ["approved", "partially_fulfilled"] },
      },
    },
    { $sort: { priority: -1, createdAt: 1 } },
    { $limit: limit },
  ]);

  return serializeBsonType(result);
}

/**
 * Get requests by customer ID
 */
export async function getRequestsByCustomer(customerId, status = null, limit = 20) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const match = {
    ...tenantMatch,
    "customer.id": customerId,
  };

  if (status) {
    match.status = status;
  }

  const result = await StockRequest.find(match)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return serializeBsonType(result);
}

/**
 * Get requests by requester (user)
 */
export async function getRequestsByRequester(requesterId, status = null, limit = 20) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const match = {
    ...tenantMatch,
    "requester.id": requesterId,
  };

  if (status) {
    match.status = status;
  }

  const result = await StockRequest.find(match)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return serializeBsonType(result);
}

/**
 * Get request statistics
 */
export async function getRequestStats() {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [statusCounts, monthlyCount, urgentCount, overdueCount] = await Promise.all([
    // Status breakdown
    StockRequest.aggregate([
      { $match: tenantMatch },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    // This month's requests
    StockRequest.countDocuments({
      ...tenantMatch,
      createdAt: { $gte: startOfMonth },
    }),
    // Urgent/high priority pending
    StockRequest.countDocuments({
      ...tenantMatch,
      priority: { $in: ["high", "urgent"] },
      status: { $in: ["pending", "approved", "partially_fulfilled"] },
    }),
    // Overdue requests
    StockRequest.countDocuments({
      ...tenantMatch,
      requiredByDate: { $lt: now },
      status: { $in: ["pending", "approved", "partially_fulfilled"] },
    }),
  ]);

  const statusMap = {
    pending: 0,
    approved: 0,
    rejected: 0,
    fulfilled: 0,
    partially_fulfilled: 0,
    cancelled: 0,
    invoiced: 0,
  };

  statusCounts.forEach((item) => {
    if (item._id in statusMap) {
      statusMap[item._id] = item.count;
    }
  });

  return {
    ...statusMap,
    total: Object.values(statusMap).reduce((a, b) => a + b, 0),
    monthlyCount,
    urgentCount,
    overdueCount,
  };
}

/**
 * Get requests by type with optional status filter
 */
export async function getRequestsByType(requestType, status = null, page = 1) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const match = {
    ...tenantMatch,
    requestType,
  };

  if (status) {
    match.status = status;
  }

  const skipRecords = (page - 1) * ITEMS_PER_PAGE;

  const result = await StockRequest.find(match)
    .sort({ createdAt: -1 })
    .skip(skipRecords)
    .limit(ITEMS_PER_PAGE)
    .lean();

  return serializeBsonType(result);
}

/**
 * Get recent requests (for dashboard widgets)
 */
export async function getRecentRequests(limit = 5) {
  await dbConnect();

  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const result = await StockRequest.find(tenantMatch)
    .sort({ createdAt: -1 })
    .limit(limit)
    .select("requestNumber requestType requester customer status priority items totalValue createdAt")
    .lean();

  return serializeBsonType(result.map((req) => ({
    ...req,
    itemCount: req.items?.length || 0,
  })));
}
