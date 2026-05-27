"use server";

import { revalidatePath } from "next/cache";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import EmployeeProfile from "@/app/models/employeeProfile";
import { requirePlanAccess } from "@/lib/plan-gate";

const ALLOWED = ["SuperAdmin", "Admin", "HR"];

function guard(user) {
  if (!user) return "Not authenticated";
  if (!ALLOWED.includes(user.role)) return "Only Admin or HR can perform this action";
  return null;
}

// ============================================
// LEAVE BALANCE CARRY-OVER
// ============================================
// At year-end (or triggered manually), rolls unused leave days from the
// closing year into the new year up to the specified maximum carry-over cap.
//
// Only applies to leave types with carryOverEnabled = true.
// For each employee:
//   - new carryOver = min(unused days, maxCarryOver)
//   - new entitledDays = their standard entitlement (unchanged)
//   - new balanceDays = entitledDays + carryOver
//   - resets usedDays, pendingDays to 0 for the new year
// ============================================
export async function runLeaveCarryOver({ fromYear, toYear, maxCarryOver = 10, leaveType = "annual" }) {
  try {
    await requirePlanAccess("hr");

    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const err = guard(user);
    if (err) return { success: false, error: err };

    await dbConnect();

    // Fetch all active employees with a balance for this leave type
    const profiles = await EmployeeProfile.find(
      withTenantScope(
        {
          "employment.status": { $nin: ["terminated"] },
          "leaveBalances.leaveType": leaveType,
        },
        companyId,
        isSuperAdmin
      )
    )
      .select("leaveBalances employment.status personalInfo.firstName personalInfo.lastName employeeNumber")
      .lean();

    let processed = 0;
    let totalCarried = 0;

    for (const profile of profiles) {
      const balance = profile.leaveBalances?.find((b) => b.leaveType === leaveType && b.year === fromYear);
      if (!balance) continue;

      const unused = Math.max(0, (balance.balanceDays || 0) - (balance.pendingDays || 0));
      const carryOver = Math.min(unused, maxCarryOver);
      const newBalance = (balance.entitledDays || 0) + carryOver;

      // Update the balance entry for the new year
      await EmployeeProfile.updateOne(
        { _id: profile._id, "leaveBalances.leaveType": leaveType },
        {
          $set: {
            "leaveBalances.$.year": toYear,
            "leaveBalances.$.carryOver": carryOver,
            "leaveBalances.$.usedDays": 0,
            "leaveBalances.$.pendingDays": 0,
            "leaveBalances.$.balanceDays": newBalance,
          },
        }
      );

      totalCarried += carryOver;
      processed++;
    }

    revalidatePath("/dashboard/hr/employees");
    return {
      success: true,
      processed,
      totalCarried,
      message: `Carry-over complete: ${processed} employees processed, ${totalCarried} days carried to ${toYear}`,
    };
  } catch (error) {
    return { success: false, error: error.message || "Carry-over failed" };
  }
}

// ============================================
// LEAVE ACCRUAL
// ============================================
// Adds accrual days to each active employee's leave balance for a given month.
// Standard Kenya: 21 days annual leave / 12 months = 1.75 days/month.
// accrualDays is configurable (default 1.75 for annual).
// ============================================
export async function runLeaveAccrual({ year, month, leaveType = "annual", accrualDays = 1.75 }) {
  try {
    await requirePlanAccess("hr");

    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const err = guard(user);
    if (err) return { success: false, error: err };

    await dbConnect();

    const accrual = Math.round(accrualDays * 2) / 2; // Round to nearest 0.5

    const result = await EmployeeProfile.updateMany(
      withTenantScope(
        {
          "employment.status": { $in: ["active", "probation"] },
          "leaveBalances.leaveType": leaveType,
        },
        companyId,
        isSuperAdmin
      ),
      {
        $inc: {
          "leaveBalances.$.balanceDays": accrual,
          "leaveBalances.$.entitledDays": accrual,
        },
      }
    );

    revalidatePath("/dashboard/hr/employees");
    return {
      success: true,
      processed: result.modifiedCount,
      accrualDays: accrual,
      message: `Accrual complete: ${result.modifiedCount} employees credited ${accrual} days for ${month}/${year}`,
    };
  } catch (error) {
    return { success: false, error: error.message || "Accrual failed" };
  }
}

// ============================================
// LEAVE ENCASHMENT
// ============================================
// Converts an employee's unused leave days to a cash payout.
// Returns the encashment amount for the caller to create a PayrollEntry line item.
// Also debits the leave balance.
// ============================================
export async function encashLeave({ profileId, leaveType = "annual", daysToEncash, dailyRate }) {
  try {
    await requirePlanAccess("hr");

    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const err = guard(user);
    if (err) return { success: false, error: err };

    if (!profileId || !daysToEncash || !dailyRate) {
      return { success: false, error: "profileId, daysToEncash, and dailyRate are required" };
    }
    if (daysToEncash <= 0 || dailyRate <= 0) {
      return { success: false, error: "daysToEncash and dailyRate must be positive" };
    }

    await dbConnect();

    const profile = await EmployeeProfile.findOne(
      withTenantScope({ _id: profileId }, companyId, isSuperAdmin)
    ).lean();
    if (!profile) return { success: false, error: "Employee not found" };

    const balance = profile.leaveBalances?.find((b) => b.leaveType === leaveType);
    if (!balance) return { success: false, error: `No ${leaveType} leave balance for this employee` };

    const available = (balance.balanceDays || 0) - (balance.pendingDays || 0);
    if (daysToEncash > available) {
      return {
        success: false,
        error: `Insufficient balance. Available: ${available} days, Requested: ${daysToEncash} days`,
      };
    }

    const encashmentAmount = Math.round(daysToEncash * dailyRate);

    // Debit the balance
    await EmployeeProfile.updateOne(
      withTenantScope({ _id: profileId, "leaveBalances.leaveType": leaveType }, companyId, isSuperAdmin),
      {
        $inc: {
          "leaveBalances.$.usedDays": daysToEncash,
          "leaveBalances.$.balanceDays": -daysToEncash,
        },
      }
    );

    revalidatePath(`/dashboard/hr/employees/${profileId}`);
    return {
      success: true,
      encashmentAmount,
      daysEncashed: daysToEncash,
      message: `${daysToEncash} days encashed at KES ${dailyRate}/day = KES ${encashmentAmount.toLocaleString()}`,
    };
  } catch (error) {
    return { success: false, error: error.message || "Encashment failed" };
  }
}
