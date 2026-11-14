import { redirect } from "next/navigation";
import { Building2, Users, ShieldCheck, KeyRound, UserCog, KeySquare, Plug, Briefcase, Landmark, Lock } from "lucide-react";
import { auth } from "@/auth";
import { can } from "@/lib/capabilities";
import { planIncludes } from "@/lib/plans";
import { SettingsCard, SettingsSection } from "@/components/settings/SettingsCard";

export const metadata = {
  title: "System Settings",
  description: "Company-wide configuration for administrators",
};

/**
 * SYSTEM SETTINGS — the administrators' page, and nobody else's.
 *
 * It used to be "Settings" for Admin, CFO, Accountant and HR Manager alike,
 * because it also held the HR and finance setup. Those now live with their
 * modules (HR Settings, Finance Settings), each run by its own people, and this
 * page is company-wide configuration only.
 *
 * The platform administrator (SuperAdmin) sees all of it. A company Admin sees
 * what their capabilities grant, and a card for a module appears only when the
 * company's licence (plan) includes that module.
 */
export default async function SettingsPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { role, companyPlan } = session.user;
  if (!can(role, "system.settings")) redirect("/dashboard");

  const isPlatform = role === "SuperAdmin";
  // The platform operator's plan is a home-tenant hint, not a licence (see
  // app/dashboard/integrations/layout.jsx), so it does not hide anything.
  const licensed = (moduleId) => isPlatform || planIncludes(companyPlan, moduleId);
  const upgrade = (await searchParams)?.upgrade;

  return (
    <div className="max-w-5xl space-y-5 sm:space-y-8 sm:p-2 lg:p-4">
      <div>
        <h1 className="text-lg font-bold tracking-tight sm:text-2xl">System Settings</h1>
        <p className="hidden text-muted-foreground sm:block">
          Company-wide configuration. Settings for one module live in that module.
        </p>
      </div>

      {upgrade && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          That feature is not included in this company&apos;s licence. See Licensing to upgrade.
        </p>
      )}

      <SettingsSection title="Company">
        <SettingsCard
          href="/dashboard/company"
          icon={Building2}
          iconColor="text-blue-500"
          iconBg="bg-blue-500/10"
          title="Company Profile"
          description="Company details, logo, bank details and contact information"
        />
        {can(role, "company.create") && (
          <SettingsCard
            href="/dashboard/admin/companies"
            icon={Briefcase}
            iconColor="text-slate-500"
            iconBg="bg-slate-500/10"
            title="Companies"
            description="Every tenant on the platform"
          />
        )}
      </SettingsSection>

      <SettingsSection title="Security & Access">
        {can(role, "admin.manage") && (
          <SettingsCard
            href="/dashboard/users"
            icon={UserCog}
            iconColor="text-sky-500"
            iconBg="bg-sky-500/10"
            title="Users & Access"
            description="Invite people, assign roles, deactivate accounts"
          />
        )}
        <SettingsCard
          href="/dashboard/settings/roles"
          icon={KeyRound}
          iconColor="text-violet-500"
          iconBg="bg-violet-500/10"
          title="Roles & Permissions"
          description="Every role and the permissions it holds, read from the code that enforces them"
        />
        <SettingsCard
          href="/dashboard/settings/approvals"
          icon={ShieldCheck}
          iconColor="text-rose-500"
          iconBg="bg-rose-500/10"
          title="Approval Thresholds"
          description="When stock adjustments, prices, and payments require approval"
        />
        {can(role, "licensing.manage") && (
          <SettingsCard
            href="/dashboard/licensing"
            icon={KeySquare}
            iconColor="text-teal-500"
            iconBg="bg-teal-500/10"
            title="Licensing"
            description="The company's licence and the modules it includes"
          />
        )}
        {can(role, "integration.manage") && licensed("integration") && (
          <SettingsCard
            href="/dashboard/integrations"
            icon={Plug}
            iconColor="text-amber-500"
            iconBg="bg-amber-500/10"
            title="Integrations"
            description="Connections to outside systems"
          />
        )}
      </SettingsSection>

      <SettingsSection title="Module settings">
        <SettingsCard
          href="/dashboard/accounts/settings"
          icon={Landmark}
          iconColor="text-emerald-500"
          iconBg="bg-emerald-500/10"
          title="Finance Settings"
          description="Chart of accounts, fiscal periods, bank feed and account setup — run by Finance"
        />
        {licensed("hr") ? (
          <SettingsCard
            href="/dashboard/hr/settings"
            icon={Users}
            iconColor="text-orange-500"
            iconBg="bg-orange-500/10"
            title="HR Settings"
            description="Payroll rates, leave types, holidays and attendance — run by HR"
          />
        ) : (
          <SettingsCard
            href="/dashboard/licensing"
            icon={Lock}
            iconColor="text-muted-foreground"
            iconBg="bg-muted"
            title="HR Settings"
            description="Human Resources is not in this company's licence"
          />
        )}
      </SettingsSection>
    </div>
  );
}
