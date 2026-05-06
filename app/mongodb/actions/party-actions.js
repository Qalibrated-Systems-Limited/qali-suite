"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import Party from "../../models/parties";
import connectDB from "../../config/dbConnect";
import {
  getTenantContext,
  getCompanyIdForCreate,
  withTenantScope,
} from "@/lib/utils/tenant-utils";
import { requirePlanAccess } from "@/lib/plan-gate";

// ============================================
// ZOD SCHEMAS
// ============================================

const CreatePartySchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
  type: z.enum(["customer", "supplier", "employee", "both"], {
    required_error: "Party type is required",
  }),
  displayName: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  taxPin: z
    .string()
    .regex(/^[A-Z]\d{9}[A-Z]$/, "Invalid KRA PIN format (A000000000X)")
    .optional()
    .or(z.literal("")),
  employeeNumber: z.string().optional(),
  department: z.string().optional(),
  designation: z.string().optional(),
  isContractor: z.boolean().optional(),
  whtApplicable: z.boolean().optional(),
  whtRate: z.coerce.number().min(0).max(20).optional(),
  creditLimit: z.coerce.number().min(0).optional(),
  paymentTermsDays: z.coerce.number().min(0).optional(),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  notes: z.string().optional(),
});

const UpdatePartySchema = CreatePartySchema.partial();

const CreateEmployeePartySchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  name: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  employeeNumber: z.string().optional(),
  department: z.string().optional(),
  designation: z.string().optional(),
  taxPin: z.string().optional(),
});

// ============================================
// PARTY ACTIONS
// ============================================

/**
 * Create a new party (customer/supplier/employee)
 */
export async function createParty(prevState, formData) {
  try {
    await requirePlanAccess("finance");
  } catch (error) {
    return {
      errors: { _form: [error.message] },
    };
  }

  // Extract form values to preserve on error
  const formValues = {
    name: formData.get("name"),
    type: formData.get("type"),
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    taxPin: formData.get("taxPin"),
    employeeNumber: formData.get("employeeNumber"),
    department: formData.get("department"),
    designation: formData.get("designation"),
    isContractor: formData.get("isContractor") === "true",
    whtApplicable: formData.get("whtApplicable") === "true",
    whtRate: formData.get("whtRate"),
    creditLimit: formData.get("creditLimit"),
    paymentTermsDays: formData.get("paymentTermsDays"),
    bankName: formData.get("bankName"),
    accountNumber: formData.get("accountNumber"),
    notes: formData.get("notes"),
  };

  // Auth check with tenant context
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return {
      errors: { _form: [error.message] },
      values: formValues,
    };
  }

  if (
    ![
      "SuperAdmin",
      "Admin",
      "CFO",
      "Finance Manager",
      "Accountant",
      "Sales Manager",
      "Procurement Officer",
    ].includes(user.role)
  ) {
    return {
      errors: { _form: ["Unauthorized: Admin or Accountant role required"] },
      values: formValues,
    };
  }

  // Get tenant companyId for create
  let tenantCompanyId;
  try {
    tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);
  } catch (error) {
    return {
      errors: { _form: [error.message] },
      values: formValues,
    };
  }

  // Validate
  const validatedFields = CreatePartySchema.safeParse(formValues);

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      values: formValues,
    };
  }

  const data = validatedFields.data;

  try {
    await connectDB();

    // Check for duplicate email (tenant-scoped)
    if (data.email) {
      const existingEmail = await Party.findOne(
        withTenantScope({ email: data.email.toLowerCase() }, tenantCompanyId, isSuperAdmin)
      );
      if (existingEmail) {
        return {
          errors: { email: ["A party with this email already exists"] },
          values: formValues,
        };
      }
    }

    // Check for duplicate tax PIN (tenant-scoped)
    if (data.taxPin) {
      const existingPin = await Party.findOne(
        withTenantScope({ taxPin: data.taxPin.toUpperCase() }, tenantCompanyId, isSuperAdmin)
      );
      if (existingPin) {
        return {
          errors: { taxPin: ["A party with this KRA PIN already exists"] },
          values: formValues,
        };
      }
    }

    // Create party with tenant companyId
    await Party.create({
      companyId: tenantCompanyId,
      ...data,
      email: data.email?.toLowerCase(),
      taxPin: data.taxPin?.toUpperCase(),
      creditTerms: {
        creditLimit: data.creditLimit || 0,
        paymentTermsDays: data.paymentTermsDays || 30,
      },
      paymentDetails: {
        bankName: data.bankName,
        accountNumber: data.accountNumber,
      },
      createdBy: {
        name: user.name,
        id: user.id,
      },
      lastModifiedBy: {
        name: user.name,
        id: user.id,
      },
    });

    // Revalidate
    revalidatePath("/dashboard/parties");
    revalidatePath("/dashboard/customers");
    revalidatePath("/dashboard/suppliers");
    revalidatePath("/dashboard/employees");

    return {
      success: true,
      message: `${
        data.type.charAt(0).toUpperCase() + data.type.slice(1)
      } created successfully`,
    };
  } catch (error) {
    console.error("Create party error:", error);
    return {
      errors: { _form: [error.message || "Failed to create party"] },
      values: formValues,
    };
  }
}

