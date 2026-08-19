import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { isSubscriptionUsable } from "@/lib/plan-gate";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { getCompanySubscription } from "@/app/db/platform";

export const metadata = { title: "Subscription Expired | QaliSuite" };

export default async function SubscriptionExpiredPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Start with session-based check, then override with live DB data
  let subCheck = isSubscriptionUsable(session);

  // Live DB check for freshness — handles SuperAdmin trial extensions
  // and subscription renewals that haven't propagated to the JWT yet
  if (session.user.companyId) {
    // From Postgres since 0035, so a SuperAdmin extending a trial takes effect
    // on the next request rather than at the next token refresh.
    const company = await getCompanySubscription(String(session.user.companyId));
    if (company?.subscription) {
      subCheck = isSubscriptionUsable({
        user: {
          subscriptionStatus: company.subscription.status,
          trialEndsAt: company.subscription.trialEndsAt?.toISOString(),
        },
      });
    }
  }
  if (subCheck.usable) redirect("/dashboard");

  return (
    <UpgradePrompt
      currentPlan={session.user.companyPlan || "free"}
      reason={subCheck.reason}
    />
  );
}
