import dbConnect from "@/app/config/dbConnect";
import Company from "@/app/models/Company";
import SubscriptionAuditLog from "@/app/models/SubscriptionAuditLog";

/**
 * Update a company's subscription with full audit trail.
 * Single entry point for all subscription mutations.
 */
export async function updateSubscription(companyId, updates, changedBy, reason = "") {
  await dbConnect();

  const company = await Company.findById(companyId).select("subscription").lean();
  if (!company) throw new Error("Company not found");

  const previous = {
    plan: company.subscription?.plan,
    status: company.subscription?.status,
    maxUsers: company.subscription?.maxUsers,
    trialEndsAt: company.subscription?.trialEndsAt,
  };

  // Build the $set object for subscription fields only
  const setFields = {};
  if (updates.plan !== undefined) setFields["subscription.plan"] = updates.plan;
  if (updates.status !== undefined) setFields["subscription.status"] = updates.status;
  if (updates.maxUsers !== undefined) setFields["subscription.maxUsers"] = updates.maxUsers;
  if (updates.trialEndsAt !== undefined) setFields["subscription.trialEndsAt"] = updates.trialEndsAt;
  if (updates.currentPeriodStart !== undefined) setFields["subscription.currentPeriodStart"] = updates.currentPeriodStart;
  if (updates.currentPeriodEnd !== undefined) setFields["subscription.currentPeriodEnd"] = updates.currentPeriodEnd;

  const updated = await Company.findByIdAndUpdate(
    companyId,
    { $set: setFields },
    { new: true }
  ).select("subscription").lean();

  // Determine action type — log multiple changes separately
  const actions = [];
  if (updates.plan && updates.plan !== previous.plan) actions.push("plan_changed");
  if (updates.status && updates.status !== previous.status) actions.push("status_changed");
  if (updates.maxUsers !== undefined && updates.maxUsers !== previous.maxUsers) actions.push("max_users_changed");
  if (updates.trialEndsAt && String(updates.trialEndsAt) !== String(previous.trialEndsAt)) actions.push("trial_extended");
  const action = actions[0] || "plan_changed";

  await SubscriptionAuditLog.create({
    companyId,
    action,
    previous,
    updated: {
      plan: updated.subscription?.plan,
      status: updated.subscription?.status,
      maxUsers: updated.subscription?.maxUsers,
      trialEndsAt: updated.subscription?.trialEndsAt,
    },
    changedBy: { name: changedBy.name, id: changedBy.id },
    reason,
  });

  return updated;
}
