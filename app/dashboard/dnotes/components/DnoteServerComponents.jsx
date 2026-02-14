import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileText,
  PackageCheck,
  TruckIcon,
  Calendar,
  DollarSign,
} from "lucide-react";
import {
  searchDeliveryNotes,
  fetchDeliveryNotePages,
  getDeliveryNotesStats,
} from "@/app/mongodb/queries/dnote-queries";
import { DeliveryNotesTable } from "./DeliveryNoteTable";
import Pagination from "@/components/pagination";
import { formatCurrency } from "@/lib/utils";

// ============================================
// DNOTE STATS CARDS (Async Server Component)
// ============================================

export async function DnoteStatsCards() {
  const stats = await getDeliveryNotesStats();

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Total DNotes</p>
              <p className="text-2xl font-bold text-foreground">
                {stats.total}
              </p>
            </div>
            <FileText className="w-8 h-8 text-yellow-500" />
          </div>
          <div className="mt-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">Total Value</p>
            <p className="text-sm font-semibold text-yellow-400">
              {formatCurrency(stats.salesValue + stats.returnableValue)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Sales</p>
              <p className="text-2xl font-bold text-green-500">
                {stats.sales}
              </p>
            </div>
            <PackageCheck className="w-8 h-8 text-green-500" />
          </div>
          <div className="mt-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">Sales Value</p>
            <p className="text-sm font-semibold text-green-400">
              {formatCurrency(stats.salesValue)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Returnable</p>
              <p className="text-2xl font-bold text-orange-500">
                {stats.returnable}
              </p>
            </div>
            <TruckIcon className="w-8 h-8 text-orange-500" />
          </div>
          <div className="mt-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">Returnable Value</p>
            <p className="text-sm font-semibold text-orange-400">
              {formatCurrency(stats.returnableValue)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">This Month</p>
              <p className="text-2xl font-bold text-blue-500">
                {stats.thisMonth}
              </p>
            </div>
            <Calendar className="w-8 h-8 text-blue-500" />
          </div>
          <div className="mt-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">Month Value</p>
            <p className="text-sm font-semibold text-blue-400">
              {formatCurrency(stats.thisMonthValue)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Avg. Value</p>
              <p className="text-2xl font-bold text-purple-500">
                {stats.total > 0
                  ? formatCurrency(
                      (stats.salesValue + stats.returnableValue) / stats.total
                    )
                  : "KES 0"}
              </p>
            </div>
            <DollarSign className="w-8 h-8 text-purple-500" />
          </div>
          <div className="mt-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">Sales Ratio</p>
            <p className="text-sm font-semibold text-purple-400">
              {stats.total > 0
                ? Math.round((stats.sales / stats.total) * 100)
                : 0}
              %
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// DNOTE STATS SKELETON
// ============================================

export function DnoteStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {[...Array(5)].map((_, index) => (
        <Card key={index} className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-8 w-12" />
              </div>
              <Skeleton className="w-8 h-8 rounded" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <Skeleton className="h-3 w-16 mb-1" />
              <Skeleton className="h-4 w-24" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================
// DNOTES TABLE SERVER (Async Server Component)
// ============================================

export async function DnotesTableServer({ query, page, filters }) {
  const deliveryNotes = await searchDeliveryNotes(query, page, filters);

  return <DeliveryNotesTable deliveryNotes={deliveryNotes} />;
}

// ============================================
// DNOTES TABLE SKELETON
// ============================================

export function DnotesTableSkeleton() {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <div className="border-b bg-muted/50 p-4">
            <div className="flex gap-6">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
            </div>
          </div>
          {[...Array(8)].map((_, index) => (
            <div key={index} className="border-b p-4">
              <div className="flex gap-6 items-center">
                <Skeleton className="h-4 w-16" />
                <div className="space-y-1 flex-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-6 w-16" />
                <Skeleton className="h-4 w-24" />
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
// DNOTES PAGINATION SERVER (Async Server Component)
// ============================================

export async function DnotesPaginationServer({ query, filters }) {
  const totalPages = await fetchDeliveryNotePages(query, filters);

  if (totalPages <= 1) return null;

  return (
    <div className="flex justify-center">
      <Pagination totalPages={totalPages} />
    </div>
  );
}

// ============================================
// PAGINATION SKELETON
// ============================================

export function PaginationSkeleton() {
  return (
    <div className="flex justify-center">
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-9" />
        <Skeleton className="h-9 w-9" />
        <Skeleton className="h-9 w-9" />
        <Skeleton className="h-9 w-9" />
        <Skeleton className="h-9 w-9" />
      </div>
    </div>
  );
}
