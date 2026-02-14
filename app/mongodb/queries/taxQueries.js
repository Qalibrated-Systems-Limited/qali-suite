import TaxTransaction from "../../models/taxTransactions";
import TaxService from "../services/taxService";
import dbConnect from "../../config/dbConnect";
import {ObjectId} from 'mongodb'
import {
  getTenantContext,
  withTenantScope,
} from "@/lib/utils/tenant-utils";

const ITEMS_PER_PAGE = 20;

// ============================================
// TAX QUERIES - READ OPERATIONS (KENYA COMPLIANCE)
// Following industry best practices
// ============================================

/**
 * Get paginated tax transactions with filters
 * Best Practice: Pagination, Smart Filters (type, period, filed/unfiled)
 */
export async function getTaxTransactions(page = 1, filters = {}) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const skip = (page - 1) * ITEMS_PER_PAGE;
  let query = isSuperAdmin ? {} : { companyId  : new ObjectId(companyId)};

  // Tax type filter (vat_input, vat_output, wht)
  if (filters.taxType) {
    query.taxType = filters.taxType;
  }

  // Filing period filter
  if (filters.filingPeriod) {
    query["kraTracking.filingPeriod"] = filters.filingPeriod;
  }

  // Filed status filter
  if (filters.filed !== undefined) {
    query["kraTracking.filed"] =
      filters.filed === "true" || filters.filed === true;
  }

  // Remitted status filter (for WHT)
  if (filters.remitted !== undefined) {
    query["kraTracking.remitted"] =
      filters.remitted === "true" || filters.remitted === true;
  }

  // Date range filter
  if (filters.startDate || filters.endDate) {
    query.transactionDate = {};
    if (filters.startDate) {
      query.transactionDate.$gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      query.transactionDate.$lte = new Date(filters.endDate);
    }
  }

  // Search filter
  if (filters.search) {
    query.$and = query.$and || [];
    query.$and.push({
      $or: [
        { transactionNumber: { $regex: filters.search, $options: "i" } },
        { "party.name": { $regex: filters.search, $options: "i" } },
        { "party.taxPin": { $regex: filters.search, $options: "i" } },
        { description: { $regex: filters.search, $options: "i" } },
      ],
    });
  }

  // Source document type filter (invoice, bill, journal_entry)
  if (filters.sourceType) {
    query["sourceDocument.type"] = filters.sourceType;
  }

  // Parallel queries for performance
  const [transactions, total] = await Promise.all([
    TaxTransaction.find(query)
      .sort({ transactionDate: -1 })
      .skip(skip)
      .limit(ITEMS_PER_PAGE)
      .lean(),
    TaxTransaction.countDocuments(query),
  ]);

  // Serialize for client components
  const serializedTransactions = transactions.map((txn) => ({
    _id: txn._id.toString(),
    companyId: txn.companyId?.toString(),
    transactionNumber: txn.transactionNumber,
    transactionDate: txn.transactionDate?.toISOString(),
    taxType: txn.taxType,
    taxCode: txn.taxCode,
    taxRate: txn.taxRate,
    baseAmount: txn.baseAmount,
    taxAmount: txn.taxAmount,
    totalAmount: txn.totalAmount,
    currency: txn.currency,
    party: txn.party
      ? {
          type: txn.party.type,
          id: txn.party.id,
          name: txn.party.name,
          taxPin: txn.party.taxPin,
        }
      : null,
    sourceDocument: txn.sourceDocument
      ? {
          type: txn.sourceDocument.type,
          id: txn.sourceDocument.id?.toString(),
          number: txn.sourceDocument.number,
        }
      : null,
    kraTracking: {
      filingPeriod: txn.kraTracking?.filingPeriod,
      filed: txn.kraTracking?.filed || false,
      remitted: txn.kraTracking?.remitted || false,
    },
    accountCode: txn.accountCode,
    accountName: txn.accountName,
    description: txn.description,
  }));

  return {
    transactions: serializedTransactions,
    pagination: {
      page,
      totalPages: Math.ceil(total / ITEMS_PER_PAGE),
      total,
      hasMore: skip + transactions.length < total,
    },
  };
}

