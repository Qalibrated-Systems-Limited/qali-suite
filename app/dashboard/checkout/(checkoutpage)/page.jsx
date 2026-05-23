import { Suspense } from "react";
import { auth } from "@/auth";
import Search from "@/components/search";
import { Card, CardContent } from "@/components/ui/card";
import { SiteHeader } from "@/components/site-header";
import {
  CheckoutStatusFilter,
  CheckoutDueFilter,
  ClearCheckoutFiltersButton,
  CheckoutFilterBadge,
} from "../components/checkoutFilter";
import {
  CheckoutStatsCards,
  CheckoutStatsSkeleton,
  CheckoutsTableServer,
  CheckoutsTableSkeleton,
  CheckoutsPaginationServer,
} from "../components/CheckoutServerComponents";

async function CheckoutsPage(props) {
  const searchParams = await props.searchParams;
  const session = await auth();

  const query = searchParams.query || "";
  const status = searchParams.status || "all";
  const dueStatus = searchParams.dueStatus || "all";

  const currentPage = Number(searchParams.page) || 1;

  const { user } = session;
  let userRole = user.role || "user";
  if (userRole && userRole !== "Store Manager") {
    userRole = userRole.toLowerCase();
  }

  const canManageCheckouts =
    userRole === "Store Manager" || userRole === "admin";

  // Build filters object
  const filters = {
    status: status !== "all" ? status : "",
    dueStatus: dueStatus !== "all" ? dueStatus : "",
  };

  // Check if any filters are active
  const hasActiveFilters = status !== "all" || dueStatus !== "all";

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <SiteHeader
        title="Item Checkouts"
        description="Track and manage checked out inventory items"
      />

      {/* Stats Cards - Stream independently */}
      <Suspense fallback={<CheckoutStatsSkeleton />}>
        <CheckoutStatsCards />
      </Suspense>

      {/* Search and Filters */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4">
            {/* Search Bar */}
            <div className="w-full">
              <Search placeholder="Search by checkout number, person, product..." />
            </div>

            {/* Filters Row */}
            <div className="flex flex-col sm:flex-row gap-3">
              <CheckoutStatusFilter currentStatus={status} />
              <CheckoutDueFilter currentDueStatus={dueStatus} />

              {/* Clear Filters Button */}
              {hasActiveFilters && <ClearCheckoutFiltersButton />}
            </div>

            {/* Active Filters Display */}
            {hasActiveFilters && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  Active filters:
                </span>
                {status !== "all" && (
                  <CheckoutFilterBadge
                    label="Status"
                    value={status}
                    param="status"
                  />
                )}
                {dueStatus !== "all" && (
                  <CheckoutFilterBadge
                    label="Due Status"
                    value={dueStatus}
                    param="dueStatus"
                  />
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Checkouts Table - Stream independently */}
      <Suspense fallback={<CheckoutsTableSkeleton />}>
        <CheckoutsTableServer
          query={query}
          page={currentPage}
          filters={filters}
          canManageCheckouts={canManageCheckouts}
        />
      </Suspense>

      {/* Pagination - Stream after table */}
      <Suspense fallback={null}>
        <CheckoutsPaginationServer query={query} filters={filters} />
      </Suspense>
    </div>
  );
}

export default CheckoutsPage;
