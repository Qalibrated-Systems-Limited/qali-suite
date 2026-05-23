import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, Clock, AlertTriangle, CheckCircle } from "lucide-react";
import {
  searchCheckouts,
  fetchCheckoutPages,
  getCheckoutStats,
} from "@/app/mongodb/queries/checkout-queries";
import { getExpenseAccountsForDialog } from "@/app/mongodb/queries/accountQueries";
import { CheckoutsTable } from "./checkoutsTable";
import Pagination from "@/components/pagination";

// ============================================
// CHECKOUT STATS CARDS (Async Server Component)
// ============================================

export async function CheckoutStatsCards() {
  const stats = await getCheckoutStats();

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card className="bg-card border-border hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Active</p>
              <p className="text-2xl font-bold text-foreground">
                {stats.active}
              </p>
            </div>
            <Package className="w-8 h-8 text-blue-500" />
          </div>
          <div className="mt-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">Currently out</p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Due Soon</p>
              <p className="text-2xl font-bold text-orange-500">
                {stats.dueSoon}
              </p>
            </div>
            <Clock className="w-8 h-8 text-orange-500" />
          </div>
          <div className="mt-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">Within 3 days</p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Overdue</p>
              <p className="text-2xl font-bold text-red-500">
                {stats.overdue}
              </p>
            </div>
            <AlertTriangle className="w-8 h-8 text-red-500" />
          </div>
          <div className="mt-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">Requires action</p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Returned</p>
              <p className="text-2xl font-bold text-green-500">
                {stats.returned}
              </p>
            </div>
            <CheckCircle className="w-8 h-8 text-green-500" />
          </div>
          <div className="mt-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">Completed</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// CHECKOUT STATS SKELETON
// ============================================

export function CheckoutStatsSkeleton() {
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
              <Skeleton className="h-3 w-20" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================
// CHECKOUTS TABLE SERVER (Async Server Component)
// ============================================

export async function CheckoutsTableServer({
  query,
  page,
  filters,
  canManageCheckouts,
}) {
  const [checkouts, expenseAccounts] = await Promise.all([
    searchCheckouts(query, page, filters),
    getExpenseAccountsForDialog(),
  ]);

  return (
    <CheckoutsTable
      checkouts={checkouts}
      canManageCheckouts={canManageCheckouts}
      expenseAccounts={expenseAccounts}
    />
  );
}

// ============================================
// CHECKOUTS TABLE SKELETON
// ============================================

export function CheckoutsTableSkeleton() {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <div className="border-b bg-muted/50 p-4">
            <div className="flex gap-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-28" />
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
                <Skeleton className="h-4 w-28" />
                <div className="space-y-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-8" />
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
// CHECKOUTS PAGINATION SERVER (Async Server Component)
// ============================================

export async function CheckoutsPaginationServer({ query, filters }) {
  const totalPages = await fetchCheckoutPages(query, filters);

  if (totalPages <= 1) return null;

  return (
    <div className="flex justify-center">
      <Pagination totalPages={totalPages} />
    </div>
  );
}
