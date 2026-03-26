"use client";

import { Lock, AlertTriangle, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PLAN_LIMITS } from "@/lib/plans";

/**
 * Shown when a user tries to access a module not included in their plan,
 * or when their subscription/trial is no longer active.
 * Replaces the page content — never blocks navigation, just shows upgrade CTA.
 */
export function UpgradePrompt({ currentPlan = "free", requiredPlan = "starter", feature = "this feature", reason }) {
  // Trial expired messaging
  if (reason === "trial_expired") {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-4">
        <div className="max-w-md w-full text-center">
          <div className="mx-auto mb-6 w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-destructive" />
          </div>

          <h2 className="text-xl font-bold text-foreground mb-2">
            Your free trial has ended
          </h2>

          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            Your trial period has expired. Subscribe to a plan to continue using
            all the features you love.
          </p>

          <div className="flex flex-col gap-2">
            <Button className="w-full" asChild>
              <Link href="/dashboard/company?tab=billing">
                View Plans & Subscribe
                <ArrowUpRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
            <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
              <Link href="/dashboard">Back to Dashboard</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Subscription expired messaging
  if (reason === "subscription_expired") {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-4">
        <div className="max-w-md w-full text-center">
          <div className="mx-auto mb-6 w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-destructive" />
          </div>

          <h2 className="text-xl font-bold text-foreground mb-2">
            Your subscription has expired
          </h2>

          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            Your subscription is no longer active. Renew your plan to regain
            access to all features.
          </p>

          <div className="flex flex-col gap-2">
            <Button className="w-full" asChild>
              <Link href="/dashboard/company?tab=billing">
                Renew Subscription
                <ArrowUpRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
            <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
              <Link href="/dashboard">Back to Dashboard</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Subscription cancelled messaging
  if (reason === "subscription_cancelled") {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-4">
        <div className="max-w-md w-full text-center">
          <div className="mx-auto mb-6 w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-destructive" />
          </div>

          <h2 className="text-xl font-bold text-foreground mb-2">
            Your subscription has been cancelled
          </h2>

          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            Your subscription was cancelled. Resubscribe to a plan to continue
            using all features.
          </p>

          <div className="flex flex-col gap-2">
            <Button className="w-full" asChild>
              <Link href="/dashboard/company?tab=billing">
                Resubscribe
                <ArrowUpRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
            <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
              <Link href="/dashboard">Back to Dashboard</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Default: plan upgrade messaging
  const required = PLAN_LIMITS[requiredPlan] || PLAN_LIMITS.starter;
  const current = PLAN_LIMITS[currentPlan] || PLAN_LIMITS.free;

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-4">
      <div className="max-w-md w-full text-center">
        <div className="mx-auto mb-6 w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Lock className="w-7 h-7 text-primary" />
        </div>

        <h2 className="text-xl font-bold text-foreground mb-2">
          Upgrade to {required.label}
        </h2>

        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          {feature} is available on the <span className="font-semibold text-foreground">{required.label}</span> plan
          and above. You&apos;re currently on the <span className="font-semibold text-foreground">{current.label}</span> plan.
        </p>

        <div className="rounded-xl border border-border bg-card p-5 mb-6 text-left">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            {required.label} plan includes
          </p>
          <ul className="space-y-2 text-sm text-foreground">
            {requiredPlan === "starter" && (
              <>
                <li className="flex items-center gap-2"><span className="text-primary">+</span> Purchases & Bills</li>
                <li className="flex items-center gap-2"><span className="text-primary">+</span> Full Expense Management</li>
                <li className="flex items-center gap-2"><span className="text-primary">+</span> Finance & Accounting</li>
                <li className="flex items-center gap-2"><span className="text-primary">+</span> Tax & KRA Compliance</li>
                <li className="flex items-center gap-2"><span className="text-primary">+</span> Financial Reports</li>
                <li className="flex items-center gap-2"><span className="text-primary">+</span> Up to {required.maxUsers} users</li>
              </>
            )}
            {requiredPlan === "professional" && (
              <>
                <li className="flex items-center gap-2"><span className="text-primary">+</span> Everything in Starter</li>
                <li className="flex items-center gap-2"><span className="text-primary">+</span> HR & Payroll</li>
                <li className="flex items-center gap-2"><span className="text-primary">+</span> Project Management</li>
                <li className="flex items-center gap-2"><span className="text-primary">+</span> Up to {required.maxUsers} users</li>
              </>
            )}
            {requiredPlan === "enterprise" && (
              <>
                <li className="flex items-center gap-2"><span className="text-primary">+</span> Everything in Professional</li>
                <li className="flex items-center gap-2"><span className="text-primary">+</span> Multi-company</li>
                <li className="flex items-center gap-2"><span className="text-primary">+</span> API Access</li>
                <li className="flex items-center gap-2"><span className="text-primary">+</span> Unlimited users</li>
              </>
            )}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <Button className="w-full" asChild>
            <Link href="/dashboard/company?tab=billing">
              Upgrade to {required.label} — {required.currency || "KES"} {required.price?.toLocaleString()}/mo
              <ArrowUpRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
            <Link href="/dashboard">Back to Dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
