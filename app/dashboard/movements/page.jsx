import {
  searchMovements,
  fetchMovementPages,
  getMovementStats,
} from "@/app/mongodb/queries/movement-queries";
import Pagination from "@/components/pagination";
import Search from "@/components/search";
import { auth } from "@/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  MovementTypeFilter,
  MovementDirectionFilter,
  MovementDateFilter,
  ClearMovementFiltersButton,
  MovementFilterBadge,
} from "./components/movementFilters";
import { MovementsTable } from "./components/movementTable";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Activity,
  DollarSign,
  Info,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";

async function MovementsPage(props) {
  const searchParams = await props.searchParams;
  const session = await auth();

  const query = searchParams.query || "";
  const movementType = searchParams.movementType || "all";
  const direction = searchParams.direction || "all";
  const startDate = searchParams.startDate || "";
  const endDate = searchParams.endDate || "";

  const currentPage = Number(searchParams.page) || 1;

  const { user } = session;

  // Build filters object
  const filters = {
    movementType: movementType !== "all" ? movementType : "",
    direction: direction !== "all" ? direction : "",
    startDate,
    endDate,
  };

  // Check if user is admin/manager for full access
  const isManager =
    user?.role === "Admin" ||
    user?.role === "Store Manager" ||
    user?.role === "Manager";

  // Fetch data with role-based filtering
  const [totalPages, movements, stats] = await Promise.all([
    fetchMovementPages(query, filters, user.id, user.role),
    searchMovements(query, currentPage, filters, user.id, user.role),
    getMovementStats(filters, user.id, user.role),
  ]);

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

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Stock In</p>
                <p className="text-2xl font-bold text-green-500">
                  {stats.totalIn}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Qty: {stats.totalQuantityIn}
                </p>
              </div>
              <ArrowDownCircle className="w-8 h-8 text-green-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Value</p>
              <p className="text-sm font-semibold text-green-400">
                {formatCurrency(stats.totalValueIn)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Stock Out</p>
                <p className="text-2xl font-bold text-red-500">
                  {stats.totalOut}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Qty: {stats.totalQuantityOut}
                </p>
              </div>
              <ArrowUpCircle className="w-8 h-8 text-red-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Value</p>
              <p className="text-sm font-semibold text-red-400">
                {formatCurrency(stats.totalValueOut)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Net Movement</p>
                <p
                  className={`text-2xl font-bold ${
                    stats.netQuantity >= 0 ? "text-green-500" : "text-red-500"
                  }`}
                >
                  {stats.netQuantity >= 0 ? "+" : ""}
                  {stats.netQuantity}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Items</p>
              </div>
              <Activity className="w-8 h-8 text-blue-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Net Value</p>
              <p
                className={`text-sm font-semibold ${
                  stats.netValue >= 0 ? "text-green-400" : "text-red-400"
                }`}
              >
                {formatCurrency(stats.netValue)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">
                  {isManager ? "Total" : "My"} Movements
                </p>
                <p className="text-2xl font-bold text-foreground">
                  {stats.totalMovements}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {startDate || endDate ? "Filtered" : "All time"}
                </p>
              </div>
              <DollarSign className="w-8 h-8 text-yellow-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Total Value</p>
              <p className="text-sm font-semibold text-yellow-400">
                {formatCurrency(stats.totalValueIn + stats.totalValueOut)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Movements Table */}
      <MovementsTable movements={movements} isManager={isManager} />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination totalPages={totalPages} />
        </div>
      )}
    </div>
  );
}

export default MovementsPage;
