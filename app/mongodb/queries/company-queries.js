import dbConnect from "../../config/dbConnect";
import Company from "../../models/Company";
import { unstable_noStore as noStore } from "next/cache";

const ITEMS_PER_PAGE = 20;

// ============================================
// GET ALL COMPANIES (SuperAdmin only)
// ============================================
export const searchCompanies = async (
  searchTerm = "",
  page = 1,
  filters = {},
) => {
  noStore();
  await dbConnect();

  const { status, plan } = filters;
  const skipRecords = (page - 1) * ITEMS_PER_PAGE;

  let matchConditions = {};

  if (status && status !== "all") {
    matchConditions.status = status;
  }

  if (plan && plan !== "all") {
    matchConditions["subscription.plan"] = plan;
  }

  const searchStage = {
    $match: {
      $and: [
        matchConditions,
        {
          $or: [
            { name: { $regex: searchTerm, $options: "i" } },
            { email: { $regex: searchTerm, $options: "i" } },
            { slug: { $regex: searchTerm, $options: "i" } },
            { "address.city": { $regex: searchTerm, $options: "i" } },
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
      name: 1,
      slug: 1,
      email: 1,
      phone: 1,
      logo: 1,
      status: 1,
      "address.city": 1,
      "address.country": 1,
      "subscription.plan": 1,
      "subscription.status": 1,
      "subscription.maxUsers": 1,
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

  let result = await Company.aggregate(pipeline);

  result = result.map((company) => ({
    ...company,
    _id: company._id.toString(),
    createdAt: company.createdAt?.toISOString() || null,
    updatedAt: company.updatedAt?.toISOString() || null,
  }));

  return result;
};

// ============================================
// FETCH COMPANY PAGES
// ============================================
export const fetchCompanyPages = async (searchTerm = "", filters = {}) => {
  noStore();
  await dbConnect();

  const { status, plan } = filters;

  let matchConditions = {};

  if (status && status !== "all") {
    matchConditions.status = status;
  }

  if (plan && plan !== "all") {
    matchConditions["subscription.plan"] = plan;
  }

  const searchStage = {
    $match: {
      $and: [
        matchConditions,
        {
          $or: [
            { name: { $regex: searchTerm, $options: "i" } },
            { email: { $regex: searchTerm, $options: "i" } },
            { slug: { $regex: searchTerm, $options: "i" } },
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

  const result = await Company.aggregate(pipeline);

  let count = 0;
  if (result && result.length > 0) {
    count = result[0].totalRecords;
  }

  const noOfPages = Math.ceil(Number(count) / ITEMS_PER_PAGE);
  return noOfPages;
};

// ============================================
// GET COMPANY BY ID
// ============================================
export const getCompanyById = async (companyId) => {
  noStore();
  await dbConnect();

  const company = await Company.findById(companyId).lean();

  if (!company) {
    return null;
  }

  return {
    ...company,
    _id: company._id.toString(),
    createdAt: company.createdAt?.toISOString() || null,
    updatedAt: company.updatedAt?.toISOString() || null,
  };
};

// ============================================
// GET COMPANY BY SLUG
// ============================================
export const getCompanyBySlug = async (slug) => {
  noStore();
  await dbConnect();

  const company = await Company.findOne({ slug: slug.toLowerCase() }).lean();

  if (!company) {
    return null;
  }

  return {
    ...company,
    _id: company._id.toString(),
    createdAt: company.createdAt?.toISOString() || null,
    updatedAt: company.updatedAt?.toISOString() || null,
  };
};

// ============================================
// GET COMPANY STATS
// ============================================
export const getCompanyStats = async () => {
  noStore();
  await dbConnect();

  const pipeline = [
    {
      $group: {
        _id: null,
        totalCompanies: { $sum: 1 },
        activeCompanies: {
          $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
        },
        inactiveCompanies: {
          $sum: { $cond: [{ $eq: ["$status", "inactive"] }, 1, 0] },
        },
        suspendedCompanies: {
          $sum: { $cond: [{ $eq: ["$status", "suspended"] }, 1, 0] },
        },
        freeCount: {
          $sum: { $cond: [{ $eq: ["$subscription.plan", "free"] }, 1, 0] },
        },
        starterCount: {
          $sum: { $cond: [{ $eq: ["$subscription.plan", "starter"] }, 1, 0] },
        },
        professionalCount: {
          $sum: {
            $cond: [{ $eq: ["$subscription.plan", "professional"] }, 1, 0],
          },
        },
        enterpriseCount: {
          $sum: {
            $cond: [{ $eq: ["$subscription.plan", "enterprise"] }, 1, 0],
          },
        },
        trialCount: {
          $sum: { $cond: [{ $eq: ["$subscription.status", "trial"] }, 1, 0] },
        },
      },
    },
  ];

  const result = await Company.aggregate(pipeline);

  if (result.length === 0) {
    return {
      totalCompanies: 0,
      activeCompanies: 0,
      inactiveCompanies: 0,
      suspendedCompanies: 0,
      freeCount: 0,
      starterCount: 0,
      professionalCount: 0,
      enterpriseCount: 0,
      trialCount: 0,
    };
  }

  return result[0];
};

// ============================================
// GET COMPANIES FOR DROPDOWN (minimal data)
// ============================================
export const getCompaniesForDropdown = async () => {
  noStore();
  await dbConnect();

  const companies = await Company.find({ status: "active" })
    .select("_id name slug")
    .sort({ name: 1 })
    .lean();

  return companies.map((company) => ({
    _id: company._id.toString(),
    name: company.name,
    slug: company.slug,
  }));
};

// ============================================
// GET COMPANY SETTINGS (for current user's company)
// ============================================
export const getCompanySettings = async (companyId) => {
  noStore();
  await dbConnect();

  const company = await Company.findById(companyId)
    .select("name settings features subscription")
    .lean();

  if (!company) {
    return null;
  }

  return {
    ...company,
    _id: company._id.toString(),
  };
};

// ============================================
// GET COMPANY FOR PDF/DOCUMENTS
// ============================================
export const getCompanyForDocuments = async (companyId) => {
  noStore();
  await dbConnect();

  const company = await Company.findById(companyId)
    .select(
      "name tagline logo email phone fullAddress taxPin bankName bankBranch accountName accountNumber mpesaPaybill mpesaTill settings.currency",
    )
    .lean();

  if (!company) {
    return null;
  }

  return {
    ...company,
    _id: company._id.toString(),
  };
};
