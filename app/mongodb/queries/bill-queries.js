// app/lib/queries/bill/queries.js

// ============================================
// BILL QUERIES - READ OPERATIONS ONLY
// ============================================
// Next.js 16 Best Practices:
// ✅ Separate from actions (mutations)
// ✅ Server-only functions (not "use server")
// ✅ Returns serialized data for client components
// ✅ Proper error handling
// ✅ Efficient queries with lean()
// ============================================

import mongoose from "mongoose";
import Bill from "@/app/models/bill";
import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  withTenantScope,
} from "@/lib/utils/tenant-utils";

const { ObjectId } = mongoose.Types;

// ============================================
// SERIALIZATION HELPER
// ============================================
function serializeBill(bill) {
  if (!bill) return null;

  return {
    _id: bill._id.toString(),
    billNumber: bill.billNumber,
    supplierInvoiceNumber: bill.supplierInvoiceNumber || "",
    billDate: bill.billDate?.toISOString() || null,
    dueDate: bill.dueDate?.toISOString() || null,
    fiscalPeriod: bill.fiscalPeriod,

    supplier: {
      partyId: bill.supplier?.partyId?.toString() || null,
      name: bill.supplier?.name || "",
      taxPin: bill.supplier?.taxPin || "",
      email: bill.supplier?.email || "",
      phone: bill.supplier?.phone || "",
      address: bill.supplier?.address || "",
    },

    whtApplicable: bill.whtApplicable || false,
    whtRate: bill.whtRate || 0,

    lines: (bill.lines || []).map((line) => ({
      _id: line._id?.toString() || null,
      lineNumber: line.lineNumber,
      product: line.product
        ? {
            id: line.product.id?.toString() || null,
            sku: line.product.sku || "",
            name: line.product.name || "",
          }
        : null,
      description: line.description,
      account: {
        id: line.account?.id?.toString() || null,
        code: line.account?.code || "",
        name: line.account?.name || "",
        type: line.account?.type || "",
      },
      asset: line.asset?.id
        ? {
            id: line.asset.id.toString(),
            assetNumber: line.asset.assetNumber || "",
            name: line.asset.name || "",
          }
        : null,
      capitalizedAssetId: line.capitalizedAssetId?.toString() || null,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      amount: line.amount,
      vat: {
        rate: line.vat?.rate || 0,
        amount: line.vat?.amount || 0,
      },
      lineTotal: line.lineTotal,
    })),

    amounts: {
      subtotal: bill.amounts?.subtotal || 0,
      vatTotal: bill.amounts?.vatTotal || 0,
      whtAmount: bill.amounts?.whtAmount || 0,
      total: bill.amounts?.total || 0,
      paid: bill.amounts?.paid || 0,
      balance: bill.amounts?.balance || 0,
    },

    status: bill.status,
    paymentStatus: bill.paymentStatus || "unpaid",

    payments: (bill.payments || []).map((p) => ({
      paymentId: p.paymentId?.toString() || null,
      paymentNumber: p.paymentNumber || "",
      amount: p.amount,
      method: p.method,
      reference: p.reference || "",
      date: p.date?.toISOString() || null,
      recordedBy: {
        name: p.recordedBy?.name || "",
        id: p.recordedBy?.id || "",
      },
    })),

    accounting: {
      journalEntryId: bill.accounting?.journalEntryId?.toString() || null,
      reversalEntryId: bill.accounting?.reversalEntryId?.toString() || null,
      postedAt: bill.accounting?.postedAt?.toISOString() || null,
      // Three-way match flags — true once an accepted GRN has cleared GR/IR.
      inventoryMoved: bill.accounting?.inventoryMoved ?? true,
      usedGRNI: bill.accounting?.usedGRNI || false,
    },

    description: bill.description || "",
    internalNotes: bill.internalNotes || "",

    createdBy: {
      name: bill.createdBy?.name || "",
      id: bill.createdBy?.id || "",
    },
    submittedBy: bill.submittedBy
      ? {
          name: bill.submittedBy.name || "",
          id: bill.submittedBy.id || "",
        }
      : null,
    submittedAt: bill.submittedAt?.toISOString() || null,
    approvedBy: bill.approvedBy
      ? {
          name: bill.approvedBy.name || "",
          id: bill.approvedBy.id || "",
        }
      : null,
    approvedAt: bill.approvedAt?.toISOString() || null,
    rejectedBy: bill.rejectedBy
      ? {
          name: bill.rejectedBy.name || "",
          id: bill.rejectedBy.id || "",
        }
      : null,
    rejectedAt: bill.rejectedAt?.toISOString() || null,
    rejectionReason: bill.rejectionReason || "",
    cancelledBy: bill.cancelledBy
      ? {
          name: bill.cancelledBy.name || "",
          id: bill.cancelledBy.id || "",
        }
      : null,
    cancelledAt: bill.cancelledAt?.toISOString() || null,
    cancellationReason: bill.cancellationReason || "",

    createdAt: bill.createdAt?.toISOString() || null,
    updatedAt: bill.updatedAt?.toISOString() || null,

    // Virtual properties (calculated)
    canEdit: ["draft", "rejected"].includes(bill.status),
    canSubmit: bill.status === "draft",
    canApprove: bill.status === "submitted",
    canPay:
      bill.status === "approved" &&
      (bill.paymentStatus === "unpaid" || bill.paymentStatus === "partial"),
    canCancel:
      ["draft", "submitted", "approved"].includes(bill.status) &&
      (bill.amounts?.paid || 0) === 0,
  };
}

