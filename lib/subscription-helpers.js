import dbConnect from "@/app/config/dbConnect";
import Company from "@/app/models/Company";
import SubscriptionAuditLog from "@/app/models/SubscriptionAuditLog";
import { getPlanLimits } from "@/lib/plans";

/**
 * Update a company's subscription with full audit trail.
 * Single entry point for all subscription mutations.
 *
 * @param {string} companyId
 * @param {object} updates - any of: plan, status, maxUsers, trialEndsAt, currentPeriodStart, currentPeriodEnd
 * @param {{name: string, id: string}} changedBy
 * @param {string} [reason]
 * @param {{action?: string}} [options] - override the audit action label (e.g. "renewed")
 */
export async function updateSubscription(companyId, updates, changedBy, reason = "", options = {}) {
  await dbConnect();

  if (!changedBy?.id) {
    throw new Error("changedBy is required for subscription updates");
  }

  // Peek at current plan to decide whether maxUsers should auto-sync.
  // We do not rely on this read for the audit "previous" snapshot — that comes
  // atomically from findOneAndUpdate below.
  const peek = await Company.findById(companyId).select("subscription.plan").lean();
  if (!peek) throw new Error("Company not found");

  const planChanging =
    updates.plan !== undefined && updates.plan !== peek.subscription?.plan;
  if (planChanging && updates.maxUsers === undefined) {
    updates.maxUsers = getPlanLimits(updates.plan).maxUsers;
  }

  // Build the $set object
  const setFields = {};
  if (updates.plan !== undefined) setFields["subscription.plan"] = updates.plan;
  if (updates.status !== undefined) setFields["subscription.status"] = updates.status;
  if (updates.maxUsers !== undefined) setFields["subscription.maxUsers"] = updates.maxUsers;
  if (updates.trialEndsAt !== undefined) setFields["subscription.trialEndsAt"] = updates.trialEndsAt;
  if (updates.currentPeriodStart !== undefined) setFields["subscription.currentPeriodStart"] = updates.currentPeriodStart;
  if (updates.currentPeriodEnd !== undefined) setFields["subscription.currentPeriodEnd"] = updates.currentPeriodEnd;

  if (Object.keys(setFields).length === 0) {
    // Nothing to update; return current
    const current = await Company.findById(companyId).select("subscription").lean();
    return current;
  }

  // Atomic: returns the document state BEFORE the update (previous snapshot)
  const before = await Company.findByIdAndUpdate(
    companyId,
    { $set: setFields },
    { new: false }
  ).select("subscription").lean();
  if (!before) throw new Error("Company not found");

  const previous = {
    plan: before.subscription?.plan,
    status: before.subscription?.status,
    maxUsers: before.subscription?.maxUsers,
    trialEndsAt: before.subscription?.trialEndsAt,
    currentPeriodStart: before.subscription?.currentPeriodStart,
    currentPeriodEnd: before.subscription?.currentPeriodEnd,
  };

  // Read updated state (after the atomic write)
  const updated = await Company.findById(companyId).select("subscription").lean();
  const updatedSnapshot = {
    plan: updated.subscription?.plan,
    status: updated.subscription?.status,
    maxUsers: updated.subscription?.maxUsers,
    trialEndsAt: updated.subscription?.trialEndsAt,
    currentPeriodStart: updated.subscription?.currentPeriodStart,
    currentPeriodEnd: updated.subscription?.currentPeriodEnd,
  };

  // Determine which actions actually happened. Multi-row logging: one row per change.
  // Caller-supplied options.action wins and is logged as a single row.
  const auditRows = [];
  if (options.action) {
    auditRows.push(options.action);
  } else {
    if (updates.plan !== undefined && updates.plan !== previous.plan) {
      auditRows.push("plan_changed");
    }
    if (updates.status !== undefined && updates.status !== previous.status) {
      auditRows.push("status_changed");
    }
    if (updates.maxUsers !== undefined && updates.maxUsers !== previous.maxUsers) {
      auditRows.push("max_users_changed");
    }
    if (
      updates.trialEndsAt !== undefined &&
      String(updates.trialEndsAt) !== String(previous.trialEndsAt)
    ) {
      auditRows.push("trial_extended");
    }
  }

  // If nothing semantically changed (e.g. setting plan to same value), still log one row
  if (auditRows.length === 0) auditRows.push("plan_changed");

  await SubscriptionAuditLog.insertMany(
    auditRows.map((action) => ({
      companyId,
      action,
      previous,
      updated: updatedSnapshot,
      changedBy: { name: changedBy.name, id: changedBy.id },
      reason,
    }))
  );

  return updated;
}

/**
 * Lazy expiry: flip stale trial/active subscriptions to "expired" when the
 * relevant date has passed. Safe to call on every read; only writes when needed.
 *
 * @param {string} companyId
 * @returns {Promise<{expired: boolean, status: string}>}
 */
export async function checkAndExpireSubscription(companyId) {
  await dbConnect();

  const company = await Company.findById(companyId).select("subscription").lean();
  if (!company) return { expired: false, status: null };

  const sub = company.subscription || {};
  const now = new Date();
  let shouldExpire = false;
  let reason = "";

  if (sub.status === "trial" && sub.trialEndsAt && new Date(sub.trialEndsAt) < now) {
    shouldExpire = true;
    reason = "Trial period ended";
  } else if (
    sub.status === "active" &&
    sub.currentPeriodEnd &&
    new Date(sub.currentPeriodEnd) < now
  ) {
    shouldExpire = true;
    reason = "Billing period ended";
  }

  if (!shouldExpire) {
    return { expired: false, status: sub.status };
  }

  await updateSubscription(
    companyId,
    { status: "expired" },
    { name: "system", id: "system" },
    reason,
    { action: "auto_expired" }
  );

  return { expired: true, status: "expired" };
}
