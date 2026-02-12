import { auth } from "@/auth";
import { redirect } from "next/navigation";
import {
  searchPurchaseOrders,
  fetchPurchaseOrderPages,
  getPurchaseOrderStats,
} from "@/app/mongodb/queries/purchase-order-queries";
import Pagination from "@/components/pagination";
import Search from "@/components/search";
import { Card, CardContent } from "@/components/ui/card";
import {
  POStatusTabs,
  PODateFilter,
  POQuickFilters,
  ClearPOFiltersButton,
  POFilterBadge,
  MobileFilterSheet,
} from "../components/po-filters";
import { POTable } from "../components/POTable";
import {
  FileText,
  CheckCircle,
  Send,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";

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

  // Check permissions - Admin, Manager, Accountant can view POs
  if (!["Admin", "Manager", "Accountant"].includes(user.role)) {
    return (
      <div className="flex min-h-100 items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Access Denied
          </h2>
          <p className="text-muted-foreground">
            Only Admins, Managers, and Accountants can view purchase orders.
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

  // Fetch data in parallel
  const [totalPages, purchaseOrders, stats] = await Promise.all([
    fetchPurchaseOrderPages(query, filters),
    searchPurchaseOrders(query, currentPage, filters),
    getPurchaseOrderStats(filters),
  ]);

  // Check if any filters are active
  const hasActiveFilters = status !== "all" || startDate || endDate;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Purchase Orders</h1>
        <p className="text-muted-foreground">
          Create and manage supplier purchase orders
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Total POs</p>
                <p className="text-2xl font-bold text-foreground">
                  {stats.total}
                </p>
              </div>
              <FileText className="w-8 h-8 text-blue-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Total Value</p>
              <p className="text-sm font-semibold text-blue-400">
                {formatCurrency(stats.totalValue, true)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Open Orders</p>
                <p className="text-2xl font-bold text-orange-500">
                  {stats.open}
                </p>
              </div>
              <Send className="w-8 h-8 text-orange-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Open Value</p>
              <p className="text-sm font-semibold text-orange-400">
                {formatCurrency(stats.openValue, true)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Received</p>
                <p className="text-2xl font-bold text-green-500">
                  {stats.received}
                </p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Received Value</p>
              <p className="text-sm font-semibold text-green-400">
                {formatCurrency(stats.receivedValue, true)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Partial</p>
                <p className="text-2xl font-bold text-amber-500">
                  {stats.partial}
                </p>
              </div>
              <Clock className="w-8 h-8 text-amber-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Partial Value</p>
              <p className="text-sm font-semibold text-amber-400">
                {formatCurrency(stats.partialValue, true)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

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

      {/* Purchase Orders Table */}
      <POTable purchaseOrders={purchaseOrders} />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination totalPages={totalPages} />
        </div>
      )}
    </div>
  );
}

export default PurchaseOrdersPage;
