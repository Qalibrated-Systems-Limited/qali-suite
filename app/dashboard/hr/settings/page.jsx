import { redirect } from "next/navigation";
import { DollarSign, Briefcase, CalendarDays, Clock, CalendarCheck } from "lucide-react";
import { auth } from "@/auth";
import { can } from "@/lib/capabilities";
import { SettingsCard, SettingsSection } from "@/components/settings/SettingsCard";

export const metadata = { title: "HR Settings" };

/**
 * The settings that belong to HR, kept in HR and run by HR.
 *
 * They used to sit in the company-wide Settings page, which put HR Manager
 * inside system settings to reach them. System settings are for the
 * administrators now (/dashboard/settings); these stay with the module, behind
 * the HR layout's licence (plan) gate.
 */
export default async function HRSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { role } = session.user;

  const rates = can(role, "payroll.rates.write");
  const admin = can(role, "hr.admin");
  if (!rates && !admin) redirect("/dashboard/hr");

  return (
    <div className="max-w-5xl space-y-5 p-4 sm:space-y-8 sm:p-6">
      <div>
        <h1 className="text-lg font-bold tracking-tight sm:text-2xl">HR Settings</h1>
        <p className="hidden text-muted-foreground sm:block">
          Payroll rates, leave, holidays, attendance rules and the organisation structure
        </p>
      </div>

      {rates && (
        <SettingsSection title="Payroll">
          <SettingsCard
            href="/dashboard/hr/settings/payroll-config"
            icon={DollarSign}
            iconColor="text-emerald-500"
            iconBg="bg-emerald-500/10"
            title="Payroll Configuration"
            description="PAYE brackets, NSSF tiers, SHIF & AHL rates — required before running payroll"
          />
        </SettingsSection>
      )}

      {admin && (
        <SettingsSection title="Time, leave & structure">
          <SettingsCard
            href="/dashboard/hr/leave-types"
            icon={CalendarCheck}
            iconColor="text-violet-500"
            iconBg="bg-violet-500/10"
            title="Leave Types"
            description="Entitlements, carry-over and which leave is paid"
          />
          <SettingsCard
            href="/dashboard/hr/settings/public-holidays"
            icon={CalendarDays}
            iconColor="text-orange-500"
            iconBg="bg-orange-500/10"
            title="Public Holidays"
            description="Holiday calendar — excluded from leave and payroll working days"
          />
          <SettingsCard
            href="/dashboard/hr/settings/attendance-config"
            icon={Clock}
            iconColor="text-teal-500"
            iconBg="bg-teal-500/10"
            title="Attendance Configuration"
            description="Shift hours, late threshold, IP whitelist, and GPS geofencing for clock-in"
          />
          <SettingsCard
            href="/dashboard/hr/departments"
            icon={Briefcase}
            iconColor="text-blue-500"
            iconBg="bg-blue-500/10"
            title="Departments"
            description="Organisational structure and departments"
          />
        </SettingsSection>
      )}
    </div>
  );
}
