"use server";

import { revalidatePath } from "next/cache";
import mongoose from "mongoose";

import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { safeErrorMessage } from "@/lib/safe-error";
import Notification from "@/app/models/notification";

// Mark-read mutations are scoped to the CALLER (userId from session) —
// you can only touch your own notifications, whatever else you may be.

export async function markAllNotificationsRead() {
  try {
    await dbConnect();
    const { user } = await getTenantContext();
    if (!user?.id || !mongoose.Types.ObjectId.isValid(user.id)) {
      return { success: false, error: "No user" };
    }

    await Notification.updateMany(
      { userId: new mongoose.Types.ObjectId(user.id), readAt: null },
      { $set: { readAt: new Date() } },
    );

    revalidatePath("/dashboard", "layout");
    return { success: true };
  } catch (error) {
    console.error("markAllNotificationsRead error:", error);
    return { success: false, error: safeErrorMessage(error, "Failed to mark read") };
  }
}

export async function markNotificationRead(notificationId) {
  try {
    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      return { success: false, error: "Invalid id" };
    }
    await dbConnect();
    const { user } = await getTenantContext();
    if (!user?.id || !mongoose.Types.ObjectId.isValid(user.id)) {
      return { success: false, error: "No user" };
    }

    await Notification.updateOne(
      {
        _id: notificationId,
        userId: new mongoose.Types.ObjectId(user.id), // ownership guard
        readAt: null,
      },
      { $set: { readAt: new Date() } },
    );

    revalidatePath("/dashboard", "layout");
    return { success: true };
  } catch (error) {
    console.error("markNotificationRead error:", error);
    return { success: false, error: safeErrorMessage(error, "Failed to mark read") };
  }
}
