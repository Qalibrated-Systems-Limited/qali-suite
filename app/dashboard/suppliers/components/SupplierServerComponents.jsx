import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Building2, CreditCard, TrendingDown } from "lucide-react";
import {
  getPartiesPaginated,
  fetchPartyPages,
  getPartyStats,
} from "@/app/mongodb/queries/partyQueries";
import SupplierListClient from "./SupplierListClient";
import Pagination from "@/components/pagination";
import { formatCurrency } from "@/lib/utils";

// ============================================
// SUPPLIER STATS CARDS (Async Server Component)
// ============================================

export async function SupplierStatsCards() {
  const stats = await getPartyStats();

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Total Suppliers
          </CardTitle>
          <Building2 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-foreground">
            {stats.totalSuppliers}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Active suppliers</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Accounts Payable
          </CardTitle>
          <TrendingDown className="h-4 w-4 text-red-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-red-500">
            {formatCurrency(stats.totalAP, true)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Amount owed</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            With Balance
          </CardTitle>
          <CreditCard className="h-4 w-4 text-orange-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-orange-500">
            {stats.partiesWithBalance}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Outstanding</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            All Parties
          </CardTitle>
          <Users className="h-4 w-4 text-blue-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-blue-500">
            {stats.totalCustomers + stats.totalSuppliers}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {stats.totalCustomers} customers
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// SUPPLIER STATS SKELETON
// ============================================

export function SupplierStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {[...Array(4)].map((_, index) => (
        <Card key={index} className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-4" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-16 mb-1" />
            <Skeleton className="h-3 w-24" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================
// SUPPLIERS TABLE SERVER (Async Server Component)
// ============================================

export async function SuppliersTableServer({ query, page }) {
  const suppliers = await getPartiesPaginated(query, page, "supplier");

  return <SupplierListClient suppliers={suppliers} />;
}

// ============================================
// SUPPLIERS TABLE SKELETON
// ============================================

export function SuppliersTableSkeleton() {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <div className="border-b bg-muted/50 p-4">
            <div className="flex gap-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
          {[...Array(8)].map((_, index) => (
            <div
              key={index}
              className="border-b p-4 hover:bg-muted/50 transition-colors"
            >
              <div className="flex gap-4 items-center">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-1 flex-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-4 w-28" />
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
// SUPPLIERS PAGINATION SERVER (Async Server Component)
// ============================================

export async function SuppliersPaginationServer({ query }) {
  const totalPages = await fetchPartyPages(query, "supplier");

  if (totalPages <= 1) return null;

  return (
    <div className="flex justify-center">
      <Pagination totalPages={totalPages} />
    </div>
  );
}
