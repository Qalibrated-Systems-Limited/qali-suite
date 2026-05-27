import dbConnect from "../../config/dbConnect";
import Account from "../../models/account";
import Party from "../../models/parties";
import Product from "../../models/product";
import Invoice from "../../models/invoice";
import Counter from "../../models/counter";
import { serializeBsonType } from "@/lib/utils";
import { ObjectId } from "mongodb";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";

// ============================================
// FETCH ACTIVE CUSTOMERS
// ============================================
export const fetchActiveCustomers = async () => {
  await dbConnect();
  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  const customers = await Party.find(
    withTenantScope(
      {
        type: { $in: ["customer", "both"] },
        isActive: true,
      },
      companyId,
      isSuperAdmin,
    ),
  )
    .sort({ name: 1 })
    .lean();

  // Format address helper
  const formatAddress = (address) => {
    if (!address) return "";
    const parts = [
      address.line1,
      address.line2,
      address.city,
      address.postalCode,
      address.country,
    ].filter(Boolean);
    return parts.join(", ");
  };

  return customers.map((customer) => ({
    _id: customer._id.toString(),
    name: customer.displayName || customer.name,
    email: customer.email || "",
    phoneNumber: customer.phone || "",
    address: formatAddress(customer.address),
    taxPin: customer.taxPin || "",
  }));
};

// ============================================
// FETCH AVAILABLE PRODUCTS
// ============================================
export const fetchAvailableProducts = async () => {
  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  // ERP: Use inventory.quantityAvailable (on hand - committed)
  const products = await Product.find(
    withTenantScope(
      {
        $or: [
          { "inventory.quantityAvailable": { $gt: 0 } },
          { stock: { $gt: 0 } }, // Fallback for legacy products
        ],
      },
      companyId,
      isSuperAdmin,
    ),
  )
    .sort({ name: 1 })
    .lean();

  return products.map((product) => ({
    _id: product._id.toString(),
    name: product.name,
    SKU: product.SKU,
    unit: product.unit,
    category: product.category,
    // Inventory tracking
    inventory: {
      quantityOnHand: product.inventory?.quantityOnHand ?? 0,
      quantityAvailable: product.inventory?.quantityAvailable ?? 0,
      quantityCommitted: product.inventory?.quantityCommitted ?? 0,
    },
    // Costing & pricing
    costing: product.costing,
    pricing: product.pricing,
  }));
};

// ============================================
// GENERATE INVOICE NUMBER (tenant-scoped with company code prefix)
// ============================================
export const generateInvoiceNumber = async (
  tenantCompanyId,
  session = null,
) => {
  const { format } = await import("date-fns");
  const Company = (await import("../../models/Company")).default;

  // Fetch company code for prefix
  let companyCode = null;
  if (tenantCompanyId) {
    const company = await Company.findById(tenantCompanyId)
      .select("code name")
      .lean();

    if (company) {
      // Use explicit code if set, otherwise derive from company name
      companyCode = company.code || deriveCompanyCode(company.name);
    }
  }

  const today = format(new Date(), "ddMMyy");

  // Include company code in the counter name for tenant isolation
  const counterId = companyCode
    ? `inv-${companyCode.toLowerCase()}-${today}`
    : tenantCompanyId
      ? `inv-${tenantCompanyId}-${today}`
      : `inv-${today}`;

  const counter = await Counter.findOneAndUpdate(
    { name: counterId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session },
  );

  if (!counter) {
    throw new Error("Failed to generate invoice number");
  }

  // Format: INV-{CODE}-{DDMMYY}-{NNN} or INV-{DDMMYY}-{NNN}
  const prefix = companyCode ? `INV-${companyCode}` : "INV";
  return `${prefix}-${today}-${String(counter.seq).padStart(3, "0")}`;
};

/**
 * Derive a company code from company name
 * Takes first letters of each word (up to 4 chars) or first 3-4 chars if single word
 */
function deriveCompanyCode(name) {
  if (!name) return null;

  const words = name.trim().split(/\s+/);

  if (words.length >= 2) {
    // Multiple words: take first letter of each (up to 4)
    return words
      .slice(0, 4)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  } else {
    // Single word: take first 3-4 characters
    return name.slice(0, 3).toUpperCase();
  }
}

