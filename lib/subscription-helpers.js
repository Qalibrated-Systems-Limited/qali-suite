import dbConnect from "@/app/config/dbConnect";
import SubscriptionAuditLog from "@/app/models/SubscriptionAuditLog";
import {
  getCompanySubscription,
  updateCompanySubscription,
} from "@/app/db/platform";
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

  // The subscription state lives in Postgres since 0035. The audit LOG is
  // still a Mongo collection, so this writes across both: the state where the
  // company record is, the history where its history already is. Moving
  // SubscriptionAuditLog is its own migration.
  const current = await getCompanySubscription(String(companyId));
  if (!current) throw new Error("Company not found");

  const planChanging =
    updates.plan !== undefined && updates.plan !== current.subscription.plan;
  if (planChanging && updates.maxUsers === undefined) {
    updates.maxUsers = getPlanLimits(updates.plan).maxUsers;
  }

  const mentioned = [
    "plan",
    "status",
    "maxUsers",
    "trialEndsAt",
    "currentPeriodStart",
    "currentPeriodEnd",
  ].filter((k) => updates[k] !== undefined);

  if (mentioned.length === 0) {
    // Nothing to update; return current.
    return current;
  }

  // ONE STATEMENT, so the "previous" snapshot is the state that was actually
  // replaced. The Mongo version peeked, wrote, then read back — three round
  // trips, with the before-snapshot taken from a different read than the write,
  // so two admins changing a plan at once could each log the other's state as
  // their own "before".
  const { previous, updated } = await updateCompanySubscription(
    String(companyId),
    updates,
  );

  const updatedSnapshot = { ...updated.subscription };

  // Determine which actions actually happened. Multi-row logging: one row per
  // change. Caller-supplied options.action wins and is logged as a single row.
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

  // If nothing semantically changed (e.g. setting plan to same value), still
  // log one row.
  if (auditRows.length === 0) auditRows.push("plan_changed");

  /**
   * MIRROR BACK TO MONGO — temporary, and only for the SuperAdmin dashboard.
   *
   * Postgres is the source: the plan gate, the seat check, the session and
   * every tenant read come from there. But the platform metrics in
   * company-queries.js still aggregate `subscription.*` off the Mongo
   * document, joined to Mongo users and invoices, so without this a plan
   * change would show correctly everywhere except the one screen that counts
   * plans. Delete this write when those aggregations move.
   */
  try {
    const Company = (await import("@/app/models/Company")).default;
    await Company.findByIdAndUpdate(companyId, {
      $set: Object.fromEntries(
        mentioned.map((k) => [`subscription.${k}`, updates[k]]),
      ),
    });
  } catch (err) {
    // The authoritative write already committed. A failed mirror makes one
    // dashboard stale, which is not worth failing a plan change over.
    console.error("Subscription mirror to Mongo failed:", err);
  }

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

  const company = await getCompanySubscription(String(companyId));
  if (!company) return { expired: false, status: null };

  const sub = company.subscription;
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
