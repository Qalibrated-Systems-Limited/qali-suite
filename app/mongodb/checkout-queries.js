import { ItemCheckout } from "../models/checkouts";
import mongoose from "mongoose";

const ITEMS_PER_PAGE = 20;

// ============================================
// FETCH CHECKOUTS WITH FILTERS
// ============================================
export const fetchCheckoutPages = async (searchTerm, filters = {}) => {
  const { status, dueStatus } = filters;

  // Build filter conditions
  let additionalFilters = {};

  // Status filter
  if (status && status !== "all") {
    additionalFilters.status = status;
  }

  // Due status filter
  if (dueStatus && dueStatus !== "all") {
    const now = new Date();
    switch (dueStatus) {
      case "due-soon":
        // Due within 3 days
        const threeDaysFromNow = new Date(
          now.getTime() + 3 * 24 * 60 * 60 * 1000
        );
        additionalFilters.expectedReturnDate = {
          $gte: now,
          $lte: threeDaysFromNow,
        };
        additionalFilters.status = "checked_out";
        break;
      case "overdue":
        additionalFilters.expectedReturnDate = { $lt: now };
        additionalFilters.status = "checked_out";
        break;
    }
  }

  const transactionSearchStage = {
    $match: {
      $and: [
        additionalFilters,
        {
          $or: [
            { checkoutNumber: { $regex: searchTerm, $options: "i" } },
            { "checkedOutTo.name": { $regex: searchTerm, $options: "i" } },
            {
              "checkedOutTo.department": { $regex: searchTerm, $options: "i" },
            },
            { "productSnapshot.name": { $regex: searchTerm, $options: "i" } },
            { "productSnapshot.SKU": { $regex: searchTerm, $options: "i" } },
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

  const result = await ItemCheckout.aggregate(pipeline);

  let count = 0;
  if (result && result.length > 0) {
    count = result[0].totalRecords;
  }

  const noOfPages = Math.ceil(Number(count) / ITEMS_PER_PAGE);

  return noOfPages;
};

// ============================================
// SEARCH CHECKOUTS WITH PAGINATION
// ============================================
export const searchCheckouts = async (searchTerm, page = 1, filters = {}) => {
  const { status, dueStatus } = filters;
  const skipRecords = (page - 1) * ITEMS_PER_PAGE;

  // Build filter conditions
  let additionalFilters = {};

  // Status filter
  if (status && status !== "all") {
    additionalFilters.status = status;
  }

  // Due status filter
  if (dueStatus && dueStatus !== "all") {
    const now = new Date();
    switch (dueStatus) {
      case "due-soon":
        const threeDaysFromNow = new Date(
          now.getTime() + 3 * 24 * 60 * 60 * 1000
        );
        additionalFilters.expectedReturnDate = {
          $gte: now,
          $lte: threeDaysFromNow,
        };
        additionalFilters.status = "checked_out";
        break;
      case "overdue":
        additionalFilters.expectedReturnDate = { $lt: now };
        additionalFilters.status = "checked_out";
        break;
    }
  }

  const searchStage = {
    $match: {
      $and: [
        additionalFilters,
        {
          $or: [
            { checkoutNumber: { $regex: searchTerm, $options: "i" } },
            { "checkedOutTo.name": { $regex: searchTerm, $options: "i" } },
            {
              "checkedOutTo.department": { $regex: searchTerm, $options: "i" },
            },
            { "productSnapshot.name": { $regex: searchTerm, $options: "i" } },
            { "productSnapshot.SKU": { $regex: searchTerm, $options: "i" } },
          ],
        },
      ],
    },
  };

  const baseFilterStage = {
    $match: additionalFilters,
  };

  const paginationStage = [{ $skip: skipRecords }, { $limit: ITEMS_PER_PAGE }];

  const sortStage = { $sort: { checkoutDate: -1 } };

  let pipeline = [baseFilterStage, sortStage, ...paginationStage];

  if (searchTerm && searchTerm.length > 0) {
    pipeline = [searchStage, sortStage, ...paginationStage];
  }

  let result = await ItemCheckout.aggregate(pipeline);

  // Transform result for client consumption
  result = result.map((checkout) => {
    // Calculate days overdue/until due
    const now = new Date();
    let daysOverdue = 0;
    let daysUntilDue = null;

    if (checkout.status === "checked_out" && checkout.expectedReturnDate) {
      const diff = now - new Date(checkout.expectedReturnDate);
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      daysOverdue = days > 0 ? days : 0;
      daysUntilDue = Math.ceil(
        (new Date(checkout.expectedReturnDate) - now) / (1000 * 60 * 60 * 24)
      );
    }

    return {
      ...checkout,
      _id: checkout._id.toString(),
      productId: checkout.productId.toString(),
      checkoutDate: checkout.checkoutDate.toISOString(),
      expectedReturnDate: checkout.expectedReturnDate?.toISOString() || null,
      actualReturnDate: checkout.actualReturnDate?.toISOString() || null,
      returnedDate: checkout.returnedDate?.toISOString() || null,
      createdAt: checkout.createdAt?.toISOString() || null,
      updatedAt: checkout.updatedAt?.toISOString() || null,
      daysOverdue,
      daysUntilDue,
      isOverdue: daysOverdue > 0,
      // Transform nested documents
      relatedDocuments: {
        requestId: checkout.relatedDocuments?.requestId?.toString() || null,
        movementId: checkout.relatedDocuments?.movementId?.toString() || null,
        returnMovementId:
          checkout.relatedDocuments?.returnMovementId?.toString() || null,
      },
    };
  });

  return result;
};

// ============================================
// GET CHECKOUT STATS
// ============================================
export const getCheckoutStats = async () => {
  const now = new Date();
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const [total, active, overdue, dueSoon, returned] = await Promise.all([
    ItemCheckout.countDocuments(),
    ItemCheckout.countDocuments({ status: "checked_out" }),
    ItemCheckout.countDocuments({
      status: "checked_out",
      expectedReturnDate: { $lt: now },
    }),
    ItemCheckout.countDocuments({
      status: "checked_out",
      expectedReturnDate: { $gte: now, $lte: threeDaysFromNow },
    }),
    ItemCheckout.countDocuments({ status: "returned" }),
  ]);

  return {
    total,
    active,
    overdue,
    dueSoon,
    returned,
  };
};

// ============================================
// GET SINGLE CHECKOUT BY ID
// ============================================
export const getCheckoutById = async (checkoutId) => {
  const checkout = await ItemCheckout.findById(checkoutId).lean();

  if (!checkout) {
    return null;
  }

  const now = new Date();
  let daysOverdue = 0;
  let daysUntilDue = null;

  if (checkout.status === "checked_out" && checkout.expectedReturnDate) {
    const diff = now - new Date(checkout.expectedReturnDate);
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    daysOverdue = days > 0 ? days : 0;
    daysUntilDue = Math.ceil(
      (new Date(checkout.expectedReturnDate) - now) / (1000 * 60 * 60 * 24)
    );
  }

  return {
    ...checkout,
    _id: checkout._id.toString(),
    productId: checkout.productId.toString(),
    checkoutDate: checkout.checkoutDate.toISOString(),
    expectedReturnDate: checkout.expectedReturnDate?.toISOString() || null,
    actualReturnDate: checkout.actualReturnDate?.toISOString() || null,
    returnedDate: checkout.returnedDate?.toISOString() || null,
    createdAt: checkout.createdAt?.toISOString() || null,
    updatedAt: checkout.updatedAt?.toISOString() || null,
    daysOverdue,
    daysUntilDue,
    isOverdue: daysOverdue > 0,
  };
};

// ============================================
// GET USER CHECKOUTS
// ============================================
export const getUserCheckouts = async (userId, activeOnly = false) => {
  const query = { "checkedOutTo.id": userId };

  if (activeOnly) {
    query.status = { $in: ["checked_out", "overdue"] };
  }

  const checkouts = await ItemCheckout.find(query)
    .sort({ checkoutDate: -1 })
    .lean();

  return checkouts.map((checkout) => ({
    ...checkout,
    _id: checkout._id.toString(),
    productId: checkout.productId.toString(),
    checkoutDate: checkout.checkoutDate.toISOString(),
    expectedReturnDate: checkout.expectedReturnDate?.toISOString() || null,
    actualReturnDate: checkout.actualReturnDate?.toISOString() || null,
  }));
};

// ============================================
// GENERATE CHECKOUT NUMBER
// ============================================
export const generateCheckoutNumber = async (session = null) => {
  const { format } = await import("date-fns");
  const { Counter } = await import("../models/counter");

  const today = format(new Date(), "ddMMyy");
  const counterId = `CHK-${today}`;

  const counter = await Counter.findOneAndUpdate(
    { name: counterId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session }
  );

  if (!counter) {
    throw new Error("Failed to generate checkout number");
  }

  return `${counterId}-${String(counter.seq).padStart(3, "0")}`;
};
