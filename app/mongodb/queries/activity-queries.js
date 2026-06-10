import "server-only";
import { cache } from "react";
import mongoose from "mongoose";

import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import Activity, { ACTIVITY_TARGETS } from "@/app/models/activity";

// ============================================
// ACTIVITY (TIMELINE) QUERIES
// ============================================

function serialize(r) {
  return {
    _id: r._id.toString(),
    type: r.type,
    subject: r.subject || "",
    body: r.body || "",
    direction: r.direction || "none",
    occurredAt: r.occurredAt?.toISOString?.() ?? null,
    by: { id: r.by?.id || "", name: r.by?.name || "" },
  };
}

/**
 * The relationship timeline for one entity (a lead, opportunity, or
 * customer), newest first. Matches the
 * {companyId, relatedTo.kind, relatedTo.id, occurredAt} index.
 */
export const cTimeline = cache(async (kind, id, limit = 50) => {
  try {
    if (!ACTIVITY_TARGETS.includes(kind)) return [];
    if (!mongoose.Types.ObjectId.isValid(id)) return [];
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    // Mongoose auto-casts relatedTo.id (an ObjectId in the schema) for
    // find(), so passing the string id here is safe.
    const rows = await Activity.find(
      withTenantScope(
        { "relatedTo.kind": kind, "relatedTo.id": id },
        companyId,
        isSuperAdmin,
      ),
    )
      .sort({ occurredAt: -1 })
      .limit(limit)
      .lean();

    return rows.map(serialize);
  } catch (error) {
    console.error("cTimeline error:", error);
    return [];
  }
});
