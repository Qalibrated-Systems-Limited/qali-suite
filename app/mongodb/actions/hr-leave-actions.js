"use server";

import mongoose from "mongoose";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope, getCompanyIdForCreate } from "@/lib/utils/tenant-utils";
import LeaveRequest from "@/app/models/leaveRequest";
import EmployeeProfile from "@/app/models/employeeProfile";
import PublicHoliday from "@/app/models/publicHoliday";

// ============================================
// ROLE AUTHORIZATION
// ============================================
const LEAVE_ROLES = {
  CREATE: ["Admin", "Manager", "HR", "Employee"],
  APPROVE: ["Admin", "Manager", "HR"],
  ADMIN_CANCEL: ["Admin", "HR"],   // Cancel an already-approved leave
};

function hasRole(user, allowedRoles) {
  return allowedRoles.includes(user?.role);
}

// ============================================
// HELPERS
// ============================================

/**
 * Calculate working days between two dates.
 * Excludes weekends and public holidays for the given company.
 */
async function calcWorkingDays(companyId, fromDate, toDate, halfDay = false) {
  if (halfDay) return 0.5;

  const holidaySet = await PublicHoliday.getDateSet(companyId, fromDate, toDate);

  let count = 0;
  const current = new Date(fromDate);
  current.setHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setHours(23, 59, 59, 999);

  while (current <= end) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) {
      const key = current.toISOString().slice(0, 10);
      if (!holidaySet.has(key)) count++;
    }
    current.setDate(current.getDate() + 1);
  }
  return count;
}

// ============================================
// CREATE / SUBMIT LEAVE REQUEST
// ============================================
export async function createLeaveRequest(_prevState, formData) {
  let mongoSession = null;
  let createdId = null;

  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, LEAVE_ROLES.CREATE)) {
      return { success: false, error: "You do not have permission to submit leave requests" };
    }

    const tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);

    // Parse form data
    const profileId = formData.get("profileId")?.toString();
    const partyId = formData.get("partyId")?.toString();
    const leaveType = formData.get("leaveType")?.toString();
    const fromDate = formData.get("fromDate") ? new Date(formData.get("fromDate")) : null;
    const toDate = formData.get("toDate") ? new Date(formData.get("toDate")) : null;
    const halfDay = formData.get("halfDay") === "true";
    const halfDayPeriod = formData.get("halfDayPeriod")?.toString() || null;
    const reason = formData.get("reason")?.toString().trim() || null;
    const submitNow = formData.get("submitNow") === "true"; // draft vs submit

    // Validate
    const fieldErrors = {};
    if (!profileId) fieldErrors.profileId = "Employee profile required";
    if (!partyId) fieldErrors.partyId = "Employee party required";
    if (!leaveType) fieldErrors.leaveType = "Leave type is required";
    if (!fromDate) fieldErrors.fromDate = "Start date is required";
    if (!toDate) fieldErrors.toDate = "End date is required";
    if (fromDate && toDate && toDate < fromDate) {
      fieldErrors.toDate = "End date cannot be before start date";
    }

    if (Object.keys(fieldErrors).length > 0) {
      return { success: false, error: "Please fill in all required fields", fieldErrors };
    }

    await dbConnect();

    const totalDays = await calcWorkingDays(tenantCompanyId, fromDate, toDate, halfDay);
    if (totalDays === 0) {
      return { success: false, error: "Leave period contains no working days (all days are weekends or public holidays)" };
    }

    // Load employee profile for snapshot and balance check
    const profile = await EmployeeProfile.findOne(
      withTenantScope({ _id: profileId }, companyId, isSuperAdmin)
    ).lean();

    if (!profile) return { success: false, error: "Employee profile not found" };

    // Check balance (only for non-unpaid leave types that consume a balance)
    if (leaveType !== "unpaid") {
      const balance = profile.leaveBalances?.find((b) => b.leaveType === leaveType);
      if (!balance) {
        return { success: false, error: `No leave balance configured for ${leaveType} leave` };
      }
      const available = (balance.balanceDays || 0) - (balance.pendingDays || 0);
      if (totalDays > available) {
        return {
          success: false,
          error: `Insufficient ${leaveType} leave balance. Available: ${available} days, Requested: ${totalDays} days`,
        };
      }
    }

    // Check for overlapping requests
    const hasOverlap = await LeaveRequest.hasOverlap(tenantCompanyId, partyId, fromDate, toDate);
    if (hasOverlap) {
      return { success: false, error: "You already have an approved or pending leave request for this period" };
    }

    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    const leaveNumber = await LeaveRequest.generateLeaveNumber(tenantCompanyId, mongoSession);

    // Capture balance snapshot at request time (for audit trail)
    const balanceRecord = profile.leaveBalances?.find((b) => b.leaveType === leaveType);
    const balanceSnapshot = balanceRecord
      ? {
          entitledDays: balanceRecord.entitledDays,
          usedDaysBefore: balanceRecord.usedDays,
          balanceBefore: balanceRecord.balanceDays,
        }
      : null;

    const [created] = await LeaveRequest.create(
      [
        {
          companyId: tenantCompanyId,
          leaveNumber,
          employee: {
            partyId,
            profileId,
            userId: profile.userId || undefined,
            name: `${profile.personalInfo?.firstName} ${profile.personalInfo?.lastName}`.trim(),
            employeeNumber: profile.employeeNumber,
            department: profile.employment?.department,
            designation: profile.employment?.designation,
          },
          leaveType,
          dates: { from: fromDate, to: toDate, totalDays, halfDay, halfDayPeriod },
          reason,
          status: submitNow ? "submitted" : "draft",
          submittedAt: submitNow ? new Date() : null,
          submittedBy: submitNow ? { name: user.name, id: user.id } : null,
          balanceSnapshot,
          createdBy: { name: user.name, id: user.id },
        },
      ],
      { session: mongoSession }
    );

    createdId = created._id.toString();

    // Mark days as pending in leave balance (only on submit)
    if (submitNow && leaveType !== "unpaid") {
      await EmployeeProfile.markLeavePending(profileId, leaveType, totalDays, mongoSession);
    }

    await mongoSession.commitTransaction();
    mongoSession.endSession();
    mongoSession = null;

    revalidatePath("/dashboard/hr/leave");
  } catch (error) {
    if (mongoSession) await mongoSession.abortTransaction();
    return { success: false, error: error.message || "Failed to create leave request" };
  } finally {
    if (mongoSession) mongoSession.endSession();
  }

  redirect(`/dashboard/hr/leave/${createdId}`);
}

