import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canSeeSalesNav } from "@/lib/permissions";
import Search from "@/components/search";
import { Card, CardContent } from "@/components/ui/card";
import {
  PaymentStatusFilter,
  InvoiceStatusFilter,
  InvoiceDateFilter,
  ClearInvoiceFiltersButton,
  InvoiceFilterBadge,
} from "../components/invoice-filters";
import {
  InvoiceStatsCards,
  InvoiceStatsSkeleton,
  InvoicesTableServer,
  InvoicesTableSkeleton,
  InvoicesPaginationServer,
  PaginationSkeleton,
} from "../components/InvoiceServerComponents";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

async function InvoicesPage(props) {
  const searchParams = await props.searchParams;
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;

  // Single source of truth — same gate the sidebar uses to surface the
  // link. Manager and Sales Manager could see the link but the previous
  // inline allowlist bounced them.
  if (!canSeeSalesNav(user.role)) {
    return (
      <div className="flex min-h-100 items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Access Denied
          </h2>
          <p className="text-muted-foreground">
            You don&apos;t have permission to view invoices.
          </p>
        </div>
      </div>
    );
  }

  const query = searchParams.query || "";
  const paymentStatus = searchParams.paymentStatus || "all";
  const status = searchParams.status || "all";
  const startDate = searchParams.startDate || "";
  const endDate = searchParams.endDate || "";
  const currentPage = Number(searchParams.page) || 1;

  // Build filters object
  const filters = {
    paymentStatus: paymentStatus !== "all" ? paymentStatus : "",
    status: status !== "all" ? status : "",
    startDate,
    endDate,
  };

  // Check if any filters are active
  const hasActiveFilters =
    paymentStatus !== "all" || status !== "all" || startDate || endDate;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Invoices</h1>
        <Button asChild size="sm">
          <Link href="/dashboard/invoices/create">
            <Plus className="h-3.5 w-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">New Invoice</span>
          </Link>
        </Button>
      </div>

      {/* Stats Cards - Stream independently */}
      <Suspense fallback={<InvoiceStatsSkeleton />}>
        <InvoiceStatsCards filters={filters} />
      </Suspense>

      {/* Search and Filters */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4">
            {/* Search Bar */}
            <div className="w-full">
              <Search placeholder="Search by invoice #, customer..." />
            </div>

            {/* Filters Row */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row gap-3">
                <PaymentStatusFilter currentStatus={paymentStatus} />
                <InvoiceStatusFilter currentStatus={status} />
                {hasActiveFilters && <ClearInvoiceFiltersButton />}
              </div>

              {/* Date Range Filter */}
              <InvoiceDateFilter startDate={startDate} endDate={endDate} />
            </div>

            {/* Active Filters Display */}
            {hasActiveFilters && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  Active filters:
                </span>
                {paymentStatus !== "all" && (
                  <InvoiceFilterBadge
                    label="Payment"
                    value={paymentStatus}
                    param="paymentStatus"
                  />
                )}
                {status !== "all" && (
                  <InvoiceFilterBadge
                    label="Status"
                    value={status}
                    param="status"
                  />
                )}
                {startDate && (
                  <InvoiceFilterBadge
                    label="From"
                    value={startDate}
                    param="startDate"
                  />
                )}
                {endDate && (
                  <InvoiceFilterBadge
                    label="To"
                    value={endDate}
                    param="endDate"
                  />
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Invoices Table - Stream independently */}
      <Suspense fallback={<InvoicesTableSkeleton />}>
        <InvoicesTableServer query={query} page={currentPage} filters={filters} />
      </Suspense>

      {/* Pagination - Stream independently */}
      <Suspense fallback={<PaginationSkeleton />}>
        <InvoicesPaginationServer query={query} filters={filters} />
      </Suspense>
    </div>
  );
}

export default InvoicesPage;