/**
 * Quick-create a party (customer or supplier) from within forms.
 * Minimal fields — returns the new party for auto-selection.
 */
export async function quickCreateParty(formData) {
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return { success: false, error: error.message };
  }

  const name = formData.get("name")?.toString().trim();
  const phone = formData.get("phone")?.toString().trim() || "";
  const email = formData.get("email")?.toString().trim().toLowerCase() || "";
  const type = formData.get("type")?.toString() || "customer";

  if (!["customer", "supplier", "both"].includes(type)) {
    return { success: false, error: "Invalid party type" };
  }

  if (!name || name.length < 1) {
    return { success: false, error: "Name is required" };
  }

  let tenantCompanyId;
  try {
    tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);
  } catch (error) {
    return { success: false, error: error.message };
  }

  try {
    await connectDB();

    // Check duplicate email if provided
    if (email) {
      const existing = await Party.findOne(
        withTenantScope({ email }, tenantCompanyId, isSuperAdmin)
      ).lean();
      if (existing) {
        return { success: false, error: "A party with this email already exists" };
      }
    }

    const party = await Party.create({
      companyId: tenantCompanyId,
      name,
      type,
      phone,
      email: email || undefined,
      createdBy: { name: user.name, id: user.id },
      lastModifiedBy: { name: user.name, id: user.id },
    });

    revalidatePath("/dashboard/parties");

    return {
      success: true,
      party: {
        _id: party._id.toString(),
        name: party.displayName || party.name,
        email: party.email || "",
        phone: party.phone || "",
        phoneNumber: party.phone || "",
        address: "",
        taxPin: "",
      },
    };
  } catch (error) {
    console.error("Quick create party error:", error);
    return { success: false, error: error.message || "Failed to create party" };
  }
}

/**
 * Update existing party
 * Uses bind() to pass partyId
 */
