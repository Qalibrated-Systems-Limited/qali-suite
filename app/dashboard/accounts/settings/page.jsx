import { Suspense } from "react";
import { redirect } from "next/navigation";
import { FileText, Calendar, CreditCard, ShieldCheck, Users, Scale } from "lucide-react";
import { auth } from "@/auth";
import { can } from "@/lib/capabilities";
import { roleAllowed } from "@/lib/permissions";
import { SettingsCard, SettingsSection } from "@/components/settings/SettingsCard";
import AccountSetupCard from "./components/AccountSetupCard";
import ChartOfAccountsSyncCard from "./components/ChartOfAccountsSyncCard";

export const metadata = { title: "Finance Settings" };

/**
 * The settings that belong to Finance, kept with Finance.
 *
 * They were part of the one company-wide Settings page, which is why CFO and
 * the Accountant could open system settings. That page is the administrators'
 * now; this one is Finance's.
 */
export default async function FinanceSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { role } = session.user;
  if (!can(role, "finance.write")) redirect("/dashboard");

  // The same roles the thresholds page admits.
  const thresholds = roleAllowed(role, ["Admin", "CFO"]);

  return (
    <div className="max-w-5xl space-y-5 sm:space-y-8 sm:p-2 lg:p-4">
      <div>
        <h1 className="text-lg font-bold tracking-tight sm:text-2xl">Finance Settings</h1>
        <p className="hidden text-muted-foreground sm:block">
          The chart of accounts, periods, banking and the accounts the system posts to
        </p>
      </div>

      <SettingsSection title="Accounting">
        <SettingsCard
          href="/dashboard/accounts"
          icon={FileText}
          iconColor="text-emerald-500"
          iconBg="bg-emerald-500/10"
          title="Chart of Accounts"
          description="Account structure and GL account management"
        />
        {can(role, "fiscal.manage") && (
          <SettingsCard
            href="/dashboard/settings/fiscal-periods"
            icon={Calendar}
            iconColor="text-indigo-500"
            iconBg="bg-indigo-500/10"
            title="Fiscal Periods"
            description="Accounting periods and period closing"
          />
        )}
        <SettingsCard
          href="/dashboard/accounts/opening-balances"
          icon={Scale}
          iconColor="text-slate-500"
          iconBg="bg-slate-500/10"
          title="Opening Balances"
          description="Balances brought forward when the books start here"
        />
        <SettingsCard
          href="/dashboard/banking"
          icon={CreditCard}
          iconColor="text-amber-500"
          iconBg="bg-amber-500/10"
          title="Bank Feed"
          description="Import and allocate bank statements"
        />
        <SettingsCard
          href="/dashboard/parties"
          icon={Users}
          iconColor="text-purple-500"
          iconBg="bg-purple-500/10"
          title="Customers & Suppliers"
          description="Business contacts and parties"
        />
        {thresholds && (
          <SettingsCard
            href="/dashboard/settings/approvals"
            icon={ShieldCheck}
            iconColor="text-rose-500"
            iconBg="bg-rose-500/10"
            title="Approval Thresholds"
            description="When stock adjustments, prices, and payments require approval"
          />
        )}
      </SettingsSection>

      <SettingsSection title="Account setup">
        <Suspense fallback={<div className="h-20 animate-pulse rounded-lg border bg-card" />}>
          <AccountSetupCard />
        </Suspense>
        <ChartOfAccountsSyncCard />
      </SettingsSection>
    </div>
  );
}
