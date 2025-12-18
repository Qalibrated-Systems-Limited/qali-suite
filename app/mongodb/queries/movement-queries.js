import dbConnect from "../../config/dbConnect";
import { StockMovement } from "../../models/stockmovement";
import Counter from "../../models/counter";

const ITEMS_PER_PAGE = 20;
dbConnect();

// ============================================
// FETCH MOVEMENTS WITH FILTERS (ROLE-BASED)
// ============================================
export const fetchMovementPages = async (
  searchTerm,
  filters = {},
  userId = null,
  userRole = null
) => {
  const { movementType, direction, startDate, endDate } = filters;

  // Build filter conditions
  let additionalFilters = {};

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
            { movementNumber: { $regex: searchTerm, $options: "i" } },
            { "productSnapshot.name": { $regex: searchTerm, $options: "i" } },
            { "productSnapshot.SKU": { $regex: searchTerm, $options: "i" } },
            { "performedBy.name": { $regex: searchTerm, $options: "i" } },
            { "issuedTo.name": { $regex: searchTerm, $options: "i" } },
            { "issuedTo.department": { $regex: searchTerm, $options: "i" } },
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

  if (searchTerm && searchTerm.length > 0) {
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
  userRole = null
) => {
  const { movementType, direction, startDate, endDate } = filters;
  const skipRecords = (page - 1) * ITEMS_PER_PAGE;

  // Build filter conditions
  let additionalFilters = {};

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
            { movementNumber: { $regex: searchTerm, $options: "i" } },
            { "productSnapshot.name": { $regex: searchTerm, $options: "i" } },
            { "productSnapshot.SKU": { $regex: searchTerm, $options: "i" } },
            { "performedBy.name": { $regex: searchTerm, $options: "i" } },
            { "issuedTo.name": { $regex: searchTerm, $options: "i" } },
            { "issuedTo.department": { $regex: searchTerm, $options: "i" } },
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

  if (searchTerm && searchTerm.length > 0) {
    pipeline = [searchStage, sortStage, ...paginationStage];
  }

  let result = await StockMovement.aggregate(pipeline);

  // Transform result for client consumption
  result = result.map((movement) => ({
    ...movement,
    _id: movement._id.toString(),
    productId: movement.productId.toString(),
    createdAt: movement.createdAt.toISOString(),
    updatedAt: movement.updatedAt?.toISOString() || null,
    expectedReturnDate: movement.expectedReturnDate?.toISOString() || null,
    actualReturnDate: movement.actualReturnDate?.toISOString() || null,
    totalValue:
      movement.totalValue || movement.quantity * (movement.unitPrice || 0),
    relatedDocuments: {
      requestId: movement.relatedDocuments?.requestId?.toString() || null,
      invoiceId: movement.relatedDocuments?.invoiceId?.toString() || null,
      checkoutId: movement.relatedDocuments?.checkoutId?.toString() || null,
      purchaseOrderId:
        movement.relatedDocuments?.purchaseOrderId?.toString() || null,
    },
  }));

  return result;
};

// ============================================
// GET MOVEMENT STATS WITH TOTAL VALUES (ROLE-BASED)
// ============================================
export const getMovementStats = async (
  filters = {},
  userId = null,
  userRole = null
) => {
  const { movementType, direction, startDate, endDate } = filters;

  // Build filter conditions
  let matchConditions = {};

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
              { $multiply: ["$quantity", { $ifNull: ["$unitPrice", 0] }] },
              0,
            ],
          },
        },
        totalValueOut: {
          $sum: {
            $cond: [
              { $eq: ["$direction", "out"] },
              { $multiply: ["$quantity", { $ifNull: ["$unitPrice", 0] }] },
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
  const movement = await StockMovement.findById(movementId).lean();

  if (!movement) {
    return null;
  }

  return {
    ...movement,
    _id: movement._id.toString(),
    productId: movement.productId.toString(),
    createdAt: movement.createdAt.toISOString(),
    updatedAt: movement.updatedAt?.toISOString() || null,
    expectedReturnDate: movement.expectedReturnDate?.toISOString() || null,
    actualReturnDate: movement.actualReturnDate?.toISOString() || null,
    totalValue:
      movement.totalValue || movement.quantity * (movement.unitPrice || 0),
  };
};

// ============================================
// GET PRODUCT MOVEMENT HISTORY
// ============================================
export const getProductMovementHistory = async (productId, limit = 50) => {
  const movements = await StockMovement.find({ productId })
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
    { upsert: true, new: true, session }
  );

  if (!counter) {
    throw new Error("Failed to generate movement number");
  }

  return `${counterId}-${String(counter.seq).padStart(3, "0")}`;
};
