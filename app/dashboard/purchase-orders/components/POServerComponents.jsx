import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileText,
  Send,
  CheckCircle,
  Clock,
} from "lucide-react";
import {
  searchPurchaseOrders,
  fetchPurchaseOrderPages,
  getPurchaseOrderStats,
} from "@/app/mongodb/queries/purchase-order-queries";
import { POTable } from "./POTable";
import Pagination from "@/components/pagination";
import { formatCurrency } from "@/lib/utils";

// ============================================
// PO STATS CARDS (Async Server Component)
// ============================================

export async function POStatsCards({ filters }) {
  const stats = await getPurchaseOrderStats(filters);

  return (
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
  );
}

// ============================================
// PO STATS SKELETON
// ============================================

export function POStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {[...Array(4)].map((_, index) => (
        <Card key={index} className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-8 w-12" />
              </div>
              <Skeleton className="h-8 w-8 rounded" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <Skeleton className="h-3 w-20 mb-1" />
              <Skeleton className="h-4 w-24" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================
// PO TABLE SERVER (Async Server Component)
// ============================================

export async function POTableServer({ query, page, filters }) {
  const purchaseOrders = await searchPurchaseOrders(query, page, filters);

  return <POTable purchaseOrders={purchaseOrders} />;
}

// ============================================
// PO TABLE SKELETON
// ============================================

export function POTableSkeleton() {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <div className="border-b bg-muted/50 p-4">
            <div className="flex gap-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
          </div>
          {[...Array(8)].map((_, index) => (
            <div
              key={index}
              className="border-b p-4 hover:bg-muted/50 transition-colors"
            >
              <div className="flex gap-4 items-center">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-8 w-8" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// PO PAGINATION SERVER (Async Server Component)
// ============================================

export async function POPaginationServer({ query, filters }) {
  const totalPages = await fetchPurchaseOrderPages(query, filters);

  if (totalPages <= 1) return null;

  return (
    <div className="flex justify-center">
      <Pagination totalPages={totalPages} />
    </div>
  );
}

// ============================================
// PO STATS FOR FILTERS (needed by filters)
// ============================================

export async function POStatsForFilters({ filters }) {
  const stats = await getPurchaseOrderStats(filters);
  return stats;
}
