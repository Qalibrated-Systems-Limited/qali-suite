"use server";

import { auth } from "@/auth";
import dbConnect from "@/app/config/dbConnect";
import User from "@/app/models/user";
import Party from "@/app/models/parties";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";

/**
 * Update current user's profile
 */
export async function updateProfile(data) {
  try {
    await dbConnect();

    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    const { name, department } = data;

    if (!name || name.trim().length === 0) {
      return { success: false, error: "Name is required" };
    }

    if (name.length > 50) {
      return { success: false, error: "Name cannot exceed 50 characters" };
    }

    const updateData = {
      name: name.trim(),
    };

    if (department !== undefined) {
      updateData.department = department.trim() || null;
    }

    await User.findByIdAndUpdate(session.user.id, updateData);

    // Keep Party (financial identity) name in sync when user changes their display name
    if (name) {
      await Party.findOneAndUpdate(
        { userId: session.user.id, type: "employee" },
        { name: name.trim() }
      );
    }

    revalidatePath("/dashboard/profile");

    return { success: true };
  } catch (error) {
    console.error("Update profile error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Change or set current user's password.
 * - If user has a password: currentPassword is required for verification.
 * - If user has no password (first-time setup): currentPassword is skipped.
 */
export async function changePassword(data) {
  try {
    await dbConnect();

    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    const { currentPassword, newPassword } = data;

    if (!newPassword) {
      return { success: false, error: "New password is required" };
    }

    if (newPassword.length < 6) {
      return { success: false, error: "Password must be at least 6 characters" };
    }

    // Get user with password field
    const user = await User.findById(session.user.id).select("+password");

    if (!user) {
      return { success: false, error: "User not found" };
    }

    // Google-only users should not set a credentials password
    if (user.authProvider === "google") {
      return { success: false, error: "Google users cannot set a password" };
    }

    // If user already has a password, verify current password
    if (user.password) {
      if (!currentPassword) {
        return { success: false, error: "Current password is required" };
      }

      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return { success: false, error: "Current password is incorrect" };
      }
    }

    // Update password via save() so the pre-save hook hashes it
    user.password = newPassword;
    await user.save();

    return { success: true };
  } catch (error) {
    console.error("Change password error:", error);
    return { success: false, error: error.message };
  }
}
