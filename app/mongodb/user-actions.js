"use server";

import { auth } from "@/auth";
import User from "../models/user";
import Company from "../models/Company";
import Party from "../models/parties";
import Invite from "../models/invite";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import dbConnect from "../config/dbConnect";
import { userRoles } from "@/lib/utils";
import mongoose from "mongoose";
import { sendInviteEmail } from "@/lib/email";
import { checkUserLimit } from "@/lib/check-user-limit";

// ============================================
// AUTHORIZATION HELPERS
// ============================================
const SUPER_ADMIN_ROLES = ["SuperAdmin"];
const ADMIN_ROLES = ["SuperAdmin", "Admin"];

// Helper to transform empty string/null to undefined
const optionalString = z
  .string()
  .optional()
  .nullable()
  .transform((val) => (val === "" || val === null ? undefined : val));

// Helper for ObjectId validation
const optionalObjectId = z
  .string()
  .optional()
  .nullable()
  .transform((val) => (val === "" || val === null ? undefined : val))
  .refine((val) => !val || mongoose.Types.ObjectId.isValid(val), {
    message: "Invalid company ID",
  });

// ============================================
// VALIDATION SCHEMAS
// ============================================
const userCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  email: z.string().email("Invalid email address"),
  role: z.enum(userRoles),
  department: optionalString,
  companyId: optionalObjectId,
});

const userUpdateSchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  email: z.string().email("Invalid email address"),
  role: z.enum(userRoles),
  department: optionalString,
  status: z.enum(["Active", "Inactive"]),
  companyId: optionalObjectId,
});

const passwordResetSchema = z
  .object({
    newPassword: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z
      .string()
      .min(6, "Password must be at least 6 characters"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

// ============================================
// CREATE USER
// ============================================
export async function createUser(prevState, formData) {
  await dbConnect();

  const session = await auth();
  const currentUser = session?.user;

  // Extract form values to preserve on error
  const formValues = {
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    department: formData.get("department"),
    companyId: formData.get("companyId"),
  };

  if (!currentUser) {
    return { message: "You must be logged in", errors: { _form: ["You must be logged in"] }, values: formValues };
  }

  if (!ADMIN_ROLES.includes(currentUser.role)) {
    return { message: "Unauthorized", errors: { _form: ["Admin role required"] }, values: formValues };
  }

  const validatedFields = userCreateSchema.safeParse(formValues);

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing or invalid fields",
      values: formValues,
    };
  }

  const { name, email, role, department, companyId } = validatedFields.data;

  // Determine which company to assign
  let assignedCompanyId = companyId;

  // Non-SuperAdmin can only create users for their own company
  if (currentUser.role !== "SuperAdmin") {
    assignedCompanyId = currentUser.companyId;

    // Admin cannot create SuperAdmin or Admin users
    if (role === "SuperAdmin" || role === "Admin") {
      return {
        message: "Only SuperAdmin can create Admin or SuperAdmin users",
        errors: { role: ["You cannot assign this role"] },
        values: formValues,
      };
    }
  }

  // Validate company exists if companyId is provided
  if (assignedCompanyId) {
    const company = await Company.findById(assignedCompanyId);
    if (!company) {
      return {
        message: "Company not found",
        errors: { companyId: ["Selected company does not exist"] },
        values: formValues,
      };
    }
  }

  // Check user limit before creating
  const limitCheck = await checkUserLimit(assignedCompanyId);
  if (!limitCheck.allowed) {
    return { message: limitCheck.error, errors: { _form: [limitCheck.error] }, values: formValues };
  }

  let newUserId = null;

  try {
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return {
        message: "User with this email already exists",
        errors: { email: ["Email already in use"] },
        values: formValues,
      };
    }

    // Create user (no password — user sets it themselves via invite link)
    const newUser = await User.create({
      name,
      email,
      role,
      department,
      companyId: assignedCompanyId,
      creator: {
        name: currentUser.name,
        id: currentUser.id,
      },
    });

    newUserId = newUser._id.toString();

    // Auto-create employee Party record linked to this user
    if (assignedCompanyId) {
      try {
        const existingParty = await Party.findOne({
          companyId: assignedCompanyId,
          userId: newUser._id,
          type: "employee",
        });
        if (!existingParty) {
          await Party.create({
            companyId: assignedCompanyId,
            type: "employee",
            userId: newUser._id,
            name,
            email,
            department: department || "",
            createdBy: {
              name: currentUser.name,
              id: currentUser.id,
            },
          });
        }
      } catch (partyErr) {
        console.error("Failed to auto-create employee party:", partyErr);
        // Non-blocking — user is created, party can be linked later
      }
    }

    // Send invite email so user can set up their account
    let emailSent = false;
    let emailError = null;
    try {
      const company = await Company.findById(assignedCompanyId).select("name").lean();
      const { rawToken, hashedToken } = Invite.generateToken();

      await Invite.create({
        email,
        role,
        companyId: assignedCompanyId,
        invitedBy: { name: currentUser.name, id: currentUser.id },
        token: hashedToken,
      });

      await sendInviteEmail({
        to: email,
        inviterName: currentUser.name,
        companyName: company?.name || "Your Company",
        role,
        rawToken,
      });
      emailSent = true;
    } catch (err) {
      console.error("Failed to send invite email:", err);
      emailError = err.message;
    }

    revalidatePath("/dashboard/users");
    revalidatePath("/dashboard/admin/users");
  } catch (error) {
    console.error("Create user error:", error);
    return {
      message: error.message || "Failed to create user",
      errors: { _form: [error.message || "Failed to create user"] },
      values: formValues,
    };
  }

  // Redirect outside try-catch to avoid catching the redirect error
  const emailParam = emailSent ? "sent" : "failed";
  redirect(`/dashboard/users/${newUserId}?created=true&email=${emailParam}${emailError ? `&emailError=${encodeURIComponent(emailError)}` : ""}`);
}

