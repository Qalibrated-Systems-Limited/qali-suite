import { Suspense } from "react";
import Link from "next/link";
import {
  Building2,
  CreditCard,
  Users,
  FileText,
  ChevronRight,
  Calendar,
  Briefcase,
  DollarSign,
  CalendarDays,
  Clock,
  ShieldCheck,
} from "lucide-react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import AccountSetupCard from "./components/AccountSetupCard";
import ChartOfAccountsSyncCard from "./components/ChartOfAccountsSyncCard";

// ============================================
// METADATA
// ============================================
export const metadata = {
  title: "Settings | System Configuration",
  description: "System settings and configuration",
};

// ============================================
// SETTINGS CARD
// ============================================
function SettingsCard({ href, icon: Icon, iconColor, iconBg, title, description }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50 sm:gap-4 sm:p-4"
    >
      <div className={`shrink-0 rounded-lg p-2 sm:p-3 ${iconBg}`}>
        <Icon className={`h-5 w-5 ${iconColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-medium sm:text-base">{title}</h3>
        <p className="truncate text-xs text-muted-foreground sm:text-sm">{description}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground sm:h-5 sm:w-5" />
    </Link>
  );
}

// ============================================
// PAGE COMPONENT
// ============================================
export default async function SettingsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { role } = session.user;
  const isSuperAdmin = role === "SuperAdmin";
  const isAdmin = role === "Admin" || isSuperAdmin;
  // Finance roles see accounting settings (fiscal periods, COA, etc).
  // CFO and Finance Manager were previously excluded — sidebar's
  // canSeeSettingsNav surfaces the link to them, so the page now matches.
  const isFinanceUser =
    role === "Accountant" || role === "CFO" || role === "Finance Manager";
  const isHR = role === "HR";

  // At least one settings section must be visible
  const canSeeGeneralOrAccounting = isAdmin || isFinanceUser;
  const canSeeHR = isAdmin || isHR;

  if (!canSeeGeneralOrAccounting && !canSeeHR) {
    return (
      <div className="flex min-h-100 items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">Access Denied</h2>
          <p className="text-muted-foreground">You don&apos;t have permission to access settings.</p>
        </div>
      </div>
    );
  }

  return (
    // No page-level padding — the dashboard layout already provides it;
    // stacking both left ~2rem of dead space on phones.
    <div className="max-w-5xl space-y-5 sm:space-y-8 sm:p-2 lg:p-4">
      {/* Header — the sticky mobile header already says "Settings" */}
      <div>
        <h1 className="text-lg font-bold tracking-tight sm:text-2xl">Settings</h1>
        <p className="hidden text-muted-foreground sm:block">
          Manage your company settings and system configuration
        </p>
      </div>

      {canSeeGeneralOrAccounting && (
        <>
          {/* General */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">General</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <SettingsCard
                href="/dashboard/company"
                icon={Building2}
                iconColor="text-blue-500"
                iconBg="bg-blue-500/10"
                title="Company Profile"
                description="Company details, logo, and contact information"
              />
              <SettingsCard
                href="/dashboard/parties"
                icon={Users}
                iconColor="text-purple-500"
                iconBg="bg-purple-500/10"
                title="Customers & Suppliers"
                description="Manage your business contacts and parties"
              />
            </div>
          </div>

          {/* Accounting */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Accounting</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <SettingsCard
                href="/dashboard/accounts"
                icon={FileText}
                iconColor="text-emerald-500"
                iconBg="bg-emerald-500/10"
                title="Chart of Accounts"
                description="Account structure and GL account management"
              />
              <SettingsCard
                href="/dashboard/settings/fiscal-periods"
                icon={Calendar}
                iconColor="text-indigo-500"
                iconBg="bg-indigo-500/10"
                title="Fiscal Periods"
                description="Accounting periods and period closing"
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
                href="/dashboard/settings/approvals"
                icon={ShieldCheck}
                iconColor="text-rose-500"
                iconBg="bg-rose-500/10"
                title="Approval Thresholds"
                description="When stock adjustments, prices, and payments require approval"
              />
            </div>
          </div>

          {/* System Setup */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">System Setup</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <Suspense
                fallback={
                  <div className="rounded-lg border bg-card p-4 animate-pulse">
                    <div className="flex items-center gap-4">
                      <div className="h-11 w-11 rounded-lg bg-muted" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 w-32 bg-muted rounded" />
                        <div className="h-3 w-48 bg-muted rounded" />
                      </div>
                    </div>
                  </div>
                }
              >
                <AccountSetupCard />
              </Suspense>
              <ChartOfAccountsSyncCard />
            </div>
          </div>
        </>
      )}

      {/* HR */}
      {canSeeHR && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Human Resources</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <SettingsCard
              href="/dashboard/settings/payroll-config"
              icon={DollarSign}
              iconColor="text-emerald-500"
              iconBg="bg-emerald-500/10"
              title="Payroll Configuration"
              description="PAYE brackets, NSSF tiers, SHIF & AHL rates — required before running payroll"
            />
            <SettingsCard
              href="/dashboard/hr/departments"
              icon={Briefcase}
              iconColor="text-blue-500"
              iconBg="bg-blue-500/10"
              title="Departments"
              description="Manage organisational structure and departments"
            />
            <SettingsCard
              href="/dashboard/settings/public-holidays"
              icon={CalendarDays}
              iconColor="text-orange-500"
              iconBg="bg-orange-500/10"
              title="Public Holidays"
              description="Manage holiday calendar — excluded from leave and payroll working days"
            />
            <SettingsCard
              href="/dashboard/settings/attendance-config"
              icon={Clock}
              iconColor="text-teal-500"
              iconBg="bg-teal-500/10"
              title="Attendance Configuration"
              description="Shift hours, late threshold, IP whitelist, and GPS geofencing for clock-in"
            />
          </div>
        </div>
      )}
    </div>
  );
}
