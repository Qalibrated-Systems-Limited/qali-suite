"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// ============================================
// SUPERADMIN TABS - Platform Management
// ============================================
// URL-based state for shareable URLs and back/forward support
// ============================================

interface SuperAdminTabsProps {
  overviewTab: React.ReactNode;
  companiesTab: React.ReactNode;
  activityTab: React.ReactNode;
}

const VALID_TABS = ["overview", "companies", "activity"] as const;
type TabValue = (typeof VALID_TABS)[number];

export function SuperAdminTabs({
  overviewTab,
  companiesTab,
  activityTab,
}: SuperAdminTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Get current tab from URL, default to "overview"
  const currentTab = (searchParams.get("tab") as TabValue) || "overview";
  const activeTab = VALID_TABS.includes(currentTab) ? currentTab : "overview";

  // Update URL when tab changes
  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());

      if (value === "overview") {
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
          value="overview"
          className={cn(
            "flex-1 sm:flex-none px-3 sm:px-4 py-2 text-xs sm:text-sm rounded-md",
            "data-[state=active]:bg-background data-[state=active]:shadow-sm",
            "transition-all duration-200"
          )}
        >
          <span className="hidden sm:inline">📊</span>
          <span className="sm:ml-1.5">Overview</span>
        </TabsTrigger>
        <TabsTrigger
          value="companies"
          className={cn(
            "flex-1 sm:flex-none px-3 sm:px-4 py-2 text-xs sm:text-sm rounded-md",
            "data-[state=active]:bg-background data-[state=active]:shadow-sm",
            "transition-all duration-200"
          )}
        >
          <span className="hidden sm:inline">🏢</span>
          <span className="sm:ml-1.5">Companies</span>
        </TabsTrigger>
        <TabsTrigger
          value="activity"
          className={cn(
            "flex-1 sm:flex-none px-3 sm:px-4 py-2 text-xs sm:text-sm rounded-md",
            "data-[state=active]:bg-background data-[state=active]:shadow-sm",
            "transition-all duration-200"
          )}
        >
          <span className="hidden sm:inline">⚡</span>
          <span className="sm:ml-1.5">Activity</span>
        </TabsTrigger>
      </TabsList>

      {/* Tab Contents */}
      <TabsContent
        value="overview"
        className="mt-4 sm:mt-6 focus-visible:outline-none"
      >
        {overviewTab}
      </TabsContent>

      <TabsContent
        value="companies"
        className="mt-4 sm:mt-6 focus-visible:outline-none"
      >
        {companiesTab}
      </TabsContent>

      <TabsContent
        value="activity"
        className="mt-4 sm:mt-6 focus-visible:outline-none"
      >
        {activityTab}
      </TabsContent>
    </Tabs>
  );
}
