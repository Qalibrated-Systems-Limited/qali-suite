import "server-only";
import { cache } from "react";
import mongoose from "mongoose";

import dbConnect from "@/app/config/dbConnect";
import {
  getTenantContext,
  withTenantScope,
  buildTenantMatch,
} from "@/lib/utils/tenant-utils";
import Lead from "@/app/models/lead";

// ============================================
// LEAD QUERIES — cached, request-scoped
// ============================================

function serializeLead(r) {
  return {
    _id: r._id.toString(),
    leadNumber: r.leadNumber,
    name: r.name,
    company: r.company || "",
    title: r.title || "",
    email: r.email || "",
    phone: r.phone || "",
    source: r.source,
    rating: r.rating || "",
    status: r.status,
    estimatedValue: r.estimatedValue || 0,
    owner: {
      id: r.owner?.id || "",
      name: r.owner?.name || "",
    },
    convertedTo: r.convertedTo
      ? {
          partyId: r.convertedTo.partyId?.toString?.() ?? null,
          opportunityId: r.convertedTo.opportunityId?.toString?.() ?? null,
        }
      : null,
    createdAt: r.createdAt?.toISOString?.() ?? null,
  };
}

/**
 * List leads, newest first. Optional status filter; caps at 100 rows.
 */
export const cLeads = cache(async (status = "") => {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    const filter = withTenantScope(
      status ? { status } : {},
      companyId,
      isSuperAdmin,
    );

    const rows = await Lead.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return rows.map(serializeLead);
  } catch (error) {
    console.error("cLeads error:", error);
    return [];
  }
});

/**
 * A single lead by id, fully serialized for the detail page. Returns null
 * if not found in the caller's tenant.
 */
export const cLead = cache(async (id) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    const r = await Lead.findOne(
      withTenantScope({ _id: id }, companyId, isSuperAdmin),
    ).lean();
    if (!r) return null;

    return {
      ...serializeLead(r),
      notes: r.notes || "",
      lostReason: r.lostReason || "",
      convertedAt: r.convertedAt?.toISOString?.() ?? null,
    };
  } catch (error) {
    console.error("cLead error:", error);
    return null;
  }
});

/**
 * Counts by status for the header stat cards. One grouped aggregation.
 */
export const cLeadStats = cache(async () => {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    const rows = await Lead.aggregate([
      { $match: buildTenantMatch(companyId, isSuperAdmin) },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          value: { $sum: "$estimatedValue" },
        },
      },
    ]);

    const stats = { total: 0, open: 0, value: 0, byStatus: {} };
    for (const r of rows) {
      stats.byStatus[r._id] = { count: r.count, value: r.value || 0 };
      stats.total += r.count;
      if (r._id !== "converted" && r._id !== "unqualified") {
        stats.open += r.count;
        stats.value += r.value || 0;
      }
    }
    return stats;
  } catch (error) {
    console.error("cLeadStats error:", error);
    return { total: 0, open: 0, value: 0, byStatus: {} };
  }
});
