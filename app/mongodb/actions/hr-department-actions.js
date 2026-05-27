"use server";

import mongoose from "mongoose";
import { roleAllowed } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope, getCompanyIdForCreate } from "@/lib/utils/tenant-utils";
import Department from "@/app/models/department";
import { requirePlanAccess } from "@/lib/plan-gate";

// ============================================
// ROLE AUTHORIZATION
// ============================================
const DEPT_ROLES = {
  CREATE: ["SuperAdmin", "Admin", "Manager", "HR"],
  UPDATE: ["SuperAdmin", "Admin", "Manager", "HR"],
  DEACTIVATE: ["SuperAdmin", "Admin", "HR"],
};

function hasRole(user, allowedRoles) {
  return roleAllowed(user?.role, allowedRoles);
}

// ============================================
// CREATE DEPARTMENT QUICK (no redirect — for create-on-the-fly in forms)
// ============================================
export async function createDepartmentQuick(name) {
  let mongoSession = null;
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, DEPT_ROLES.CREATE)) {
      return { success: false, error: "You do not have permission to create departments" };
    }

    const trimmed = name?.toString().trim();
    if (!trimmed) return { success: false, error: "Department name is required" };

    const tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);

    await dbConnect();

    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    const code = await Department.generateCode(tenantCompanyId, mongoSession);

    const [created] = await Department.create(
      [{ companyId: tenantCompanyId, code, name: trimmed, createdBy: { name: user.name, id: user.id } }],
      { session: mongoSession }
    );

    await mongoSession.commitTransaction();
    mongoSession.endSession();
    mongoSession = null;

    revalidatePath("/dashboard/hr/departments");

    return {
      success: true,
      department: { _id: created._id.toString(), name: created.name, code: created.code },
    };
  } catch (error) {
    if (mongoSession) await mongoSession.abortTransaction();
    return { success: false, error: error.message || "Failed to create department" };
  } finally {
    if (mongoSession) mongoSession.endSession();
  }
}

// ============================================
// CREATE DEPARTMENT
// ============================================
export async function createDepartment(prevState, formData) {
  let mongoSession = null;

  try {
    await requirePlanAccess("hr");

    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, DEPT_ROLES.CREATE)) {
      return { success: false, error: "You do not have permission to create departments" };
    }

    const tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);

    // Parse form data
    const name = formData.get("name")?.toString().trim();
    const description = formData.get("description")?.toString().trim() || null;
    const parentDepartmentId = formData.get("parentDepartmentId")?.toString() || null;
    const costCenterAccountId = formData.get("costCenterAccountId")?.toString() || null;
    const costCenterCode = formData.get("costCenterCode")?.toString() || null;
    const costCenterName = formData.get("costCenterName")?.toString() || null;

    // Validate
    if (!name) {
      return { success: false, error: "Department name is required", fieldErrors: { name: "Required" } };
    }

    await dbConnect();

    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    // Auto-generate code
    const code = await Department.generateCode(tenantCompanyId, mongoSession);

    const [dept] = await Department.create(
      [
        {
          companyId: tenantCompanyId,
          code,
          name,
          description,
          parentDepartmentId: parentDepartmentId || undefined,
          costCenter: costCenterAccountId
            ? { accountId: costCenterAccountId, accountCode: costCenterCode, accountName: costCenterName }
            : undefined,
          createdBy: { name: user.name, id: user.id },
        },
      ],
      { session: mongoSession }
    );

    await mongoSession.commitTransaction();
    mongoSession.endSession();
    mongoSession = null;

    revalidatePath("/dashboard/hr/departments");
  } catch (error) {
    if (mongoSession) {
      await mongoSession.abortTransaction();
    }
    // Duplicate code (race condition) — should not happen with counter, but guard anyway
    if (error.code === 11000) {
      return { success: false, error: "A department with this code already exists" };
    }
    return { success: false, error: error.message || "Failed to create department" };
  } finally {
    if (mongoSession) mongoSession.endSession();
  }

  redirect("/dashboard/hr/departments");
}

// ============================================
// UPDATE DEPARTMENT
// ============================================
export async function updateDepartment(prevState, formData) {
  let mongoSession = null;

  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, DEPT_ROLES.UPDATE)) {
      return { success: false, error: "You do not have permission to update departments" };
    }

    const deptId = formData.get("deptId")?.toString();
    const name = formData.get("name")?.toString().trim();
    const description = formData.get("description")?.toString().trim() || null;
    const parentDepartmentId = formData.get("parentDepartmentId")?.toString() || null;
    const costCenterAccountId = formData.get("costCenterAccountId")?.toString() || null;
    const costCenterCode = formData.get("costCenterCode")?.toString() || null;
    const costCenterName = formData.get("costCenterName")?.toString() || null;
    const headPartyId = formData.get("headPartyId")?.toString() || null;
    const headName = formData.get("headName")?.toString() || null;
    const headEmployeeNumber = formData.get("headEmployeeNumber")?.toString() || null;

    if (!deptId) return { success: false, error: "Department ID is required" };
    if (!name) return { success: false, error: "Department name is required", fieldErrors: { name: "Required" } };

    await dbConnect();

    const dept = await Department.findOne(
      withTenantScope({ _id: deptId }, companyId, isSuperAdmin)
    );

    if (!dept) return { success: false, error: "Department not found" };

    dept.name = name;
    dept.description = description;
    dept.parentDepartmentId = parentDepartmentId || undefined;

    if (costCenterAccountId) {
      dept.costCenter = { accountId: costCenterAccountId, accountCode: costCenterCode, accountName: costCenterName };
    } else {
      dept.costCenter = {};
    }

    if (headPartyId) {
      dept.head = { partyId: headPartyId, name: headName, employeeNumber: headEmployeeNumber };
    } else {
      dept.head = {};
    }

    dept.lastModifiedBy = { name: user.name, id: user.id };

    await dept.save();

    revalidatePath("/dashboard/hr/departments");
    revalidatePath(`/dashboard/hr/departments/${deptId}`);
  } catch (error) {
    if (mongoSession) await mongoSession.abortTransaction();
    return { success: false, error: error.message || "Failed to update department" };
  } finally {
    if (mongoSession) mongoSession.endSession();
  }

  redirect(`/dashboard/hr/departments/${formData.get("deptId")}`);
}

// ============================================
// TOGGLE ACTIVE STATUS
// ============================================
export async function toggleDepartmentStatus(deptId, activate) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, DEPT_ROLES.DEACTIVATE)) {
      return { success: false, error: "You do not have permission to change department status" };
    }

    await dbConnect();

    const dept = await Department.findOne(
      withTenantScope({ _id: deptId }, companyId, isSuperAdmin)
    );

    if (!dept) return { success: false, error: "Department not found" };

    dept.isActive = activate;
    dept.lastModifiedBy = { name: user.name, id: user.id };
    await dept.save();

    revalidatePath("/dashboard/hr/departments");
    revalidatePath(`/dashboard/hr/departments/${deptId}`);

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Failed to update department status" };
  }
}
