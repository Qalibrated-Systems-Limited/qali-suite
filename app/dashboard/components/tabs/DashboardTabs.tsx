"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// ============================================
// DASHBOARD TABS - Next.js 16 Pattern
// ============================================
// Uses useSearchParams for URL-based state
// Better performance, shareable URLs, back/forward works
// ============================================

interface DashboardTabsProps {
  financeTab: React.ReactNode;
  inventoryTab: React.ReactNode;
  operationsTab: React.ReactNode;
}

const VALID_TABS = ["finance", "inventory", "operations"] as const;
type TabValue = (typeof VALID_TABS)[number];

export function DashboardTabs({
  financeTab,
  inventoryTab,
  operationsTab,
}: DashboardTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Get current tab from URL, default to "finance"
  const currentTab = (searchParams.get("tab") as TabValue) || "finance";
  const activeTab = VALID_TABS.includes(currentTab) ? currentTab : "finance";

  // Update URL when tab changes
  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());

      if (value === "finance") {
        // Remove param for default tab (cleaner URL)
        params.delete("tab");
      } else {
        params.set("tab", value);
      }

      const query = params.toString();
      const url = query ? `${pathname}?${query}` : pathname;

      // Use router.replace for tab changes (no history stack)
      router.replace(url, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
      {/* Tab Triggers */}
      <TabsList className="w-full sm:w-auto h-auto p-1 bg-muted/50 rounded-lg">
        <TabsTrigger
          value="finance"
          className={cn(
            "flex-1 sm:flex-none px-3 sm:px-4 py-2 text-xs sm:text-sm rounded-md",
            "data-[state=active]:bg-background data-[state=active]:shadow-sm",
            "transition-all duration-200"
          )}
        >
          <span className="hidden sm:inline">💰</span>
          <span className="sm:ml-1.5">Finance</span>
        </TabsTrigger>
        <TabsTrigger
          value="inventory"
          className={cn(
            "flex-1 sm:flex-none px-3 sm:px-4 py-2 text-xs sm:text-sm rounded-md",
            "data-[state=active]:bg-background data-[state=active]:shadow-sm",
            "transition-all duration-200"
          )}
        >
          <span className="hidden sm:inline">📦</span>
          <span className="sm:ml-1.5">Inventory</span>
        </TabsTrigger>
        <TabsTrigger
          value="operations"
          className={cn(
            "flex-1 sm:flex-none px-3 sm:px-4 py-2 text-xs sm:text-sm rounded-md",
            "data-[state=active]:bg-background data-[state=active]:shadow-sm",
            "transition-all duration-200"
          )}
        >
          <span className="hidden sm:inline">⚡</span>
          <span className="sm:ml-1.5">Operations</span>
        </TabsTrigger>
      </TabsList>

      {/* Tab Contents */}
      <TabsContent
        value="finance"
        className="mt-4 sm:mt-6 focus-visible:outline-none"
      >
        {financeTab}
      </TabsContent>

      <TabsContent
        value="inventory"
        className="mt-4 sm:mt-6 focus-visible:outline-none"
      >
        {inventoryTab}
      </TabsContent>

      <TabsContent
        value="operations"
        className="mt-4 sm:mt-6 focus-visible:outline-none"
      >
        {operationsTab}
      </TabsContent>
    </Tabs>
  );
}
