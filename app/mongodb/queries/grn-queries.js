// ============================================
// GRN QUERIES — READ OPERATIONS ONLY
// ============================================

import GoodsReceipt from "@/app/models/goodsReceipt";
import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  withTenantScope,
} from "@/lib/utils/tenant-utils";

const ITEMS_PER_PAGE = 20;

function serializeLine(l) {
  return {
    _id: l._id?.toString() || null,
    productId: l.productId?.toString() || null,
    sku: l.sku || "",
    description: l.description || "",
    expectedQty: l.expectedQty || 0,
    receivedQty: l.receivedQty || 0,
    acceptedQty: l.acceptedQty || 0,
    unit: l.unit || "pcs",
    packagingCondition: l.packagingCondition || "good",
    physicalCondition: l.physicalCondition || "good",
    inspectionNotes: l.inspectionNotes || "",
    photoUrls: Array.isArray(l.photoUrls) ? l.photoUrls : [],
    lineStatus: l.lineStatus || "pending",
    rejectReason: l.rejectReason || "",
    storageLocation: l.storageLocation || "",
    inventoryApplied: !!l.inventoryApplied,
  };
}

function serializeGRN(g) {
  if (!g) return null;
  return {
    _id: g._id.toString(),
    grnNumber: g.grnNumber,
    status: g.status,
    receivedDate: g.receivedDate?.toISOString() || null,
    source: {
      type: g.source?.type || "bill",
      billId: g.source?.billId?.toString() || null,
      purchaseOrderId: g.source?.purchaseOrderId?.toString() || null,
      proformaInvoiceNumber: g.source?.proformaInvoiceNumber || "",
      packingListNumber: g.source?.packingListNumber || "",
    },
    supplier: {
      partyId: g.supplier?.partyId?.toString() || null,
      name: g.supplier?.name || "",
    },
    receivedBy: g.receivedBy || null,
    lines: (g.lines || []).map(serializeLine),
    hasDiscrepancy: !!g.hasDiscrepancy,
    discrepancyNotes: g.discrepancyNotes || "",
    salesAccepted: g.salesAccepted?.at
      ? {
          name: g.salesAccepted.name,
          at: g.salesAccepted.at.toISOString(),
          notes: g.salesAccepted.notes || "",
        }
      : null,
    financeAccepted: g.financeAccepted?.at
      ? {
          name: g.financeAccepted.name,
          at: g.financeAccepted.at.toISOString(),
          notes: g.financeAccepted.notes || "",
        }
      : null,
    acceptedAt: g.acceptedAt?.toISOString() || null,
    rejectedAt: g.rejectedAt?.toISOString() || null,
    rejectedBy: g.rejectedBy || null,
    rejectReason: g.rejectReason || "",
    ncrId: g.ncrId?.toString() || null,
    notes: g.notes || "",
    createdBy: g.createdBy || null,
    lastModifiedBy: g.lastModifiedBy || null,
    createdAt: g.createdAt?.toISOString() || null,
    updatedAt: g.updatedAt?.toISOString() || null,
  };
}

export async function getGRNs({ page = 1, status = "", search = "" } = {}) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const filter = withTenantScope({}, companyId, isSuperAdmin);
  if (status && status !== "all") filter.status = status;
  if (search) {
    filter.$or = [
      { grnNumber: new RegExp(search, "i") },
      { "supplier.name": new RegExp(search, "i") },
    ];
  }
  const skip = (page - 1) * ITEMS_PER_PAGE;
  const [items, total] = await Promise.all([
    GoodsReceipt.find(filter)
      .sort({ receivedDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(ITEMS_PER_PAGE)
      .lean(),
    GoodsReceipt.countDocuments(filter),
  ]);
  return {
    grns: items.map(serializeGRN),
    pagination: {
      page,
      total,
      totalPages: Math.ceil(total / ITEMS_PER_PAGE),
    },
  };
}

export async function getGRNById(id) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const grn = await GoodsReceipt.findOne(
    withTenantScope({ _id: id }, companyId, isSuperAdmin),
  ).lean();
  return serializeGRN(grn);
}

export async function getGRNsForBill(billId) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const filter = withTenantScope(
    { "source.billId": billId },
    companyId,
    isSuperAdmin,
  );
  const items = await GoodsReceipt.find(filter)
    .sort({ createdAt: -1 })
    .lean();
  return items.map(serializeGRN);
}

export async function getGRNStats() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const filter = withTenantScope({}, companyId, isSuperAdmin);
  const counts = await GoodsReceipt.aggregate([
    { $match: filter },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const out = {
    total: 0,
    draft: 0,
    pending_acceptance: 0,
    accepted: 0,
    partially_accepted: 0,
    rejected: 0,
    voided: 0,
  };
  for (const { _id, count } of counts) {
    out[_id] = count;
    out.total += count;
  }
  return out;
}
