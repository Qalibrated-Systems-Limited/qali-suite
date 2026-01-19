import Quote from "@/app/models/quote";
import dbConnect from "@/app/config/dbConnect";
import { serializeBsonType } from "@/lib/utils";

// ============================================
// SEARCH QUOTES
// ============================================
export async function searchQuotes(query = "", page = 1, filters = {}) {
  await dbConnect();

  const ITEMS_PER_PAGE = 10;
  const skip = (page - 1) * ITEMS_PER_PAGE;

  // Build filter query
  const filterQuery = {};

  // Search by quote number or customer name
  if (query) {
    filterQuery.$or = [
      { quoteNumber: { $regex: query, $options: "i" } },
      { "customer.name": { $regex: query, $options: "i" } },
    ];
  }

  // Status filter
  if (filters.status && filters.status !== "all") {
    filterQuery.status = filters.status;
  }

  // Date range filter
  if (filters.startDate) {
    filterQuery.quoteDate = filterQuery.quoteDate || {};
    filterQuery.quoteDate.$gte = new Date(filters.startDate);
  }
  if (filters.endDate) {
    filterQuery.quoteDate = filterQuery.quoteDate || {};
    filterQuery.quoteDate.$lte = new Date(filters.endDate);
  }

  // Customer filter
  if (filters.customerId) {
    filterQuery.$or = [
      { "customer.partyId": filters.customerId },
      { "customer.id": filters.customerId },
    ];
  }

  // Expiring soon filter
  if (filters.expiringSoon) {
    const now = new Date();
    const futureDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    filterQuery.status = { $in: ["draft", "sent"] };
    filterQuery.validUntil = { $gte: now, $lte: futureDate };
  }

  const quotes = await Quote.find(filterQuery)
    .sort({ quoteDate: -1, createdAt: -1 })
    .skip(skip)
    .limit(ITEMS_PER_PAGE)
    .lean();

  // Serialize for client
  return quotes.map((quote) => serializeBsonType(quote));
}

// ============================================
// FETCH QUOTE PAGES
// ============================================
export async function fetchQuotePages(query = "", filters = {}) {
  await dbConnect();

  const ITEMS_PER_PAGE = 10;

  const filterQuery = {};

  if (query) {
    filterQuery.$or = [
      { quoteNumber: { $regex: query, $options: "i" } },
      { "customer.name": { $regex: query, $options: "i" } },
    ];
  }

  if (filters.status && filters.status !== "all") {
    filterQuery.status = filters.status;
  }

  if (filters.startDate) {
    filterQuery.quoteDate = filterQuery.quoteDate || {};
    filterQuery.quoteDate.$gte = new Date(filters.startDate);
  }
  if (filters.endDate) {
    filterQuery.quoteDate = filterQuery.quoteDate || {};
    filterQuery.quoteDate.$lte = new Date(filters.endDate);
  }

  if (filters.customerId) {
    filterQuery.$or = [
      { "customer.partyId": filters.customerId },
      { "customer.id": filters.customerId },
    ];
  }

  const count = await Quote.countDocuments(filterQuery);
  return Math.ceil(count / ITEMS_PER_PAGE);
}

