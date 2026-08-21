import "server-only";
import { cache } from "react";
import mongoose from "mongoose";

import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import EmployeeClaim from "@/app/models/employeesClaims";
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

    // Leave, contracts and who is away today all come from Postgres. Claims
    // have not moved yet, so they are still counted here.
    const [hr, pendingClaims] = await Promise.all([
      getHrAlertCounts(),
      EmployeeClaim.countDocuments({
        ...tenantMatch,
        status: "submitted",
      }),
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