/**
 * Get tax transaction by ID
 */
export async function getTaxTransactionById(transactionId) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const query = withTenantScope({ _id: transactionId }, companyId , isSuperAdmin);
  return await TaxTransaction.findOne(query).lean();
}

/**
 * Get VAT dashboard data
 * Best Practice: Kenya VAT compliance dashboard
 */
export async function getVATDashboard(filingPeriod = null) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  // Use current month if no period specified
  if (!filingPeriod) {
    const now = new Date();
    filingPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      "0"
    )}`;
  }

  // Use model static method if available (now requires companyId)
  if (typeof TaxTransaction.getVATReturn === "function" && companyId) {
    const vatReturn = await TaxTransaction.getVATReturn(companyId, filingPeriod);

    // Transform the static method result to match expected structure
    const vatPayable = vatReturn.vatPayable || 0;
    return {
      filingPeriod,
      input: {
        totalPurchases: vatReturn.input?.totalBase || 0,
        totalVAT: vatReturn.input?.totalTax || 0,
        transactionCount: vatReturn.input?.count || 0,
        unfiledCount: 0, // Static method doesn't track this
      },
      output: {
        totalSales: vatReturn.output?.totalBase || 0,
        totalVAT: vatReturn.output?.totalTax || 0,
        transactionCount: vatReturn.output?.count || 0,
        unfiledCount: 0, // Static method doesn't track this
      },
      summary: {
        vatPayable: vatPayable > 0 ? vatPayable : 0,
        vatRefundable: vatPayable < 0 ? Math.abs(vatPayable) : 0,
        netPosition: vatPayable,
      },
    };
  }

  // Fallback aggregation
  const [input, output, unfiledInput, unfiledOutput] = await Promise.all([
    TaxTransaction.aggregate([
      {
        $match: {
          ...tenantMatch,
          taxType: "vat_input",
          "kraTracking.filingPeriod": filingPeriod,
        },
      },
      {
        $group: {
          _id: null,
          totalBase: { $sum: "$baseAmount" },
          totalTax: { $sum: "$taxAmount" },
          count: { $sum: 1 },
        },
      },
    ]),

    TaxTransaction.aggregate([
      {
        $match: {
          ...tenantMatch,
          taxType: "vat_output",
          "kraTracking.filingPeriod": filingPeriod,
        },
      },
      {
        $group: {
          _id: null,
          totalBase: { $sum: "$baseAmount" },
          totalTax: { $sum: "$taxAmount" },
          count: { $sum: 1 },
        },
      },
    ]),

    TaxTransaction.countDocuments({
      ...tenantMatch,
      taxType: "vat_input",
      "kraTracking.filingPeriod": filingPeriod,
      "kraTracking.filed": false,
    }),

    TaxTransaction.countDocuments({
      ...tenantMatch,
      taxType: "vat_output",
      "kraTracking.filingPeriod": filingPeriod,
      "kraTracking.filed": false,
    }),
  ]);

  const vatInput = input[0] || { totalBase: 0, totalTax: 0, count: 0 };
  const vatOutput = output[0] || { totalBase: 0, totalTax: 0, count: 0 };
  const vatPayable = vatOutput.totalTax - vatInput.totalTax;

  return {
    filingPeriod,
    input: {
      totalPurchases: vatInput.totalBase,
      totalVAT: vatInput.totalTax,
      transactionCount: vatInput.count,
      unfiledCount: unfiledInput,
    },
    output: {
      totalSales: vatOutput.totalBase,
      totalVAT: vatOutput.totalTax,
      transactionCount: vatOutput.count,
      unfiledCount: unfiledOutput,
    },
    summary: {
      vatPayable: vatPayable > 0 ? vatPayable : 0,
      vatRefundable: vatPayable < 0 ? Math.abs(vatPayable) : 0,
      netPosition: vatPayable,
    },
  };
}

/**
 * Get WHT dashboard data
 * Best Practice: Kenya WHT compliance dashboard
 */
export async function getWHTDashboard(startDate = null, endDate = null) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  // Default to current month if no dates
  if (!startDate || !endDate) {
    const now = new Date();
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  }

  const dateQuery = {
    transactionDate: {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    },
  };

  // Get WHT by rate and supplier
  const [byRate, bySupplier, unremitted, total] = await Promise.all([
    // WHT by rate
    TaxTransaction.aggregate([
      { $match: { ...tenantMatch, taxType: "wht", ...dateQuery } },
      {
        $group: {
          _id: { taxCode: "$taxCode", taxRate: "$taxRate" },
          totalBase: { $sum: "$baseAmount" },
          totalWHT: { $sum: "$taxAmount" },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          taxCode: "$_id.taxCode",
          taxRate: "$_id.taxRate",
          totalBase: 1,
          totalWHT: 1,
          count: 1,
        },
      },
      { $sort: { taxRate: 1 } },
    ]),

    // WHT by supplier
    TaxTransaction.aggregate([
      { $match: { ...tenantMatch, taxType: "wht", ...dateQuery } },
      {
        $group: {
          _id: {
            supplierId: "$party.id",
            supplierName: "$party.name",
            taxPin: "$party.taxPin",
          },
          totalBase: { $sum: "$baseAmount" },
          totalWHT: { $sum: "$taxAmount" },
          transactions: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          supplierId: "$_id.supplierId",
          supplierName: "$_id.supplierName",
          taxPin: "$_id.taxPin",
          totalBase: 1,
          totalWHT: 1,
          transactions: 1,
        },
      },
      { $sort: { totalWHT: -1 } },
      { $limit: 10 }, // Top 10 suppliers
    ]),

    // Unremitted WHT
    TaxTransaction.aggregate([
      {
        $match: {
          ...tenantMatch,
          taxType: "wht",
          "kraTracking.remitted": false,
        },
      },
      {
        $group: {
          _id: null,
          totalWHT: { $sum: "$taxAmount" },
          count: { $sum: 1 },
        },
      },
    ]),

    // Total WHT for period
    TaxTransaction.aggregate([
      { $match: { ...tenantMatch, taxType: "wht", ...dateQuery } },
      {
        $group: {
          _id: null,
          totalWHT: { $sum: "$taxAmount" },
          remitted: {
            $sum: {
              $cond: ["$kraTracking.remitted", "$taxAmount", 0],
            },
          },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const unremittedData = unremitted[0] || { totalWHT: 0, count: 0 };
  const totalData = total[0] || { totalWHT: 0, remitted: 0, count: 0 };

  return {
    period: {
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
    },
    byRate,
    bySupplier,
    summary: {
      totalWHT: totalData.totalWHT,
      remitted: totalData.remitted,
      unremitted: unremittedData.totalWHT,
      transactionCount: totalData.count,
      unremittedCount: unremittedData.count,
    },
  };
}

/**
 * Get unfiled tax transactions
 * Best Practice: Pending KRA filing actions
 */
export async function getUnfiledTransactions(taxType = null) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  let query = { "kraTracking.filed": false };
  if (taxType) query.taxType = taxType;
  query = withTenantScope(query, companyId, isSuperAdmin);

  return await TaxTransaction.find(query).sort({ transactionDate: 1 }).lean();
}

/**
 * Get unremitted WHT
 * Best Practice: Pending WHT remittance actions
 */
export async function getUnremittedWHT() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const query = withTenantScope(
    {
      taxType: "wht",
      "kraTracking.remitted": false,
    },
    companyId,
    isSuperAdmin
  );

  return await TaxTransaction.find(query).sort({ transactionDate: 1 }).lean();
}

/**
 * Get tax summary for dashboard
 * Best Practice: Dashboard KPIs
 */
export async function getTaxSummary(startDate = null, endDate = null) {
  await dbConnect();

  // Default to current month
  if (!startDate || !endDate) {
    const now = new Date();
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  }

  return await TaxService.getTaxSummary(startDate, endDate);
}

/**
 * Get filing periods (for dropdown)
 */
export async function getFilingPeriods(limit = 12) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const query = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };
  const periods = await TaxTransaction.distinct(
    "kraTracking.filingPeriod",
    query
  );

  // Sort descending (most recent first)
  return periods.sort().reverse().slice(0, limit);
}

/**
 * Search tax transactions
 */
export async function searchTaxTransactions(searchTerm, limit = 50) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  if (!searchTerm || searchTerm.trim().length === 0) {
    return [];
  }

  const query = withTenantScope(
    {
      $or: [
        { transactionNumber: { $regex: searchTerm, $options: "i" } },
        { "party.name": { $regex: searchTerm, $options: "i" } },
        { "party.taxPin": { $regex: searchTerm, $options: "i" } },
        { description: { $regex: searchTerm, $options: "i" } },
      ],
    },
    companyId,
    isSuperAdmin
  );

  return await TaxTransaction.find(query)
    .sort({ transactionDate: -1 })
    .limit(limit)
    .select("transactionNumber transactionDate taxType taxAmount party.name")
    .lean();
}

/**
 * Get tax transaction stats (for server component)
 * Returns total count, tax amount totals, filed/unfiled counts
 */
export async function getTaxTransactionStats(filters = {}) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId) };

  let matchQuery = { ...tenantMatch };

  // Apply filters
  if (filters.taxType) matchQuery.taxType = filters.taxType;
  if (filters.filingPeriod) matchQuery["kraTracking.filingPeriod"] = filters.filingPeriod;
  if (filters.startDate || filters.endDate) {
    matchQuery.transactionDate = {};
    if (filters.startDate) matchQuery.transactionDate.$gte = new Date(filters.startDate);
    if (filters.endDate) matchQuery.transactionDate.$lte = new Date(filters.endDate);
  }

  const stats = await TaxTransaction.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: null,
        totalTransactions: { $sum: 1 },
        totalTaxAmount: { $sum: "$taxAmount" },
        totalBaseAmount: { $sum: "$baseAmount" },
        filedCount: {
          $sum: { $cond: ["$kraTracking.filed", 1, 0] },
        },
        unfiledCount: {
          $sum: { $cond: ["$kraTracking.filed", 0, 1] },
        },
      },
    },
  ]);

  return stats[0] || {
    totalTransactions: 0,
    totalTaxAmount: 0,
    totalBaseAmount: 0,
    filedCount: 0,
    unfiledCount: 0,
  };
}

/**
 * Get VAT stats only (for server component)
 */
export async function getVATStats(filingPeriod = null) {
  const dashboard = await getVATDashboard(filingPeriod);
  return {
    filingPeriod: dashboard.filingPeriod,
    outputVAT: dashboard.output?.totalVAT || 0,
    inputVAT: dashboard.input?.totalVAT || 0,
    outputCount: dashboard.output?.transactionCount || 0,
    inputCount: dashboard.input?.transactionCount || 0,
    unfiledCount: (dashboard.output?.unfiledCount || 0) + (dashboard.input?.unfiledCount || 0),
    vatPayable: dashboard.summary?.vatPayable || 0,
    vatRefundable: dashboard.summary?.vatRefundable || 0,
    netPosition: dashboard.summary?.netPosition || 0,
  };
}

/**
 * Get WHT stats only (for server component)
 */
export async function getWHTStats(startDate = null, endDate = null) {
  const dashboard = await getWHTDashboard(startDate, endDate);
  return {
    period: dashboard.period,
    totalWHT: dashboard.summary?.totalWHT || 0,
    remitted: dashboard.summary?.remitted || 0,
    unremitted: dashboard.summary?.unremitted || 0,
    transactionCount: dashboard.summary?.transactionCount || 0,
    unremittedCount: dashboard.summary?.unremittedCount || 0,
  };
}

export default {
  getTaxTransactions,
  getTaxTransactionById,
  getVATDashboard,
  getWHTDashboard,
  getUnfiledTransactions,
  getUnremittedWHT,
  getTaxSummary,
  getFilingPeriods,
  searchTaxTransactions,
  getTaxTransactionStats,
  getVATStats,
  getWHTStats,
};