// ============================================
// SUBMIT LEAVE REQUEST (draft → submitted)
// ============================================
export async function submitLeaveRequest(leaveId) {
  let mongoSession = null;

  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    await dbConnect();

    const leave = await LeaveRequest.findOne(
      withTenantScope({ _id: leaveId }, companyId, isSuperAdmin)
    );
    if (!leave) return { success: false, error: "Leave request not found" };

    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    await leave.submit({ name: user.name, id: user.id });

    // Mark days as pending in profile balance
    if (leave.leaveType !== "unpaid") {
      await EmployeeProfile.markLeavePending(
        leave.employee.profileId,
        leave.leaveType,
        leave.dates.totalDays,
        mongoSession
      );
    }

    await mongoSession.commitTransaction();
    mongoSession.endSession();
    mongoSession = null;

    revalidatePath("/dashboard/hr/leave");
    revalidatePath(`/dashboard/hr/leave/${leaveId}`);

    return { success: true };
  } catch (error) {
    if (mongoSession) await mongoSession.abortTransaction();
    return { success: false, error: error.message || "Failed to submit leave request" };
  } finally {
    if (mongoSession) mongoSession.endSession();
  }
}

// ============================================
// APPROVE LEAVE REQUEST
// ============================================
export async function approveLeaveRequest(leaveId) {
  let mongoSession = null;

  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, LEAVE_ROLES.APPROVE)) {
      return { success: false, error: "You do not have permission to approve leave requests" };
    }

    await dbConnect();

    const leave = await LeaveRequest.findOne(
      withTenantScope({ _id: leaveId }, companyId, isSuperAdmin)
    );
    if (!leave) return { success: false, error: "Leave request not found" };

    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    await leave.approve({ name: user.name, id: user.id });

    // Debit leave balance: usedDays += N, balanceDays -= N, pendingDays -= N
    if (leave.leaveType !== "unpaid") {
      await EmployeeProfile.debitLeave(
        leave.employee.profileId,
        leave.leaveType,
        leave.dates.totalDays,
        mongoSession
      );
    }

    // Update employee status to "on_leave" if leave starts today or earlier
    const today = new Date();
    if (leave.dates.from <= today && leave.dates.to >= today) {
      await EmployeeProfile.findByIdAndUpdate(
        leave.employee.profileId,
        { "employment.status": "on_leave" },
        { session: mongoSession }
      );
    }

    await mongoSession.commitTransaction();
    mongoSession.endSession();
    mongoSession = null;

    revalidatePath("/dashboard/hr/leave");
    revalidatePath(`/dashboard/hr/leave/${leaveId}`);

    return { success: true };
  } catch (error) {
    if (mongoSession) await mongoSession.abortTransaction();
    return { success: false, error: error.message || "Failed to approve leave request" };
  } finally {
    if (mongoSession) mongoSession.endSession();
  }
}