// ============================================
// GET QUOTE STATS
// ============================================
export async function getQuoteStats(filters = {}) {
  await dbConnect();

  const now = new Date();
  const sevenDaysAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Build base query
  const baseQuery = {};
  if (filters.startDate) {
    baseQuery.quoteDate = baseQuery.quoteDate || {};
    baseQuery.quoteDate.$gte = new Date(filters.startDate);
  }
  if (filters.endDate) {
    baseQuery.quoteDate = baseQuery.quoteDate || {};
    baseQuery.quoteDate.$lte = new Date(filters.endDate);
  }

  const [stats] = await Quote.aggregate([
    { $match: { ...baseQuery, status: { $ne: "cancelled" } } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        totalValue: { $sum: "$total" },
        draft: {
          $sum: { $cond: [{ $eq: ["$status", "draft"] }, 1, 0] },
        },
        sent: {
          $sum: { $cond: [{ $eq: ["$status", "sent"] }, 1, 0] },
        },
        accepted: {
          $sum: { $cond: [{ $eq: ["$status", "accepted"] }, 1, 0] },
        },
        rejected: {
          $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] },
        },
        converted: {
          $sum: { $cond: [{ $eq: ["$status", "converted"] }, 1, 0] },
        },
        expired: {
          $sum: { $cond: [{ $eq: ["$status", "expired"] }, 1, 0] },
        },
        draftValue: {
          $sum: {
            $cond: [{ $eq: ["$status", "draft"] }, "$total", 0],
          },
        },
        openValue: {
          $sum: {
            $cond: [
              { $in: ["$status", ["sent", "accepted"]] },
              "$total",
              0,
            ],
          },
        },
        convertedValue: {
          $sum: {
            $cond: [{ $eq: ["$status", "converted"] }, "$total", 0],
          },
        },
      },
    },
  ]);

  // Get expiring soon count
  const expiringCount = await Quote.countDocuments({
    ...baseQuery,
    status: { $in: ["draft", "sent"] },
    validUntil: { $gte: now, $lte: sevenDaysAhead },
  });

  // Calculate conversion rate
  const totalSentOrBetter = (stats?.sent || 0) +
    (stats?.accepted || 0) +
    (stats?.converted || 0) +
    (stats?.rejected || 0);
  const converted = (stats?.accepted || 0) + (stats?.converted || 0);
  const conversionRate = totalSentOrBetter > 0
    ? Math.round((converted / totalSentOrBetter) * 100)
    : 0;

  return {
    total: stats?.total || 0,
    totalValue: stats?.totalValue || 0,
    draft: stats?.draft || 0,
    sent: stats?.sent || 0,
    accepted: stats?.accepted || 0,
    rejected: stats?.rejected || 0,
    converted: stats?.converted || 0,
    expired: stats?.expired || 0,
    draftValue: stats?.draftValue || 0,
    openValue: stats?.openValue || 0,
    convertedValue: stats?.convertedValue || 0,
    expiringCount,
    conversionRate,
  };
}

// ============================================
// GET QUOTE BY ID
// ============================================
export async function getQuoteById(id) {
  await dbConnect();

  const quote = await Quote.findById(id).lean();
  if (!quote) return null;

  return serializeBsonType(quote);
}

// ============================================
// GET ACTIVE QUOTES FOR CUSTOMER (for Invoice creation)
// ============================================
export async function getActiveQuotesForCustomer(customerId) {
  await dbConnect();

  const now = new Date();

  const quotes = await Quote.find({
    $or: [
      { "customer.partyId": customerId },
      { "customer.id": customerId },
    ],
    status: { $in: ["sent", "accepted"] },
    validUntil: { $gte: now },
  })
    .sort({ quoteDate: -1 })
    .lean();

  return quotes.map((quote) => serializeBsonType(quote));
}

// ============================================
// GET RECENT QUOTES
// ============================================
export async function getRecentQuotes(limit = 5) {
  await dbConnect();

  const quotes = await Quote.find({
    status: { $ne: "cancelled" },
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return quotes.map((quote) => serializeBsonType(quote));
}

// ============================================
// GET QUOTES EXPIRING SOON
// ============================================
export async function getExpiringQuotes(daysAhead = 7) {
  await dbConnect();

  const now = new Date();
  const futureDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const quotes = await Quote.find({
    status: { $in: ["draft", "sent"] },
    validUntil: { $gte: now, $lte: futureDate },
  })
    .sort({ validUntil: 1 })
    .lean();

  return quotes.map((quote) => serializeBsonType(quote));
}

// ============================================
// GET QUOTES WITH AVAILABLE ITEMS
// ============================================
export async function getQuotesWithAvailableItems(customerId = null) {
  await dbConnect();

  const now = new Date();

  const query = {
    status: { $in: ["sent", "accepted"] },
    validUntil: { $gte: now },
  };

  if (customerId) {
    query.$or = [
      { "customer.partyId": customerId },
      { "customer.id": customerId },
    ];
  }

  const quotes = await Quote.find(query).sort({ quoteDate: -1 }).lean();

  // Filter to only quotes with available items
  const quotesWithAvailable = quotes
    .map((quote) => {
      const availableItems = quote.items.filter(
        (item) => (item.invoicedQuantity || 0) < item.quantity
      );
      return {
        ...quote,
        availableItems,
      };
    })
    .filter((quote) => quote.availableItems.length > 0);

  return quotesWithAvailable.map((quote) => serializeBsonType(quote));
}

// ============================================
// GENERATE QUOTE NUMBER
// ============================================
export async function generateQuoteNumber() {
  await dbConnect();
  return Quote.generateQuoteNumber();
}
