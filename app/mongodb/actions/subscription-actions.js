"use server";

import { revalidatePath } from "next/cache";
import dbConnect from "@/app/config/dbConnect";
import Company from "@/app/models/Company";
import User from "@/app/models/user";
import SubscriptionAuditLog from "@/app/models/SubscriptionAuditLog";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { updateSubscription } from "@/lib/subscription-helpers";
import { PLAN_LIMITS } from "@/lib/plans";
import { invalidatePlanCache } from "@/lib/plans-server";
import { addMonths } from "@/lib/dates";

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
    const force = formData.get("force") === "true";
    // When upgrading from trial / free → paid tier, also activate and
    // start the billing period. Default 1 month; pass `months=...` to
    // override. Set `activate=false` to suppress and just change plan
    // (e.g., for back-office plan adjustments without billing).
    const months = parseInt(formData.get("months") || "1", 10);
    const activate = formData.get("activate") !== "false";

    if (!companyId || !newPlan) {
      return { success: false, error: "Company and plan are required" };
    }

    const planConfig = PLAN_LIMITS[newPlan];
    if (!planConfig) {
      return { success: false, error: "Invalid plan" };
    }

    // Read current state once to drive the "should we activate?" decision.
    const company = await Company.findById(companyId)
      .select("subscription")
      .lean();
    if (!company) return { success: false, error: "Company not found" };
    const currentPlan = company.subscription?.plan;
    const currentStatus = company.subscription?.status;

    // Seat-count check on downgrade
    if (planConfig.maxUsers !== -1) {
      const activeUsers = await User.countDocuments({
        companyId,
        status: { $ne: "Inactive" },
      });
      if (activeUsers > planConfig.maxUsers && !force) {
        return {
          success: false,
          error: `Cannot downgrade: company has ${activeUsers} active users but ${planConfig.label} allows only ${planConfig.maxUsers}. Deactivate users first or pass force=true.`,
          requiresForce: true,
          activeUsers,
          maxUsers: planConfig.maxUsers,
        };
      }
    }

    // Build update payload. Always set plan + maxUsers. Add status +
    // period dates when this is an upgrade-to-paid that should activate.
    const updates = {
      plan: newPlan,
      maxUsers: planConfig.maxUsers,
    };

    const isUpgradeToPaid = newPlan !== "free" && currentPlan !== newPlan;
    const wasNotPaying =
      currentStatus === "trial" ||
      currentStatus === "expired" ||
      currentStatus === "cancelled" ||
      currentPlan === "free";

    if (activate && isUpgradeToPaid && wasNotPaying) {
      const start = new Date();
      const end = addMonths(start, months || 1);
      updates.status = "active";
      updates.currentPeriodStart = start;
      updates.currentPeriodEnd = end;
    }

    // Special case: switching to free plan should clear period dates and
    // mark active (free is permanent, no expiry).
    if (newPlan === "free") {
      updates.status = "active";
      updates.currentPeriodStart = null;
      updates.currentPeriodEnd = null;
      updates.trialEndsAt = null;
    }

    await updateSubscription(
      companyId,
      updates,
      { name: user.name, id: user.id },
      reason,
    );

    revalidatePath(`/dashboard/admin/companies/${companyId}`);
    invalidatePlanCache();
    return {
      success: true,
      message:
        updates.currentPeriodEnd
          ? `Plan updated to ${planConfig.label} and activated until ${updates.currentPeriodEnd.toLocaleDateString()}`
          : `Plan updated to ${planConfig.label}`,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Renew subscription — set period dates and (re)activate.
 * Chains renewals: if currentPeriodEnd is in the future, extend from there;
 * otherwise start from now.
 */
export async function renewSubscription(_prevState, formData) {
  try {
    await dbConnect();
    const { user } = await getTenantContext();
    requireSuperAdmin(user);

    const companyId = formData.get("companyId");
    const months = parseInt(formData.get("months") || "1", 10);
    const reason = formData.get("reason") || `Renewed for ${months} month(s)`;

    if (!companyId) return { success: false, error: "Company is required" };
    if (!months || months < 1 || months > 60) {
      return { success: false, error: "Months must be between 1 and 60" };
    }

    const company = await Company.findById(companyId).select("subscription").lean();
    if (!company) return { success: false, error: "Company not found" };

    const now = new Date();
    const currentEnd = company.subscription?.currentPeriodEnd
      ? new Date(company.subscription.currentPeriodEnd)
      : null;

    // Chain from currentPeriodEnd if still in the future, else from now.
    // Use addMonths() (not setMonth) to clamp Jan 31 + 1 month → Feb 28
    // instead of overflowing to Mar 3.
    const start = currentEnd && currentEnd > now ? currentEnd : now;
    const end = addMonths(start, months);

    await updateSubscription(
      companyId,
      {
        status: "active",
        currentPeriodStart: start,
        currentPeriodEnd: end,
      },
      { name: user.name, id: user.id },
      reason,
      { action: "renewed" }
    );

    revalidatePath(`/dashboard/admin/companies/${companyId}`);
    invalidatePlanCache();
    return {
      success: true,
      message: `Renewed until ${end.toLocaleDateString()}`,
    };
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
    const days = parseInt(formData.get("days") || "14", 10);
    const reason = formData.get("reason") || `Trial extended by ${days} days`;

    if (!days || days < 1 || days > 365) {
      return { success: false, error: "Days must be between 1 and 365" };
    }

    const company = await Company.findById(companyId).select("subscription.status").lean();
    if (!company) return { success: false, error: "Company not found" };

    // Refuse to demote active/cancelled paying customers back to trial
    const currentStatus = company.subscription?.status;
    if (currentStatus === "active" || currentStatus === "cancelled") {
      return {
        success: false,
        error: `Cannot extend trial: company is currently ${currentStatus}. Use Renew Subscription instead.`,
      };
    }

    const newTrialEnd = new Date();
    newTrialEnd.setDate(newTrialEnd.getDate() + days);

    await updateSubscription(
      companyId,
      { status: "trial", trialEndsAt: newTrialEnd },
      { name: user.name, id: user.id },
      reason,
      { action: "trial_extended" }
    );

    revalidatePath(`/dashboard/admin/companies/${companyId}`);
    invalidatePlanCache();
    return { success: true, message: `Trial extended by ${days} days` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Cancel an active or trial subscription. Status becomes "cancelled".
 * Period dates are preserved (the company retains access until
 * currentPeriodEnd if they were paying — industry standard "cancel at
 * period end"). The proxy + checkUserLimit then both treat them as
 * expired once the period actually lapses.
 */
export async function cancelSubscription(_prevState, formData) {
  try {
    await dbConnect();
    const { user } = await getTenantContext();
    requireSuperAdmin(user);

    const companyId = formData.get("companyId");
    const reason = formData.get("reason") || "Subscription cancelled";
    const immediate = formData.get("immediate") === "true";

    if (!companyId) return { success: false, error: "Company is required" };

    const updates = { status: "cancelled" };
    if (immediate) {
      // Cancel-now mode: also clear the period so checkUserLimit clamps
      // to free plan immediately rather than waiting for the period to lapse.
      updates.currentPeriodEnd = new Date();
    }

    await updateSubscription(
      companyId,
      updates,
      { name: user.name, id: user.id },
      reason,
      { action: "cancelled" },
    );

    revalidatePath(`/dashboard/admin/companies/${companyId}`);
    invalidatePlanCache();
    return {
      success: true,
      message: immediate
        ? "Subscription cancelled (effective immediately)"
        : "Subscription cancelled (effective at period end)",
    };
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
