import mongoose from "mongoose";
import dbConnect from "@/app/config/dbConnect";
import Product from "@/app/models/product";
import { sanitizeSearchTerm } from "@/lib/utils/sanitize";
import { getTenantContext } from "@/lib/utils/tenant-utils";

dbConnect();
const { ObjectId } = mongoose.Types;
const ITEMS_PER_PAGE = 20;

export const searchStock = async (searchTerm, page = 1, filters = {}) => {
  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const { category, quantity } = filters;
  const skipRecords = (page - 1) * ITEMS_PER_PAGE;

  // Sanitize search term to prevent NoSQL injection
  const safeSearchTerm = sanitizeSearchTerm(searchTerm);

  // Build filter conditions
  let additionalFilters = {};

  // Category filter
  if (category) {
    additionalFilters.category = category;
  }

  // Quantity/Stock level filter
  if (quantity) {
    switch (quantity) {
      case "in-stock":
        additionalFilters.stock = { $gte: 10 };
        break;
      case "low-stock":
        additionalFilters.stock = { $gte: 1, $lte: 9 };
        break;
      case "out-of-stock":
        additionalFilters.stock = 0;
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
            { name: { $regex: safeSearchTerm, $options: "i" } },
            { SKU: { $regex: safeSearchTerm, $options: "i" } },
          ],
        },
      ],
    },
  };

  const baseFilterStage = {
    $match: { ...tenantMatch, ...additionalFilters },
  };

  const paginationStage = [{ $skip: skipRecords }, { $limit: ITEMS_PER_PAGE }];

  const sortStage = { $sort: { createdAt: -1 } };

  let pipeline = [baseFilterStage, sortStage, ...paginationStage];

  if (safeSearchTerm && safeSearchTerm.length > 0) {
    pipeline = [searchStage, sortStage, ...paginationStage];
  }

  let result = await Product.aggregate(pipeline);
  result = result.map((res) => {
    return { ...res, _id: res._id.toString() };
  });

  return result;
};

export const fetchStockData = async () => {
  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const projectStage = {
    $project: {
      stock: 1,
      SKU: 1,
      name: 1,
      price: 1,
      unit: 1,
      category: { $toUpper: "$category" },
    },
  };
  const sortStage = { $sort: { category: 1 } };
  // Organize stock by department

  const pipeline = isSuperAdmin
    ? [projectStage, sortStage]
    : [{ $match: tenantMatch }, projectStage, sortStage];

  const stockItems = await Product.aggregate(pipeline);

  return stockItems.reduce((acc, item) => {
    const dept = item.category || "Uncategorized";
    if (!acc[dept]) acc[dept] = [];
    acc[dept].push({
      name: item.name,
      quantity: item.stock.$numberInt || item.stock,
      SKU: item.SKU,
      price: item.price,
      unit: item.unit,
    });
    return acc;
  }, {});
};

//Products or stock queries

export const fetchStockPages = async (searchTerm, filters = {}) => {
  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  const { category, quantity } = filters;

  // Sanitize search term to prevent NoSQL injection
  const safeSearchTerm = sanitizeSearchTerm(searchTerm);

  // Build filter conditions
  let additionalFilters = {};

  // Category filter
  if (category) {
    additionalFilters.category = category;
  }

  // Quantity/Stock level filter
  if (quantity) {
    switch (quantity) {
      case "in-stock":
        additionalFilters.stock = { $gte: 10 };
        break;
      case "low-stock":
        additionalFilters.stock = { $gte: 1, $lte: 9 };
        break;
      case "out-of-stock":
        additionalFilters.stock = 0;
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
            { name: { $regex: safeSearchTerm, $options: "i" } },
            { SKU: { $regex: safeSearchTerm, $options: "i" } },
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

  if (safeSearchTerm && safeSearchTerm.length > 0) {
    pipeline = [transactionSearchStage, countStage];
  }

  const result = await Product.aggregate(pipeline);

  let count = 0;
  if (result && result.length > 0) {
    count = result[0].totalRecords;
  }

  const noOfPages = Math.ceil(Number(count) / ITEMS_PER_PAGE);

  return noOfPages;
};