// ============================================
// REJECT LEAVE REQUEST
// ============================================
export async function rejectLeaveRequest(_prevState, formData) {
  let mongoSession = null;

  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, LEAVE_ROLES.APPROVE)) {
      return { success: false, error: "You do not have permission to reject leave requests" };
    }

    const leaveId = formData.get("leaveId")?.toString();
    const reason = formData.get("reason")?.toString().trim();

    if (!leaveId) return { success: false, error: "Leave ID is required" };
    if (!reason) return { success: false, error: "Rejection reason is required", fieldErrors: { reason: "Required" } };

    await dbConnect();

    const leave = await LeaveRequest.findOne(
      withTenantScope({ _id: leaveId }, companyId, isSuperAdmin)
    );
    if (!leave) return { success: false, error: "Leave request not found" };

    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    await leave.reject({ name: user.name, id: user.id }, reason);

    // Release pending days in profile balance
    if (leave.leaveType !== "unpaid") {
      await EmployeeProfile.releasePendingLeave(
        leave.employee.profileId,
        leave.leaveType,
        leave.dates.totalDays,
        mongoSession
      );
    }

    await mongoSession.commitTransaction();
    mongoSession.endSession();
    mongoSession = null;

    revalidatePath("/dashboard/hr/leave");
    revalidatePath(`/dashboard/hr/leave/${leaveId}`);

    return { success: true };
  } catch (error) {
    if (mongoSession) await mongoSession.abortTransaction();
    return { success: false, error: error.message || "Failed to reject leave request" };
  } finally {
    if (mongoSession) mongoSession.endSession();
  }
}

// ============================================
// RECALL LEAVE REQUEST (submitted → draft)
// ============================================
export async function recallLeaveRequest(leaveId) {
  let mongoSession = null;

  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    await dbConnect();

    const leave = await LeaveRequest.findOne(
      withTenantScope({ _id: leaveId }, companyId, isSuperAdmin)
    );
    if (!leave) return { success: false, error: "Leave request not found" };

    // Only the employee or admin can recall
    const isOwner = leave.employee.userId?.toString() === user.id;
    if (!isOwner && !hasRole(user, LEAVE_ROLES.APPROVE)) {
      return { success: false, error: "You can only recall your own leave requests" };
    }

    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    await leave.recall();

    // Release pending days
    if (leave.leaveType !== "unpaid") {
      await EmployeeProfile.releasePendingLeave(
        leave.employee.profileId,
        leave.leaveType,
        leave.dates.totalDays,
        mongoSession
      );
    }

    await mongoSession.commitTransaction();
    mongoSession.endSession();
    mongoSession = null;

    revalidatePath("/dashboard/hr/leave");
    revalidatePath(`/dashboard/hr/leave/${leaveId}`);

    return { success: true };
  } catch (error) {
    if (mongoSession) await mongoSession.abortTransaction();
    return { success: false, error: error.message || "Failed to recall leave request" };
  } finally {
    if (mongoSession) mongoSession.endSession();
  }
}
