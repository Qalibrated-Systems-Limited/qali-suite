import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

import { AlertsStrip, AlertsStripSkeleton } from "./AlertsStrip";

// Client Component (uses useSearchParams)
import { SuperAdminTabs } from "./tabs/SuperAdminTabs";

// Server Components (Tabs)
import {
  SuperAdminOverviewTab,
  SuperAdminOverviewTabSkeleton,
} from "./tabs/SuperAdminOverviewTab";
import {
  SuperAdminCompaniesTab,
  SuperAdminCompaniesTabSkeleton,
} from "./tabs/SuperAdminCompaniesTab";
import {
  SuperAdminActivityTab,
  SuperAdminActivityTabSkeleton,
} from "./tabs/SuperAdminActivityTab";

// ============================================
// SUPERADMIN DASHBOARD - Server Component
// ============================================
export const metadata = {
  title: "Platform Dashboard | ERP System",
  description: "Platform management dashboard for SuperAdmin",
};

export default async function SuperAdminDashboard() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const user = session.user as {
    id?: string;
    name?: string;
    email?: string;
    role?: string;
  };

  const isSuperAdmin = user.role === "SuperAdmin";

  if (!isSuperAdmin) {
    redirect("/dashboard");
  }

  const firstName = user.name?.split(" ")[0] || "Admin";
  const greeting = getGreeting();

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <header>
        <p className="text-xs text-muted-foreground">
          {formatDate(new Date())}
        </p>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          {greeting}, {firstName}
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
          Platform management — tenants, subscriptions, and system health.
        </p>
      </header>

      {/* Cross-tenant alerts strip — SuperAdmin sees the aggregate (tenantMatch
          is empty in their context, so getDashboardAlerts spans all companies). */}
      <Suspense fallback={<AlertsStripSkeleton />}>
        <AlertsStrip />
      </Suspense>

      {/*
        IMPORTANT: Wrap in Suspense for useSearchParams
        Next.js 16 requires this for client components using useSearchParams
      */}
      <Suspense fallback={<TabsLoadingSkeleton />}>
        <SuperAdminTabs
          overviewTab={
            <Suspense fallback={<SuperAdminOverviewTabSkeleton />}>
              <SuperAdminOverviewTab />
            </Suspense>
          }
          companiesTab={
            <Suspense fallback={<SuperAdminCompaniesTabSkeleton />}>
              <SuperAdminCompaniesTab />
            </Suspense>
          }
          activityTab={
            <Suspense fallback={<SuperAdminActivityTabSkeleton />}>
              <SuperAdminActivityTab />
            </Suspense>
          }
        />
      </Suspense>
    </div>
  );
}

// ============================================
// TABS LOADING SKELETON
// ============================================
function TabsLoadingSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Tab triggers skeleton */}
      <div className="flex gap-1 p-1 bg-muted/50 rounded-lg w-full sm:w-auto">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex-1 sm:flex-none h-9 px-4 bg-muted animate-pulse rounded-md"
          />
        ))}
      </div>

      {/* Tab content skeleton - Metrics */}
      <div className="space-y-4">
        {/* 4 KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-24 bg-muted/50 animate-pulse rounded-lg border border-border/40"
            />
          ))}
        </div>

        {/* 3 Cards Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-48 bg-muted/50 animate-pulse rounded-lg border border-border/40"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================
// HELPERS
// ============================================
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}
