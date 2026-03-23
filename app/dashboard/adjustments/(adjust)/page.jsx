import { Suspense } from "react";
import { auth } from "@/auth";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, Plus } from "lucide-react";

import { AdjustmentsFilters } from "../components/AdjustmentsFilters";
import {
  AdjustmentStatsCards,
  AdjustmentStatsSkeleton,
  AdjustmentsTableServer,
  AdjustmentsTableSkeleton,
} from "../components/AdjustmentServerComponents";

export default async function AdjustmentsPage({ searchParams }) {
  const session = await auth();
  const { user } = session;

  // Check if user has permission
  const hasPermission = ["Admin", "Store Manager", "Accountant"].includes(
    user?.role,
  );

  if (!hasPermission) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="space-y-4">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            Stock Adjustments
          </h1>
          <Alert className="bg-destructive/10 border-destructive/20">
            <Info className="h-4 w-4 text-destructive" />
            <AlertDescription className="text-destructive text-xs sm:text-sm">
              You don't have permission to access stock adjustments. Contact
              your administrator.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const params = await searchParams;
  const currentPage = Number(params?.page) || 1;
  const status = params?.status || "all";
  const adjustmentType = params?.type || "all";
  const search = params?.search || "";

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold tracking-tight">Stock Adjustments</h1>
        <Button asChild size="sm">
          <Link href="/dashboard/adjustments/create">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Adjustment
          </Link>
        </Button>
      </div>

      {/* Stats Cards - Stream independently */}
      <div className="mb-6">
        <Suspense fallback={<AdjustmentStatsSkeleton />}>
          <AdjustmentStatsCards />
        </Suspense>
      </div>

      {/* Filters */}
      <AdjustmentsFilters
        currentStatus={status}
        currentType={adjustmentType}
        currentSearch={search}
      />

      {/* Adjustments Table - Stream independently */}
      <Suspense fallback={<AdjustmentsTableSkeleton />}>
        <AdjustmentsTableServer
          page={currentPage}
          status={status}
          adjustmentType={adjustmentType}
          search={search}
        />
      </Suspense>
    </div>
  );
}
