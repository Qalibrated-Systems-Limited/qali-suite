import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { isSubscriptionUsable } from "@/lib/plan-gate";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import dbConnect from "@/app/config/dbConnect";
import Company from "@/app/models/Company";

export const metadata = { title: "Subscription Expired | QaliSuite" };

export default async function SubscriptionExpiredPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Start with session-based check, then override with live DB data
  let subCheck = isSubscriptionUsable(session);

  // Live DB check for freshness — handles SuperAdmin trial extensions
  // and subscription renewals that haven't propagated to the JWT yet
  if (session.user.companyId) {
    await dbConnect();
    const company = await Company.findById(session.user.companyId)
      .select("subscription.status subscription.trialEndsAt")
      .lean();
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
