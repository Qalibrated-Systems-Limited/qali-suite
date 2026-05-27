import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

// Client Component (uses useSearchParams)
import { DashboardTabs } from "./tabs/DashboardTabs";
import MyHRStrip from "./MyHRStrip";
import { AlertsStrip, AlertsStripSkeleton } from "./AlertsStrip";

// Server Components (Tabs)
import { FinanceTab, FinanceTabSkeleton } from "./tabs/FinanceTab";
import { InventoryTab, InventoryTabSkeleton } from "./tabs/InventoryTab";
import { OperationsTab, OperationsTabSkeleton } from "./tabs/OperationlTabs";

// ============================================
// DASHBOARD PAGE - Server Component
// ============================================
export const metadata = {
  title: "Dashboard | ERP System",
  description: "Your personalized dashboard",
};

export async function AdminDashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const sessionUser = session.user as { id?: string; name?: string; email?: string; role?: string };
  const user = {
    id: sessionUser.id || "",
    name: sessionUser.name || "User",
    email: sessionUser.email || "",
    role: sessionUser.role || "Employee",
  };

  const firstName = user.name?.split(" ")[0] || "Admin";
  const greeting = getGreeting();

  // Role check — defensive; the dashboard router only sends Admin/Manager
  // here, but this component might be rendered directly from another route.
  // If someone lands here without authorization, send them back to the
  // router which knows where they belong.
  const isAdmin = ["SuperAdmin", "Admin", "Manager", "Store Manager", "Accountant"].includes(
    user.role
  );

  if (!isAdmin) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <p className="text-xs text-muted-foreground">{formatDate(new Date())}</p>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          {greeting}, {firstName}
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
          Today's pulse across operations, finance, and inventory.
        </p>
      </div>

      {/* Alerts strip — what needs attention right now */}
      <Suspense fallback={<AlertsStripSkeleton />}>
        <AlertsStrip />
      </Suspense>

      {/* Personal HR strip */}
      <section>
        <h2 className="text-xs font-medium text-muted-foreground mb-2">My HR</h2>
        <MyHRStrip />
      </section>

      {/*
        IMPORTANT: Wrap in Suspense for useSearchParams
        Next.js 16 requires this for client components using useSearchParams
      */}
      <Suspense fallback={<TabsLoadingSkeleton />}>
        <DashboardTabs
          financeTab={
            <Suspense fallback={<FinanceTabSkeleton />}>
              <FinanceTab />
            </Suspense>
          }
          inventoryTab={
            <Suspense fallback={<InventoryTabSkeleton />}>
              <InventoryTab />
            </Suspense>
          }
          operationsTab={
            <Suspense fallback={<OperationsTabSkeleton />}>
              <OperationsTab />
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

      {/* Tab content skeleton */}
      <div className="space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 bg-muted/50 animate-pulse rounded-lg border border-border/40"
            />
          ))}
        </div>

        {/* Alerts */}
        <div className="h-12 bg-muted/50 animate-pulse rounded-lg border border-border/40" />

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-80 bg-muted/50 animate-pulse rounded-lg border border-border/40"
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
