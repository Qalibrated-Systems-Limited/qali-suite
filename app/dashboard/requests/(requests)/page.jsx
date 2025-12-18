import React from "react";
import { RequestsListWithActions } from "../components/request";
import { AddButton } from "@/components/buttons";
import { fetchRequestPages, searchRequests } from "@/app/mongodb/queries";
import Pagination from "@/components/pagination";
import { auth } from "@/auth";
import Search from "@/components/search";
import { Card, CardContent } from "@/components/ui/card";
import {
  StatusFilter,
  PriorityFilter,
  ClearFiltersButton,
  FilterBadge,
} from "../components/filters";
import { SiteHeader } from "@/components/site-header";

const RequestsPage = async (props) => {
  const searchParams = await props.searchParams;

  const query = searchParams.query || "";
  const status = searchParams.status || "all";
  const priority = searchParams.priority || "all";
  const customer = searchParams.customer || "";
  const startDate = searchParams.startDate || "";
  const endDate = searchParams.endDate || "";

  const session = await auth();
  const user = session?.user;

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="bg-[#161b22] border-[#30363d]">
          <CardContent className="p-6">
            <p className="text-gray-300">Please log in to view requests.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const userId = user.id;
  let userRole = user.role || "user";
  if (userRole && userRole !== "Store Manager") {
    userRole = userRole.toLowerCase();
  }
  const canOnlyViewOwn = ![
    "store clerk",
    "warehouse staff",
    "admin",
    "Store Manager",
  ].includes(userRole);

  const currentPage = Number(searchParams.page) || 1;

  // Build filters object
  const filters = {
    status: status !== "all" ? status : "",
    priority: priority !== "all" ? priority : "",
    customer,
    startDate,
    endDate,
  };

  const totalPages = await fetchRequestPages(query, userId, userRole, filters);
  const requests = await searchRequests(
    query,
    currentPage,
    userId,
    userRole,
    filters
  );

  // Check if any filters are active
  const hasActiveFilters = status !== "all" || priority !== "all";

  return (
    <div className="space-y-6">
      {/* Header */}
      <SiteHeader title={canOnlyViewOwn ? "My Requests" : "Manage Requets"} />

      {/* Search and Filters */}
      <Card className="bg-[#161b22] border-[#30363d]">
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

              {/* Clear Filters Button */}
              {hasActiveFilters && <ClearFiltersButton />}
            </div>

            {/* Active Filters Display */}
            {hasActiveFilters && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-[#30363d]">
                <span className="text-xs text-gray-400">Active filters:</span>
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
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Requests List */}
      <RequestsListWithActions
        requests={requests}
        userId={user.id}
        userRole={userRole}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination totalPages={totalPages} />
        </div>
      )}
    </div>
  );
};
export default RequestsPage;