// ============================================
// GET CUSTOMER BY ID
// ============================================
export const getCustomerById = async (customerId) => {
  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  const customer = await Party.findOne(
    withTenantScope({ _id: customerId }, companyId, isSuperAdmin),
  ).lean();

  if (!customer) {
    return null;
  }

  // Verify it's a customer
  if (customer.type !== "customer" && customer.type !== "both") {
    return null;
  }

  // Format address from Party model
  const formatAddress = (address) => {
    if (!address) return "";
    const parts = [
      address.line1,
      address.line2,
      address.city,
      address.postalCode,
      address.country,
    ].filter(Boolean);
    return parts.join(", ");
  };

  return {
    _id: customer._id.toString(),
    name: customer.displayName || customer.name,
    email: customer.email || "",
    phoneNumber: customer.phone || "",
    address: formatAddress(customer.address),
    taxPin: customer.taxPin || "",
  };
};

// ============================================
// SEARCH INVOICES
// ============================================
export const searchInvoices = async (
  searchTerm = "",
  page = 1,
  filters = {},
) => {
  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin
    ? {}
    : { companyId: new ObjectId(companyId) };

  const ITEMS_PER_PAGE = 20;
  const skipRecords = (page - 1) * ITEMS_PER_PAGE;

  const { paymentStatus, status, startDate, endDate } = filters;

  // Build filter conditions
  let additionalFilters = { ...tenantMatch };

  if (paymentStatus && paymentStatus !== "all") {
    additionalFilters.paymentStatus = paymentStatus;
  }

  if (status && status !== "all") {
    additionalFilters.status = status;
  }

  if (startDate || endDate) {
    additionalFilters.invoiceDate = {};
    if (startDate) {
      additionalFilters.invoiceDate.$gte = new Date(startDate);
    }
    if (endDate) {
      const endDateTime = new Date(endDate);
      endDateTime.setDate(endDateTime.getDate() + 1);
      additionalFilters.invoiceDate.$lt = endDateTime;
    }
  }

  const searchStage = {
    $match: {
      $and: [
        additionalFilters,
        {
          $or: [
            { invoiceNumber: { $regex: searchTerm, $options: "i" } },
            { "customer.name": { $regex: searchTerm, $options: "i" } },
            { "customer.email": { $regex: searchTerm, $options: "i" } },
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

  if (searchTerm && searchTerm.length >= 2) {
    pipeline = [searchStage, sortStage, ...paginationStage];
  }

  let result = await Invoice.aggregate(pipeline);

  // Properly serialize all data
  result = result.map((invoice) => ({
    ...invoice,
    _id: invoice._id.toString(),
    invoiceDate: invoice.invoiceDate?.toISOString(),
    dueDate: invoice.dueDate?.toISOString() || null,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt?.toISOString() || null,
    // Serialize items array
    items: invoice.items.map((item) => ({
      ...item,
      _id: item._id?.toString(),
      productId: item.productId?.toString() || null,
    })),
    // Serialize related documents
    relatedDocuments: invoice.relatedDocuments
      ? {
          movementIds:
            invoice.relatedDocuments.movementIds?.map((id) => id.toString()) ||
            [],
        }
      : { movementIds: [] },
  }));

  return serializeBsonType(result);
};

// ============================================
// FETCH INVOICE PAGES
// ============================================
export const fetchInvoicePages = async (searchTerm = "", filters = {}) => {
  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin
    ? {}
    : { companyId: new ObjectId(companyId) };

  const ITEMS_PER_PAGE = 20;
  const { paymentStatus, status, startDate, endDate } = filters;

  let additionalFilters = { ...tenantMatch };

  if (paymentStatus && paymentStatus !== "all") {
    additionalFilters.paymentStatus = paymentStatus;
  }

  if (status && status !== "all") {
    additionalFilters.status = status;
  }

  if (startDate || endDate) {
    additionalFilters.invoiceDate = {};
    if (startDate) {
      additionalFilters.invoiceDate.$gte = new Date(startDate);
    }
    if (endDate) {
      const endDateTime = new Date(endDate);
      endDateTime.setDate(endDateTime.getDate() + 1);
      additionalFilters.invoiceDate.$lt = endDateTime;
    }
  }

  const searchStage = {
    $match: {
      $and: [
        additionalFilters,
        {
          $or: [
            { invoiceNumber: { $regex: searchTerm, $options: "i" } },
            { "customer.name": { $regex: searchTerm, $options: "i" } },
            { "customer.email": { $regex: searchTerm, $options: "i" } },
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

  if (searchTerm && searchTerm.length >= 2) {
    pipeline = [searchStage, countStage];
  }

  const result = await Invoice.aggregate(pipeline);

  let count = 0;
  if (result && result.length > 0) {
    count = result[0].totalRecords;
  }

  const noOfPages = Math.ceil(Number(count) / ITEMS_PER_PAGE);

  return noOfPages;
};

// ============================================
// GET INVOICE BY ID
// ============================================
export const getInvoiceById = async (invoiceId) => {
  await dbConnect();
  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();

  const invoice = await Invoice.findOne(
    withTenantScope({ _id: invoiceId }, companyId, isSuperAdmin),
  ).lean();

  if (!invoice) {
    return null;
  }

  // Full BSON round-trip — was hand-serializing only top-level + items +
  // relatedDocuments, which left companyId, accounting.journalEntryId,
  // accounting.reversalEntryId, paymentHistory[].paymentId, customer.id
  // and any other nested ObjectIds as raw BSON. That triggers
  // "Only plain objects can be passed to Client Components" when the
  // invoice is forwarded to any client subtree.
  return serializeBsonType(invoice);
};

// ============================================
// GET INVOICE STATS
// ============================================
export const getInvoiceStats = async (filters = {}) => {
  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin
    ? {}
    : { companyId: new ObjectId(companyId) };

  const { startDate, endDate } = filters;

  let matchConditions = { ...tenantMatch };

  if (startDate || endDate) {
    matchConditions.invoiceDate = {};
    if (startDate) {
      matchConditions.invoiceDate.$gte = new Date(startDate);
    }
    if (endDate) {
      const endDateTime = new Date(endDate);
      endDateTime.setDate(endDateTime.getDate() + 1);
      matchConditions.invoiceDate.$lt = endDateTime;
    }
  }

  const pipeline = [
    { $match: matchConditions },
    {
      $group: {
        _id: null,
        totalInvoices: { $sum: 1 },
        totalPaid: {
          $sum: {
            $cond: [{ $eq: ["$paymentStatus", "paid"] }, 1, 0],
          },
        },
        totalUnpaid: {
          $sum: {
            $cond: [{ $eq: ["$paymentStatus", "unpaid"] }, 1, 0],
          },
        },
        totalPartial: {
          $sum: {
            $cond: [{ $eq: ["$paymentStatus", "partial"] }, 1, 0],
          },
        },
        totalRevenue: { $sum: "$total" },
        totalAmountPaid: { $sum: "$amountPaid" },
      },
    },
  ];

  const result = await Invoice.aggregate(pipeline);

  if (result.length === 0) {
    return {
      totalInvoices: 0,
      totalPaid: 0,
      totalUnpaid: 0,
      totalPartial: 0,
      totalRevenue: 0,
      totalAmountPaid: 0,
      balanceDue: 0,
    };
  }

  const stats = result[0];

  return {
    totalInvoices: stats.totalInvoices,
    totalPaid: stats.totalPaid,
    totalUnpaid: stats.totalUnpaid,
    totalPartial: stats.totalPartial,
    totalRevenue: stats.totalRevenue,
    totalAmountPaid: stats.totalAmountPaid,
    balanceDue: stats.totalRevenue - stats.totalAmountPaid,
  };
};

// ============================================
// GET FULFILLED REQUESTS FOR CUSTOMER (for linking to invoices)
// ============================================
export const getFulfilledRequestsForCustomer = async (customerId) => {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const { StockRequest } = await import("../../models/requests");

  const requests = await StockRequest.find(
    withTenantScope(
      {
        "customer.id": customerId,
        status: { $in: ["fulfilled", "partially_fulfilled"] },
      },
      companyId,
      isSuperAdmin,
    ),
  )
    .sort({ updatedAt: -1 })
    .lean();

  // Filter requests that have items not fully invoiced
  const availableRequests = requests
    .map((request) => {
      const availableItems = request.items.filter((item) => {
        const totalFulfilled = item.totalFulfilled || 0;
        const invoiced = item.invoicedQuantity || 0;
        return totalFulfilled > invoiced; // Has un-invoiced items
      });

      if (availableItems.length === 0) return null;

      return {
        _id: request._id.toString(),
        requestNumber: request.requestNumber,
        requesterName: request.requester.name,
        technicianId: request.requester.id,
        technicianName: request.requester.name,
        items: availableItems.map((item) => ({
          productId: item.productId.toString(),
          productName: item.productName,
          SKU: item.SKU,
          totalFulfilled: item.totalFulfilled || 0,
          invoicedQuantity: item.invoicedQuantity || 0,
          availableToInvoice:
            (item.totalFulfilled || 0) - (item.invoicedQuantity || 0),
          unit: item.unit,
          unitPrice: item.unitPrice,
        })),
      };
    })
    .filter(Boolean); // Remove null entries

  return availableRequests;
};
