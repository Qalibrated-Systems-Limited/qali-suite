import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, TrendingUp, CreditCard, UserCheck } from "lucide-react";
import {
  getPartiesPaginated,
  fetchPartyPages,
  getPartyStats,
} from "@/app/mongodb/queries/partyQueries";
import CustomerListClient from "./CustomerListClient";
import Pagination from "@/components/pagination";
import Search from "@/components/search";
import { formatCurrency } from "@/lib/utils";

// ============================================
// CUSTOMER STATS CARDS (Async Server Component)
// ============================================

export async function CustomerStatsCards() {
  const stats = await getPartyStats();

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 sm:p-4 sm:pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Total Customers
          </CardTitle>
          <Users className="h-4 w-4 text-blue-500" />
        </CardHeader>
        <CardContent className="p-3 pt-0 sm:p-4 sm:pt-0">
          <div className="text-lg sm:text-xl font-bold text-foreground">
            {stats.totalCustomers}
          </div>
          <p className="hidden sm:block text-xs text-muted-foreground mt-1">Active accounts</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 sm:p-4 sm:pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Accounts Receivable
          </CardTitle>
          <TrendingUp className="h-4 w-4 text-green-500" />
        </CardHeader>
        <CardContent className="p-3 pt-0 sm:p-4 sm:pt-0">
          <div className="text-lg sm:text-xl font-bold text-green-600">
            {formatCurrency(stats.totalAR, true)}
          </div>
          <p className="hidden sm:block text-xs text-muted-foreground mt-1">Owed to you</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 sm:p-4 sm:pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            With Balance
          </CardTitle>
          <CreditCard className="h-4 w-4 text-orange-500" />
        </CardHeader>
        <CardContent className="p-3 pt-0 sm:p-4 sm:pt-0">
          <div className="text-lg sm:text-xl font-bold text-orange-500">
            {stats.partiesWithBalance}
          </div>
          <p className="hidden sm:block text-xs text-muted-foreground mt-1">Outstanding</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 sm:p-4 sm:pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            All Parties
          </CardTitle>
          <UserCheck className="h-4 w-4 text-purple-500" />
        </CardHeader>
        <CardContent className="p-3 pt-0 sm:p-4 sm:pt-0">
          <div className="text-lg sm:text-xl font-bold text-purple-500">
            {stats.totalCustomers + stats.totalSuppliers}
          </div>
          <p className="hidden sm:block text-xs text-muted-foreground mt-1">
            {stats.totalSuppliers} suppliers
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// CUSTOMER STATS SKELETON
// ============================================

export function CustomerStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
      {[...Array(4)].map((_, index) => (
        <Card key={index} className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 sm:p-4 sm:pb-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-4" />
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-4 sm:pt-0">
            <Skeleton className="h-8 w-16 mb-1" />
            <Skeleton className="h-3 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================
// CUSTOMERS TABLE SERVER (Async Server Component)
// ============================================

export async function CustomersTableServer({ query, page }) {
  const customers = await getPartiesPaginated(query, page, "customer");

  return <CustomerListClient customers={customers} />;
}

// ============================================
// CUSTOMERS TABLE SKELETON
// ============================================

export function CustomersTableSkeleton() {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <div className="border-b bg-muted/50 p-4">
            <div className="flex gap-6">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
          </div>
          {[...Array(8)].map((_, index) => (
            <div key={index} className="border-b p-4">
              <div className="flex gap-6 items-center">
                <div className="space-y-1 flex-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-6 w-16" />
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
// CUSTOMERS PAGINATION SERVER (Async Server Component)
// ============================================

export async function CustomersPaginationServer({ query }) {
  const totalPages = await fetchPartyPages(query, "customer");

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