// ============================================
// UPDATE USER
// ============================================
export async function updateUser(userId, prevState, formData) {
  await dbConnect();

  const session = await auth();
  const currentUser = session?.user;

  // Extract form values to preserve on error
  const formValues = {
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    department: formData.get("department"),
    status: formData.get("status"),
    companyId: formData.get("companyId"),
  };

  if (!currentUser) {
    return { message: "You must be logged in", errors: { _form: ["You must be logged in"] }, values: formValues };
  }

  if (!ADMIN_ROLES.includes(currentUser.role)) {
    return { message: "Unauthorized", errors: { _form: ["Admin role required"] }, values: formValues };
  }

  const validatedFields = userUpdateSchema.safeParse(formValues);

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing or invalid fields",
      values: formValues,
    };
  }

  const { name, email, role, department, status, companyId } = validatedFields.data;

  try {
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return { message: "User not found", errors: { _form: ["User not found"] }, values: formValues };
    }

    // Non-SuperAdmin can only update users in their own company
    if (currentUser.role !== "SuperAdmin") {
      if (targetUser.companyId?.toString() !== currentUser.companyId) {
        return {
          message: "You can only update users in your own company",
          errors: { _form: ["Unauthorized"] },
          values: formValues,
        };
      }

      // Admin cannot promote to Admin or SuperAdmin
      if (role === "SuperAdmin" || role === "Admin") {
        return {
          message: "Only SuperAdmin can assign Admin or SuperAdmin roles",
          errors: { role: ["You cannot assign this role"] },
          values: formValues,
        };
      }

      // Admin cannot update Admin or SuperAdmin users
      if (targetUser.role === "Admin" || targetUser.role === "SuperAdmin") {
        return {
          message: "You cannot update Admin or SuperAdmin users",
          errors: { _form: ["Unauthorized"] },
          values: formValues,
        };
      }
    }

    // Check if email is taken by another user
    const existingUser = await User.findOne({
      email,
      _id: { $ne: userId },
    });

    if (existingUser) {
      return {
        message: "Email already in use by another user",
        errors: { email: ["Email already in use"] },
        values: formValues,
      };
    }

    // Determine company assignment
    let assignedCompanyId = companyId;

    // Only SuperAdmin can change company assignment
    if (currentUser.role !== "SuperAdmin") {
      assignedCompanyId = targetUser.companyId; // Keep existing company
    }

    // Validate company exists if provided
    if (assignedCompanyId) {
      const company = await Company.findById(assignedCompanyId);
      if (!company) {
        return {
          message: "Company not found",
          errors: { companyId: ["Selected company does not exist"] },
          values: formValues,
        };
      }
    }

    await User.findByIdAndUpdate(userId, {
      $set: {
        name,
        email,
        role,
        department,
        status,
        companyId: assignedCompanyId,
      },
    });

    revalidatePath("/dashboard/users");
    revalidatePath("/dashboard/admin/users");
  } catch (error) {
    console.error("Update user error:", error);
    return {
      message: error.message || "Failed to update user",
      errors: { _form: [error.message || "Failed to update user"] },
      values: formValues,
    };
  }

  redirect("/dashboard/users");
}

