import "server-only";
import { cache } from "react";
import mongoose from "mongoose";

import dbConnect from "@/app/config/dbConnect";
import { getTenantContextSafe } from "@/lib/utils/tenant-utils";
import Notification from "@/app/models/notification";

// ============================================
// NOTIFICATION QUERIES (the bell)
// ============================================
// Both run on every dashboard render via the layout — keep them on the
// (companyId, userId, readAt, createdAt) index, lean, projected, capped.
// Uses getTenantContextSafe: layout must render even mid-logout.

export const cMyNotifications = cache(async (limit = 12) => {
  try {
    const ctx = await getTenantContextSafe();
    const userId = ctx?.user?.id;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return { items: [], unread: 0 };
    }
    await dbConnect();

    const base = {
      userId: new mongoose.Types.ObjectId(userId),
      ...(ctx.isSuperAdmin || !ctx.companyId
        ? {}
        : { companyId: new mongoose.Types.ObjectId(ctx.companyId) }),
    };

    const [items, unread] = await Promise.all([
      Notification.find(base)
        .select("type title body href readAt createdAt")
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      Notification.countDocuments({ ...base, readAt: null }),
    ]);

    return {
      items: items.map((n) => ({
        _id: n._id.toString(),
        type: n.type,
        title: n.title,
        body: n.body || "",
        href: n.href || "",
        read: !!n.readAt,
        createdAt: n.createdAt?.toISOString?.() ?? null,
      })),
      unread,
    };
  } catch (error) {
    console.error("cMyNotifications error:", error);
    return { items: [], unread: 0 };
  }
});
