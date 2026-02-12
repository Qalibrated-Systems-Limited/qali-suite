import { Suspense } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Clock,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  FileSpreadsheet,
  Building2,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getAllUnallocatedLines,
  getBankAccounts,
} from "@/app/mongodb/queries/bank-feed-queries";
import { format } from "date-fns";
import UnallocatedLinesClient from "./UnallocatedLinesClient";

// ============================================
// METADATA
// ============================================
export const metadata = {
  title: "Unallocated Transactions | Banking",
  description: "View and allocate pending bank transactions",
};

// ============================================
// STATS HEADER
// ============================================
async function StatsHeader() {
  const { pagination } = await getAllUnallocatedLines({}, 1, 1);

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="rounded-md p-2 bg-amber-500/10">
            <Clock className="h-4 w-4 text-amber-500" />
          </div>
          <span className="text-2xl font-bold">{pagination.total}</span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Pending Transactions
        </p>
        {pagination.total > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            Requires attention
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================
// LINES LIST WRAPPER
// ============================================
async function LinesListWrapper({ searchParams }) {
  const params = await searchParams;
  const page = Number(params?.page) || 1;
  const type = params?.type || "";
  const search = params?.search || "";
  const bankAccountId = params?.bankAccountId || "";

  const [{ lines, pagination }, bankAccounts] = await Promise.all([
    getAllUnallocatedLines({ type, search, bankAccountId }, page, 50),
    getBankAccounts(),
  ]);

  return (
    <UnallocatedLinesClient
      lines={lines}
      pagination={pagination}
      bankAccounts={bankAccounts}
      filters={{ type, search, bankAccountId }}
    />
  );
}

// ============================================
// PAGE COMPONENT
// ============================================
export default async function UnallocatedPage({ searchParams }) {
  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" asChild>
            <Link href="/dashboard/banking">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Unallocated Transactions
            </h1>
            <p className="text-muted-foreground">
              All pending bank transactions across statements
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <Suspense
        fallback={
          <div className="h-24 rounded-lg border bg-muted animate-pulse" />
        }
      >
        <StatsHeader />
      </Suspense>

      {/* Lines List */}
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <LinesListWrapper searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