export async function updateParty(partyId, prevState, formData) {
  // Auth check with tenant context
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return {
      errors: { _form: [error.message] },
    };
  }

  if (
    ![
      "SuperAdmin",
      "Admin",
      "CFO",
      "Finance Manager",
      "Accountant",
      "Sales Manager",
      "Procurement Officer",
    ].includes(user.role)
  ) {
    return {
      errors: { _form: ["Unauthorized: Admin or Accountant role required"] },
    };
  }

  // Validate
  const validatedFields = UpdatePartySchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    taxPin: formData.get("taxPin"),
    employeeNumber: formData.get("employeeNumber"),
    department: formData.get("department"),
    designation: formData.get("designation"),
    isContractor: formData.get("isContractor") === "true",
    whtApplicable: formData.get("whtApplicable") === "true",
    whtRate: formData.get("whtRate"),
    creditLimit: formData.get("creditLimit"),
    paymentTermsDays: formData.get("paymentTermsDays"),
    bankName: formData.get("bankName"),
    accountNumber: formData.get("accountNumber"),
    notes: formData.get("notes"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  const data = validatedFields.data;

  try {
    await connectDB();

    // Find party with tenant scoping
    const party = await Party.findOne(
      withTenantScope({ _id: partyId }, companyId, isSuperAdmin)
    );
    if (!party) {
      return {
        errors: { _form: ["Party not found"] },
      };
    }

    // Check for duplicate email (excluding current party, tenant-scoped)
    if (data.email && data.email !== party.email) {
      const existingEmail = await Party.findOne(
        withTenantScope({
          email: data.email.toLowerCase(),
          _id: { $ne: partyId },
        }, companyId, isSuperAdmin)
      );
      if (existingEmail) {
        return {
          errors: { email: ["A party with this email already exists"] },
        };
      }
    }

    // Check for duplicate tax PIN (excluding current party, tenant-scoped)
    if (data.taxPin && data.taxPin !== party.taxPin) {
      const existingPin = await Party.findOne(
        withTenantScope({
          taxPin: data.taxPin.toUpperCase(),
          _id: { $ne: partyId },
        }, companyId, isSuperAdmin)
      );
      if (existingPin) {
        return {
          errors: { taxPin: ["A party with this KRA PIN already exists"] },
        };
      }
    }

    // Update party
    Object.keys(data).forEach((key) => {
      if (data[key] !== undefined) {
        if (key === "email" && data.email) {
          party.email = data.email.toLowerCase();
        } else if (key === "taxPin" && data.taxPin) {
          party.taxPin = data.taxPin.toUpperCase();
        } else if (key === "creditLimit" || key === "paymentTermsDays") {
          if (!party.creditTerms) party.creditTerms = {};
          party.creditTerms[key] = data[key];
        } else if (key === "bankName" || key === "accountNumber") {
          if (!party.paymentDetails) party.paymentDetails = {};
          party.paymentDetails[key] = data[key];
        } else {
          party[key] = data[key];
        }
      }
    });

    party.lastModifiedBy = {
      name: user.name,
      id: user.id,
    };

    await party.save();

    // Revalidate
    revalidatePath("/dashboard/parties");
    revalidatePath("/dashboard/customers");
    revalidatePath("/dashboard/suppliers");
    revalidatePath("/dashboard/employees");
    revalidatePath(`/dashboard/parties/${partyId}`);

    return {
      success: true,
      message: "Party updated successfully",
    };
  } catch (error) {
    console.error("Update party error:", error);
    return {
      errors: { _form: [error.message || "Failed to update party"] },
    };
  }
}

/**
 * Delete party
 * Uses bind() to pass partyId
 */
export async function deleteParty(partyId) {
  // Auth check with tenant context
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return {
      errors: { _form: [error.message] },
    };
  }

  // Destructive / type-changing operations — top-level finance authority only.
  if (!["SuperAdmin", "Admin", "CFO"].includes(user.role)) {
    return {
      errors: {
        _form: ["You don't have permission to perform this action."],
      },
    };
  }

  try {
    await connectDB();

    // Find party with tenant scoping
    const party = await Party.findOne(
      withTenantScope({ _id: partyId }, companyId, isSuperAdmin)
    );
    if (!party) {
      return {
        errors: { _form: ["Party not found"] },
      };
    }

    // Check for transactions (tenant-scoped)
    const JournalEntry = (await import("../../models/JournalEntry")).default;
    const transactionCount = await JournalEntry.countDocuments(
      withTenantScope({ "party.id": partyId }, companyId, isSuperAdmin)
    );

    // Check for HR data (employee-specific)
    const EmployeeProfile = (await import("../../models/employeeProfile")).default;
    const LeaveRequest = (await import("../../models/leaveRequest")).default;
    const PayrollEntry = (await import("../../models/payrollEntry")).default;

    if (party.type === "employee") {
      const [leaveCount, payrollCount] = await Promise.all([
        LeaveRequest.countDocuments(
          withTenantScope({ "employee.partyId": partyId }, companyId, isSuperAdmin)
        ),
        PayrollEntry.countDocuments(
          withTenantScope({ partyId }, companyId, isSuperAdmin)
        ),
      ]);

      if (leaveCount > 0 || payrollCount > 0 || transactionCount > 0) {
        // Soft delete — HR data exists
        party.isActive = false;
        party.lastModifiedBy = {
          name: user.name,
          id: user.id,
        };
        await party.save();

        revalidatePath("/dashboard/parties");
        revalidatePath("/dashboard/hr/employees");

        return {
          success: true,
          message: `Employee deactivated (${transactionCount} journal entries, ${leaveCount} leave requests, ${payrollCount} payroll entries exist)`,
        };
      }
    }

    if (transactionCount > 0) {
      // Soft delete — financial data exists
      party.isActive = false;
      party.lastModifiedBy = {
        name: user.name,
        id: user.id,
      };
      await party.save();

      revalidatePath("/dashboard/parties");
      revalidatePath("/dashboard/customers");
      revalidatePath("/dashboard/suppliers");

      return {
        success: true,
        message: `Party deactivated (${transactionCount} transactions exist)`,
      };
    } else {
      // Hard delete — cascade clean EmployeeProfile and clear User ref
      const profile = await EmployeeProfile.findOneAndDelete(
        withTenantScope({ partyId }, companyId, isSuperAdmin)
      );

      // If this party was linked to a User, clear the back-link on User
      if (party.userId) {
        const User = (await import("../../models/user")).default;
        // Note: User doesn't have partyId yet but future-proofs this
      }

      await Party.findOneAndDelete(
        withTenantScope({ _id: partyId }, companyId, isSuperAdmin)
      );

      revalidatePath("/dashboard/parties");
      revalidatePath("/dashboard/customers");
      revalidatePath("/dashboard/suppliers");
      revalidatePath("/dashboard/hr/employees");

      return {
        success: true,
        message: profile
          ? "Party and employee profile deleted successfully"
          : "Party deleted successfully",
      };
    }
  } catch (error) {
    console.error("Delete party error:", error);
    return {
      errors: { _form: [error.message || "Failed to delete party"] },
    };
  }
}