// ============================================
// RESET USER PASSWORD (Admin)
// ============================================
export async function resetUserPassword(userId, prevState, formData) {
  await dbConnect();

  const session = await auth();
  const currentUser = session?.user;

  if (!currentUser || !ADMIN_ROLES.includes(currentUser.role)) {
    return { message: "Unauthorized", errors: { _form: ["Admin role required"] } };
  }

  const rawFormData = {
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  };

  const validatedFields = passwordResetSchema.safeParse(rawFormData);

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Invalid password fields",
    };
  }

  try {
    const targetUser = await User.findById(userId).select("+password");

    if (!targetUser) {
      return { message: "User not found", errors: { _form: ["User not found"] } };
    }

    // Admin can only reset passwords for users in their company (not Admin/SuperAdmin)
    if (currentUser.role === "Admin") {
      if (targetUser.companyId?.toString() !== currentUser.companyId) {
        return { message: "You can only reset passwords for users in your company", errors: { _form: ["Unauthorized"] } };
      }

      if (targetUser.role === "SuperAdmin" || targetUser.role === "Admin") {
        return { message: "Cannot reset password of Admin or SuperAdmin users", errors: { _form: ["Unauthorized"] } };
      }
    }

    // Update password (will be hashed by pre-save hook)
    targetUser.password = validatedFields.data.newPassword;
    await targetUser.save();

    revalidatePath("/dashboard/users");
    revalidatePath("/dashboard/admin/users");
    return { message: "Password reset successfully", errors: {}, success: true };
  } catch (error) {
    console.error("Reset password error:", error);
    return { message: error.message || "Failed to reset password", errors: { _form: [error.message] } };
  }
}

// ============================================
// DELETE USER
// ============================================
export async function deleteUser(userId) {
  await dbConnect();

  const session = await auth();
  const currentUser = session?.user;

  if (!currentUser) {
    return { message: "You must be logged in", success: false };
  }

  // Only SuperAdmin and Admin can delete users
  if (!ADMIN_ROLES.includes(currentUser.role)) {
    return { message: "Unauthorized - Admin only", success: false };
  }

  // Don't allow deleting yourself
  if (currentUser.id === userId) {
    return { message: "Cannot delete your own account", success: false };
  }

  try {
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return { message: "User not found", success: false };
    }

    // Admin can only delete users in their own company
    if (currentUser.role === "Admin") {
      if (targetUser.companyId?.toString() !== currentUser.companyId) {
        return { message: "You can only delete users in your company", success: false };
      }

      // Admin cannot delete SuperAdmin or other Admin users
      if (targetUser.role === "SuperAdmin" || targetUser.role === "Admin") {
        return { message: "Cannot delete Admin or SuperAdmin users", success: false };
      }
    }

    await User.findByIdAndDelete(userId);

    revalidatePath("/dashboard/users");
    revalidatePath("/dashboard/admin/users");
    return { message: "User deleted successfully", success: true };
  } catch (error) {
    console.error("Delete user error:", error);
    return { message: error.message || "Failed to delete user", success: false };
  }
}

// ============================================
// TOGGLE USER STATUS
// ============================================
export async function toggleUserStatus(userId) {
  await dbConnect();

  const session = await auth();
  const currentUser = session?.user;

  if (!currentUser || !ADMIN_ROLES.includes(currentUser.role)) {
    return { message: "Unauthorized", success: false };
  }

  try {
    const targetUser = await User.findById(userId);

    if (!targetUser) {
      return { message: "User not found", success: false };
    }

    // Admin can only toggle status for users in their own company
    if (currentUser.role === "Admin") {
      if (targetUser.companyId?.toString() !== currentUser.companyId) {
        return { message: "You can only manage users in your company", success: false };
      }

      // Admin cannot toggle SuperAdmin or Admin status
      if (targetUser.role === "SuperAdmin" || targetUser.role === "Admin") {
        return { message: "Cannot change status of Admin or SuperAdmin users", success: false };
      }
    }

    const newStatus = targetUser.status === "Active" ? "Inactive" : "Active";

    await User.findByIdAndUpdate(userId, {
      $set: { status: newStatus },
    });

    revalidatePath("/dashboard/users");
    revalidatePath("/dashboard/admin/users");
    return {
      message: `User ${newStatus === "Active" ? "activated" : "deactivated"} successfully`,
      success: true,
    };
  } catch (error) {
    console.error("Toggle status error:", error);
    return { message: error.message || "Failed to update status", success: false };
  }
}

