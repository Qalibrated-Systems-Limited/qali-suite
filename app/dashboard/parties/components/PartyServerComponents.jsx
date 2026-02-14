import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Building2, UserCheck, CreditCard, TrendingUp, TrendingDown } from "lucide-react";
import {
  getPartiesPaginated,
  fetchPartyPages,
  getPartyStats,
} from "@/app/mongodb/queries/partyQueries";
import PartyListClient from "./partylistClient";
import Pagination from "@/components/pagination";
import { formatCurrency } from "@/lib/utils";

// ============================================
// PARTY STATS CARDS (Async Server Component)
// ============================================

export async function PartyStatsCards() {
  const stats = await getPartyStats();

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Customers
          </CardTitle>
          <Users className="h-4 w-4 text-blue-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-foreground">
            {stats.totalCustomers}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Active accounts</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Suppliers
          </CardTitle>
          <Building2 className="h-4 w-4 text-green-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-foreground">
            {stats.totalSuppliers}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Active vendors</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Employees
          </CardTitle>
          <UserCheck className="h-4 w-4 text-purple-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-foreground">
            {stats.totalEmployees}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Active staff</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Accounts Receivable
          </CardTitle>
          <TrendingUp className="h-4 w-4 text-green-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">
            {formatCurrency(stats.totalAR, true)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Owed to you</p>
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
          <p className="text-xs text-muted-foreground mt-1">You owe</p>
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
    </div>
  );
}

// ============================================
// PARTY STATS SKELETON
// ============================================

export function PartyStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {[...Array(6)].map((_, index) => (
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
// PARTIES TABLE SERVER (Async Server Component)
// ============================================

export async function PartiesTableServer({ query, page, type }) {
  const parties = await getPartiesPaginated(
    query,
    page,
    type === "all" ? null : type
  );

  return <PartyListClient parties={parties} currentType={type} />;
}

// ============================================
// PARTIES TABLE SKELETON
// ============================================

export function PartiesTableSkeleton() {
  return (
    <div className="space-y-4">
      {/* Tabs skeleton */}
      <div className="border-b border-border">
        <div className="flex gap-4">
          {[...Array(4)].map((_, index) => (
            <Skeleton key={index} className="h-10 w-24" />
          ))}
        </div>
      </div>

      {/* Table skeleton */}
      <Card className="bg-card border-border">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="border-b bg-muted/50 p-4">
              <div className="flex gap-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-32" />
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
                  <div className="space-y-1 flex-1">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-6 w-16" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-8 w-8" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// PARTIES PAGINATION SERVER (Async Server Component)
// ============================================

export async function PartiesPaginationServer({ query, type }) {
  const totalPages = await fetchPartyPages(query, type === "all" ? null : type);

  if (totalPages <= 1) return null;

  return (
    <div className="flex justify-center mt-4">
      <Pagination totalPages={totalPages} />
    </div>
  );
}
