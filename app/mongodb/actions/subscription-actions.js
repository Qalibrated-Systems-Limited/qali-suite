"use server";

import { revalidatePath } from "next/cache";
import dbConnect from "@/app/config/dbConnect";
import Company from "@/app/models/Company";
import SubscriptionAuditLog from "@/app/models/SubscriptionAuditLog";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { updateSubscription } from "@/lib/subscription-helpers";
import { PLAN_LIMITS } from "@/lib/plans";
import { invalidatePlanCache } from "@/lib/plans-server";

function requireSuperAdmin(user) {
  if (user.role !== "SuperAdmin") {
    throw new Error("Only SuperAdmin can manage subscriptions");
  }
}

export async function updateCompanyPlan(_prevState, formData) {
  try {
    await dbConnect();
    const { user } = await getTenantContext();
    requireSuperAdmin(user);

    const companyId = formData.get("companyId");
    const newPlan = formData.get("plan");
    const reason = formData.get("reason") || "";

    if (!companyId || !newPlan) {
      return { success: false, error: "Company and plan are required" };
    }

    const planConfig = PLAN_LIMITS[newPlan];
    if (!planConfig) {
      return { success: false, error: "Invalid plan" };
    }

    await updateSubscription(
      companyId,
      { plan: newPlan, maxUsers: planConfig.maxUsers, status: "active" },
      { name: user.name, id: user.id },
      reason
    );

    revalidatePath(`/dashboard/admin/companies/${companyId}`);
    invalidatePlanCache();
    return { success: true, message: `Plan updated to ${planConfig.label}` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updateCompanyStatus(_prevState, formData) {
  try {
    await dbConnect();
    const { user } = await getTenantContext();
    requireSuperAdmin(user);

    const companyId = formData.get("companyId");
    const newStatus = formData.get("status");
    const reason = formData.get("reason") || "";

    if (!["active", "trial", "expired", "cancelled"].includes(newStatus)) {
      return { success: false, error: "Invalid status" };
    }

    await updateSubscription(
      companyId,
      { status: newStatus },
      { name: user.name, id: user.id },
      reason
    );

    revalidatePath(`/dashboard/admin/companies/${companyId}`);
    invalidatePlanCache();
    return { success: true, message: `Status updated to ${newStatus}` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function extendTrial(_prevState, formData) {
  try {
    await dbConnect();
    const { user } = await getTenantContext();
    requireSuperAdmin(user);

    const companyId = formData.get("companyId");
    const days = parseInt(formData.get("days") || "14");
    const reason = formData.get("reason") || `Trial extended by ${days} days`;

    const newTrialEnd = new Date();
    newTrialEnd.setDate(newTrialEnd.getDate() + days);

    await updateSubscription(
      companyId,
      { status: "trial", trialEndsAt: newTrialEnd },
      { name: user.name, id: user.id },
      reason
    );

    revalidatePath(`/dashboard/admin/companies/${companyId}`);
    invalidatePlanCache();
    return { success: true, message: `Trial extended by ${days} days` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getSubscriptionAuditLog(companyId) {
  try {
    await dbConnect();
    const { user } = await getTenantContext();
    requireSuperAdmin(user);

    const logs = await SubscriptionAuditLog.find({ companyId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return JSON.parse(JSON.stringify(logs));
  } catch (error) {
    console.error("[getSubscriptionAuditLog]:", error.message);
    return [];
  }
}
