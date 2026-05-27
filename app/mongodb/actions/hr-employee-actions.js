"use server";

import mongoose from "mongoose";
import { roleAllowed } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope, getCompanyIdForCreate } from "@/lib/utils/tenant-utils";
import EmployeeProfile from "@/app/models/employeeProfile";
import SalaryHistory from "@/app/models/salaryHistory";
import EmploymentHistory from "@/app/models/employmentHistory";
import Party from "@/app/models/parties";
import Invite from "@/app/models/invite";
import User from "@/app/models/user";
import Company from "@/app/models/Company";
import { sendInviteEmail } from "@/lib/email";
import cloudinary from "@/lib/cloudinary";
import { requirePlanAccess } from "@/lib/plan-gate";
import { checkUserLimit } from "@/lib/check-user-limit";
import LeaveType from "@/app/models/leaveType";

// ============================================
// ROLE AUTHORIZATION
// ============================================
const EMP_ROLES = {
  CREATE: ["SuperAdmin", "Admin", "Manager", "HR"],
  UPDATE: ["SuperAdmin", "Admin", "Manager", "HR"],
  // Compensation is finance-sensitive — finance leadership in addition to HR.
  UPDATE_COMPENSATION: ["SuperAdmin", "Admin", "CFO", "Finance Manager", "HR"],
  TERMINATE: ["SuperAdmin", "Admin", "HR"],
};

function hasRole(user, allowedRoles) {
  return roleAllowed(user?.role, allowedRoles);
}

// ============================================
// DYNAMIC LEAVE POLICY
// ============================================
// Fetches leave types from the LeaveType collection for the company.
// Seeds defaults if none exist yet. Filters by employee gender.
async function getLeavePolicy(companyId, gender) {
  await LeaveType.seedDefaults(companyId);
  const leaveTypes = await LeaveType.find({ companyId, isActive: true })
    .sort({ sortOrder: 1 })
    .lean();

  return leaveTypes
    .filter((lt) => lt.applicableGender === "all" || lt.applicableGender === gender)
    .map((lt) => ({
      leaveType: lt.code,
      label: lt.name,
      entitledDays: lt.defaultEntitlement,
      carryOver: 0,
    }));
}

