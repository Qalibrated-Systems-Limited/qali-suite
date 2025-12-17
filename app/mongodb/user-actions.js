"use server";

import { auth } from "@/auth";
import User from "../models/user";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import dbConnect from "../config/dbConnect";
import { userRoles } from "@/lib/utils";
dbConnect();

// ============================================
// VALIDATION SCHEMAS
// ============================================
const userCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(userRoles),
  department: z.string().min(1, "Department is required"),
});

const userUpdateSchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  email: z.string().email("Invalid email address"),
  role: z.enum(userRoles),
  department: z.string().min(1, "Department is required"),
  status: z.enum(["Active", "Inactive"]),
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
  try {
    const session = await auth();
    const user = session?.user;

    if (!user || (user.role !== "Admin" && user.role !== "Store Manager")) {
      return { message: "Unauthorized", errors: {} };
    }

    const rawFormData = {
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password"),
      role: formData.get("role"),
      department: formData.get("department"),
    };

    const validatedFields = userCreateSchema.safeParse(rawFormData);

    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
        message: "Missing or invalid fields",
      };
    }

    const { name, email, password, role, department } = validatedFields.data;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return {
        message: "User with this email already exists",
        errors: { email: ["Email already in use"] },
      };
    }

    // Create user
    await User.create({
      name,
      email,
      password,
      role,
      department,
      creator: {
        name: user.name,
        id: user.id,
      },
    });

    revalidatePath("/dashboard/users");
    return { message: "User created successfully", errors: {} };
  } catch (error) {
    console.error("Create user error:", error);
    return {
      message: "Database Error: Failed to create user",
      errors: {},
    };
  }
}

// ============================================
// UPDATE USER
// ============================================
export async function updateUser(userId, prevState, formData) {
  try {
    const session = await auth();
    const user = session?.user;

    if (!user || (user.role !== "Admin" && user.role !== "Store Manager")) {
      return { message: "Unauthorized", errors: {} };
    }

    const rawFormData = {
      name: formData.get("name"),
      email: formData.get("email"),
      role: formData.get("role"),
      department: formData.get("department"),
      status: formData.get("status"),
    };

    const validatedFields = userUpdateSchema.safeParse(rawFormData);

    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
        message: "Missing or invalid fields",
      };
    }

    const { name, email, role, department, status } = validatedFields.data;

    // Check if email is taken by another user
    const existingUser = await User.findOne({
      email,
      _id: { $ne: userId },
    });

    if (existingUser) {
      return {
        message: "Email already in use by another user",
        errors: { email: ["Email already in use"] },
      };
    }

    await User.findByIdAndUpdate(userId, {
      $set: {
        name,
        email,
        role,
        department,
        status,
      },
    });

   
  } catch (error) {
    console.error("Update user error:", error);
    return {
      message: "Database Error: Failed to update user",
      errors: {},
    };
  }
   revalidatePath("/dashboard/users");
    redirect("/dashboard/users");
}

// ============================================
// RESET USER PASSWORD (Admin)
// ============================================
export async function resetUserPassword(userId, prevState, formData) {
  try {
    const session = await auth();
    const user = session?.user;

    if (!user || (user.role !== "Admin" && user.role !== "Store Manager")) {
      return { message: "Unauthorized", errors: {} };
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

    const targetUser = await User.findById(userId).select("+password");

    if (!targetUser) {
      return {
        message: "User not found",
        errors: {},
      };
    }

    // Update password (will be hashed by pre-save hook)
    targetUser.password = validatedFields.data.newPassword;
    await targetUser.save();

    revalidatePath("/dashboard/users");
    return {
      message: "Password reset successfully",
      errors: {},
      success: true,
    };
  } catch (error) {
    console.error("Reset password error:", error);
    return {
      message: "Database Error: Failed to reset password",
      errors: {},
    };
  }
}

// ============================================
// DELETE USER
// ============================================
export async function deleteUser(userId) {
  try {
    const session = await auth();
    const user = session?.user;

    if (!user || user.role !== "Admin") {
      return { message: "Unauthorized - Admin only", success: false };
    }

    // Don't allow deleting yourself
    if (user.id === userId) {
      return { message: "Cannot delete your own account", success: false };
    }

    await User.findByIdAndDelete(userId);

    revalidatePath("/dashboard/users");
    return { message: "User deleted successfully", success: true };
  } catch (error) {
    console.error("Delete user error:", error);
    return {
      message: "Database Error: Failed to delete user",
      success: false,
    };
  }
}

// ============================================
// TOGGLE USER STATUS
// ============================================
export async function toggleUserStatus(userId) {
  try {
    const session = await auth();
    const user = session?.user;

    if (!user || (user.role !== "Admin" && user.role !== "Store Manager")) {
      return { message: "Unauthorized", success: false };
    }

    const targetUser = await User.findById(userId);

    if (!targetUser) {
      return { message: "User not found", success: false };
    }

    const newStatus = targetUser.status === "Active" ? "Inactive" : "Active";

    await User.findByIdAndUpdate(userId, {
      $set: { status: newStatus },
    });

    revalidatePath("/dashboard/users");
    return {
      message: `User ${
        newStatus === "Active" ? "activated" : "deactivated"
      } successfully`,
      success: true,
    };
  } catch (error) {
    console.error("Toggle status error:", error);
    return {
      message: "Database Error: Failed to update status",
      success: false,
    };
  }
}
