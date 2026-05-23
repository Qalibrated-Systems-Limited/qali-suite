import dbConnect from "../../config/dbConnect";
import { StockMovement } from "../../models/stockmovement";
import Counter from "../../models/counter";
import { sanitizeSearchTerm } from "../../../lib/utils/sanitize";
import { serializeBsonType } from "@/lib/utils";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { ObjectId } from "mongodb";

const ITEMS_PER_PAGE = 20;

// ============================================
// FETCH MOVEMENTS WITH FILTERS (ROLE-BASED)
// ============================================
export const fetchMovementPages = async (
  searchTerm,
  filters = {},
  userId = null,
  userRole = null,
) => {
  await dbConnect();
  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin
    ? {}
    : { companyId: new ObjectId(companyId) };

  const { movementType, direction, startDate, endDate } = filters;

  // Sanitize search term to prevent NoSQL injection
  const safeSearchTerm = sanitizeSearchTerm(searchTerm);

  // Build filter conditions
  let additionalFilters = { ...tenantMatch };

  // Role-based filtering for non-managers
  if (
    userId &&
    userRole !== "Admin" &&
    userRole !== "Store Manager" &&
    userRole !== "manager"
  ) {
    additionalFilters.$or = [
      { "performedBy.id": userId },
      { "issuedTo.id": userId },
      { "receivedBy.id": userId },
    ];
  }

  // Movement type filter
  if (movementType && movementType !== "all") {
    additionalFilters.movementType = movementType;
  }

  // Direction filter
  if (direction && direction !== "all") {
    additionalFilters.direction = direction;
  }

  // Date range filter
  if (startDate || endDate) {
    additionalFilters.createdAt = {};
    if (startDate) {
      additionalFilters.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      // Add one day to include the end date
      const endDateTime = new Date(endDate);
      endDateTime.setDate(endDateTime.getDate() + 1);
      additionalFilters.createdAt.$lt = endDateTime;
    }
  }

  const transactionSearchStage = {
    $match: {
      $and: [
        additionalFilters,
        {
          $or: [
            { movementNumber: { $regex: safeSearchTerm, $options: "i" } },
            {
              "productSnapshot.name": { $regex: safeSearchTerm, $options: "i" },
            },
            {
              "productSnapshot.SKU": { $regex: safeSearchTerm, $options: "i" },
            },
            { "performedBy.name": { $regex: safeSearchTerm, $options: "i" } },
            { "issuedTo.name": { $regex: safeSearchTerm, $options: "i" } },
            {
              "issuedTo.department": { $regex: safeSearchTerm, $options: "i" },
            },
          ],
        },
      ],
    },
  };

  const baseFilterStage = {
    $match: additionalFilters,
  };

  const countStage = {
    $count: "totalRecords",
  };

  let pipeline = [baseFilterStage, countStage];

  // Require at least 2 chars before triggering 6-field $regex OR scan
  // (each field would otherwise do a full COLLSCAN with a single char).
  if (safeSearchTerm && safeSearchTerm.length >= 2) {
    pipeline = [transactionSearchStage, countStage];
  }

  const result = await StockMovement.aggregate(pipeline);

  let count = 0;
  if (result && result.length > 0) {
    count = result[0].totalRecords;
  }

  const noOfPages = Math.ceil(Number(count) / ITEMS_PER_PAGE);

  return noOfPages;
};

// ============================================
// SEARCH MOVEMENTS WITH PAGINATION (ROLE-BASED)
// ============================================
export const searchMovements = async (
  searchTerm,
  page = 1,
  filters = {},
  userId = null,
  userRole = null,
) => {
  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin
    ? {}
    : { companyId: new ObjectId(companyId) };

  const { movementType, direction, startDate, endDate, productId } = filters;
  const skipRecords = (page - 1) * ITEMS_PER_PAGE;

  // Sanitize search term to prevent NoSQL injection
  const safeSearchTerm = sanitizeSearchTerm(searchTerm);

  // Build filter conditions
  let additionalFilters = { ...tenantMatch };

  // Role-based filtering for non-managers
  // Technicians/Users only see movements where they are involved
  if (userId && userRole !== "Admin" && userRole !== "Store Manager") {
    additionalFilters.$or = [
      { "performedBy.id": userId },
      { "issuedTo.id": userId },
      { "receivedBy.id": userId },
    ];
  }

  // Movement type filter
  if (movementType && movementType !== "all") {
    additionalFilters.movementType = movementType;
  }
  if (productId && productId !== "") {
    additionalFilters.productId = productId;
  }

  // Direction filter
  if (direction && direction !== "all") {
    additionalFilters.direction = direction;
  }

  // Date range filter
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

  const searchStage = {
    $match: {
      $and: [
        additionalFilters,
        {
          $or: [
            { movementNumber: { $regex: safeSearchTerm, $options: "i" } },
            {
              "productSnapshot.name": { $regex: safeSearchTerm, $options: "i" },
            },
            {
              "productSnapshot.SKU": { $regex: safeSearchTerm, $options: "i" },
            },
            { "performedBy.name": { $regex: safeSearchTerm, $options: "i" } },
            { "issuedTo.name": { $regex: safeSearchTerm, $options: "i" } },
            {
              "issuedTo.department": { $regex: safeSearchTerm, $options: "i" },
            },
          ],
        },
      ],
    },
  };

  const baseFilterStage = {
    $match: additionalFilters,
  };

  const paginationStage = [{ $skip: skipRecords }, { $limit: ITEMS_PER_PAGE }];

  const sortStage = { $sort: { createdAt: -1 } };

  let pipeline = [baseFilterStage, sortStage, ...paginationStage];

  // Require at least 2 chars before triggering 6-field $regex OR scan
  // (each field would otherwise do a full COLLSCAN with a single char).
  if (safeSearchTerm && safeSearchTerm.length >= 2) {
    pipeline = [searchStage, sortStage, ...paginationStage];
  }

  let result = await StockMovement.aggregate(pipeline);

  // Transform result for client consumption

  return serializeBsonType(result);
};