// ============================================
// GET BILLS LIST
// ============================================
export async function getBills({
  page = 1,
  limit = 10,
  search = "",
  status = "",
  paymentStatus = "",
  supplierId = "",
  sortBy = "createdAt",
  sortOrder = "desc",
} = {}) {
  try {
    await dbConnect();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();

    // Build query
    let query = {};

    // Search filter
    if (search) {
      query.$or = [
        { billNumber: { $regex: search, $options: "i" } },
        { supplierInvoiceNumber: { $regex: search, $options: "i" } },
        { "supplier.name": { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    // Status filter
    if (status) {
      query.status = status;
    }

    // Payment status filter
    if (paymentStatus) {
      query.paymentStatus = paymentStatus;
    }

    // Supplier filter
    if (supplierId) {
      query["supplier.partyId"] = supplierId;
    }

    // Apply tenant scoping
    query = withTenantScope(query, companyId, isSuperAdmin);

    // Build sort
    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    // Count total
    const total = await Bill.countDocuments(query);

    // Fetch bills
    const bills = await Bill.find(query)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return {
      bills: bills.map(serializeBill),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    };
  } catch (error) {
    console.error("Get bills error:", error);
    return {
      bills: [],
      pagination: {
        page: 1,
        limit,
        total: 0,
        totalPages: 0,
        hasMore: false,
      },
      error: error.message,
    };
  }
}

// ============================================
// GET SINGLE BILL
// ============================================
export async function getBillById(id) {
  try {
    await dbConnect();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();

    const bill = await Bill.findOne(
      withTenantScope({ _id: id }, companyId, isSuperAdmin)
    ).lean();

    if (!bill) {
      return { bill: null, error: "Bill not found" };
    }

    return { bill: serializeBill(bill), error: null };
  } catch (error) {
    console.error("Get bill by ID error:", error);
    return { bill: null, error: error.message };
  }
}

// ============================================
// GET BILLS STATS (For dashboard)
// ============================================
export async function getBillsStats() {
  try {
    await dbConnect();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();
    // Cast to ObjectId for aggregate $match — Mongoose auto-casts find()
    // queries but NOT aggregate pipelines, so a string companyId here
    // silently bypasses the (companyId, billDate, status) compound index.
    const tenantMatch = isSuperAdmin
      ? {}
      : { companyId: new ObjectId(companyId) };

    const stats = await Bill.aggregate([
      { $match: tenantMatch },
      {
        $facet: {
          // Count by status
          byStatus: [
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
                total: { $sum: "$amounts.total" },
              },
            },
          ],
          // Count by payment status
          byPaymentStatus: [
            {
              $match: { status: "approved" },
            },
            {
              $group: {
                _id: "$paymentStatus",
                count: { $sum: 1 },
                total: { $sum: "$amounts.total" },
                balance: { $sum: "$amounts.balance" },
              },
            },
          ],
          // Overdue bills
          overdue: [
            {
              $match: {
                status: "approved",
                paymentStatus: { $in: ["unpaid", "partial"] },
                dueDate: { $lt: new Date() },
              },
            },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                total: { $sum: "$amounts.balance" },
              },
            },
          ],
          // This month
          thisMonth: [
            {
              $match: {
                billDate: {
                  $gte: new Date(
                    new Date().getFullYear(),
                    new Date().getMonth(),
                    1
                  ),
                },
              },
            },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                total: { $sum: "$amounts.total" },
              },
            },
          ],
          // Pending approval
          pendingApproval: [
            {
              $match: { status: "submitted" },
            },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                total: { $sum: "$amounts.total" },
              },
            },
          ],
        },
      },
    ]);

    const result = stats[0] || {};

    // Transform to easier format
    const byStatus = {};
    (result.byStatus || []).forEach((s) => {
      byStatus[s._id] = { count: s.count, total: s.total };
    });

    const byPaymentStatus = {};
    (result.byPaymentStatus || []).forEach((s) => {
      byPaymentStatus[s._id] = {
        count: s.count,
        total: s.total,
        balance: s.balance,
      };
    });

    return {
      byStatus,
      byPaymentStatus,
      overdue: result.overdue?.[0] || { count: 0, total: 0 },
      thisMonth: result.thisMonth?.[0] || { count: 0, total: 0 },
      pendingApproval: result.pendingApproval?.[0] || { count: 0, total: 0 },
    };
  } catch (error) {
    console.error("Get bills stats error:", error);
    return {
      byStatus: {},
      byPaymentStatus: {},
      overdue: { count: 0, total: 0 },
      thisMonth: { count: 0, total: 0 },
      pendingApproval: { count: 0, total: 0 },
      error: error.message,
    };
  }
}

