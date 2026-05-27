import { ItemCheckout } from "../../models/checkouts";
import mongoose from "mongoose";
import { getTenantContext, buildTenantMatch } from "@/lib/utils/tenant-utils";
import { ObjectId } from "mongodb";
import { serializeBsonType } from "@/lib/utils";
import dbConnect from "../../config/dbConnect";

const ITEMS_PER_PAGE = 20;

// ============================================
// FETCH CHECKOUTS WITH FILTERS
// ============================================
export const fetchCheckoutPages = async (searchTerm, filters = {}) => {
  await dbConnect();
  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin
    ? {}
    : { companyId: new ObjectId(companyId) };

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
          now.getTime() + 3 * 24 * 60 * 60 * 1000,
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
        tenantMatch,
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
    $match: { ...tenantMatch, ...additionalFilters },
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
  await dbConnect();
  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin
    ? {}
    : { companyId: new ObjectId(companyId) };

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
          now.getTime() + 3 * 24 * 60 * 60 * 1000,
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
        tenantMatch,
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
    $match: { ...tenantMatch, ...additionalFilters },
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
    let daysHeld = null;

    if (
      ["checked_out", "overdue"].includes(checkout.status) &&
      checkout.expectedReturnDate
    ) {
      const diff = now - new Date(checkout.expectedReturnDate);
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      daysOverdue = days > 0 ? days : 0;
      daysUntilDue = Math.ceil(
        (new Date(checkout.expectedReturnDate) - now) / (1000 * 60 * 60 * 24),
      );
    } else if (checkout.returnedDate && checkout.checkoutDate) {
      // Closed checkouts (returned / lost / damaged / expensed / sold) —
      // how long did the borrower hold it?
      const diff =
        new Date(checkout.returnedDate) - new Date(checkout.checkoutDate);
      daysHeld = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
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
      daysHeld,
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

  return serializeBsonType(result);
};

// ============================================
// GET CHECKOUT STATS
// ============================================
export const getCheckoutStats = async () => {
  await dbConnect();
  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantMatch(companyId, isSuperAdmin);

  const now = new Date();
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const [total, active, overdue, dueSoon, returned] = await Promise.all([
    ItemCheckout.countDocuments(tenantMatch),
    ItemCheckout.countDocuments({ ...tenantMatch, status: "checked_out" }),
    ItemCheckout.countDocuments({
      ...tenantMatch,
      status: "checked_out",
      expectedReturnDate: { $lt: now },
    }),
    ItemCheckout.countDocuments({
      ...tenantMatch,
      status: "checked_out",
      expectedReturnDate: { $gte: now, $lte: threeDaysFromNow },
    }),
    ItemCheckout.countDocuments({ ...tenantMatch, status: "returned" }),
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
  await dbConnect();
  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantMatch(companyId, isSuperAdmin);

  const checkout = await ItemCheckout.findOne({
    ...tenantMatch,
    _id: checkoutId,
  }).lean();

  if (!checkout) {
    return null;
  }

  const now = new Date();
  let daysOverdue = 0;
  let daysUntilDue = null;

  if (
    ["checked_out", "overdue"].includes(checkout.status) &&
    checkout.expectedReturnDate
  ) {
    const diff = now - new Date(checkout.expectedReturnDate);
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    daysOverdue = days > 0 ? days : 0;
    daysUntilDue = Math.ceil(
      (new Date(checkout.expectedReturnDate) - now) / (1000 * 60 * 60 * 24),
    );
  }

  return {
    ...serializeBsonType(checkout),
    daysOverdue,
    daysUntilDue,
    isOverdue: daysOverdue > 0,
  };
};

// ============================================
// GET USER CHECKOUTS
// ============================================
export const getUserCheckouts = async (userId, activeOnly = false) => {
  await dbConnect();
  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantMatch(companyId, isSuperAdmin);

  const query = { ...tenantMatch, "checkedOutTo.id": userId };

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
// GET ACTIVE CHECKOUTS FOR INVOICE (Technician Stock)
// Returns checkouts that can be added to invoices
// ============================================
// RULES:
// 1. "sale" type requests → Draft invoice already created during fulfillment → EXCLUDE
// 2. "internal" type requests → Cannot be invoiced (return to store or expense) → EXCLUDE
// 3. "demo", "installation", "repair" → Can be invoiced → INCLUDE
// 4. Must match customer when adding to invoice (filtered in UI)
// 5. Checkouts with saleConversion.invoiceId already exist → EXCLUDE
// ============================================
export const getActiveCheckouts = async () => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  // Import StockRequest to get customer info
  const { StockRequest } = await import("../../models/requests");

  const checkouts = await ItemCheckout.find({
    ...tenantMatch,
    status: "checked_out",
    // Exclude already converted checkouts
    "saleConversion.converted": { $ne: true },
    // Exclude checkouts that already have a draft invoice created
    "saleConversion.invoiceId": { $exists: false },
    // Only include types that CAN be invoiced (demo, installation, repair)
    // Exclude: "sale" (already has invoice), "internal" (not for sale)
    requestType: { $in: ["demo", "installation", "repair"] },
  })
    .populate("productId", "name SKU unit pricing costing stock")
    .sort({ checkoutDate: -1 })
    .lean();

  // Get customer info from parent requests
  const requestIds = [...new Set(checkouts
    .filter(c => c.relatedDocuments?.requestId)
    .map(c => c.relatedDocuments.requestId.toString()))];

  // Tenant scope this sub-query — the _id $in list is sourced from
  // already-scoped checkouts, but cross-tenant ID collisions shouldn't be
  // possible to construct via crafted IDs.
  const requests = await StockRequest.find({
    ...tenantMatch,
    _id: { $in: requestIds },
  })
    .select("_id customer")
    .lean();

  // Create a map of requestId -> customer
  const requestCustomerMap = new Map();
  for (const req of requests) {
    requestCustomerMap.set(req._id.toString(), req.customer);
  }

  return checkouts.map((checkout) => {
    const product = checkout.productId;
    const requestId = checkout.relatedDocuments?.requestId?.toString();
    const customer = requestId ? requestCustomerMap.get(requestId) : null;

    return {
      _id: checkout._id.toString(),
      checkoutNumber: checkout.checkoutNumber,
      productId: product?._id?.toString() || null,
      productSnapshot: checkout.productSnapshot,
      product: product
        ? {
            _id: product._id.toString(),
            name: product.name,
            SKU: product.SKU,
            unit: product.unit,
            sellingPrice: product.pricing?.sellingPrice ?? 0,
            costPrice: product.costing?.costPrice ?? 0,
            quantityOnHand: product.inventory?.quantityOnHand ?? 0,
            quantityAvailable: product.inventory?.quantityAvailable ?? 0,
          }
        : null,
      quantity: checkout.quantity,
      checkedOutTo: checkout.checkedOutTo,
      checkoutDate: checkout.checkoutDate?.toISOString(),
      expectedReturnDate: checkout.expectedReturnDate?.toISOString(),
      requestType: checkout.requestType,
      // Include customer info from parent request for filtering
      customer: customer
        ? {
            id: customer.id,
            name: customer.name,
          }
        : null,
      relatedDocuments: {
        requestId: requestId || null,
        requestNumber: checkout.relatedDocuments?.requestNumber || null,
      },
    };
  });
};

// ============================================
// GENERATE CHECKOUT NUMBER
// ============================================
export const generateCheckoutNumber = async (session = null) => {
  await dbConnect();
  const { format } = await import("date-fns");
  const { Counter } = await import("../../models/counter");

  const today = format(new Date(), "ddMMyy");
  const counterId = `CHK-${today}`;

  const counter = await Counter.findOneAndUpdate(
    { name: counterId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session },
  );

  if (!counter) {
    throw new Error("Failed to generate checkout number");
  }

  return `${counterId}-${String(counter.seq).padStart(3, "0")}`;
};
