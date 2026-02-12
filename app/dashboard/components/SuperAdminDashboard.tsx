import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Crown } from "lucide-react";

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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-400 to-amber-500 shadow-lg shadow-yellow-500/25">
              <Crown className="w-4 h-4 text-black" />
            </div>
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
              {greeting}, {firstName}
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1 pl-10">
            {formatDate(new Date())} • Platform Management
          </p>
        </div>
      </div>

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