// ============================================
// CREATE EMPLOYEE
// ============================================
// Creates both the Party (financial identity) and EmployeeProfile (HR data)
// in a single transaction. This ensures the two records are always in sync.
// ============================================
export async function createEmployee(_prevState, formData) {
  let mongoSession = null;

  try {
    await requirePlanAccess("hr");

    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, EMP_ROLES.CREATE)) {
      return { success: false, error: "You do not have permission to create employees" };
    }

    const tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);

    // Parse form data
    const firstName = formData.get("firstName")?.toString().trim();
    const lastName = formData.get("lastName")?.toString().trim();
    const email = formData.get("email")?.toString().trim().toLowerCase() || null;
    const phone = formData.get("phone")?.toString().trim() || null;
    const nationalId = formData.get("nationalId")?.toString().trim() || null;
    const kraPin = formData.get("kraPin")?.toString().trim().toUpperCase() || null;
    const nssfNumber = formData.get("nssfNumber")?.toString().trim() || null;
    // Accept both `shaNumber` (new) and `nhifNumber` (legacy form key) for back-compat
    const shaNumber =
      formData.get("shaNumber")?.toString().trim() ||
      formData.get("nhifNumber")?.toString().trim() ||
      null;
    const gender = formData.get("gender")?.toString() || null;
    const dateOfBirth = formData.get("dateOfBirth") ? new Date(formData.get("dateOfBirth")) : null;

    const departmentId = formData.get("departmentId")?.toString() || null;
    const department = formData.get("department")?.toString() || null;
    const designation = formData.get("designation")?.toString().trim() || null;
    const employmentType = formData.get("employmentType")?.toString() || "full_time";
    const hireDate = formData.get("hireDate") ? new Date(formData.get("hireDate")) : new Date();
    const jobGrade = formData.get("jobGrade")?.toString() || null;
    const workLocation = formData.get("workLocation")?.toString() || null;
    const managerId = formData.get("managerId")?.toString() || null;
    const managerName = formData.get("managerName")?.toString() || null;

    const basicSalary = parseFloat(formData.get("basicSalary") || "0");
    const housingAllowance = parseFloat(formData.get("housingAllowance") || "0");
    const transportAllowance = parseFloat(formData.get("transportAllowance") || "0");
    const paymentMethod = formData.get("paymentMethod")?.toString() || "bank";
    const bankName = formData.get("bankName")?.toString() || null;
    const bankAccount = formData.get("bankAccount")?.toString() || null;
    const mpesaNumber = formData.get("mpesaNumber")?.toString() || null;

    const emergencyName = formData.get("emergencyName")?.toString() || null;
    const emergencyPhone = formData.get("emergencyPhone")?.toString() || null;
    const emergencyRelationship = formData.get("emergencyRelationship")?.toString() || null;
    const linkedUserId = formData.get("linkedUserId")?.toString() || null;

    // Validate required fields
    const fieldErrors = {};
    if (!firstName) fieldErrors.firstName = "Required";
    if (!lastName) fieldErrors.lastName = "Required";
    if (!hireDate) fieldErrors.hireDate = "Required";
    if (Object.keys(fieldErrors).length > 0) {
      return { success: false, error: "Please fill in all required fields", fieldErrors };
    }

    await dbConnect();

    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    // Employee number — use manual input if provided, otherwise auto-generate
    const manualEmpNo = formData.get("employeeNumber")?.toString().trim() || null;
    const employeeNumber = manualEmpNo || await EmployeeProfile.generateEmployeeNumber(tenantCompanyId, mongoSession);
    const fullName = `${firstName} ${lastName}`;

    // 1. Create Party (financial identity — used in EmployeeClaims, payroll payments)
    const [party] = await Party.create(
      [
        {
          companyId: tenantCompanyId,
          type: "employee",
          name: fullName,
          email,
          phone,
          employeeNumber,
          department: department || null,
          designation: designation || null,
          isActive: true,
          ...(linkedUserId ? { userId: linkedUserId } : {}),
          createdBy: { name: user.name, id: user.id },
        },
      ],
      { session: mongoSession }
    );

    // 2. Create EmployeeProfile (HR data)
    const currentYear = new Date().getFullYear();
    const [profile] = await EmployeeProfile.create(
      [
        {
          companyId: tenantCompanyId,
          partyId: party._id,
          employeeNumber,
          personalInfo: {
            firstName,
            lastName,
            dateOfBirth,
            gender,
            nationalId,
            kraPin,
            nssfNumber,
            shaNumber,
            nationality: formData.get("nationality")?.toString() || "Kenyan",
          },
          employment: {
            departmentId: departmentId || undefined,
            department: department || null,
            designation,
            employmentType,
            status: "probation",    // All new employees start on probation
            hireDate,
            jobGrade,
            workLocation,
            managerId: managerId ? new mongoose.Types.ObjectId(managerId) : undefined,
            managerName: managerName || null,
          },
          compensation: {
            basicSalary,
            currency: "KES",
            allowances: {
              housing: housingAllowance,
              transport: transportAllowance,
            },
            paymentMethod,
            bankName,
            bankAccount,
            mpesaNumber,
          },
          emergencyContact: emergencyName
            ? { name: emergencyName, phone: emergencyPhone, relationship: emergencyRelationship }
            : undefined,
          ...(linkedUserId ? { userId: linkedUserId } : {}),
          createdBy: { name: user.name, id: user.id },
        },
      ],
      { session: mongoSession }
    );

    // 3. Initialize leave balances for current year (dynamic, gender-filtered)
    const leavePolicy = await getLeavePolicy(tenantCompanyId, gender);
    profile.initLeaveBalances(currentYear, leavePolicy);
    await profile.save({ session: mongoSession });

    await mongoSession.commitTransaction();
    mongoSession.endSession();
    mongoSession = null;

    revalidatePath("/dashboard/hr/employees");
  } catch (error) {
    if (mongoSession) await mongoSession.abortTransaction();
    return { success: false, error: error.message || "Failed to create employee" };
  } finally {
    if (mongoSession) mongoSession.endSession();
  }

  redirect("/dashboard/hr/employees");
}

