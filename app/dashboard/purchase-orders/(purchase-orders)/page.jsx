import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canSeePurchasesNav } from "@/lib/permissions";
import { getPurchaseOrderStats } from "@/app/mongodb/queries/purchase-order-queries";
import Search from "@/components/search";
import { Card, CardContent } from "@/components/ui/card";
import {
  POStatusTabs,
  PODateFilter,
  ClearPOFiltersButton,
  POFilterBadge,
  MobileFilterSheet,
} from "../components/po-filters";
import {
  POStatsCards,
  POStatsSkeleton,
  POTableServer,
  POTableSkeleton,
  POPaginationServer,
} from "../components/POServerComponents";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export const metadata = {
  title: "Purchase Orders | ERP",
  description: "Manage supplier purchase orders",
};

async function PurchaseOrdersPage(props) {
  const searchParams = await props.searchParams;
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;

  // Single source of truth — same gate the sidebar uses. CFO, Finance
  // Manager, Procurement Officer, and Store Manager could see the link
  // but the previous inline allowlist bounced them.
  if (!canSeePurchasesNav(user.role)) {
    return (
      <div className="flex min-h-100 items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Access Denied
          </h2>
          <p className="text-muted-foreground">
            You don&apos;t have permission to view purchase orders.
          </p>
        </div>
      </div>
    );
  }

  const query = searchParams.query || "";
  const status = searchParams.status || "all";
  const startDate = searchParams.startDate || "";
  const endDate = searchParams.endDate || "";
  const currentPage = Number(searchParams.page) || 1;

  // Build filters object
  const filters = {
    status: status !== "all" ? status : "",
    startDate,
    endDate,
  };

  // Fetch stats for filter tabs (needed synchronously for tabs)
  const stats = await getPurchaseOrderStats(filters);

  // Check if any filters are active
  const hasActiveFilters = status !== "all" || startDate || endDate;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Purchase Orders</h1>
        <Button asChild size="sm">
          <Link href="/dashboard/purchase-orders/create">
            <Plus className="h-3.5 w-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">New PO</span>
          </Link>
        </Button>
      </div>

      {/* Stats Cards - Stream independently */}
      <Suspense fallback={<POStatsSkeleton />}>
        <POStatsCards filters={filters} />
      </Suspense>

      {/* Search and Filters */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4">
            {/* Search Bar + Mobile Filter Button */}
            <div className="flex gap-2">
              <div className="flex-1">
                <Search placeholder="Search by PO #, supplier..." />
              </div>
              {/* Mobile filter sheet trigger */}
              <MobileFilterSheet
                stats={stats}
                currentStatus={status}
                startDate={startDate}
                endDate={endDate}
                overdueCount={0}
                expiringCount={0}
              />
            </div>

            {/* Status Tabs - hidden on mobile (use sheet instead) */}
            <div className="hidden sm:block">
              <div className="flex flex-wrap items-center gap-3">
                <POStatusTabs currentStatus={status} stats={stats} />
                <ClearPOFiltersButton />
              </div>
            </div>

            {/* Date Range Filter - hidden on mobile */}
            <div className="hidden sm:block">
              <PODateFilter startDate={startDate} endDate={endDate} />
            </div>

            {/* Active Filters Display - hidden on mobile */}
            {hasActiveFilters && (
              <div className="hidden sm:flex flex-wrap gap-2 pt-2 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  Active filters:
                </span>
                {status !== "all" && (
                  <POFilterBadge
                    label="Status"
                    value={status}
                    param="status"
                  />
                )}
                {startDate && (
                  <POFilterBadge
                    label="From"
                    value={startDate}
                    param="startDate"
                  />
                )}
                {endDate && (
                  <POFilterBadge
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

      {/* Purchase Orders Table - Stream independently */}
      <Suspense fallback={<POTableSkeleton />}>
        <POTableServer query={query} page={currentPage} filters={filters} />
      </Suspense>

      {/* Pagination - Stream after table */}
      <Suspense fallback={null}>
        <POPaginationServer query={query} filters={filters} />
      </Suspense>
    </div>
  );
}

export default PurchaseOrdersPage;
