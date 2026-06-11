"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import mongoose from "mongoose";

import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, getCompanyIdForCreate } from "@/lib/utils/tenant-utils";
import { safeErrorMessage } from "@/lib/safe-error";
import { canSeeSalesNav } from "@/lib/permissions";
import { ACTIVITY_TYPES, ACTIVITY_TARGETS } from "@/app/models/activity";
import { recordActivity } from "@/lib/crm/activity-log";

function userInfo(user) {
  return {
    id: user?.id || user?._id?.toString?.() || "system",
    name: user?.name || user?.email || "System",
    role: user?.role,
  };
}

// Server actions are directly invokable endpoints — page-level gating is
// not enough. Same role set the sidebar/pages use (canSeeSalesNav).
function salesRoleGate(user) {
  if (!canSeeSalesNav(user?.role)) {
    return { success: false, error: "Not authorized for CRM actions." };
  }
  return null;
}

const LogActivitySchema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  relatedKind: z.enum(ACTIVITY_TARGETS),
  relatedId: z.string().min(1, "Related record is required"),
  subject: z.string().max(200).optional().default(""),
  body: z.string().max(5000).optional().default(""),
  direction: z.enum(["inbound", "outbound", "none"]).optional().default("none"),
  occurredAt: z.coerce.date().optional(),
});

// Log an interaction (call/email/meeting/note) against a CRM entity.
export async function logActivity(prevState, formData) {
  try {
    await dbConnect();
    const { companyId, isSuperAdmin, user } = await getTenantContext();
    const denied = salesRoleGate(user);
    if (denied) return denied;

    const parsed = LogActivitySchema.safeParse(
      Object.fromEntries(formData?.entries?.() ?? []),
    );
    if (!parsed.success) {
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: parsed.error.flatten().fieldErrors,
      };
    }
    const d = parsed.data;
    if (!mongoose.Types.ObjectId.isValid(d.relatedId)) {
      return { success: false, error: "Invalid related record id" };
    }

    const tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);

    await recordActivity({
      companyId: tenantCompanyId,
      type: d.type,
      relatedTo: { kind: d.relatedKind, id: d.relatedId },
      subject: d.subject,
      body: d.body,
      direction: d.direction,
      occurredAt: d.occurredAt || new Date(),
      by: userInfo(user),
    });

    // Refresh whichever detail page this entity is shown on.
    const pathByKind = {
      Lead: `/dashboard/leads/${d.relatedId}`,
      Opportunity: `/dashboard/opportunities/${d.relatedId}`,
      Party: `/dashboard/customers/${d.relatedId}`,
    };
    if (pathByKind[d.relatedKind]) revalidatePath(pathByKind[d.relatedKind]);

    return { success: true };
  } catch (error) {
    console.error("logActivity error:", error);
    return { success: false, error: safeErrorMessage(error, "Failed to log activity") };
  }
}
