import { auth } from "@/auth";
import { planIncludes, getRequiredPlan } from "@/lib/plans";

/**
 * Checks whether the current subscription is usable (active or valid trial).
 * Returns { usable: boolean, reason?: string }.
 */
export function isSubscriptionUsable(session) {
  const status = session?.user?.subscriptionStatus || "active";
  const trialEndsAt = session?.user?.trialEndsAt;

  if (status === "active") {
    return { usable: true };
  }

  if (status === "trial") {
    if (trialEndsAt && new Date(trialEndsAt) < new Date()) {
      return { usable: false, reason: "trial_expired" };
    }
    return { usable: true };
  }

  if (status === "cancelled") {
    return { usable: false, reason: "subscription_cancelled" };
  }

  // "expired" or any other non-active status
  return { usable: false, reason: "subscription_expired" };
}

/**
 * Server-side plan gate for pages and server actions.
 *
 * Usage in a page:
 *   const gate = await checkPlanAccess("hr");
 *   if (!gate.allowed) return <UpgradePrompt {...gate} />;
 *
 * Usage in a server action:
 *   const gate = await checkPlanAccess("hr");
 *   if (!gate.allowed) return { error: `Upgrade to ${gate.requiredPlan} to use this feature` };
 */
export async function checkPlanAccess(moduleId) {
  const session = await auth();
  if (!session?.user) {
    return { allowed: false, currentPlan: "free", requiredPlan: "starter", feature: moduleId };
  }

  const role = session.user.role;

  // Warm plan config cache from DB (no-op if already warm)
  try {
    const { warmPlanCache } = await import("@/lib/plans-server");
    await warmPlanCache();
  } catch {
    // Falls back to DEFAULT_PLANS
  }

  // Server-side: fetch fresh plan from DB (not edge, so MongoDB works).
  // This Company query runs on every call (not cached) intentionally — one query
  // per page load is acceptable and ensures we always have fresh subscription data.
  let plan = session.user.companyPlan || "free";
  let freshStatus = session.user.subscriptionStatus;
  let freshTrialEndsAt = session.user.trialEndsAt;
  if (session.user.companyId && role !== "SuperAdmin") {
    try {
      const dbConnect = (await import("@/app/config/dbConnect")).default;
      const Company = (await import("@/app/models/Company")).default;
      await dbConnect();
      const company = await Company.findById(session.user.companyId)
        .select("subscription.plan subscription.status subscription.trialEndsAt subscription.maxUsers subscription.currentPeriodEnd")
        .lean();
      if (company?.subscription) {
        plan = company.subscription.plan || "free";
        freshStatus = company.subscription.status || "trial";
        freshTrialEndsAt = company.subscription.trialEndsAt?.toISOString() || null;

        // Lazy expiry: if trial/active is past its date, persist the flip
        const now = new Date();
        const trialOver =
          freshStatus === "trial" &&
          company.subscription.trialEndsAt &&
          new Date(company.subscription.trialEndsAt) < now;
        const periodOver =
          freshStatus === "active" &&
          company.subscription.currentPeriodEnd &&
          new Date(company.subscription.currentPeriodEnd) < now;

        if (trialOver || periodOver) {
          try {
            const { checkAndExpireSubscription } = await import("@/lib/subscription-helpers");
            const result = await checkAndExpireSubscription(session.user.companyId);
            if (result.expired) freshStatus = "expired";
          } catch {
            // If expiry write fails, fall through with stale status (gate still blocks via date check)
            if (trialOver || periodOver) freshStatus = "expired";
          }
        }
      }
    } catch {
      // Fall back to session data if DB is unreachable
    }
  }

  // SuperAdmin bypasses all plan restrictions
  if (role === "SuperAdmin") {
    return { allowed: true, currentPlan: "enterprise", requiredPlan: null };
  }

  // Check subscription status before plan-level access (use fresh data)
  const subCheck = isSubscriptionUsable({
    user: { ...session.user, subscriptionStatus: freshStatus, trialEndsAt: freshTrialEndsAt },
  });
  if (!subCheck.usable) {
    return {
      allowed: false,
      currentPlan: plan,
      requiredPlan: null,
      feature: moduleId,
      reason: subCheck.reason,
    };
  }

  const allowed = planIncludes(plan, moduleId);
  const requiredPlan = allowed ? null : getRequiredPlan(moduleId);

  return {
    allowed,
    currentPlan: plan,
    requiredPlan,
    feature: moduleId,
  };
}

/**
 * Quick guard for server actions — throws if not allowed.
 * Use at the top of any gated server action.
 *
 * Usage:
 *   await requirePlanAccess("hr");  // throws if plan doesn't include "hr"
 */
export async function requirePlanAccess(moduleId) {
  const gate = await checkPlanAccess(moduleId);
  if (!gate.allowed) {
    if (gate.reason === "trial_expired") {
      throw new Error(
        "Your free trial has ended. Please subscribe to a plan to continue using this feature."
      );
    }
    if (gate.reason === "subscription_cancelled") {
      throw new Error(
        "Your subscription has been cancelled. Please resubscribe to continue using this feature."
      );
    }
    if (gate.reason === "subscription_expired") {
      throw new Error(
        "Your subscription has expired. Please renew to continue using this feature."
      );
    }
    throw new Error(
      `This feature requires the ${gate.requiredPlan} plan. Please upgrade to continue.`
    );
  }
  return gate;
}
