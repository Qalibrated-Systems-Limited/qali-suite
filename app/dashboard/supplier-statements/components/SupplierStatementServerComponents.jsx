import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Users, AlertTriangle, Clock } from "lucide-react";
import {
  getSuppliersWithBalances,
  getAPAgingSummary,
} from "@/app/mongodb/queries/statement-queries";
import { SupplierStatementGenerator } from "./SupplierStatementGenerator";

// ============================================
// FORMAT CURRENCY HELPER
// ============================================
const formatCurrency = (amount) => {
  return `KES ${Number(amount || 0).toLocaleString("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
};

// ============================================
// SUPPLIER STATS CARDS (Async Server Component)
// ============================================

export async function SupplierStatementStatsCards() {
  const [suppliers, aging] = await Promise.all([
    getSuppliersWithBalances(),
    getAPAgingSummary(),
  ]);

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">Total Suppliers</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{suppliers.length}</div>
          <p className="text-xs text-muted-foreground">Active accounts</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">Total Payable</CardTitle>
          <FileText className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatCurrency(aging.totalOutstanding)}
          </div>
          <p className="text-xs text-muted-foreground">Accounts payable</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">Overdue (30+ Days)</CardTitle>
          <Clock className="h-4 w-4 text-yellow-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-yellow-600">
            {formatCurrency(aging.days30 + aging.days60 + aging.days90 + aging.over90)}
          </div>
          <p className="text-xs text-muted-foreground">Requires attention</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">Critical (90+ Days)</CardTitle>
          <AlertTriangle className="h-4 w-4 text-red-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-red-600">
            {formatCurrency(aging.over90)}
          </div>
          <p className="text-xs text-muted-foreground">Needs immediate action</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// SUPPLIER STATS SKELETON
// ============================================

export function SupplierStatementStatsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      {[...Array(4)].map((_, index) => (
        <Card key={index}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-4" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-20 mb-1" />
            <Skeleton className="h-3 w-24" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================
// AP AGING BREAKDOWN (Async Server Component)
// ============================================

export async function APAgingBreakdown() {
  const aging = await getAPAgingSummary();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">AP Aging Summary</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-5 gap-4">
          <div className="text-center p-4 bg-green-50 dark:bg-green-950 rounded-lg">
            <p className="text-sm text-muted-foreground">Current</p>
            <p className="text-xl font-bold text-green-600">
              {formatCurrency(aging.current)}
            </p>
          </div>
          <div className="text-center p-4 bg-yellow-50 dark:bg-yellow-950 rounded-lg">
            <p className="text-sm text-muted-foreground">1-30 Days</p>
            <p className="text-xl font-bold text-yellow-600">
              {formatCurrency(aging.days30)}
            </p>
          </div>
          <div className="text-center p-4 bg-orange-50 dark:bg-orange-950 rounded-lg">
            <p className="text-sm text-muted-foreground">31-60 Days</p>
            <p className="text-xl font-bold text-orange-600">
              {formatCurrency(aging.days60)}
            </p>
          </div>
          <div className="text-center p-4 bg-red-50 dark:bg-red-950 rounded-lg">
            <p className="text-sm text-muted-foreground">61-90 Days</p>
            <p className="text-xl font-bold text-red-600">
              {formatCurrency(aging.days90)}
            </p>
          </div>
          <div className="text-center p-4 bg-red-100 dark:bg-red-900 rounded-lg">
            <p className="text-sm text-muted-foreground">Over 90 Days</p>
            <p className="text-xl font-bold text-red-700">
              {formatCurrency(aging.over90)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// AP AGING SKELETON
// ============================================

export function APAgingSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-40" />
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-5 gap-4">
          {[...Array(5)].map((_, index) => (
            <div key={index} className="text-center p-4 bg-muted rounded-lg">
              <Skeleton className="h-4 w-16 mx-auto mb-2" />
              <Skeleton className="h-6 w-24 mx-auto" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// STATEMENT GENERATOR SERVER (Async Server Component)
// ============================================

export async function StatementGeneratorServer() {
  const suppliers = await getSuppliersWithBalances();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Generate Statement</CardTitle>
      </CardHeader>
      <CardContent>
        <SupplierStatementGenerator suppliers={suppliers} />
      </CardContent>
    </Card>
  );
}

// ============================================
// STATEMENT GENERATOR SKELETON
// ============================================

export function StatementGeneratorSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-40" />
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Skeleton className="h-4 w-20 mb-2" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div>
              <Skeleton className="h-4 w-20 mb-2" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div>
              <Skeleton className="h-4 w-20 mb-2" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
