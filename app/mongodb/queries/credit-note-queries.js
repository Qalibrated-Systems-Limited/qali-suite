import dbConnect from "@/app/config/dbConnect";
import CreditNote from "@/app/models/creditNote";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { ObjectId } from "mongodb";

// ============================================
// GET CREDIT NOTE BY ID
// ============================================
export async function getCreditNoteById(id) {
  // Validate ObjectId format
  if (!id || !ObjectId.isValid(id)) {
    return null;
  }

  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const query = { _id: new ObjectId(id) };
  if (!isSuperAdmin && companyId) {
    query.companyId = new ObjectId(companyId);
  }

  const creditNote = await CreditNote.findOne(query).lean();

  return creditNote;
}

// ============================================
// GET CREDIT NOTES LIST
// ============================================
export async function getCreditNotes(filters = {}, limit = 50, cursor = null) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const query = {};
  if (!isSuperAdmin && companyId) {
    query.companyId = new ObjectId(companyId);
  }

  // Status filter
  if (filters.status && filters.status !== "all") {
    query.status = filters.status;
  }

  // Date range filter
  if (filters.startDate || filters.endDate) {
    query.creditNoteDate = {};
    if (filters.startDate) {
      query.creditNoteDate.$gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      query.creditNoteDate.$lte = new Date(filters.endDate);
    }
  }

  // Customer filter
  if (filters.customerId) {
    query["customer.id"] = filters.customerId;
  }

  // Invoice filter
  if (filters.invoiceId) {
    query["invoice.id"] = filters.invoiceId;
  }

  // Search
  if (filters.search) {
    const searchRegex = new RegExp(filters.search, "i");
    query.$or = [
      { creditNoteNumber: searchRegex },
      { "customer.name": searchRegex },
      { "invoice.invoiceNumber": searchRegex },
      { reasonDescription: searchRegex },
    ];
  }

  // Cursor-based pagination
  if (cursor) {
    query._id = { $lt: cursor };
  }

  const creditNotes = await CreditNote.find(query)
    .sort({ creditNoteDate: -1, _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = creditNotes.length > limit;
  if (hasMore) {
    creditNotes.pop();
  }

  const nextCursor = hasMore ? creditNotes[creditNotes.length - 1]._id : null;

  return {
    creditNotes,
    hasMore,
    nextCursor,
  };
}

// ============================================
// GET CREDIT NOTES BY INVOICE
// ============================================
export async function getCreditNotesByInvoice(invoiceId) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const query = {
    "invoice.id": invoiceId,
    status: { $ne: "void" },
  };
  if (!isSuperAdmin && companyId) {
    query.companyId = new ObjectId(companyId);
  }

  const creditNotes = await CreditNote.find(query)
    .sort({ creditNoteDate: -1 })
    .lean();

  return creditNotes;
}

// ============================================
// GET CREDIT NOTES BY CUSTOMER
// ============================================
export async function getCreditNotesByCustomer(customerId) {
  await dbConnect();
  const { companyId } = await getTenantContext();

  const creditNotes = await CreditNote.find({
    companyId: new ObjectId(companyId),
    "customer.id": customerId,
    status: { $ne: "void" },
  })
    .sort({ creditNoteDate: -1 })
    .lean();

  return creditNotes;
}

// ============================================
// GET CREDIT NOTE STATS
// ============================================
export async function getCreditNoteStats() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const matchStage = {};
  if (!isSuperAdmin && companyId) {
    matchStage.companyId = new ObjectId(companyId);
  }

  const stats = await CreditNote.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        total: { $sum: "$total" },
      },
    },
  ]);

  const result = {
    draft: { count: 0, total: 0 },
    issued: { count: 0, total: 0 },
    applied: { count: 0, total: 0 },
    void: { count: 0, total: 0 },
    totalCount: 0,
    totalValue: 0,
  };

  for (const stat of stats) {
    result[stat._id] = { count: stat.count, total: stat.total };
    if (stat._id !== "void") {
      result.totalCount += stat.count;
      result.totalValue += stat.total;
    }
  }

  return result;
}
