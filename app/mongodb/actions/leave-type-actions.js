"use server";

import { revalidatePath } from "next/cache";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope, getCompanyIdForCreate } from "@/lib/utils/tenant-utils";
import { requirePlanAccess } from "@/lib/plan-gate";
import LeaveType from "@/app/models/leaveType";
import LeaveRequest from "@/app/models/leaveRequest";

const ALLOWED = ["SuperAdmin", "Admin", "HR"];

function guard(user) {
  if (!user) return "Not authenticated";
  if (!ALLOWED.includes(user.role)) return "Only Admin or HR can manage leave types";
  return null;
}

// ============================================
// SEED DEFAULT LEAVE TYPES
// ============================================
export async function seedLeaveTypes() {
  try {
    await requirePlanAccess("hr");
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const err = guard(user);
    if (err) return { success: false, error: err };

    const tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);
    await dbConnect();

    await LeaveType.seedDefaults(tenantCompanyId);

    revalidatePath("/dashboard/hr/leave-types");
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Failed to seed leave types" };
  }
}

// ============================================
// GET LEAVE TYPES
// ============================================
export async function getLeaveTypes() {
  try {
    await requirePlanAccess("hr");
    const { companyId, isSuperAdmin } = await getTenantContext();

    await dbConnect();

    const leaveTypes = await LeaveType.find(
      withTenantScope({ isActive: true }, companyId, isSuperAdmin)
    )
      .sort({ sortOrder: 1 })
      .lean();

    return {
      success: true,
      data: JSON.parse(JSON.stringify(leaveTypes)),
    };
  } catch (error) {
    return { success: false, error: error.message || "Failed to fetch leave types" };
  }
}

// ============================================
// GET ALL LEAVE TYPES (including inactive, for admin)
// ============================================
export async function getAllLeaveTypes() {
  try {
    await requirePlanAccess("hr");
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const err = guard(user);
    if (err) return { success: false, error: err };

    await dbConnect();

    const leaveTypes = await LeaveType.find(
      withTenantScope({}, companyId, isSuperAdmin)
    )
      .sort({ sortOrder: 1 })
      .lean();

    return {
      success: true,
      data: JSON.parse(JSON.stringify(leaveTypes)),
    };
  } catch (error) {
    return { success: false, error: error.message || "Failed to fetch leave types" };
  }
}

// ============================================
// CREATE LEAVE TYPE
// ============================================
export async function createLeaveType(_prevState, formData) {
  try {
    await requirePlanAccess("hr");
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const err = guard(user);
    if (err) return { success: false, error: err };

    const tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);

    const code = formData.get("code")?.toString().trim().toLowerCase();
    const name = formData.get("name")?.toString().trim();
    const defaultEntitlement = parseFloat(formData.get("defaultEntitlement") || "0");
    const maxCarryOver = parseFloat(formData.get("maxCarryOver") || "0");
    const paidLeave = formData.get("paidLeave") === "true";
    const requiresDocument = formData.get("requiresDocument") === "true";
    const applicableGender = formData.get("applicableGender")?.toString() || "all";
    const sortOrder = parseInt(formData.get("sortOrder") || "0", 10);
    const description = formData.get("description")?.toString().trim() || null;

    // Validate required fields
    const fieldErrors = {};
    if (!code) fieldErrors.code = "Code is required";
    if (!name) fieldErrors.name = "Name is required";
    if (!["all", "male", "female"].includes(applicableGender)) {
      fieldErrors.applicableGender = "Invalid gender filter";
    }
    if (Object.keys(fieldErrors).length > 0) {
      return { success: false, error: "Please fill in all required fields", fieldErrors };
    }

    await dbConnect();

    // Check for duplicate code
    const existing = await LeaveType.findOne({ companyId: tenantCompanyId, code });
    if (existing) {
      return { success: false, error: `Leave type with code "${code}" already exists` };
    }

    await LeaveType.create({
      companyId: tenantCompanyId,
      code,
      name,
      defaultEntitlement,
      maxCarryOver,
      paidLeave,
      requiresDocument,
      applicableGender,
      sortOrder,
      description,
      isDefault: false,
    });

    revalidatePath("/dashboard/hr/leave-types");
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Failed to create leave type" };
  }
}

// ============================================
// UPDATE LEAVE TYPE
// ============================================
export async function updateLeaveType(_prevState, formData) {
  try {
    await requirePlanAccess("hr");
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const err = guard(user);
    if (err) return { success: false, error: err };

    const leaveTypeId = formData.get("leaveTypeId")?.toString();
    if (!leaveTypeId) return { success: false, error: "Leave type ID is required" };

    await dbConnect();

    const leaveType = await LeaveType.findOne(
      withTenantScope({ _id: leaveTypeId }, companyId, isSuperAdmin)
    );
    if (!leaveType) return { success: false, error: "Leave type not found" };

    // Update fields
    const name = formData.get("name")?.toString().trim();
    if (name) leaveType.name = name;

    const defaultEntitlement = formData.get("defaultEntitlement");
    if (defaultEntitlement !== null && defaultEntitlement !== undefined) {
      leaveType.defaultEntitlement = parseFloat(defaultEntitlement);
    }

    const maxCarryOver = formData.get("maxCarryOver");
    if (maxCarryOver !== null && maxCarryOver !== undefined) {
      leaveType.maxCarryOver = parseFloat(maxCarryOver);
    }

    const paidLeave = formData.get("paidLeave");
    if (paidLeave !== null) leaveType.paidLeave = paidLeave === "true";

    const requiresDocument = formData.get("requiresDocument");
    if (requiresDocument !== null) leaveType.requiresDocument = requiresDocument === "true";

    const applicableGender = formData.get("applicableGender");
    if (applicableGender && ["all", "male", "female"].includes(applicableGender)) {
      leaveType.applicableGender = applicableGender;
    }

    const sortOrder = formData.get("sortOrder");
    if (sortOrder !== null && sortOrder !== undefined) {
      leaveType.sortOrder = parseInt(sortOrder, 10);
    }

    const description = formData.get("description");
    if (description !== undefined) leaveType.description = description?.toString().trim() || null;

    const isActive = formData.get("isActive");
    if (isActive !== null) leaveType.isActive = isActive === "true";

    await leaveType.save();

    revalidatePath("/dashboard/hr/leave-types");
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Failed to update leave type" };
  }
}

// ============================================
// DELETE LEAVE TYPE
// ============================================
export async function deleteLeaveType(leaveTypeId) {
  try {
    await requirePlanAccess("hr");
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const err = guard(user);
    if (err) return { success: false, error: err };

    if (!leaveTypeId) return { success: false, error: "Leave type ID is required" };

    await dbConnect();

    const leaveType = await LeaveType.findOne(
      withTenantScope({ _id: leaveTypeId }, companyId, isSuperAdmin)
    );
    if (!leaveType) return { success: false, error: "Leave type not found" };

    // Prevent deletion of seeded defaults
    if (leaveType.isDefault) {
      return { success: false, error: "Cannot delete a default leave type. You can deactivate it instead." };
    }

    // Check if any leave requests reference this type
    const usageCount = await LeaveRequest.countDocuments(
      withTenantScope({ leaveType: leaveType.code }, companyId, isSuperAdmin)
    );
    if (usageCount > 0) {
      return {
        success: false,
        error: `Cannot delete — ${usageCount} leave request(s) use this type. Deactivate it instead.`,
      };
    }

    await LeaveType.deleteOne({ _id: leaveTypeId });

    revalidatePath("/dashboard/hr/leave-types");
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Failed to delete leave type" };
  }
}
