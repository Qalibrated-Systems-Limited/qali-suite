import { Suspense } from "react";
import { auth } from "@/auth";
import Search from "@/components/search";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import {
  MovementTypeFilter,
  MovementDirectionFilter,
  MovementDateFilter,
  ClearMovementFiltersButton,
  MovementFilterBadge,
} from "./components/movementFilters";
import {
  MovementStatsCards,
  MovementStatsSkeleton,
  MovementsTableServer,
  MovementsTableSkeleton,
  MovementsPaginationServer,
} from "./components/MovementServerComponents";

// ============================================
// MAIN PAGE COMPONENT
// ============================================

async function MovementsPage(props) {
  const searchParams = await props.searchParams;
  const session = await auth();

  const query = searchParams.query || "";
  const movementType = searchParams.movementType || "all";
  const direction = searchParams.direction || "all";
  const startDate = searchParams.startDate || "";
  const endDate = searchParams.endDate || "";
  const productId = searchParams.productId || "";

  const currentPage = Number(searchParams.page) || 1;

  const { user } = session;

  // Build filters object
  const filters = {
    movementType: movementType !== "all" ? movementType : "",
    direction: direction !== "all" ? direction : "",
    productId: productId || "",
    startDate,
    endDate,
  };

  // Check if user is admin/manager for full access
  const isManager =
    user?.role === "Admin" ||
    user?.role === "Store Manager" ||
    user?.role === "Manager";

  // Check if any filters are active
  const hasActiveFilters =
    movementType !== "all" || direction !== "all" || startDate || endDate;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-3xl font-bold text-foreground">Stock Movements</h1>
        <p className="text-muted-foreground">
          {isManager
            ? "Track all inventory movements across the system"
            : "View your stock movements and transactions"}
        </p>
      </div>

      {/* Info Alert for Non-Managers */}
      {!isManager && (
        <Alert className="bg-blue-500/10 border-blue-500/20">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <AlertDescription className="text-blue-600 dark:text-blue-400 text-sm">
            You're viewing movements where you are involved (performed by you,
            issued to you, or received by you).
          </AlertDescription>
        </Alert>
      )}

      {/* Search and Filters */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4">
            {/* Search Bar */}
            <div className="w-full">
              <Search placeholder="Search by movement #, product, person..." />
            </div>

            {/* Filters Row */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row gap-3">
                <MovementTypeFilter currentType={movementType} />
                <MovementDirectionFilter currentDirection={direction} />
                {hasActiveFilters && <ClearMovementFiltersButton />}
              </div>

              {/* Date Range Filter */}
              <MovementDateFilter startDate={startDate} endDate={endDate} />
            </div>

            {/* Active Filters Display */}
            {hasActiveFilters && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  Active filters:
                </span>
                {movementType !== "all" && (
                  <MovementFilterBadge
                    label="Type"
                    value={movementType}
                    param="movementType"
                  />
                )}
                {direction !== "all" && (
                  <MovementFilterBadge
                    label="Direction"
                    value={direction}
                    param="direction"
                  />
                )}
                {startDate && (
                  <MovementFilterBadge
                    label="From"
                    value={startDate}
                    param="startDate"
                  />
                )}
                {endDate && (
                  <MovementFilterBadge
                    label="To"
                    value={endDate}
                    param="endDate"
                  />
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards - Stream in independently */}
      <Suspense fallback={<MovementStatsSkeleton />}>
        <MovementStatsCards
          filters={filters}
          userId={user.id}
          userRole={user.role}
          isManager={isManager}
        />
      </Suspense>

      {/* Movements Table - Stream in independently */}
      <Suspense fallback={<MovementsTableSkeleton />}>
        <MovementsTableServer
          query={query}
          page={currentPage}
          filters={filters}
          userId={user.id}
          userRole={user.role}
          isManager={isManager}
        />
      </Suspense>

      {/* Pagination - Stream in after table */}
      <Suspense fallback={null}>
        <MovementsPaginationServer
          query={query}
          filters={filters}
          userId={user.id}
          userRole={user.role}
        />
      </Suspense>
    </div>
  );
}

export default MovementsPage;
