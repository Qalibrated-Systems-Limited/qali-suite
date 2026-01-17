"use client";

import { useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClaimCard, ClaimCardSkeleton } from "./ClaimCard";
import { Badge } from "@/components/ui/badge";

/**
 * Claims List Component with Filters
 * Matches your Party List pattern with tabs for filtering
 */
export function ClaimsListWithFilters({
  claims,
  currentStatus = "all",
  currentType = "all",
  showStatusFilter = true,
  showTypeFilter = true,
  emptyMessage = "No claims found",
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleFilterChange = (filterType, value) => {
    const params = new URLSearchParams(searchParams);

    if (filterType === "status") {
      if (value === "all") {
        params.delete("status");
      } else {
        params.set("status", value);
      }
    } else if (filterType === "type") {
      if (value === "all") {
        params.delete("type");
      } else {
        params.set("type", value);
      }
    }

    // Reset to page 1 when filters change
    params.set("page", "1");

    router.push(`${pathname}?${params.toString()}`);
  };

  // Status filter options
  const statusFilters = [
    { value: "all", label: "All" },
    { value: "submitted", label: "Pending Approval" },
    { value: "approved", label: "Approved" },
    { value: "paid", label: "Paid" },
    { value: "pending_return", label: "Pending Return" }, // NEW
    { value: "pending_payment", label: "Pending Payment" }, // NEW
    { value: "rejected", label: "Rejected" },
    { value: "closed", label: "Closed" },
  ];

  // Type filter options
  const typeFilters = [
    { value: "all", label: "All Types" },
    { value: "advance_request", label: "Advances" },
    { value: "reimbursement", label: "Reimbursements" },
    { value: "advance_return", label: "Settlements" },
  ];

  return (
    <div className="space-y-6">
      {/* Filters - Responsive Tabs */}
      {showStatusFilter && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-foreground">
            Filter by Status
          </p>
          <Tabs
            value={currentStatus}
            onValueChange={(value) => handleFilterChange("status", value)}
          >
            <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 h-auto gap-1.5 p-1 bg-muted">
              {statusFilters.map((filter) => (
                <TabsTrigger
                  key={filter.value}
                  value={filter.value}
                  className="text-xs sm:text-sm font-medium py-2 px-2 data-[state=active]:bg-yellow-500 data-[state=active]:text-black data-[state=active]:shadow-sm"
                >
                  {filter.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}

      {showTypeFilter && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-foreground">
            Filter by Type
          </p>
          <Tabs
            value={currentType}
            onValueChange={(value) => handleFilterChange("type", value)}
          >
            <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4 h-auto gap-2 p-1 bg-muted">
              {typeFilters.map((filter) => (
                <TabsTrigger
                  key={filter.value}
                  value={filter.value}
                  className="text-sm font-medium py-2.5 px-3 data-[state=active]:bg-yellow-500 data-[state=active]:text-black data-[state=active]:shadow-sm"
                >
                  {filter.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}

      {/* Results Count */}
      <div className="flex items-center justify-between pt-2">
        <p className="text-sm sm:text-base text-muted-foreground">
          {claims.length > 0 ? (
            <>
              Showing{" "}
              <span className="font-semibold text-foreground">
                {claims.length}
              </span>{" "}
              claim{claims.length !== 1 ? "s" : ""}
            </>
          ) : (
            "No claims found"
          )}
        </p>
      </div>

      {/* Claims Grid */}
      {claims.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
          {claims.map((claim) => (
            <ClaimCard key={claim._id} claim={claim} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 sm:py-20 text-center px-4">
          <div className="w-20 h-20 sm:w-24 sm:h-24 mb-6 rounded-full bg-muted flex items-center justify-center">
            <span className="text-4xl sm:text-5xl">📋</span>
          </div>
          <h3 className="text-lg sm:text-xl font-semibold text-foreground mb-2">
            {emptyMessage}
          </h3>
          <p className="text-sm sm:text-base text-muted-foreground max-w-md">
            {currentStatus !== "all" || currentType !== "all"
              ? "Try adjusting your filters to see more claims"
              : "Get started by creating your first expense claim"}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Claims List Skeleton
 */
export function ClaimsListSkeleton() {
  return (
    <div className="space-y-4">
      {/* Filter skeletons */}
      <div className="space-y-2">
        <div className="h-4 w-16 bg-muted rounded animate-pulse" />
        <div className="h-10 w-full bg-muted rounded animate-pulse" />
      </div>

      <div className="space-y-2">
        <div className="h-4 w-16 bg-muted rounded animate-pulse" />
        <div className="h-10 w-full bg-muted rounded animate-pulse" />
      </div>

      {/* Count skeleton */}
      <div className="h-4 w-32 bg-muted rounded animate-pulse" />

      {/* Cards skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <ClaimCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
