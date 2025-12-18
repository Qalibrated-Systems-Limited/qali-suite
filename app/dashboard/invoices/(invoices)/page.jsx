import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  searchInvoices,
  fetchInvoicePages,
  getInvoiceStats,
} from "@/app/mongodb/queries/invoice-queries";
import Pagination from "@/components/pagination";
import Search from "@/components/search";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  PaymentStatusFilter,
  InvoiceStatusFilter,
  InvoiceDateFilter,
  ClearInvoiceFiltersButton,
  InvoiceFilterBadge,
} from "../components/invoice-filters";
import { InvoicesTable } from "../components/Invoicetable";
import { FileText, Plus, CheckCircle, XCircle, Clock } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

async function InvoicesPage(props) {
  const searchParams = await props.searchParams;
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;

  // Check permissions
  if (user.role !== "Admin" && user.role !== "Accountant") {
    return (
      <div className="flex min-h-100 items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Access Denied
          </h2>
          <p className="text-muted-foreground">
            Only Admins and Accountants can view invoices.
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

  // Fetch data in parallel
  const [totalPages, invoices, stats] = await Promise.all([
    fetchInvoicePages(query, filters),
    searchInvoices(query, currentPage, filters),
    getInvoiceStats(filters),
  ]);

  // Check if any filters are active
  const hasActiveFilters =
    paymentStatus !== "all" || status !== "all" || startDate || endDate;


  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Invoices</h1>
          <p className="text-muted-foreground">
            Manage and track all your invoices
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Total Invoices</p>
                <p className="text-2xl font-bold text-foreground">
                  {stats.totalInvoices}
                </p>
              </div>
              <FileText className="w-8 h-8 text-blue-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Total Revenue</p>
              <p className="text-sm font-semibold text-blue-400">
                {formatCurrency(stats.totalRevenue)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Paid</p>
                <p className="text-2xl font-bold text-green-500">
                  {stats.totalPaid}
                </p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Amount Paid</p>
              <p className="text-sm font-semibold text-green-400">
                {formatCurrency(stats.totalAmountPaid)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Unpaid</p>
                <p className="text-2xl font-bold text-red-500">
                  {stats.totalUnpaid}
                </p>
              </div>
              <XCircle className="w-8 h-8 text-red-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Balance Due</p>
              <p className="text-sm font-semibold text-red-400">
                {formatCurrency(stats.balanceDue)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Partial</p>
                <p className="text-2xl font-bold text-orange-500">
                  {stats.totalPartial}
                </p>
              </div>
              <Clock className="w-8 h-8 text-orange-500" />
            </div>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Collection Rate</p>
              <p className="text-sm font-semibold text-orange-400">
                {stats.totalRevenue > 0
                  ? Math.round(
                      (stats.totalAmountPaid / stats.totalRevenue) * 100
                    )
                  : 0}
                %
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

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

      {/* Invoices Table */}
      <InvoicesTable invoices={invoices} />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination totalPages={totalPages} />
        </div>
      )}
    </div>
  );
}

export default InvoicesPage;
