import Nonconformance from "@/app/models/nonconformance";
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
    actualQty: l.actualQty || 0,
    variance: l.variance || 0,
    unit: l.unit || "",
    severity: l.severity || "minor",
    notes: l.notes || "",
  };
}

function serializeNCR(n) {
  if (!n) return null;
  return {
    _id: n._id.toString(),
    ncrNumber: n.ncrNumber,
    category: n.category,
    status: n.status,
    title: n.title,
    description: n.description,
    estimatedImpact: n.estimatedImpact || 0,
    photoUrls: Array.isArray(n.photoUrls) ? n.photoUrls : [],
    source: {
      type: n.source?.type || "manual",
      grnId: n.source?.grnId?.toString() || null,
      reference: n.source?.reference || "",
    },
    supplier: {
      partyId: n.supplier?.partyId?.toString() || null,
      name: n.supplier?.name || "",
    },
    lines: (n.lines || []).map(serializeLine),
    disposition: {
      type: n.disposition?.type || "pending",
      reason: n.disposition?.reason || "",
      proposedBy: n.disposition?.proposedBy?.at
        ? {
            id: n.disposition.proposedBy.id || "",
            name: n.disposition.proposedBy.name || "",
            at: n.disposition.proposedBy.at.toISOString(),
          }
        : null,
      authorizedBy: n.disposition?.authorizedBy?.at
        ? {
            id: n.disposition.authorizedBy.id || "",
            name: n.disposition.authorizedBy.name || "",
            at: n.disposition.authorizedBy.at.toISOString(),
            notes: n.disposition.authorizedBy.notes || "",
          }
        : null,
      executedAt: n.disposition?.executedAt?.toISOString() || null,
      executedBy: n.disposition?.executedBy || null,
      executionNotes: n.disposition?.executionNotes || "",
    },
    requiresCAR: !!n.requiresCAR,
    createdBy: n.createdBy || null,
    createdAt: n.createdAt?.toISOString() || null,
    updatedAt: n.updatedAt?.toISOString() || null,
  };
}

export async function getNCRs({
  page = 1,
  status = "",
  category = "",
  search = "",
} = {}) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const filter = withTenantScope({}, companyId, isSuperAdmin);
  if (status && status !== "all") filter.status = status;
  if (category && category !== "all") filter.category = category;
  if (search) {
    filter.$or = [
      { ncrNumber: new RegExp(search, "i") },
      { title: new RegExp(search, "i") },
      { "supplier.name": new RegExp(search, "i") },
    ];
  }
  const skip = (page - 1) * ITEMS_PER_PAGE;
  const [items, total] = await Promise.all([
    Nonconformance.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(ITEMS_PER_PAGE)
      .lean(),
    Nonconformance.countDocuments(filter),
  ]);
  return {
    ncrs: items.map(serializeNCR),
    pagination: {
      page,
      total,
      totalPages: Math.ceil(total / ITEMS_PER_PAGE),
    },
  };
}

export async function getNCRById(id) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const ncr = await Nonconformance.findOne(
    withTenantScope({ _id: id }, companyId, isSuperAdmin),
  ).lean();
  return serializeNCR(ncr);
}

export async function getNCRStats() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const filter = withTenantScope({}, companyId, isSuperAdmin);
  const counts = await Nonconformance.aggregate([
    { $match: filter },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const out = {
    total: 0,
    open: 0,
    disposition_proposed: 0,
    authorized: 0,
    closed: 0,
    cancelled: 0,
  };
  for (const { _id, count } of counts) {
    out[_id] = count;
    out.total += count;
  }
  return out;
}
