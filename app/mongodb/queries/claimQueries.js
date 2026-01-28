import mongoose from "mongoose";
import EmployeeClaim from "../../models/employeesClaims";
import dbConnect from "../../config/dbConnect";

dbConnect();

const ITEMS_PER_PAGE = 20;

// ============================================
// FETCH CLAIM PAGES (for pagination)
// ============================================
export const fetchClaimPages = async (searchTerm = "", filters = {}) => {
  const { status, claimType, userId, userRole } = filters;

  // Build filter conditions
  let additionalFilters = {};

  // Status filter
  if (status && status !== "all") {
    additionalFilters.status = status;
  }

  // Claim type filter
  if (claimType && claimType !== "all") {
    additionalFilters.claimType = claimType;
  }

  // User-specific filters based on role
  if (userRole === "employee" || userRole === "user") {
    // Employees see only their own claims
    additionalFilters["employee.userId"] = userId;
  }
  // Managers and accountants see all claims (no additional filter)

  const transactionSearchStage = {
    $match: {
      $and: [
        additionalFilters,
        {
          $or: [
            { claimNumber: { $regex: searchTerm, $options: "i" } },
            { "employee.name": { $regex: searchTerm, $options: "i" } },
            { "employee.department": { $regex: searchTerm, $options: "i" } },
            { description: { $regex: searchTerm, $options: "i" } },
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

  const result = await EmployeeClaim.aggregate(pipeline);

  let count = 0;
  if (result && result.length > 0) {
    count = result[0].totalRecords;
  }

  const noOfPages = Math.ceil(Number(count) / ITEMS_PER_PAGE);

  return noOfPages;
};

// ============================================
// SEARCH CLAIMS WITH PAGINATION
// ============================================
export const searchClaims = async (searchTerm = "", page = 1, filters = {}) => {
  const { status, claimType, userId, userRole } = filters;

  const skipRecords = (page - 1) * ITEMS_PER_PAGE;

  // Build filter conditions
  let additionalFilters = {};

  // Status filter
  if (status && status !== "all") {
    additionalFilters.status = status;
  }

  // Claim type filter
  if (claimType && claimType !== "all") {
    additionalFilters.claimType = claimType;
  }

  // User-specific filters based on role
  if (userRole === "employee" || userRole === "user" || userId) {
    // Employees see only their own claims
    additionalFilters["employee.userId"] = new mongoose.Types.ObjectId(userId);
  }
  // Managers and accountants see all claims

  const searchStage = {
    $match: {
      $and: [
        additionalFilters,
        {
          $or: [
            { claimNumber: { $regex: searchTerm, $options: "i" } },
            { "employee.name": { $regex: searchTerm, $options: "i" } },
            { "employee.department": { $regex: searchTerm, $options: "i" } },
            { description: { $regex: searchTerm, $options: "i" } },
          ],
        },
      ],
    },
  };

  const baseFilterStage = {
    $match: additionalFilters,
  };

  const paginationStage = [{ $skip: skipRecords }, { $limit: ITEMS_PER_PAGE }];

  const sortStage = { $sort: { claimDate: -1 } };

  let pipeline = [baseFilterStage, sortStage, ...paginationStage];

  if (searchTerm && searchTerm.length > 0) {
    pipeline = [searchStage, sortStage, ...paginationStage];
  }

  let result = await EmployeeClaim.aggregate(pipeline);

  // Transform result for client consumption
  result = result.map((claim) => {
    let items = [];
    if (claim.items && claim.items.length > 0) {
      items = claim.items.map((item) => ({
        ...item,
        _id: item._id.toString(),
        receipt: {
          ...item.receipt,
          uploadedAt: item.receipt.uploadedAt.toISOString(),
        },
        date: item.date.toISOString(),
      }));
    }

    return {
      ...claim,
      items,
      _id: claim._id.toString(),
      employee: {
        ...claim.employee,
        userId: claim.employee.userId.toString(),
        partyId: claim.employee.partyId.toString(),
      },
      claimDate: claim.claimDate.toISOString(),
      submittedAt: claim.submittedAt?.toISOString() || null,
      approvedAt: claim.approvedAt?.toISOString() || null,
      rejectedAt: claim.rejectedAt?.toISOString() || null,
      paidAt: claim.paidAt?.toISOString() || null,
      createdAt: claim.createdAt?.toISOString() || null,
      updatedAt: claim.updatedAt?.toISOString() || null,
      advancePaymentId: claim.advancePaymentId?.toString() || null,
      settlementPaymentId: claim.settlementPaymentId?.toString() || null,
      journalEntryIds: claim.journalEntryIds?.map((id) => id.toString()) || [],
    };
  });

  return result;
};

// ============================================
// GET PENDING APPROVAL CLAIMS (Manager view)
// ============================================
export const getPendingApprovalClaims = async (searchTerm = "", page = 1) => {
  return searchClaims(searchTerm, page, {
    status: "submitted",
  });
};

// ============================================
// GET PENDING PAYMENT CLAIMS (Accountant view)
// ============================================
export const getPendingPaymentClaims = async (searchTerm = "", page = 1) => {
  return searchClaims(searchTerm, page, {
    status: "approved",
  });
};

// ============================================
// GET USER CLAIMS (Employee view)
// ============================================
export const getUserClaims = async (
  userId,
  searchTerm = "",
  page = 1,
  filters = {}
) => {
  return searchClaims(searchTerm, page, {
    ...filters,
    userId,
    userRole: "employee",
  });
};

// ============================================
// GET CLAIM STATS
// ============================================
export const getClaimStats = async (userId = null, userRole = null) => {
  // Build base filter for user role
  let baseFilter = {};
  if (userRole === "employee" || userRole === "user") {
    baseFilter["employee.userId"] = userId;
  }

  const [total, pending, approved, paid, rejected] = await Promise.all([
    EmployeeClaim.countDocuments(baseFilter),
    EmployeeClaim.countDocuments({ ...baseFilter, status: "submitted" }),
    EmployeeClaim.countDocuments({ ...baseFilter, status: "approved" }),
    EmployeeClaim.countDocuments({ ...baseFilter, status: "paid" }),
    EmployeeClaim.countDocuments({ ...baseFilter, status: "rejected" }),
  ]);

  // Calculate total amounts
  const amountStats = await EmployeeClaim.aggregate([
    { $match: baseFilter },
    {
      $group: {
        _id: "$status",
        totalAmount: { $sum: "$totalAmount" },
      },
    },
  ]);

  const amountsByStatus = {};
  amountStats.forEach((stat) => {
    amountsByStatus[stat._id] = stat.totalAmount;
  });

  return {
    total,
    pending,
    approved,
    paid,
    rejected,
    totalPendingAmount: amountsByStatus.submitted || 0,
    totalApprovedAmount: amountsByStatus.approved || 0,
    totalPaidAmount: amountsByStatus.paid || 0,
  };
};

// ============================================
// GET SINGLE CLAIM BY ID
// ============================================
export const getClaimById = async (claimId) => {
  const id = new mongoose.Types.ObjectId(claimId);
  const claim = await EmployeeClaim.findById(id).lean();

  if (!claim) {
    return null;
  }

  return {
    ...claim,
    _id: claim._id.toString(),
    employee: {
      ...claim.employee,
      userId: claim.employee.userId.toString(),
      partyId: claim.employee.partyId.toString(),
    },
    claimDate: claim.claimDate.toISOString(),
    submittedAt: claim.submittedAt?.toISOString() || null,
    approvedAt: claim.approvedAt?.toISOString() || null,
    rejectedAt: claim.rejectedAt?.toISOString() || null,
    paidAt: claim.paidAt?.toISOString() || null,
    createdAt: claim.createdAt?.toISOString() || null,
    updatedAt: claim.updatedAt?.toISOString() || null,
    advancePaymentId: claim.advancePaymentId?.toString() || null,
    settlementPaymentId: claim.settlementPaymentId?.toString() || null,
    journalEntryIds: claim.journalEntryIds?.map((id) => id.toString()) || [],
  };
};

// ============================================
// GET CLAIMS BY TYPE
// ============================================
export const getClaimsByType = async (
  claimType,
  searchTerm = "",
  page = 1,
  userId = null
) => {
  const filters = { claimType };

  if (userId) {
    filters.userId = userId;
    filters.userRole = "employee";
  }

  return searchClaims(searchTerm, page, filters);
};

// ============================================
// GET ADVANCE REQUESTS NEEDING SETTLEMENT
// ============================================
export const getAdvancesNeedingSettlement = async (userId) => {
  const claims = await EmployeeClaim.find({
    "employee.userId": userId,
    claimType: "advance_request",
    status: "paid",
  })
    .sort({ claimDate: -1 })
    .lean();

  // Check if each advance has a settlement
  const advancesNeedingSettlement = [];

  for (const claim of claims) {
    // Check if there's a settlement for this advance
    const settlement = await EmployeeClaim.findOne({
      claimType: "advance_return",
      "returnDetails.advancePaymentId": claim.advancePaymentId,
    }).lean();

    if (!settlement) {
      advancesNeedingSettlement.push({
        ...claim,
        _id: claim._id.toString(),
        employee: {
          ...claim.employee,
          userId: claim.employee.userId.toString(),
          partyId: claim.employee.partyId.toString(),
        },
        claimDate: claim.claimDate.toISOString(),
        paidAt: claim.paidAt?.toISOString() || null,
      });
    }
  }

  return advancesNeedingSettlement;
};

// ============================================
// SEARCH CLAIMS FOR SPECIFIC USER (with role check)
// ============================================
export const searchUserClaims = async (
  userId,
  userRole,
  searchTerm = "",
  page = 1,
  filters = {}
) => {
  console.log("User in searchUserClaims:", userId, userRole);
  // Employees can only see their own claims

  return searchClaims(searchTerm, page, {
    ...filters,
    userId,
    userRole,
  });
};

// ============================================
// GET CLAIM PAGES FOR USER (with role check)
// ============================================
export const fetchUserClaimPages = async (
  userId,
  userRole,
  searchTerm = "",
  filters = {}
) => {
  // Employees can only see their own claims
  if (userRole === "employee" || userRole === "user") {
    return fetchClaimPages(searchTerm, {
      ...filters,
      userId,
      userRole,
    });
  }

  // Managers and accountants can see all claims
  return fetchClaimPages(searchTerm, filters);
};
