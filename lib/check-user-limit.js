import dbConnect from "@/app/config/dbConnect";
import User from "@/app/models/user";
import Company from "@/app/models/Company";
import { getPlanLimits } from "@/lib/plans";

/**
 * Check whether a company can add another user.
 *
 * Effective seat limit logic:
 *   - If subscription is `expired` or `cancelled`, ignore the company's
 *     stored maxUsers and clamp to the FREE plan's limit. Otherwise an
 *     expired company keeps its paid-tier seats indefinitely.
 *   - Trial / active uses the stored maxUsers (synced to plan).
 *   - -1 is unlimited (enterprise).
 *
 * @param {string} companyId
 * @param {object} [options]
 * @param {boolean} [options.bypass] - skip enforcement (e.g. SuperAdmin acting on behalf of a tenant)
 */
export async function checkUserLimit(companyId, options = {}) {
  if (options.bypass) return { allowed: true, bypassed: true };
  if (!companyId) return { allowed: true };
  await dbConnect();

  const [company, activeUserCount] = await Promise.all([
    Company.findById(companyId)
      .select(
        "subscription.maxUsers subscription.plan subscription.status subscription.currentPeriodEnd subscription.trialEndsAt",
      )
      .lean(),
    User.countDocuments({ companyId, status: { $ne: "Inactive" } }),
  ]);

  if (!company) return { allowed: false, error: "Company not found" };

  return evaluateUserLimit({ company, activeUserCount });
}

// Pure evaluator — exposed so callers that already have `company` and
// `activeUserCount` can avoid an extra round-trip (e.g. invite flow runs
// these reads alongside other I/O and reuses the same Company doc).
export function evaluateUserLimit({ company, activeUserCount }) {
  const sub = company?.subscription || {};
  let maxUsers = sub.maxUsers ?? 2;

  // Effective expiry — covers (a) explicit expired/cancelled status and
  // (b) silent expiry (active with past currentPeriodEnd, trial with past
  // trialEndsAt). Either way, we clamp to free plan limits at runtime so
  // a company can't keep adding users on a non-paying tier.
  const now = new Date();
  const explicitlyExpired =
    sub.status === "expired" || sub.status === "cancelled";
  const periodExpired =
    sub.status === "active" &&
    sub.currentPeriodEnd &&
    new Date(sub.currentPeriodEnd) < now;
  const trialExpired =
    sub.status === "trial" &&
    sub.trialEndsAt &&
    new Date(sub.trialEndsAt) < now;

  if (explicitlyExpired || periodExpired || trialExpired) {
    maxUsers = getPlanLimits("free").maxUsers; // 2
  }

  if (maxUsers === -1) return { allowed: true }; // unlimited (enterprise)

  if (activeUserCount >= maxUsers) {
    return {
      allowed: false,
      error:
        explicitlyExpired || periodExpired || trialExpired
          ? `Subscription expired. User limit clamped to ${maxUsers} (free plan). Renew to restore your ${sub.plan} plan seats.`
          : `User limit reached (${activeUserCount}/${maxUsers}). Upgrade your plan to add more users.`,
      currentCount: activeUserCount,
      maxUsers,
      subscriptionStatus: sub.status,
    };
  }
  return {
    allowed: true,
    currentCount: activeUserCount,
    maxUsers,
    subscriptionStatus: sub.status,
  };
}
