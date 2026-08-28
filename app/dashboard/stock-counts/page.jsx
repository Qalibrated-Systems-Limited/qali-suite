import { Suspense } from "react";
import Link from "next/link";
import { auth } from "@/auth";
import { canSeeInventoryNav } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, Plus } from "lucide-react";

import {
  StockCountStatsCards,
  StockCountStatsSkeleton,
  StockCountsTableServer,
  StockCountsTableSkeleton,
} from "./components/StockCountServerComponents";

export const metadata = {
  title: "Stock Counts | Inventory",
  description: "Stocktake sheets, variances and posting",
};

const FILTERS = [
  { value: "all", label: "All" },
  { value: "counting", label: "Counting" },
  { value: "review", label: "In review" },
  { value: "posted", label: "Posted" },
];

export default async function StockCountsPage({ searchParams }) {
  const session = await auth();
  const { user } = session;

  // The same gate the sidebar uses, as elsewhere in inventory.
  if (!canSeeInventoryNav(user?.role)) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold tracking-tight">Stock Counts</h1>
        <Alert className="bg-destructive/10 border-destructive/20">
          <Info className="h-4 w-4 text-destructive" />
          <AlertDescription className="text-destructive text-xs sm:text-sm">
            You don&apos;t have permission to access stock counts. Contact your
            administrator.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const params = await searchParams;
  const status = params?.status || "all";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Stock Counts</h1>
          <p className="text-sm text-muted-foreground">
            Freeze the book, count the shelf, post the difference
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/dashboard/stock-counts/create">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Count
          </Link>
        </Button>
      </div>

      <Suspense fallback={<StockCountStatsSkeleton />}>
        <StockCountStatsCards />
      </Suspense>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            asChild
            size="sm"
            variant={status === f.value ? "default" : "outline"}
          >
            <Link
              href={
                f.value === "all"
                  ? "/dashboard/stock-counts"
                  : `/dashboard/stock-counts?status=${f.value}`
              }
            >
              {f.label}
            </Link>
          </Button>
        ))}
      </div>

      <Suspense key={status} fallback={<StockCountsTableSkeleton />}>
        <StockCountsTableServer status={status} />
      </Suspense>
    </div>
  );
}