// ============================================
// UPDATE EMPLOYEE (Personal & Employment Info)
// ============================================
export async function updateEmployee(_prevState, formData) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, EMP_ROLES.UPDATE)) {
      return { success: false, error: "You do not have permission to update employees" };
    }

    const profileId = formData.get("profileId")?.toString();
    if (!profileId) return { success: false, error: "Profile ID is required" };

    await dbConnect();

    const profile = await EmployeeProfile.findOne(
      withTenantScope({ _id: profileId }, companyId, isSuperAdmin)
    );

    if (!profile) return { success: false, error: "Employee not found" };

    // Update employee number if provided
    const newEmpNo = formData.get("employeeNumber")?.toString().trim();
    if (newEmpNo && newEmpNo !== profile.employeeNumber) {
      profile.employeeNumber = newEmpNo;
    }

    // Update personal info
    if (profile.personalInfo) {
      profile.personalInfo.firstName = formData.get("firstName")?.toString().trim() || profile.personalInfo.firstName;
      profile.personalInfo.lastName = formData.get("lastName")?.toString().trim() || profile.personalInfo.lastName;
      profile.personalInfo.dateOfBirth = formData.get("dateOfBirth") ? new Date(formData.get("dateOfBirth")) : profile.personalInfo.dateOfBirth;
      profile.personalInfo.gender = formData.get("gender")?.toString() || profile.personalInfo.gender;
      profile.personalInfo.nationalId = formData.get("nationalId")?.toString().trim() || profile.personalInfo.nationalId;
      profile.personalInfo.kraPin = formData.get("kraPin")?.toString().trim().toUpperCase() || profile.personalInfo.kraPin;
      profile.personalInfo.nssfNumber = formData.get("nssfNumber")?.toString().trim() || profile.personalInfo.nssfNumber;
      // Accept both new and legacy form keys; backfill from legacy `nhifNumber`
      // (which lean reads still expose) when the new `shaNumber` is empty so
      // edits to a pre-rename record don't blank the SHA value.
      profile.personalInfo.shaNumber =
        formData.get("shaNumber")?.toString().trim() ||
        formData.get("nhifNumber")?.toString().trim() ||
        profile.personalInfo.shaNumber ||
        profile.personalInfo.nhifNumber;
    }

    // Update employment info (non-financial)
    if (profile.employment) {
      const departmentId = formData.get("departmentId")?.toString() || null;
      const department = formData.get("department")?.toString() || null;
      profile.employment.departmentId = departmentId || profile.employment.departmentId;
      profile.employment.department = department || profile.employment.department;
      profile.employment.designation = formData.get("designation")?.toString().trim() || profile.employment.designation;
      profile.employment.workLocation = formData.get("workLocation")?.toString() || profile.employment.workLocation;
      profile.employment.jobGrade = formData.get("jobGrade")?.toString() || profile.employment.jobGrade;
      // Per-employee shift — empty string means "use company default" (stored as null)
      const shiftStart = formData.get("shiftStart")?.toString().trim() || null;
      const shiftEnd   = formData.get("shiftEnd")?.toString().trim() || null;
      profile.employment.shiftStart = shiftStart;
      profile.employment.shiftEnd   = shiftEnd;
      const contractEnd = formData.get("contractEnd");
      if (contractEnd) profile.employment.contractEnd = new Date(contractEnd);
      const contractType = formData.get("contractType")?.toString();
      if (contractType) profile.employment.contractType = contractType;
    }

    // Update emergency contact
    const emergencyName = formData.get("emergencyName")?.toString();
    if (emergencyName) {
      profile.emergencyContact = {
        name: emergencyName,
        phone: formData.get("emergencyPhone")?.toString() || null,
        relationship: formData.get("emergencyRelationship")?.toString() || null,
      };
    }

    profile.notes = formData.get("notes")?.toString() || profile.notes;
    profile.lastModifiedBy = { name: user.name, id: user.id };

    await profile.save();

    // Sync Party + User when name/department/designation/contact change
    const newFirstName = formData.get("firstName")?.toString().trim();
    const newLastName = formData.get("lastName")?.toString().trim();
    const syncDepartment = formData.get("department")?.toString() || undefined;
    const syncDesignation = formData.get("designation")?.toString() || undefined;
    const newEmail = formData.get("email")?.toString().trim().toLowerCase() || undefined;
    const newPhone = formData.get("phone")?.toString().trim() || undefined;

    if (newFirstName && newLastName) {
      const fullName = `${newFirstName} ${newLastName}`;
      const partyUpdate = {
        name: fullName,
        department: syncDepartment,
        designation: syncDesignation,
        employeeNumber: profile.employeeNumber,
        lastModifiedBy: { name: user.name, id: user.id },
      };
      // Only update email if employee has no portal login (userId)
      if (!profile.userId && newEmail !== undefined) partyUpdate.email = newEmail;
      if (newPhone !== undefined) partyUpdate.phone = newPhone;

      await Party.findByIdAndUpdate(profile.partyId, partyUpdate);
      // Keep User display name in sync with the authoritative HR name
      if (profile.userId) {
        await User.findByIdAndUpdate(profile.userId, {
          name: fullName,
          ...(syncDepartment ? { department: syncDepartment } : {}),
        });
      }
    } else if ((syncDepartment || syncDesignation || newEmail || newPhone) && profile.partyId) {
      // Name didn't change but other fields did — still sync
      const partyUpdate = {
        ...(syncDepartment ? { department: syncDepartment } : {}),
        ...(syncDesignation ? { designation: syncDesignation } : {}),
        lastModifiedBy: { name: user.name, id: user.id },
      };
      if (!profile.userId && newEmail !== undefined) partyUpdate.email = newEmail;
      if (newPhone !== undefined) partyUpdate.phone = newPhone;

      await Party.findByIdAndUpdate(profile.partyId, partyUpdate);
      if (profile.userId && syncDepartment) {
        await User.findByIdAndUpdate(profile.userId, { department: syncDepartment });
      }
    }

    revalidatePath(`/dashboard/hr/employees/${profileId}`);
    revalidatePath("/dashboard/hr/employees");
  } catch (error) {
    return { success: false, error: error.message || "Failed to update employee" };
  }

  redirect(`/dashboard/hr/employees/${formData.get("profileId")}`);
}

