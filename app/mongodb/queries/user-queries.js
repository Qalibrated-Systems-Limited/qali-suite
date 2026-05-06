import dbConnect from "../../config/dbConnect";
import User from "../../models/user";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import mongoose from "mongoose";

const ObjectId = mongoose.Types.ObjectId;

const ITEMS_PER_PAGE = 20;

// ============================================
// SEARCH USERS WITH FILTERS
// ============================================
export const searchUsers = async (searchTerm, page = 1, filters = {}) => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const { role, status, department, companyId: filterCompanyId } = filters;
  const skipRecords = (page - 1) * ITEMS_PER_PAGE;

  // Build filter conditions with tenant scope.
  // SuperAdmin sees all companies by default but can narrow to one via filter.
  let matchConditions;
  if (isSuperAdmin) {
    matchConditions = {};
    if (filterCompanyId && filterCompanyId !== "all") {
      matchConditions.companyId = new ObjectId(filterCompanyId);
    }
  } else {
    matchConditions = { companyId: new ObjectId(companyId) };
  }

  if (role && role !== "all") {
    matchConditions.role = role;
  }

  if (status && status !== "all") {
    matchConditions.status = status;
  }

  if (department && department !== "all") {
    matchConditions.department = department;
  }

  // Search stage
  const searchStage = {
    $match: {
      $and: [
        matchConditions,
        {
          $or: [
            { name: { $regex: searchTerm, $options: "i" } },
            { email: { $regex: searchTerm, $options: "i" } },
            { department: { $regex: searchTerm, $options: "i" } },
          ],
        },
      ],
    },
  };

  const baseFilterStage = {
    $match: matchConditions,
  };

  const projectStage = {
    $project: {
      status: 1,
      role: 1,
      name: 1,
      email: 1,
      department: 1,
      companyId: 1,
      companyName: { $ifNull: [{ $arrayElemAt: ["$company.name", 0] }, null] },
      createdAt: 1,
      updatedAt: 1,
    },
  };

  // Only SuperAdmin needs the per-row company name.
  const lookupStages = isSuperAdmin
    ? [
        {
          $lookup: {
            from: "companies",
            localField: "companyId",
            foreignField: "_id",
            as: "company",
            pipeline: [{ $project: { name: 1 } }],
          },
        },
      ]
    : [];

  const sortStage = { $sort: { createdAt: -1 } };
  const paginationStage = [{ $skip: skipRecords }, { $limit: ITEMS_PER_PAGE }];

  let pipeline = [
    baseFilterStage,
    sortStage,
    ...paginationStage,
    ...lookupStages,
    projectStage,
  ];

  if (searchTerm && searchTerm.length > 0) {
    pipeline = [
      searchStage,
      sortStage,
      ...paginationStage,
      ...lookupStages,
      projectStage,
    ];
  }

  let result = await User.aggregate(pipeline);
  result = result.map((res) => ({
    ...res,
    _id: res._id.toString(),
    companyId: res.companyId?.toString() || null,
    createdAt: res.createdAt?.toISOString() || null,
    updatedAt: res.updatedAt?.toISOString() || null,
  }));

  return result;
};

// ============================================
// FETCH USER PAGES
// ============================================
export const fetchUserPages = async (searchTerm, filters = {}) => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const { role, status, department, companyId: filterCompanyId } = filters;

  // Build filter conditions with tenant scope.
  // SuperAdmin sees all companies by default but can narrow to one via filter.
  let matchConditions;
  if (isSuperAdmin) {
    matchConditions = {};
    if (filterCompanyId && filterCompanyId !== "all") {
      matchConditions.companyId = new ObjectId(filterCompanyId);
    }
  } else {
    matchConditions = { companyId: new ObjectId(companyId) };
  }

  if (role && role !== "all") {
    matchConditions.role = role;
  }

  if (status && status !== "all") {
    matchConditions.status = status;
  }

  if (department && department !== "all") {
    matchConditions.department = department;
  }

  const searchStage = {
    $match: {
      $and: [
        matchConditions,
        {
          $or: [
            { name: { $regex: searchTerm, $options: "i" } },
            { email: { $regex: searchTerm, $options: "i" } },
            { department: { $regex: searchTerm, $options: "i" } },
          ],
        },
      ],
    },
  };

  const baseFilterStage = {
    $match: matchConditions,
  };

  const countStage = {
    $count: "totalRecords",
  };

  let pipeline = [baseFilterStage, countStage];

  if (searchTerm && searchTerm.length > 0) {
    pipeline = [searchStage, countStage];
  }

  const result = await User.aggregate(pipeline);

  let count = 0;
  if (result && result.length > 0) {
    count = result[0].totalRecords;
  }

  const noOfPages = Math.ceil(Number(count) / ITEMS_PER_PAGE);
  return noOfPages;
};

// ============================================
// GET USER STATS
// ============================================
export const getUserStats = async (filters = {}) => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const { role, status, department, companyId: filterCompanyId } = filters;

  // Build filter conditions with tenant scope.
  // SuperAdmin sees all companies by default but can narrow to one via filter.
  let matchConditions;
  if (isSuperAdmin) {
    matchConditions = {};
    if (filterCompanyId && filterCompanyId !== "all") {
      matchConditions.companyId = new ObjectId(filterCompanyId);
    }
  } else {
    matchConditions = { companyId: new ObjectId(companyId) };
  }

  if (role && role !== "all") {
    matchConditions.role = role;
  }

  if (status && status !== "all") {
    matchConditions.status = status;
  }

  if (department && department !== "all") {
    matchConditions.department = department;
  }

  const pipeline = [
    { $match: matchConditions },
    {
      $group: {
        _id: null,
        totalUsers: { $sum: 1 },
        activeUsers: {
          $sum: {
            $cond: [{ $eq: ["$status", "Active"] }, 1, 0],
          },
        },
        inactiveUsers: {
          $sum: {
            $cond: [{ $eq: ["$status", "Inactive"] }, 1, 0],
          },
        },
        adminCount: {
          $sum: {
            $cond: [{ $eq: ["$role", "Admin"] }, 1, 0],
          },
        },
        managerCount: {
          $sum: {
            $cond: [{ $eq: ["$role", "Store Manager"] }, 1, 0],
          },
        },
      },
    },
  ];

  const result = await User.aggregate(pipeline);

  if (result.length === 0) {
    return {
      totalUsers: 0,
      activeUsers: 0,
      inactiveUsers: 0,
      adminCount: 0,
      managerCount: 0,
    };
  }

  return result[0];
};

// ============================================
// GET USER BY ID
// ============================================
export const getUserById = async (userId) => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const query = withTenantScope({ _id: userId }, companyId, isSuperAdmin);
  // Include +password only to check existence, not to expose the hash
  const user = await User.findOne(query).select("+password").lean();

  if (!user) {
    return null;
  }

  const hasPassword = !!user.password;

  return {
    ...user,
    password: undefined, // never leak the hash
    hasPassword,
    _id: user._id.toString(),
    companyId: user.companyId?.toString() || null,
    createdAt: user.createdAt?.toISOString() || null,
    updatedAt: user.updatedAt?.toISOString() || null,
  };
};

// ============================================
// GET DEPARTMENTS LIST
// ============================================
export const getDepartments = async () => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const query = isSuperAdmin ? {} : { companyId };
  const departments = await User.distinct("department", query);
  return departments.filter(Boolean); // Remove null/undefined
};
