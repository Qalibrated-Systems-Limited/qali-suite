import {
  searchCheckouts,
  fetchCheckoutPages,
  getCheckoutStats,
} from "@/app/mongodb/queries/checkout-queries";
import Pagination from "@/components/pagination";
import Search from "@/components/search";
import { auth } from "@/auth";
import { Card, CardContent } from "@/components/ui/card";
import { SiteHeader } from "@/components/site-header";
import {
  CheckoutStatusFilter,
  CheckoutDueFilter,
  ClearCheckoutFiltersButton,
  CheckoutFilterBadge,
} from "../components/checkoutFilter";
import { CheckoutsTable } from "../components/checkoutsTable";
import { Package, Clock, AlertTriangle, CheckCircle } from "lucide-react";

async function CheckoutsPage(props) {
  const searchParams = await props.searchParams;
  const session = await auth();

  const query = searchParams.query || "";
  const status = searchParams.status || "all";
  const dueStatus = searchParams.dueStatus || "all";

  const currentPage = Number(searchParams.page) || 1;

  const { user } = session;
  const userId = user.id;
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

  const [totalPages, checkouts, stats] = await Promise.all([
    fetchCheckoutPages(query, filters),
    searchCheckouts(query, currentPage, filters),
    getCheckoutStats(),
  ]);

  // Check if any filters are active
  const hasActiveFilters = status !== "all" || dueStatus !== "all";

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <SiteHeader title="Item Checkouts" />

      {/* Search and Filters */}
      <Card className="bg-[#161b22] border-[#30363d]">
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
              <div className="flex flex-wrap gap-2 pt-2 border-t border-[#30363d]">
                <span className="text-xs text-gray-400">Active filters:</span>
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

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-[#161b22] border-[#30363d]">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400">Active</p>
                <p className="text-2xl font-bold text-white">{stats.active}</p>
              </div>
              <Package className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#161b22] border-[#30363d]">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400">Due Soon</p>
                <p className="text-2xl font-bold text-orange-500">
                  {stats.dueSoon}
                </p>
              </div>
              <Clock className="w-8 h-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#161b22] border-[#30363d]">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400">Overdue</p>
                <p className="text-2xl font-bold text-red-500">
                  {stats.overdue}
                </p>
              </div>
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#161b22] border-[#30363d]">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400">Returned</p>
                <p className="text-2xl font-bold text-green-500">
                  {stats.returned}
                </p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Checkouts Table */}
      <CheckoutsTable
        checkouts={checkouts}
        canManageCheckouts={canManageCheckouts}
        userId={userId}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination totalPages={totalPages} />
        </div>
      )}
    </div>
  );
}

export default CheckoutsPage;