// ============================================
// UPDATE COMPENSATION (Separate — sensitive)
// ============================================
export async function updateCompensation(_prevState, formData) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, EMP_ROLES.UPDATE_COMPENSATION)) {
      return { success: false, error: "You do not have permission to update compensation" };
    }

    const profileId = formData.get("profileId")?.toString();
    if (!profileId) return { success: false, error: "Profile ID is required" };

    await dbConnect();

    const profile = await EmployeeProfile.findOne(
      withTenantScope({ _id: profileId }, companyId, isSuperAdmin)
    );

    if (!profile) return { success: false, error: "Employee not found" };

    // Snapshot previous compensation for history record
    const prev = profile.compensation || {};
    const prevGross = (prev.basicSalary || 0) + (prev.allowances?.housing || 0) +
      (prev.allowances?.transport || 0) + (prev.allowances?.medical || 0) + (prev.allowances?.other || 0);

    const newBasic = parseFloat(formData.get("basicSalary") || "0");
    const newHousing = parseFloat(formData.get("housingAllowance") || "0");
    const newTransport = parseFloat(formData.get("transportAllowance") || "0");
    const newMedical = parseFloat(formData.get("medicalAllowance") || "0");
    const newOther = parseFloat(formData.get("otherAllowance") || "0");
    const newGross = newBasic + newHousing + newTransport + newMedical + newOther;
    const effectiveDate = formData.get("effectiveDate") ? new Date(formData.get("effectiveDate")) : new Date();
    const reason = formData.get("reason")?.toString().trim() || null;

    profile.compensation = {
      basicSalary: newBasic,
      currency: "KES",
      allowances: {
        housing: newHousing,
        transport: newTransport,
        medical: newMedical,
        other: newOther,
      },
      paymentMethod: formData.get("paymentMethod")?.toString() || "bank",
      bankName: formData.get("bankName")?.toString() || null,
      bankAccount: formData.get("bankAccount")?.toString() || null,
      bankBranch: formData.get("bankBranch")?.toString() || null,
      mpesaNumber: formData.get("mpesaNumber")?.toString() || null,
      lastReviewDate: effectiveDate,
      lastReviewedBy: { name: user.name, id: user.id },
    };

    profile.lastModifiedBy = { name: user.name, id: user.id };
    await profile.save();

    // Write salary history record
    await SalaryHistory.create({
      companyId: profile.companyId,
      profileId: profile._id,
      partyId: profile.partyId,
      employeeName: `${profile.personalInfo?.firstName} ${profile.personalInfo?.lastName}`.trim(),
      employeeNumber: profile.employeeNumber,
      department: profile.employment?.department,
      previous: {
        basicSalary: prev.basicSalary || 0,
        housingAllowance: prev.allowances?.housing || 0,
        transportAllowance: prev.allowances?.transport || 0,
        medicalAllowance: prev.allowances?.medical || 0,
        otherAllowance: prev.allowances?.other || 0,
        grossSalary: prevGross,
      },
      updated: {
        basicSalary: newBasic,
        housingAllowance: newHousing,
        transportAllowance: newTransport,
        medicalAllowance: newMedical,
        otherAllowance: newOther,
        grossSalary: newGross,
      },
      basicSalaryChange: newBasic - (prev.basicSalary || 0),
      grossSalaryChange: newGross - prevGross,
      effectiveDate,
      reason,
      changedBy: { name: user.name, id: user.id },
    });

    revalidatePath(`/dashboard/hr/employees/${profileId}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Failed to update compensation" };
  }
}

// ============================================
// CONFIRM EMPLOYEE (probation → active)
// ============================================
export async function confirmEmployee(profileId) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, EMP_ROLES.UPDATE)) {
      return { success: false, error: "You do not have permission to confirm employees" };
    }

    await dbConnect();

    const profile = await EmployeeProfile.findOne(
      withTenantScope({ _id: profileId }, companyId, isSuperAdmin)
    );

    if (!profile) return { success: false, error: "Employee not found" };
    if (profile.employment?.status !== "probation") {
      return { success: false, error: "Employee is not on probation" };
    }

    profile.employment.status = "active";
    profile.employment.confirmationDate = new Date();
    profile.lastModifiedBy = { name: user.name, id: user.id };
    await profile.save();

    await EmploymentHistory.create({
      companyId: profile.companyId,
      profileId: profile._id,
      partyId: profile.partyId,
      employeeName: `${profile.personalInfo?.firstName} ${profile.personalInfo?.lastName}`.trim(),
      employeeNumber: profile.employeeNumber,
      eventType: "probation_confirmation",
      field: "status",
      previousValue: "probation",
      newValue: "active",
      effectiveDate: new Date(),
      changedBy: { name: user.name, id: user.id },
    });

    revalidatePath(`/dashboard/hr/employees/${profileId}`);
    revalidatePath("/dashboard/hr/employees");

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Failed to confirm employee" };
  }
}

// ============================================
// TERMINATE EMPLOYEE
// ============================================
export async function terminateEmployee(_prevState, formData) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, EMP_ROLES.TERMINATE)) {
      return { success: false, error: "You do not have permission to terminate employees" };
    }

    const profileId = formData.get("profileId")?.toString();
    const terminationDate = formData.get("terminationDate")
      ? new Date(formData.get("terminationDate"))
      : new Date();
    const reason = formData.get("reason")?.toString().trim();

    if (!profileId) return { success: false, error: "Profile ID is required" };

    await dbConnect();

    const profile = await EmployeeProfile.findOne(
      withTenantScope({ _id: profileId }, companyId, isSuperAdmin)
    );

    if (!profile) return { success: false, error: "Employee not found" };
    if (profile.employment?.status === "terminated") {
      return { success: false, error: "Employee is already terminated" };
    }

    const prevStatus = profile.employment?.status;
    profile.employment.status = "terminated";
    profile.employment.terminationDate = terminationDate;
    if (reason) profile.notes = `TERMINATED: ${reason}\n${profile.notes || ""}`.trim();
    profile.lastModifiedBy = { name: user.name, id: user.id };
    await profile.save();

    await EmploymentHistory.create({
      companyId: profile.companyId,
      profileId: profile._id,
      partyId: profile.partyId,
      employeeName: `${profile.personalInfo?.firstName} ${profile.personalInfo?.lastName}`.trim(),
      employeeNumber: profile.employeeNumber,
      eventType: "termination",
      field: "status",
      previousValue: prevStatus,
      newValue: "terminated",
      effectiveDate: terminationDate,
      reason,
      changedBy: { name: user.name, id: user.id },
    });

    // Deactivate Party + User account
    await Party.findByIdAndUpdate(profile.partyId, {
      isActive: false,
      lastModifiedBy: { name: user.name, id: user.id },
    });
    if (profile.userId) {
      // Bump tokenVersion so any active session is killed on next
      // privileged request — termination shouldn't have an 8h tail.
      await User.findByIdAndUpdate(profile.userId, {
        $set: { status: "Inactive" },
        $inc: { tokenVersion: 1 },
      });
    }

    revalidatePath(`/dashboard/hr/employees/${profileId}`);
    revalidatePath("/dashboard/hr/employees");

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Failed to terminate employee" };
  }
}

// ============================================
// UPDATE LEAVE BALANCE (Admin / HR — per leave type)
// ============================================
export async function updateLeaveBalance(_prevState, formData) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!["SuperAdmin", "Admin", "HR"].includes(user?.role)) {
      return { success: false, error: "You do not have permission to manage leave balances" };
    }

    const profileId = formData.get("profileId")?.toString();
    const leaveType = formData.get("leaveType")?.toString();
    const entitledDays = parseInt(formData.get("entitledDays") || "0");
    const carryOver = parseInt(formData.get("carryOver") || "0");

    if (!profileId || !leaveType) return { success: false, error: "Missing required fields" };

    await dbConnect();

    const profile = await EmployeeProfile.findOne(
      withTenantScope({ _id: profileId }, companyId, isSuperAdmin)
    );
    if (!profile) return { success: false, error: "Employee not found" };

    const balance = profile.leaveBalances?.find((b) => b.leaveType === leaveType);
    if (!balance) return { success: false, error: `Leave type "${leaveType}" not found for this employee` };

    const newBalanceDays = entitledDays + carryOver - (balance.usedDays || 0);

    await EmployeeProfile.updateOne(
      withTenantScope({ _id: profileId, "leaveBalances.leaveType": leaveType }, companyId, isSuperAdmin),
      {
        $set: {
          "leaveBalances.$.entitledDays": entitledDays,
          "leaveBalances.$.carryOver": carryOver,
          "leaveBalances.$.balanceDays": newBalanceDays,
          lastModifiedBy: { name: user.name, id: user.id },
        },
      }
    );

    revalidatePath(`/dashboard/hr/employees/${profileId}`);
    revalidatePath(`/dashboard/hr/employees/${profileId}/leave-balances`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Failed to update leave balance" };
  }
}

// ============================================
// SEND EMPLOYEE PORTAL INVITE
// ============================================
// Sends a login invite to an employee so they can access the portal.
// Links the Invite to the Party record via partyId.
// When the invite is accepted, User.id is written back to Party and
// EmployeeProfile, completing the login connection.
// ============================================
export async function sendEmployeePortalInvite(profileId, role = "Employee") {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!hasRole(user, EMP_ROLES.CREATE)) {
      return { success: false, error: "You do not have permission to invite employees" };
    }

    await dbConnect();

    // Load profile + party in parallel
    const profile = await EmployeeProfile.findOne(
      withTenantScope({ _id: profileId }, companyId, isSuperAdmin)
    ).lean();

    if (!profile) return { success: false, error: "Employee not found" };

    const party = await Party.findById(profile.partyId).lean();
    if (!party) return { success: false, error: "Employee party record not found" };

    if (!party.email) {
      return { success: false, error: "Employee has no email address. Add an email first." };
    }

    // If already has a login, no need to invite
    if (profile.userId) {
      return { success: false, error: "Employee already has a portal login" };
    }

    const email = party.email;

    // Check for existing pending invite
    const existing = await Invite.findOne({
      email,
      companyId: profile.companyId,
      status: "pending",
      expiresAt: { $gt: new Date() },
    }).lean();

    if (existing) {
      return { success: false, error: `A pending invite already exists for ${email}` };
    }

    // Check if a User with this email already exists
    // Validate role
    const ALLOWED_ROLES = ["Employee", "Manager", "Accountant", "HR", "Store Manager", "Admin"];
    const inviteRole = ALLOWED_ROLES.includes(role) ? role : "Employee";

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      // User exists — link to employee profile and set chosen role
      // Complete the triangle: User.partyId ↔ Party.userId ↔ EmployeeProfile.userId
      existingUser.role = inviteRole;
      existingUser.partyId = profile.partyId;
      if (!existingUser.companyId) existingUser.companyId = profile.companyId;
      await existingUser.save();

      await Promise.all([
        Party.findByIdAndUpdate(profile.partyId, { userId: existingUser._id }),
        EmployeeProfile.findByIdAndUpdate(profileId, { userId: existingUser._id }),
      ]);
      return { success: true, message: `Account (${email}) linked with role: ${inviteRole}` };
    }

    // Check user limit — SuperAdmin bypasses when acting on behalf of a tenant
    const limitCheck = await checkUserLimit(profile.companyId, { bypass: isSuperAdmin });
    if (!limitCheck.allowed) {
      return { success: false, error: limitCheck.error };
    }

    // Fetch company name for the email
    const company = await Company.findById(profile.companyId).select("name").lean();

    const { rawToken, hashedToken } = Invite.generateToken();

    await Invite.create({
      email,
      role: inviteRole,
      companyId: profile.companyId,
      partyId: profile.partyId,
      invitedBy: { name: user.name, id: user.id },
      token: hashedToken,
    });

    // Send email — await so we can surface failures to the user
    try {
      await sendInviteEmail({
        to: email,
        inviterName: user.name,
        companyName: company?.name || "Your Company",
        role: inviteRole,
        rawToken,
      });
    } catch (emailErr) {
      console.error("Failed to send employee invite email:", emailErr);
      // Invite record is created — HR can resend from Users page
      revalidatePath(`/dashboard/hr/employees/${profileId}`);
      return {
        success: true,
        warning: true,
        message: `Invite created for ${email} but the email could not be sent. Check your email configuration or resend from the Users page.`,
      };
    }

    revalidatePath(`/dashboard/hr/employees/${profileId}`);
    return { success: true, message: `Portal invite sent to ${email}` };
  } catch (error) {
    return { success: false, error: error.message || "Failed to send invite" };
  }
}

// ============================================
// UPLOAD EMPLOYEE PHOTO (Admin / HR / Manager)
// ============================================
export async function uploadEmployeePhoto(_prevState, formData) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!["SuperAdmin", "Admin", "HR", "Manager"].includes(user?.role)) {
      return { success: false, error: "You do not have permission to upload photos" };
    }

    const profileId = formData.get("profileId")?.toString();
    const file = formData.get("photo");

    if (!profileId) return { success: false, error: "Profile ID is required" };
    if (!file || file.size === 0) return { success: false, error: "No photo selected" };
    if (!file.type.startsWith("image/")) return { success: false, error: "File must be an image" };
    if (file.size > 5 * 1024 * 1024) return { success: false, error: "Photo must be under 5MB" };

    await dbConnect();

    const profile = await EmployeeProfile.findOne(
      withTenantScope({ _id: profileId }, companyId, isSuperAdmin)
    );
    if (!profile) return { success: false, error: "Employee not found" };

    // Delete old photo from Cloudinary if exists
    if (profile.personalInfo?.photo?.publicId) {
      await cloudinary.uploader.destroy(profile.personalInfo.photo.publicId).catch(() => {});
    }

    // Upload new photo — base64 approach works reliably in Next.js server actions
    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const dataUri = `data:${file.type};base64,${base64}`;

    const result = await cloudinary.uploader.upload(dataUri, {
      folder: `hr/employees/${profileId}`,
      public_id: "photo",
      overwrite: true,
      transformation: [{ width: 400, height: 400, crop: "fill", gravity: "auto" }],
    });

    profile.personalInfo.photo = { url: result.secure_url, publicId: result.public_id };
    profile.lastModifiedBy = { name: user.name, id: user.id };
    await profile.save();

    revalidatePath(`/dashboard/hr/employees/${profileId}`);
    return { success: true, url: result.secure_url };
  } catch (error) {
    return { success: false, error: error.message || "Failed to upload photo" };
  }
}

// ============================================
// UPLOAD EMPLOYEE DOCUMENT (Admin / HR / Manager)
// ============================================
export async function uploadEmployeeDocument(_prevState, formData) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!["SuperAdmin", "Admin", "HR", "Manager"].includes(user?.role)) {
      return { success: false, error: "You do not have permission to upload documents" };
    }

    const profileId = formData.get("profileId")?.toString();
    const docType = formData.get("docType")?.toString();
    const docName = formData.get("docName")?.toString()?.trim();
    const file = formData.get("file");

    if (!profileId || !docType || !file || file.size === 0) {
      return { success: false, error: "Profile ID, document type, and file are required" };
    }
    if (file.size > 10 * 1024 * 1024) return { success: false, error: "File must be under 10MB" };

    await dbConnect();

    const profile = await EmployeeProfile.findOne(
      withTenantScope({ _id: profileId }, companyId, isSuperAdmin)
    );
    if (!profile) return { success: false, error: "Employee not found" };
    if ((profile.documents || []).length >= 50) {
      return { success: false, error: "Document limit reached (50 max)" };
    }

    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const isImage = file.type.startsWith("image/");
    const resourceType = isImage ? "image" : "raw";
    const dataUri = `data:${file.type};base64,${base64}`;

    const result = await cloudinary.uploader.upload(dataUri, {
      folder: `hr/employees/${profileId}/documents`,
      resource_type: resourceType,
      use_filename: true,
      unique_filename: true,
    });

    profile.documents.push({
      docType,
      name: docName || file.name || docType,
      url: result.secure_url,
      publicId: result.public_id,
      uploadedAt: new Date(),
      uploadedBy: { name: user.name, id: user.id },
    });

    profile.lastModifiedBy = { name: user.name, id: user.id };
    await profile.save();

    revalidatePath(`/dashboard/hr/employees/${profileId}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Failed to upload document" };
  }
}

// ============================================
// DELETE EMPLOYEE DOCUMENT (Admin / HR)
// ============================================
export async function deleteEmployeeDocument(profileId, documentId) {
  try {
    const { companyId, isSuperAdmin, user } = await getTenantContext();

    if (!["SuperAdmin", "Admin", "HR"].includes(user?.role)) {
      return { success: false, error: "You do not have permission to delete documents" };
    }

    await dbConnect();

    const profile = await EmployeeProfile.findOne(
      withTenantScope({ _id: profileId }, companyId, isSuperAdmin)
    );
    if (!profile) return { success: false, error: "Employee not found" };

    const doc = profile.documents?.find((d) => d._id?.toString() === documentId);
    if (!doc) return { success: false, error: "Document not found" };

    // Delete from Cloudinary
    if (doc.publicId) {
      await cloudinary.uploader.destroy(doc.publicId, { resource_type: "raw" }).catch(() => {});
    }

    profile.documents = profile.documents.filter((d) => d._id?.toString() !== documentId);
    profile.lastModifiedBy = { name: user.name, id: user.id };
    await profile.save();

    revalidatePath(`/dashboard/hr/employees/${profileId}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Failed to delete document" };
  }
}