/**
 * Toggle party status (activate/deactivate)
 * Uses bind() to pass partyId and isActive
 */
export async function togglePartyStatus(partyId, isActive) {
  // Auth check with tenant context
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return {
      errors: { _form: [error.message] },
    };
  }

  if (
    ![
      "SuperAdmin",
      "Admin",
      "CFO",
      "Finance Manager",
      "Accountant",
      "Sales Manager",
      "Procurement Officer",
    ].includes(user.role)
  ) {
    return {
      errors: { _form: ["Unauthorized: Admin or Accountant role required"] },
    };
  }

  try {
    await connectDB();

    // Find party with tenant scoping
    const party = await Party.findOne(
      withTenantScope({ _id: partyId }, companyId, isSuperAdmin)
    );
    if (!party) {
      return {
        errors: { _form: ["Party not found"] },
      };
    }

    party.isActive = isActive;
    party.lastModifiedBy = {
      name: user.name,
      id: user.id,
    };

    await party.save();

    revalidatePath("/dashboard/parties");
    revalidatePath("/dashboard/customers");
    revalidatePath("/dashboard/suppliers");
    revalidatePath(`/dashboard/parties/${partyId}`);

    return {
      success: true,
      message: `Party ${isActive ? "activated" : "deactivated"} successfully`,
    };
  } catch (error) {
    console.error("Toggle party status error:", error);
    return {
      errors: { _form: [error.message || "Failed to update party status"] },
    };
  }
}

/**
 * Refresh party balance
 * Uses bind() to pass partyId
 */
export async function refreshPartyBalance(partyId) {
  // Auth check with tenant context
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return {
      errors: { _form: [error.message] },
    };
  }

  if (
    ![
      "SuperAdmin",
      "Admin",
      "CFO",
      "Finance Manager",
      "Accountant",
      "Sales Manager",
      "Procurement Officer",
    ].includes(user.role)
  ) {
    return {
      errors: { _form: ["Unauthorized: Admin or Accountant role required"] },
    };
  }

  try {
    await connectDB();

    // Find party with tenant scoping
    const party = await Party.findOne(
      withTenantScope({ _id: partyId }, companyId, isSuperAdmin)
    );
    if (!party) {
      return {
        errors: { _form: ["Party not found"] },
      };
    }

    await party.calculateActualBalance();

    revalidatePath("/dashboard/parties");
    revalidatePath(`/dashboard/parties/${partyId}`);
    revalidatePath("/dashboard/reports/ar-aging");
    revalidatePath("/dashboard/reports/ap-aging");

    return {
      success: true,
      message: "Balance refreshed successfully",
    };
  } catch (error) {
    console.error("Refresh balance error:", error);
    return {
      errors: { _form: [error.message || "Failed to refresh balance"] },
    };
  }
}

