import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, CheckCircle, Layers, Calculator } from "lucide-react";
import {
  getAccountsGrouped,
  getAccountStats,
} from "@/app/mongodb/queries/accountQueries";
import AccountsListClient from "./accountsList";

// ============================================
// ACCOUNT STATS CARDS (Async Server Component)
// ============================================

export async function AccountStatsCards() {
  const stats = await getAccountStats();

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Total Accounts
          </CardTitle>
          <Layers className="h-4 w-4 text-blue-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-foreground">{stats.total}</div>
          <p className="text-xs text-muted-foreground mt-1">Active accounts</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Postable
          </CardTitle>
          <CheckCircle className="h-4 w-4 text-green-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">
            {stats.postableTotal}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Can receive entries</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Asset Accounts
          </CardTitle>
          <FileText className="h-4 w-4 text-blue-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-foreground">
            {stats.byType?.asset?.count || 0}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {stats.byType?.asset?.postable || 0} postable
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Expense Accounts
          </CardTitle>
          <Calculator className="h-4 w-4 text-orange-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-foreground">
            {stats.byType?.expense?.count || 0}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {stats.byType?.expense?.postable || 0} postable
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// ACCOUNT STATS SKELETON
// ============================================

export function AccountStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {[...Array(4)].map((_, index) => (
        <Card key={index} className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-4" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-16 mb-1" />
            <Skeleton className="h-3 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================
// ACCOUNTS LIST SERVER (Async Server Component)
// ============================================

export async function AccountsListServer() {
  const accountsGrouped = await getAccountsGrouped();

  return <AccountsListClient accountsGrouped={accountsGrouped} />;
}

// ============================================
// ACCOUNTS LIST SKELETON
// ============================================

export function AccountsListSkeleton() {
  return (
    <div className="space-y-4">
      {/* Accordion items skeleton */}
      {[...Array(5)].map((_, index) => (
        <div key={index} className="border rounded-lg">
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-4 w-4" />
          </div>
          {index < 2 && (
            <div className="px-4 pb-4">
              <Card>
                <CardContent className="p-0">
                  <div className="border-b p-4">
                    <div className="flex gap-8">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-4 w-16" />
                    </div>
                  </div>
                  {[...Array(4)].map((_, rowIndex) => (
                    <div
                      key={rowIndex}
                      className="border-b p-4 flex items-center gap-8"
                    >
                      <div className="flex items-center gap-2 flex-1">
                        <Skeleton className="h-4 w-4" />
                        <div className="space-y-1">
                          <Skeleton className="h-4 w-16" />
                          <Skeleton className="h-3 w-32" />
                        </div>
                      </div>
                      <Skeleton className="h-5 w-16" />
                      <Skeleton className="h-5 w-12" />
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-5 w-14" />
                      <Skeleton className="h-8 w-8" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
