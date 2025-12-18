import dbConnect from "../../config/dbConnect";
import Account from "../../models/account";
import Product from "../../models/product";
import Invoice from "../../models/invoice";
import Counter from "../../models/counter";

dbConnect();

// ============================================
// FETCH ACTIVE CUSTOMERS
// ============================================
export const fetchActiveCustomers = async () => {
  const customers = await Account.find({ status: "Active" })
    .sort({ name: 1 })
    .lean();

  return customers.map((customer) => ({
    _id: customer._id.toString(),
    name: customer.name,
    email: customer.email || "",
    phoneNumber: customer.phoneNumber || "",
    address: customer.address || "",
  }));
};

// ============================================
// FETCH AVAILABLE PRODUCTS
// ============================================
export const fetchAvailableProducts = async () => {
  const products = await Product.find({ stock: { $gt: 0 } })
    .sort({ name: 1 })
    .lean();

  return products.map((product) => ({
    _id: product._id.toString(),
    name: product.name,
    SKU: product.SKU,
    price: product.price,
    stock: product.stock,
    unit: product.unit,
    category: product.category,
  }));
};

// ============================================
// GENERATE INVOICE NUMBER
// ============================================
export const generateInvoiceNumber = async (session = null) => {
  const { format } = await import("date-fns");

  const today = format(new Date(), "ddMMyy");
  const counterId = `INV-${today}`;

  const counter = await Counter.findOneAndUpdate(
    { name: counterId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session }
  );

  if (!counter) {
    throw new Error("Failed to generate invoice number");
  }

  return `${counterId}-${String(counter.seq).padStart(3, "0")}`;
};

// ============================================
// GET CUSTOMER BY ID
// ============================================
export const getCustomerById = async (customerId) => {
  const customer = await Account.findById(customerId).lean();

  if (!customer) {
    return null;
  }

  return {
    _id: customer._id.toString(),
    name: customer.name,
    email: customer.email || "",
    phoneNumber: customer.phoneNumber || "",
    address: customer.address || "",
  };
};

// ============================================
// SEARCH INVOICES
// ============================================
export const searchInvoices = async (
  searchTerm = "",
  page = 1,
  filters = {}
) => {
  const ITEMS_PER_PAGE = 20;
  const skipRecords = (page - 1) * ITEMS_PER_PAGE;

  const { paymentStatus, status, startDate, endDate } = filters;

  // Build filter conditions
  let additionalFilters = {};

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

  if (searchTerm && searchTerm.length > 0) {
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

  return result;
};

// ============================================
// FETCH INVOICE PAGES
// ============================================
export const fetchInvoicePages = async (searchTerm = "", filters = {}) => {
  const ITEMS_PER_PAGE = 20;
  const { paymentStatus, status, startDate, endDate } = filters;

  let additionalFilters = {};

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

  if (searchTerm && searchTerm.length > 0) {
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
  const invoice = await Invoice.findById(invoiceId).lean();

  if (!invoice) {
    return null;
  }

  return {
    ...invoice,
    _id: invoice._id.toString(),
    invoiceDate: invoice.invoiceDate?.toISOString(),
    dueDate: invoice.dueDate?.toISOString() || null,
    createdAt: invoice.createdAt?.toISOString(),
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
  };
};

// ============================================
// GET INVOICE STATS
// ============================================
export const getInvoiceStats = async (filters = {}) => {
  const { startDate, endDate } = filters;

  let matchConditions = {};

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
