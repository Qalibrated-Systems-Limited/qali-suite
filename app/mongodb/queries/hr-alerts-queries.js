import "server-only";
import { cache } from "react";
import mongoose from "mongoose";

import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { countClaimsAwaitingApprovalPg } from "@/app/db/actions/claim-actions";
import { getHrAlertCounts } from "@/app/db/actions/hr-employee-actions";

// ============================================
// HR ALERTS
// ============================================
// Cached, request-scoped. Returns the counts the HR dashboard's alert
// strip needs in a single round-trip via Promise.all.
export const cHRAlerts = cache(async () => {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();
    const tenantMatch = isSuperAdmin
      ? {}
      : { companyId: new mongoose.Types.ObjectId(companyId) };

    // Leave, contracts, who is away today — and now claims — all come from
    // Postgres. Counting the Mongo collection here would report zero, because
    // nothing writes to it any more.
    const [hr, pendingClaims] = await Promise.all([
      getHrAlertCounts(),
      countClaimsAwaitingApprovalPg(),
    ]);
    const { pendingLeave, contractsExpiring, onLeaveToday } = hr;

    return {
      pendingLeave,
      pendingClaims,
      contractsExpiring,
      onLeaveToday,
    };
  } catch (error) {
    console.error("cHRAlerts error:", error);
    return {
      pendingLeave: 0,
      pendingClaims: 0,
      contractsExpiring: 0,
      onLeaveToday: 0,
    };
  }
});