/**
 * Refresh all party balances
 */
export async function refreshAllPartyBalances() {
  // Auth check with tenant context
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return {
      errors: { _form: [error.message] },
    };
  }

  // Destructive / type-changing operations — top-level finance authority only.
  if (!["SuperAdmin", "Admin", "CFO"].includes(user.role)) {
    return {
      errors: {
        _form: ["You don't have permission to perform this action."],
      },
    };
  }

  try {
    await connectDB();

    // Get parties with tenant scoping
    const parties = await Party.find(
      withTenantScope({ isActive: true }, companyId, isSuperAdmin)
    );

    let successCount = 0;
    let errorCount = 0;

    for (const party of parties) {
      try {
        await party.calculateActualBalance();
        successCount++;
      } catch (error) {
        console.error(`Failed to refresh balance for ${party.name}:`, error);
        errorCount++;
      }
    }

    revalidatePath("/dashboard/parties");
    revalidatePath("/dashboard/customers");
    revalidatePath("/dashboard/suppliers");
    revalidatePath("/dashboard/reports/ar-aging");
    revalidatePath("/dashboard/reports/ap-aging");

    return {
      success: true,
      message: `Refreshed ${successCount} balances${
        errorCount > 0 ? ` (${errorCount} errors)` : ""
      }`,
    };
  } catch (error) {
    console.error("Bulk refresh error:", error);
    return {
      errors: { _form: [error.message || "Failed to refresh balances"] },
    };
  }
}

/**
 * Convert party type
 * Uses bind() to pass partyId and newType
 */
export async function convertPartyType(partyId, newType) {
  // Auth check with tenant context
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return {
      errors: { _form: [error.message] },
    };
  }

  // Destructive / type-changing operations — top-level finance authority only.
  if (!["SuperAdmin", "Admin", "CFO"].includes(user.role)) {
    return {
      errors: {
        _form: ["You don't have permission to perform this action."],
      },
    };
  }

  try {
    await connectDB();

    // Find party with tenant scoping
    const party = await Party.findOne(
      withTenantScope({ _id: partyId }, companyId, isSuperAdmin)
    );
    if (!party) {
      return {
        errors: { _form: ["Party not found"] },
      };
    }

    // Validate conversion
    const validConversions = {
      customer: ["both"],
      supplier: ["both"],
      employee: [],
      both: ["customer", "supplier"],
    };

    if (!validConversions[party.type]?.includes(newType)) {
      return {
        errors: {
          _form: [
            `Cannot convert from ${
              party.type
            } to ${newType}. Valid conversions: ${
              validConversions[party.type]?.join(", ") || "none"
            }`,
          ],
        },
      };
    }

    party.type = newType;
    party.lastModifiedBy = {
      name: user.name,
      id: user.id,
    };

    await party.save();

    revalidatePath("/dashboard/parties");
    revalidatePath("/dashboard/customers");
    revalidatePath("/dashboard/suppliers");
    revalidatePath(`/dashboard/parties/${partyId}`);

    return {
      success: true,
      message: `Party converted to ${newType} successfully`,
    };
  } catch (error) {
    console.error("Convert party type error:", error);
    return {
      errors: { _form: [error.message || "Failed to convert party type"] },
    };
  }
}

/**
 * Create employee party linked to user
 */
