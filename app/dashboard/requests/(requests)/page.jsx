import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Search from "@/components/search";
import { Card, CardContent } from "@/components/ui/card";
import {
  StatusFilter,
  PriorityFilter,
  RequestTypeFilter,
  ClearFiltersButton,
  FilterBadge,
} from "../components/filters";
import { SiteHeader } from "@/components/site-header";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import {
  RequestStatsCards,
  RequestStatsSkeleton,
  RequestsTableServer,
  RequestsTableSkeleton,
  RequestsPaginationServer,
} from "../components/RequestServerComponents";

const RequestsPage = async (props) => {
  const searchParams = await props.searchParams;

  const query = searchParams.query || "";
  const status = searchParams.status || "all";
  const priority = searchParams.priority || "all";
  const requestType = searchParams.type || "all";
  const customer = searchParams.customer || "";
  const startDate = searchParams.startDate || "";
  const endDate = searchParams.endDate || "";

  const session = await auth();
  const user = session?.user;

  if (!user) {
    redirect("/login");
  }

  const userId = user.id;
  // Pass the canonical (capitalised) role straight through. The earlier
  // lowercase coercion broke buildRoleFilter — Admin / SuperAdmin /
  // Manager would silently fall through to "own requests only" because
  // the filter compares against canonical names.
  const userRole = user.role || "User";
  const canOnlyViewOwn = ![
    "SuperAdmin",
    "Admin",
    "Manager",
    "Store Manager",
    "Storekeeper",
  ].includes(userRole);

  const currentPage = Number(searchParams.page) || 1;

  // Build filters object
  const filters = {
    status: status !== "all" ? status : "",
    priority: priority !== "all" ? priority : "",
    requestType: requestType !== "all" ? requestType : "",
    customer,
    startDate,
    endDate,
  };

  // Check if any filters are active
  const hasActiveFilters = status !== "all" || priority !== "all" || requestType !== "all";

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <SiteHeader
        title={canOnlyViewOwn ? "My Requests" : "Manage Requests"}
        description={
          canOnlyViewOwn
            ? "View and track your submitted requests"
            : "Review and manage all stock requests"
        }
        Action={() => (
          <Button asChild size="sm">
            <Link href="/dashboard/requests/create">
              <Plus className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">New Request</span>
            </Link>
          </Button>
        )}
      />

      {/* Stats Cards - Stream independently */}
      <Suspense fallback={<RequestStatsSkeleton />}>
        <RequestStatsCards userId={userId} userRole={userRole} />
      </Suspense>

      {/* Search and Filters */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4">
            {/* Search Bar */}
            <div className="w-full">
              <Search placeholder="Search by requester, department, request number..." />
            </div>

            {/* Filters Row */}
            <div className="flex flex-col sm:flex-row gap-3">
              <StatusFilter currentStatus={status} />
              <PriorityFilter currentPriority={priority} />
              <RequestTypeFilter currentType={requestType} />

              {/* Clear Filters Button */}
              {hasActiveFilters && <ClearFiltersButton />}
            </div>

            {/* Active Filters Display */}
            {hasActiveFilters && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  Active filters:
                </span>
                {status !== "all" && (
                  <FilterBadge label="Status" value={status} param="status" />
                )}
                {priority !== "all" && (
                  <FilterBadge
                    label="Priority"
                    value={priority}
                    param="priority"
                  />
                )}
                {requestType !== "all" && (
                  <FilterBadge
                    label="Type"
                    value={requestType}
                    param="type"
                  />
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Requests Table - Stream independently */}
      <Suspense fallback={<RequestsTableSkeleton />}>
        <RequestsTableServer
          query={query}
          page={currentPage}
          filters={filters}
          userId={userId}
          userRole={userRole}
        />
      </Suspense>

      {/* Pagination - Stream after table */}
      <Suspense fallback={null}>
        <RequestsPaginationServer
          query={query}
          filters={filters}
          userId={userId}
          userRole={userRole}
        />
      </Suspense>
    </div>
  );
};

export default RequestsPage;
