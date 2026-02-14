import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  FileText,
  TrendingUp,
  TrendingDown,
  Package,
  Plus,
} from "lucide-react";
import {
  getAdjustments,
  getAdjustmentStats,
} from "@/app/mongodb/queries/adjustment-queries";
import { formatCurrency } from "@/lib/utils/erp-utils";
import { formatDate } from "@/lib/pdf";

const ADJUSTMENT_TYPE_LABELS = {
  physical_count: "Physical Count",
  damage: "Damage",
  expiry: "Expiry",
  theft: "Theft/Loss",
  correction: "Correction",
  write_off: "Write Off",
  found: "Found",
  other: "Other",
};

const STATUS_STYLES = {
  draft: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  approved: "bg-green-500/10 text-green-600 border-green-500/20",
  cancelled: "bg-red-500/10 text-red-600 border-red-500/20",
};

// ============================================
// ADJUSTMENT STATS CARDS (Async Server Component)
// ============================================

export async function AdjustmentStatsCards() {
  const stats = await getAdjustmentStats();

  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
            Total Adjustments
          </CardTitle>
          <FileText className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-xl sm:text-2xl font-bold text-foreground">
            {stats.totalAdjustments}
          </div>
          <p className="text-xs text-muted-foreground mt-1">This month</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
            Items Adjusted
          </CardTitle>
          <Package className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-xl sm:text-2xl font-bold text-foreground">
            {stats.totalItems || 0}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Line items</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
            Increased Value
          </CardTitle>
          <TrendingUp className="h-4 w-4 text-green-600" />
        </CardHeader>
        <CardContent>
          <div className="text-xl sm:text-2xl font-bold text-green-600">
            +{formatCurrency(stats.totalIncreaseValue || 0)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Stock added</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
            Decreased Value
          </CardTitle>
          <TrendingDown className="h-4 w-4 text-red-600" />
        </CardHeader>
        <CardContent>
          <div className="text-xl sm:text-2xl font-bold text-red-600">
            -{formatCurrency(stats.totalDecreaseValue || 0)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Stock removed</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// ADJUSTMENT STATS SKELETON
// ============================================

export function AdjustmentStatsSkeleton() {
  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      {[...Array(4)].map((_, index) => (
        <Card key={index} className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-4" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-20 mb-1" />
            <Skeleton className="h-3 w-16" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================
// ADJUSTMENTS TABLE SERVER (Async Server Component)
// ============================================

export async function AdjustmentsTableServer({
  page,
  status,
  adjustmentType,
  search,
}) {
  const { adjustments, pagination } = await getAdjustments({
    page,
    limit: 20,
    status: status !== "all" ? status : null,
    adjustmentType: adjustmentType !== "all" ? adjustmentType : null,
    search: search || null,
  });

  if (adjustments.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-6 sm:p-12">
          <div className="flex flex-col items-center justify-center text-center">
            <FileText className="h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground mb-4" />
            <h3 className="text-base sm:text-lg font-semibold text-foreground mb-2">
              No stock adjustments found
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground max-w-md mb-4">
              {search || status !== "all" || adjustmentType !== "all"
                ? "Try adjusting your filters to find what you're looking for."
                : "Stock adjustments are used to correct inventory discrepancies, record damaged goods, or account for inventory loss/gain."}
            </p>
            {!search && status === "all" && adjustmentType === "all" && (
              <Button
                asChild
                className="bg-yellow-500 hover:bg-yellow-600 text-black"
              >
                <Link href="/dashboard/adjustments/create">
                  <Plus className="h-4 w-4 mr-2" />
                  Create First Adjustment
                </Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-0">
        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left p-4 text-xs font-medium text-muted-foreground">
                  Adjustment #
                </th>
                <th className="text-left p-4 text-xs font-medium text-muted-foreground">
                  Date
                </th>
                <th className="text-left p-4 text-xs font-medium text-muted-foreground">
                  Type
                </th>
                <th className="text-center p-4 text-xs font-medium text-muted-foreground">
                  Items
                </th>
                <th className="text-right p-4 text-xs font-medium text-muted-foreground">
                  <span className="flex items-center justify-end gap-1">
                    <TrendingUp className="h-3 w-3 text-green-600" />
                    Increase
                  </span>
                </th>
                <th className="text-right p-4 text-xs font-medium text-muted-foreground">
                  <span className="flex items-center justify-end gap-1">
                    <TrendingDown className="h-3 w-3 text-red-600" />
                    Decrease
                  </span>
                </th>
                <th className="text-center p-4 text-xs font-medium text-muted-foreground">
                  Status
                </th>
                <th className="text-left p-4 text-xs font-medium text-muted-foreground">
                  Created By
                </th>
              </tr>
            </thead>
            <tbody>
              {adjustments.map((adjustment) => (
                <tr
                  key={adjustment._id}
                  className="border-b border-border hover:bg-muted/30 transition-colors"
                >
                  <td className="p-4">
                    <Link
                      href={`/dashboard/adjustments/${adjustment._id}`}
                      className="text-sm font-medium text-foreground hover:text-yellow-600 transition-colors"
                    >
                      {adjustment.adjustmentNumber}
                    </Link>
                  </td>
                  <td className="p-4 text-sm text-muted-foreground">
                    {formatDate(adjustment.adjustmentDate)}
                  </td>
                  <td className="p-4">
                    <span className="text-sm text-foreground">
                      {ADJUSTMENT_TYPE_LABELS[adjustment.adjustmentType] ||
                        adjustment.adjustmentType}
                    </span>
                  </td>
                  <td className="p-4 text-center">
                    <span className="text-sm text-muted-foreground">
                      {adjustment.lines?.length || 0}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    {adjustment.totalIncreaseValue > 0 ? (
                      <span className="text-sm font-medium text-green-600">
                        +{formatCurrency(adjustment.totalIncreaseValue)}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="p-4 text-right">
                    {adjustment.totalDecreaseValue > 0 ? (
                      <span className="text-sm font-medium text-red-600">
                        -{formatCurrency(adjustment.totalDecreaseValue)}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="p-4 text-center">
                    <Badge
                      variant="outline"
                      className={STATUS_STYLES[adjustment.status]}
                    >
                      {adjustment.status}
                    </Badge>
                  </td>
                  <td className="p-4 text-sm text-muted-foreground">
                    {adjustment.createdBy?.name || "Unknown"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards */}
        <div className="md:hidden divide-y divide-border">
          {adjustments.map((adjustment) => (
            <Link
              key={adjustment._id}
              href={`/dashboard/adjustments/${adjustment._id}`}
              className="block p-4 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {adjustment.adjustmentNumber}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(adjustment.adjustmentDate)}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={STATUS_STYLES[adjustment.status]}
                >
                  {adjustment.status}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {ADJUSTMENT_TYPE_LABELS[adjustment.adjustmentType]} •{" "}
                  {adjustment.lines?.length || 0} items
                </span>
                <div className="flex items-center gap-2">
                  {adjustment.totalIncreaseValue > 0 && (
                    <span className="text-green-600">
                      +{formatCurrency(adjustment.totalIncreaseValue)}
                    </span>
                  )}
                  {adjustment.totalDecreaseValue > 0 && (
                    <span className="text-red-600">
                      -{formatCurrency(adjustment.totalDecreaseValue)}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between p-4 border-t border-border">
            <p className="text-sm text-muted-foreground">
              Showing {(pagination.page - 1) * pagination.limit + 1} to{" "}
              {Math.min(
                pagination.page * pagination.limit,
                pagination.total
              )}{" "}
              of {pagination.total} adjustments
            </p>
            <div className="flex items-center gap-2">
              {pagination.hasPrev && (
                <Button variant="outline" size="sm" asChild>
                  <Link
                    href={`/dashboard/adjustments?page=${pagination.page - 1}${
                      status !== "all" ? `&status=${status}` : ""
                    }${adjustmentType !== "all" ? `&type=${adjustmentType}` : ""}${
                      search ? `&search=${search}` : ""
                    }`}
                  >
                    Previous
                  </Link>
                </Button>
              )}
              {pagination.hasNext && (
                <Button variant="outline" size="sm" asChild>
                  <Link
                    href={`/dashboard/adjustments?page=${pagination.page + 1}${
                      status !== "all" ? `&status=${status}` : ""
                    }${adjustmentType !== "all" ? `&type=${adjustmentType}` : ""}${
                      search ? `&search=${search}` : ""
                    }`}
                  >
                    Next
                  </Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================
// ADJUSTMENTS TABLE SKELETON
// ============================================

export function AdjustmentsTableSkeleton() {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <div className="border-b bg-muted/50 p-4">
            <div className="flex gap-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
          {[...Array(8)].map((_, index) => (
            <div
              key={index}
              className="border-b p-4 hover:bg-muted/50 transition-colors"
            >
              <div className="flex gap-4 items-center">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-8" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