export async function createEmployeeParty(prevState, formData) {
  // Auth check with tenant context
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return {
      errors: { _form: [error.message] },
    };
  }

  if (
    ![
      "SuperAdmin",
      "Admin",
      "CFO",
      "Finance Manager",
      "Accountant",
      "Sales Manager",
      "Procurement Officer",
    ].includes(user.role)
  ) {
    return {
      errors: { _form: ["Unauthorized: Admin or Accountant role required"] },
    };
  }

  // Get tenant companyId for create
  let tenantCompanyId;
  try {
    tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);
  } catch (error) {
    return {
      errors: { _form: [error.message] },
    };
  }

  // Validate
  const validatedFields = CreateEmployeePartySchema.safeParse({
    userId: formData.get("userId"),
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    employeeNumber: formData.get("employeeNumber"),
    department: formData.get("department"),
    designation: formData.get("designation"),
    taxPin: formData.get("taxPin"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  const data = validatedFields.data;

  try {
    await connectDB();

    // Verify user exists (tenant-scoped)
    const User = (await import("../../models/user")).default;
    const targetUser = await User.findOne(
      withTenantScope({ _id: data.userId }, tenantCompanyId, isSuperAdmin)
    );
    if (!targetUser) {
      return {
        errors: { userId: ["User not found"] },
      };
    }

    // Check if employee party already exists (tenant-scoped)
    const existingParty = await Party.findOne(
      withTenantScope({ userId: data.userId }, tenantCompanyId, isSuperAdmin)
    );
    if (existingParty) {
      return {
        errors: { _form: ["Employee party already exists for this user"] },
      };
    }

    // Create employee party with tenant companyId
    await Party.create({
      companyId: tenantCompanyId,
      type: "employee",
      userId: data.userId,
      name: data.name || targetUser.name,
      email: data.email || targetUser.email,
      phone: data.phone,
      employeeNumber: data.employeeNumber || targetUser.employeeNumber,
      department: data.department || targetUser.department,
      designation: data.designation,
      taxPin: data.taxPin?.toUpperCase(),
      isActive: true,
      createdBy: {
        name: user.name,
        id: user.id,
      },
      lastModifiedBy: {
        name: user.name,
        id: user.id,
      },
    });

    revalidatePath("/dashboard/parties");
    revalidatePath("/dashboard/employees");

    return {
      success: true,
      message: "Employee party created successfully",
    };
  } catch (error) {
    console.error("Create employee party error:", error);
    return {
      errors: { _form: [error.message || "Failed to create employee party"] },
    };
  }
}

/**
 * Link existing user to party
 * Uses bind() to pass userId and partyId
 */
export async function linkUserToParty(userId, partyId) {
  // Auth check with tenant context
  let companyId, isSuperAdmin, user;
  try {
    ({ companyId, isSuperAdmin, user } = await getTenantContext());
  } catch (error) {
    return {
      errors: { _form: [error.message] },
    };
  }

  // Destructive / type-changing operations — top-level finance authority only.
  if (!["SuperAdmin", "Admin", "CFO"].includes(user.role)) {
    return {
      errors: {
        _form: ["You don't have permission to perform this action."],
      },
    };
  }

  try {
    await connectDB();

    // Verify user exists (tenant-scoped)
    const User = (await import("../../models/user")).default;
    const targetUser = await User.findOne(
      withTenantScope({ _id: userId }, companyId, isSuperAdmin)
    );
    if (!targetUser) {
      return {
        errors: { _form: ["User not found"] },
      };
    }

    // Verify party exists (tenant-scoped)
    const party = await Party.findOne(
      withTenantScope({ _id: partyId }, companyId, isSuperAdmin)
    );
    if (!party) {
      return {
        errors: { _form: ["Party not found"] },
      };
    }

    // Check if user already linked (tenant-scoped)
    const existingLink = await Party.findOne(
      withTenantScope({ userId }, companyId, isSuperAdmin)
    );
    if (existingLink && existingLink._id.toString() !== partyId) {
      return {
        errors: { _form: ["User is already linked to another party"] },
      };
    }

    party.userId = userId;
    party.type = "employee";
    party.lastModifiedBy = {
      name: user.name,
      id: user.id,
    };

    await party.save();

    // Keep EmployeeProfile and User in sync so the full triangle is consistent:
    //   User.partyId → Party._id
    //   Party.userId → User._id
    //   EmployeeProfile.userId → User._id
    const EmployeeProfile = (await import("../../models/employeeProfile")).default;
    await Promise.all([
      EmployeeProfile.findOneAndUpdate(
        withTenantScope({ partyId }, companyId, isSuperAdmin),
        { userId },
      ),
      targetUser.updateOne({ partyId }),
    ]);

    revalidatePath("/dashboard/parties");
    revalidatePath("/dashboard/employees");
    revalidatePath("/dashboard/hr/employees");
    revalidatePath(`/dashboard/parties/${partyId}`);

    return {
      success: true,
      message: "User linked to party successfully",
    };
  } catch (error) {
    console.error("Link user to party error:", error);
    return {
      errors: { _form: [error.message || "Failed to link user to party"] },
    };
  }
}
