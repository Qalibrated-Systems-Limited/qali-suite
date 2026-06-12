import dbConnect from "../../config/dbConnect";
import User from "../../models/user";
import Company from "../../models/Company";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import { serializeBsonType } from "@/lib/utils";
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
      createdAt: 1,
      updatedAt: 1,
    },
  };

  const sortStage = { $sort: { createdAt: -1 } };
  const paginationStage = [{ $skip: skipRecords }, { $limit: ITEMS_PER_PAGE }];

  let pipeline = [baseFilterStage, sortStage, ...paginationStage, projectStage];

  if (searchTerm && searchTerm.length > 0) {
    pipeline = [searchStage, sortStage, ...paginationStage, projectStage];
  }

  // Companies map is fetched once for SuperAdmin and joined in-memory —
  // cheaper than a per-page $lookup since the page already needs the full
  // company list for the filter dropdown anyway. For non-SuperAdmin we
  // skip the join entirely (single tenant — no need to display).
  const [rawResult, companies] = await Promise.all([
    User.aggregate(pipeline),
    isSuperAdmin
      ? Company.find({}).select("name").lean()
      : Promise.resolve(null),
  ]);

  const companyNameById = companies
    ? new Map(companies.map((c) => [c._id.toString(), c.name]))
    : null;

  return rawResult.map((res) => {
    const companyIdStr = res.companyId?.toString() || null;
    return {
      ...res,
      _id: res._id.toString(),
      companyId: companyIdStr,
      companyName: companyNameById?.get(companyIdStr) || null,
      createdAt: res.createdAt?.toISOString() || null,
      updatedAt: res.updatedAt?.toISOString() || null,
    };
  });
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
  // Strip the password hash BEFORE serialization — serializeBsonType
  // doesn't filter fields, so we do it here. Hand-rolled serialization
  // previously left nested ObjectIds (assignments, audit refs) raw.
  const { password: _password, ...rest } = user;

  return {
    ...serializeBsonType(rest),
    hasPassword,
  };
};

// ============================================
// GET DEPARTMENTS LIST
// ============================================
export const getDepartments = async () => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  // distinct() doesn't auto-cast in $match-like filters — cast companyId so
  // it stays scoped and uses the index rather than a COLLSCAN.
  const query = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };
  const departments = await User.distinct("department", query);
  return departments.filter(Boolean); // Remove null/undefined
};