// ============================================
// GET BILLS BY SUPPLIER
// ============================================
export async function getBillsBySupplier(supplierId, options = {}) {
  return getBills({ ...options, supplierId });
}

// ============================================
// GET BILLS AWAITING GOODS RECEIPT
// ============================================
// Used by the GRN create form's in-form picker for sourceType="bill".
// Returns approved strict-mode bills (usedGRNI=true, inventoryMoved=false)
// — i.e., bills that posted to GR/IR clearing and still need a GRN
// accepted to admit inventory and unlock payment.
export async function getBillsAwaitingGRN() {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    let query = {
      status: "approved",
      "accounting.usedGRNI": true,
      "accounting.inventoryMoved": { $ne: true },
    };
    query = withTenantScope(query, companyId, isSuperAdmin);

    const bills = await Bill.find(query)
      .sort({ billDate: -1 })
      .lean();

    return bills.map(serializeBill).filter(Boolean);
  } catch (error) {
    console.error("Error fetching bills awaiting GRN:", error);
    return [];
  }
}

// ============================================
// GET UNPAID BILLS (For payment module)
// ============================================
export async function getUnpaidBills(supplierId = null) {
  try {
    await dbConnect();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();

    let query = {
      status: "approved",
      paymentStatus: { $in: ["unpaid", "partial"] },
    };

    if (supplierId) {
      query["supplier.partyId"] = supplierId;
    }

    // Apply tenant scoping
    query = withTenantScope(query, companyId, isSuperAdmin);

    const bills = await Bill.find(query)
      .select(
        "billNumber supplierInvoiceNumber supplier.name billDate dueDate amounts"
      )
      .sort({ dueDate: 1 })
      .lean();

    return bills.map((bill) => ({
      _id: bill._id.toString(),
      billNumber: bill.billNumber,
      supplierInvoiceNumber: bill.supplierInvoiceNumber || "",
      supplierName: bill.supplier?.name || "",
      billDate: bill.billDate?.toISOString() || null,
      dueDate: bill.dueDate?.toISOString() || null,
      total: bill.amounts?.total || 0,
      paid: bill.amounts?.paid || 0,
      balance: bill.amounts?.balance || 0,
      isOverdue: bill.dueDate && new Date(bill.dueDate) < new Date(),
    }));
  } catch (error) {
    console.error("Get unpaid bills error:", error);
    return [];
  }
}

// ============================================
// GET AP AGING REPORT
// ============================================
export async function getAPAgingReport() {
  try {
    await dbConnect();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const bills = await Bill.find(
      withTenantScope({
        status: "approved",
        paymentStatus: { $in: ["unpaid", "partial"] },
      }, companyId, isSuperAdmin)
    )
      .select("billNumber supplier dueDate amounts")
      .lean();

    const aging = {
      current: { count: 0, total: 0 },
      days1to30: { count: 0, total: 0 },
      days31to60: { count: 0, total: 0 },
      days61to90: { count: 0, total: 0 },
      over90: { count: 0, total: 0 },
      total: { count: 0, total: 0 },
    };

    bills.forEach((bill) => {
      const balance = bill.amounts?.balance || 0;
      const dueDate = new Date(bill.dueDate);
      const daysPastDue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));

      aging.total.count += 1;
      aging.total.total += balance;

      if (daysPastDue <= 0) {
        aging.current.count += 1;
        aging.current.total += balance;
      } else if (daysPastDue <= 30) {
        aging.days1to30.count += 1;
        aging.days1to30.total += balance;
      } else if (daysPastDue <= 60) {
        aging.days31to60.count += 1;
        aging.days31to60.total += balance;
      } else if (daysPastDue <= 90) {
        aging.days61to90.count += 1;
        aging.days61to90.total += balance;
      } else {
        aging.over90.count += 1;
        aging.over90.total += balance;
      }
    });

    return aging;
  } catch (error) {
    console.error("Get AP aging report error:", error);
    return {
      current: { count: 0, total: 0 },
      days1to30: { count: 0, total: 0 },
      days31to60: { count: 0, total: 0 },
      days61to90: { count: 0, total: 0 },
      over90: { count: 0, total: 0 },
      total: { count: 0, total: 0 },
      error: error.message,
    };
  }
}