// ============================================
// SUPERADMIN: ASSIGN USER TO COMPANY
// ============================================
export async function assignUserToCompany(userId, companyId) {
  await dbConnect();

  const session = await auth();
  const currentUser = session?.user;

  if (!currentUser) {
    return { message: "You must be logged in", success: false };
  }

  if (!SUPER_ADMIN_ROLES.includes(currentUser.role)) {
    return { message: "Unauthorized - SuperAdmin only", success: false };
  }

  try {
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return { message: "User not found", success: false };
    }

    // Validate company if provided
    if (companyId) {
      const company = await Company.findById(companyId);
      if (!company) {
        return { message: "Company not found", success: false };
      }
    }

    await User.findByIdAndUpdate(userId, {
      $set: { companyId: companyId || null },
    });

    revalidatePath("/dashboard/admin/users");
    revalidatePath("/dashboard/users");
    return {
      message: companyId ? "User assigned to company successfully" : "User removed from company",
      success: true,
    };
  } catch (error) {
    console.error("Assign user to company error:", error);
    return { message: error.message || "Failed to assign user", success: false };
  }
}

// ============================================
// SUPERADMIN: BULK ASSIGN USERS TO COMPANY
// ============================================
export async function bulkAssignUsersToCompany(userIds, companyId) {
  await dbConnect();

  const session = await auth();
  const currentUser = session?.user;

  if (!currentUser) {
    return { message: "You must be logged in", success: false };
  }

  if (!SUPER_ADMIN_ROLES.includes(currentUser.role)) {
    return { message: "Unauthorized - SuperAdmin only", success: false };
  }

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return { message: "No users selected", success: false };
  }

  try {
    // Validate company if provided
    if (companyId) {
      const company = await Company.findById(companyId);
      if (!company) {
        return { message: "Company not found", success: false };
      }
    }

    await User.updateMany(
      { _id: { $in: userIds } },
      { $set: { companyId: companyId || null } }
    );

    revalidatePath("/dashboard/admin/users");
    revalidatePath("/dashboard/users");
    return {
      message: `${userIds.length} users updated successfully`,
      success: true,
    };
  } catch (error) {
    console.error("Bulk assign users error:", error);
    return { message: error.message || "Failed to assign users", success: false };
  }
}

// ============================================
// SUPERADMIN: GET USERS BY COMPANY
// ============================================
export async function getUsersByCompany(companyId) {
  await dbConnect();

  const session = await auth();
  const currentUser = session?.user;

  if (!currentUser) {
    return { users: [], error: "You must be logged in" };
  }

  try {
    let query = {};

    if (currentUser.role === "SuperAdmin") {
      // SuperAdmin can filter by company or get all
      if (companyId) {
        query.companyId = companyId;
      }
    } else if (currentUser.role === "Admin") {
      // Admin can only see users in their company
      query.companyId = currentUser.companyId;
    } else {
      return { users: [], error: "Unauthorized" };
    }

    const users = await User.find(query)
      .select("-password")
      .populate("companyId", "name")
      .sort({ createdAt: -1 })
      .lean();

    // Convert ObjectIds to strings for serialization
    const serializedUsers = users.map((user) => ({
      ...user,
      _id: user._id.toString(),
      companyId: user.companyId?._id?.toString() || null,
      companyName: user.companyId?.name || null,
    }));

    return { users: serializedUsers, error: null };
  } catch (error) {
    console.error("Get users by company error:", error);
    return { users: [], error: error.message };
  }
}

// ============================================
// SUPERADMIN: GET UNASSIGNED USERS
// ============================================
export async function getUnassignedUsers() {
  await dbConnect();

  const session = await auth();
  const currentUser = session?.user;

  if (!currentUser || !SUPER_ADMIN_ROLES.includes(currentUser.role)) {
    return { users: [], error: "Unauthorized - SuperAdmin only" };
  }

  try {
    const users = await User.find({ companyId: null })
      .select("-password")
      .sort({ createdAt: -1 })
      .lean();

    const serializedUsers = users.map((user) => ({
      ...user,
      _id: user._id.toString(),
    }));

    return { users: serializedUsers, error: null };
  } catch (error) {
    console.error("Get unassigned users error:", error);
    return { users: [], error: error.message };
  }
}
