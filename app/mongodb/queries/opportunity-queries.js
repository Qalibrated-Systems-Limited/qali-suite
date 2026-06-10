 import "server-only";
import { cache } from "react";
import mongoose from "mongoose";

import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import Opportunity, {
  OPPORTUNITY_STAGES,
  STAGE_PROBABILITY,
} from "@/app/models/opportunity";

// ============================================
// OPPORTUNITY / PIPELINE QUERIES
// ============================================

const OPEN_STAGES = OPPORTUNITY_STAGES.filter((s) => !s.startsWith("closed_"));

function weighted(amount, probability, stage) {
  const p =
    typeof probability === "number"
      ? probability
      : STAGE_PROBABILITY[stage] ?? 0;
  return Math.round((Number(amount) || 0) * (p / 100) * 100) / 100;
}

function serializeOpp(r) {
  return {
    _id: r._id.toString(),
    opportunityNumber: r.opportunityNumber,
    name: r.name,
    account: { name: r.account?.name || "" },
    owner: { name: r.owner?.name || "" },
    stage: r.stage,
    amount: r.amount || 0,
    currency: r.currency || "KES",
    probability:
      typeof r.probability === "number"
        ? r.probability
        : STAGE_PROBABILITY[r.stage] ?? 0,
    weightedAmount: weighted(r.amount, r.probability, r.stage),
    expectedCloseDate: r.expectedCloseDate?.toISOString?.() ?? null,
    createdAt: r.createdAt?.toISOString?.() ?? null,
  };
}

/**
 * The pipeline board: open opportunities grouped by stage, with per-stage
 * count / total value / weighted forecast. Caps the working set at 250 —
 * a single rep board never approaches that, and it keeps the page bounded.
 */
export const cPipeline = cache(async () => {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    const rows = await Opportunity.find(
      withTenantScope({ stage: { $in: OPEN_STAGES } }, companyId, isSuperAdmin),
    )
      .sort({ expectedCloseDate: 1, createdAt: -1 })
      .limit(250)
      .lean();

    // Initialise a column per open stage so empty stages still render.
    const columns = OPEN_STAGES.map((stage) => ({
      stage,
      deals: [],
      count: 0,
      total: 0,
      weighted: 0,
    }));
    const byStage = Object.fromEntries(columns.map((c) => [c.stage, c]));

    for (const r of rows) {
      const col = byStage[r.stage];
      if (!col) continue;
      const s = serializeOpp(r);
      col.deals.push(s);
      col.count += 1;
      col.total += s.amount;
      col.weighted += s.weightedAmount;
    }

    const totals = columns.reduce(
      (acc, c) => {
        acc.count += c.count;
        acc.total += c.total;
        acc.weighted += c.weighted;
        return acc;
      },
      { count: 0, total: 0, weighted: 0 },
    );

    return { columns, totals };
  } catch (error) {
    console.error("cPipeline error:", error);
    return { columns: [], totals: { count: 0, total: 0, weighted: 0 } };
  }
});

/**
 * A single opportunity by id, fully serialized for the detail page —
 * including stage history (for the velocity trail), close details, and
 * lead provenance. Returns null if not found in the caller's tenant.
 */
export const cOpportunity = cache(async (id) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();

    const r = await Opportunity.findOne(
      withTenantScope({ _id: id }, companyId, isSuperAdmin),
    ).lean();
    if (!r) return null;

    return {
      ...serializeOpp(r),
      source: r.source || "",
      primaryContact: {
        name: r.primaryContact?.name || "",
        email: r.primaryContact?.email || "",
        phone: r.primaryContact?.phone || "",
      },
      leadRef: r.leadRef?.leadNumber
        ? {
            leadId: r.leadRef.leadId?.toString?.() ?? null,
            leadNumber: r.leadRef.leadNumber,
          }
        : null,
      lostReason: r.lostReason || "",
      lostNote: r.lostNote || "",
      wonDetails: r.wonDetails
        ? {
            quoteId: r.wonDetails.quoteId?.toString?.() ?? null,
            wonAt: r.wonDetails.wonAt?.toISOString?.() ?? null,
          }
        : null,
      stageHistory: (r.stageHistory || []).map((h) => ({
        stage: h.stage,
        at: h.at?.toISOString?.() ?? null,
        by: { name: h.by?.name || "" },
      })),
    };
  } catch (error) {
    console.error("cOpportunity error:", error);
    return null;
  }
});
