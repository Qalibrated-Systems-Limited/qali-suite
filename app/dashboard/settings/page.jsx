import { Suspense } from "react";
import Link from "next/link";
import {
  Building2,
  CreditCard,
  Users,
  FileText,
  ChevronRight,
  Calendar,
} from "lucide-react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import AccountSetupCard from "./components/AccountSetupCard";

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
      className="flex items-center gap-4 rounded-lg border bg-card p-4 hover:bg-muted/50 transition-colors"
    >
      <div className={`rounded-lg p-3 ${iconBg}`}>
        <Icon className={`h-5 w-5 ${iconColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground truncate">{description}</p>
      </div>
      <ChevronRight className="h-5 w-5 text-muted-foreground" />
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

  const isAdmin = session.user.role === "Admin";
  const isAccountant = session.user.role === "Accountant";
  const canManageSettings = isAdmin || isAccountant;

  if (!canManageSettings) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Access Denied
          </h2>
          <p className="text-muted-foreground">
            You don&apos;t have permission to access settings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your company settings and system configuration
        </p>
      </div>

      {/* Quick Settings */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">General Settings</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <SettingsCard
            href="/dashboard/company"
            icon={Building2}
            iconColor="text-blue-500"
            iconBg="bg-blue-500/10"
            title="Company Profile"
            description="Manage company details, logo, and contact information"
          />
          <SettingsCard
            href="/dashboard/parties"
            icon={Users}
            iconColor="text-purple-500"
            iconBg="bg-purple-500/10"
            title="Customers & Suppliers"
            description="Manage your business contacts"
          />
        </div>
      </div>

      {/* Accounting Settings */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Accounting Settings</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <SettingsCard
            href="/dashboard/accounts"
            icon={FileText}
            iconColor="text-emerald-500"
            iconBg="bg-emerald-500/10"
            title="Chart of Accounts"
            description="Manage your chart of accounts and account structure"
          />
          <SettingsCard
            href="/dashboard/settings/fiscal-periods"
            icon={Calendar}
            iconColor="text-indigo-500"
            iconBg="bg-indigo-500/10"
            title="Fiscal Periods"
            description="Manage accounting periods and period closing"
          />
          <SettingsCard
            href="/dashboard/banking"
            icon={CreditCard}
            iconColor="text-amber-500"
            iconBg="bg-amber-500/10"
            title="Bank Feed"
            description="Import and allocate bank statements"
          />
        </div>
      </div>

      {/* System Setup */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">System Setup</h2>
        <p className="text-sm text-muted-foreground">
          One-time setup tasks to ensure your system is properly configured
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Advance Accounts Setup */}
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
        </div>
      </div>
    </div>
  );
}
