import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ClipboardList,
  Clock,
  CheckCircle,
  Package,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import {
  searchRequests,
  fetchRequestPages,
  getRequestStats,
} from "@/app/mongodb/queries/request-queries";
import { RequestsListWithActions } from "./request";
import Pagination from "@/components/pagination";

// ============================================
// REQUEST STATS CARDS (Async Server Component)
// ============================================

export async function RequestStatsCards({ userId, userRole }) {
  const stats = await getRequestStats();

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Total
          </CardTitle>
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-foreground">
            {stats.total}
          </div>
          <p className="text-xs text-muted-foreground mt-1">All requests</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Pending
          </CardTitle>
          <Clock className="h-4 w-4 text-yellow-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-yellow-500">
            {stats.pending}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Awaiting approval</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Approved
          </CardTitle>
          <CheckCircle className="h-4 w-4 text-blue-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-blue-500">
            {stats.approved}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Ready to fulfill</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Fulfilled
          </CardTitle>
          <Package className="h-4 w-4 text-green-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-500">
            {stats.fulfilled}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Completed</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Urgent
          </CardTitle>
          <AlertTriangle className="h-4 w-4 text-red-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-red-500">
            {stats.urgentCount}
          </div>
          <p className="text-xs text-muted-foreground mt-1">High priority</p>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Overdue
          </CardTitle>
          <XCircle className="h-4 w-4 text-orange-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-orange-500">
            {stats.overdueCount}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Past due date</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// REQUEST STATS SKELETON
// ============================================

export function RequestStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {[...Array(6)].map((_, index) => (
        <Card key={index} className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-4" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-12 mb-1" />
            <Skeleton className="h-3 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================
// REQUESTS TABLE SERVER (Async Server Component)
// ============================================

export async function RequestsTableServer({
  query,
  page,
  filters,
  userId,
  userRole,
}) {
  // Company fetch was for the (now-promoted-to-page) view dialog's PDF
  // button. The detail page loads its own company doc; this list path
  // no longer needs one — saves a round-trip per list render.
  const requests = await searchRequests(query, page, userId, userRole, filters);

  return (
    <RequestsListWithActions
      requests={requests}
      userId={userId}
      userRole={userRole}
    />
  );
}

// ============================================
// REQUESTS TABLE SKELETON
// ============================================

export function RequestsTableSkeleton() {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <div className="border-b bg-muted/50 p-4">
            <div className="flex gap-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
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
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
                <div className="space-y-1">
                  <Skeleton className="h-2 w-20" />
                  <Skeleton className="h-3 w-8" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20" />
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
// REQUESTS PAGINATION SERVER (Async Server Component)
// ============================================

export async function RequestsPaginationServer({
  query,
  filters,
  userId,
  userRole,
}) {
  const totalPages = await fetchRequestPages(query, userId, userRole, filters);

  if (totalPages <= 1) return null;

  return (
    <div className="flex justify-center">
      <Pagination totalPages={totalPages} />
    </div>
  );
}
