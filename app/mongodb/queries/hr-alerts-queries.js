import "server-only";
import { cache } from "react";
import mongoose from "mongoose";

import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import LeaveRequest from "@/app/models/leaveRequest";
import EmployeeClaim from "@/app/models/employeesClaims";
import EmployeeProfile from "@/app/models/employeeProfile";

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

    const now = new Date();
    const in30 = new Date(now);
    in30.setDate(in30.getDate() + 30);

    const [
      pendingLeave,
      pendingClaims,
      contractsExpiring,
      onLeaveToday,
    ] = await Promise.all([
      LeaveRequest.countDocuments({
        ...tenantMatch,
        status: "submitted",
      }),
      EmployeeClaim.countDocuments({
        ...tenantMatch,
        status: "submitted",
      }),
      EmployeeProfile.countDocuments({
        ...tenantMatch,
        "employment.contractEnd": { $gte: now, $lte: in30 },
        "employment.status": { $in: ["active", "probation"] },
      }),
      LeaveRequest.countDocuments({
        ...tenantMatch,
        status: "approved",
        "dates.from": { $lte: now },
        "dates.to": { $gte: now },
      }),
    ]);

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
