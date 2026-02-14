import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Activity,
  DollarSign,
} from "lucide-react";
import {
  searchMovements,
  fetchMovementPages,
  getMovementStats,
} from "@/app/mongodb/queries/movement-queries";
import { MovementsTable } from "./movementTable";
import Pagination from "@/components/pagination";
import { formatCurrency } from "@/lib/utils";

// ============================================
// MOVEMENT STATS CARDS (Async Server Component)
// ============================================

export async function MovementStatsCards({ filters, userId, userRole, isManager }) {
  const stats = await getMovementStats(filters, userId, userRole);
  const { startDate, endDate } = filters;

  return (
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
  );
}

// ============================================
// MOVEMENT STATS SKELETON
// ============================================

export function MovementStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {[...Array(4)].map((_, index) => (
        <Card key={index} className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2 flex-1">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-8 w-12" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-8 w-8 rounded" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <Skeleton className="h-3 w-12 mb-1" />
              <Skeleton className="h-4 w-20" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================
// MOVEMENTS TABLE SERVER (Async Server Component)
// ============================================

export async function MovementsTableServer({
  query,
  page,
  filters,
  userId,
  userRole,
  isManager,
}) {
  const movements = await searchMovements(query, page, filters, userId, userRole);

  return <MovementsTable movements={movements} isManager={isManager} />;
}

// ============================================
// MOVEMENTS TABLE SKELETON
// ============================================

export function MovementsTableSkeleton() {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <div className="border-b bg-muted/50 p-4">
            <div className="flex gap-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
          {[...Array(10)].map((_, index) => (
            <div
              key={index}
              className="border-b p-4 hover:bg-muted/50 transition-colors"
            >
              <div className="flex gap-4 items-center">
                <Skeleton className="h-4 w-28" />
                <div className="space-y-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-28" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// MOVEMENTS PAGINATION SERVER (Async Server Component)
// ============================================

export async function MovementsPaginationServer({ query, filters, userId, userRole }) {
  const totalPages = await fetchMovementPages(query, filters, userId, userRole);

  if (totalPages <= 1) return null;

  return (
    <div className="flex justify-center">
      <Pagination totalPages={totalPages} />
    </div>
  );
}