// ============================================
// GET MOVEMENT STATS WITH TOTAL VALUES (ROLE-BASED)
// ============================================
export const getMovementStats = async (
  filters = {},
  userId = null,
  userRole = null,
) => {
  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin
    ? {}
    : { companyId: new ObjectId(companyId) };

  const { movementType, direction, startDate, endDate } = filters;

  // Build filter conditions
  let matchConditions = { ...tenantMatch };

  // Role-based filtering for non-managers
  if (userId && userRole !== "Admin" && userRole !== "Store Manager") {
    matchConditions.$or = [
      { "performedBy.id": userId },
      { "issuedTo.id": userId },
      { "receivedBy.id": userId },
    ];
  }

  if (movementType && movementType !== "all") {
    matchConditions.movementType = movementType;
  }

  if (direction && direction !== "all") {
    matchConditions.direction = direction;
  }

  if (startDate || endDate) {
    matchConditions.createdAt = {};
    if (startDate) {
      matchConditions.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      const endDateTime = new Date(endDate);
      endDateTime.setDate(endDateTime.getDate() + 1);
      matchConditions.createdAt.$lt = endDateTime;
    }
  }

  const pipeline = [
    { $match: matchConditions },
    {
      $group: {
        _id: null,
        totalMovements: { $sum: 1 },
        totalIn: {
          $sum: {
            $cond: [{ $eq: ["$direction", "in"] }, 1, 0],
          },
        },
        totalOut: {
          $sum: {
            $cond: [{ $eq: ["$direction", "out"] }, 1, 0],
          },
        },
        totalQuantityIn: {
          $sum: {
            $cond: [{ $eq: ["$direction", "in"] }, "$quantity", 0],
          },
        },
        totalQuantityOut: {
          $sum: {
            $cond: [{ $eq: ["$direction", "out"] }, "$quantity", 0],
          },
        },
        totalValueIn: {
          $sum: {
            $cond: [
              { $eq: ["$direction", "in"] },
              { $ifNull: ["$costing.totalValue", { $ifNull: ["$costing.totalCost", 0] }] },
              0,
            ],
          },
        },
        totalValueOut: {
          $sum: {
            $cond: [
              { $eq: ["$direction", "out"] },
              { $ifNull: ["$costing.totalValue", { $ifNull: ["$costing.totalCost", 0] }] },
              0,
            ],
          },
        },
      },
    },
  ];

  const result = await StockMovement.aggregate(pipeline);

  if (result.length === 0) {
    return {
      totalMovements: 0,
      totalIn: 0,
      totalOut: 0,
      totalQuantityIn: 0,
      totalQuantityOut: 0,
      totalValueIn: 0,
      totalValueOut: 0,
      netQuantity: 0,
      netValue: 0,
    };
  }

  const stats = result[0];

  return {
    totalMovements: stats.totalMovements,
    totalIn: stats.totalIn,
    totalOut: stats.totalOut,
    totalQuantityIn: stats.totalQuantityIn,
    totalQuantityOut: stats.totalQuantityOut,
    totalValueIn: stats.totalValueIn,
    totalValueOut: stats.totalValueOut,
    netQuantity: stats.totalQuantityIn - stats.totalQuantityOut,
    netValue: stats.totalValueIn - stats.totalValueOut,
  };
};

// ============================================
// GET MOVEMENT BY ID
// ============================================
export const getMovementById = async (movementId) => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin
    ? {}
    : { companyId: new ObjectId(companyId) };

  const movement = await StockMovement.findOne({
    ...tenantMatch,
    _id: movementId,
  }).lean();

  if (!movement) {
    return null;
  }

  // Use the same full BSON round-trip as the rest of the codebase —
  // hand-serializing only top-level fields leaves nested ObjectIds
  // (companyId, relatedDocuments.*) un-stringified and triggers
  // "Only plain objects can be passed to Client Components" errors
  // when the result is forwarded to a client subtree.
  return {
    ...serializeBsonType(movement),
    totalValue:
      movement.totalValue || movement.quantity * (movement.unitPrice || 0),
  };
};

// ============================================
// GET PRODUCT MOVEMENT HISTORY
// ============================================
export const getProductMovementHistory = async (productId, limit = 50) => {
  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin
    ? {}
    : { companyId: new ObjectId(companyId) };

  const movements = await StockMovement.find({ ...tenantMatch, productId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return movements.map((movement) => ({
    ...movement,
    _id: movement._id.toString(),
    productId: movement.productId.toString(),
    createdAt: movement.createdAt.toISOString(),
    totalValue:
      movement.totalValue || movement.quantity * (movement.unitPrice || 0),
  }));
};

// ============================================
// GENERATE MOVEMENT NUMBER
// ============================================
export const generateMovementNumber = async (session = null) => {
  const { format } = await import("date-fns");

  const today = format(new Date(), "ddMMyy");
  const counterId = `MOV-${today}`;

  const counter = await Counter.findOneAndUpdate(
    { name: counterId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session },
  );

  if (!counter) {
    throw new Error("Failed to generate movement number");
  }

  return `${counterId}-${String(counter.seq).padStart(3, "0")}`;
};
