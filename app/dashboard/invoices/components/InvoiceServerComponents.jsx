import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, CheckCircle, XCircle, Clock } from "lucide-react";
import {
  searchInvoices,
  fetchInvoicePages,
  getInvoiceStats,
} from "@/app/mongodb/queries/invoice-queries";
import Account from "@/app/models/account";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { InvoicesTable } from "./Invoicetable";
import Pagination from "@/components/pagination";
import { formatCurrency } from "@/lib/utils";

// ============================================
// INVOICE STATS CARDS (Async Server Component)
// ============================================

export async function InvoiceStatsCards({ filters }) {
  const stats = await getInvoiceStats(filters);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
      <Card className="bg-card border-border">
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Total Invoices</p>
              <p className="text-lg sm:text-xl font-bold text-foreground">
                {stats.totalInvoices}
              </p>
            </div>
            <FileText className="w-5 h-5 sm:w-6 sm:h-6 text-blue-500" />
          </div>
          <div className="hidden sm:block mt-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">Total Revenue</p>
            <p className="text-sm font-semibold text-blue-400">
              {formatCurrency(stats.totalRevenue)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Paid</p>
              <p className="text-lg sm:text-xl font-bold text-green-500">
                {stats.totalPaid}
              </p>
            </div>
            <CheckCircle className="w-5 h-5 sm:w-6 sm:h-6 text-green-500" />
          </div>
          <div className="hidden sm:block mt-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">Amount Paid</p>
            <p className="text-sm font-semibold text-green-400">
              {formatCurrency(stats.totalAmountPaid)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Unpaid</p>
              <p className="text-lg sm:text-xl font-bold text-red-500">
                {stats.totalUnpaid}
              </p>
            </div>
            <XCircle className="w-5 h-5 sm:w-6 sm:h-6 text-red-500" />
          </div>
          <div className="hidden sm:block mt-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">Balance Due</p>
            <p className="text-sm font-semibold text-red-400">
              {formatCurrency(stats.balanceDue)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Partial</p>
              <p className="text-lg sm:text-xl font-bold text-orange-500">
                {stats.totalPartial}
              </p>
            </div>
            <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-orange-500" />
          </div>
          <div className="hidden sm:block mt-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">Collection Rate</p>
            <p className="text-sm font-semibold text-orange-400">
              {stats.totalRevenue > 0
                ? Math.round((stats.totalAmountPaid / stats.totalRevenue) * 100)
                : 0}
              %
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// INVOICE STATS SKELETON
// ============================================

export function InvoiceStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
      {[...Array(4)].map((_, index) => (
        <Card key={index} className="bg-card border-border">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-8 w-12" />
              </div>
              <Skeleton className="w-8 h-8 rounded" />
            </div>
            <div className="hidden sm:block mt-2 pt-2 border-t border-border">
              <Skeleton className="h-3 w-16 mb-1" />
              <Skeleton className="h-4 w-24" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================
// INVOICES TABLE SERVER (Async Server Component)
// ============================================

export async function InvoicesTableServer({ query, page, filters }) {
  await dbConnect();
  const { companyId } = await getTenantContext();

  const [invoices, paymentAccounts] = await Promise.all([
    searchInvoices(query, page, filters),
    Account.find({
      companyId,
      accountType: "asset",
      subType: { $in: ["cash", "bank", "mpesa"] },
      isActive: true,
    })
      .select("_id accountName accountCode subType")
      .sort({ accountName: 1 })
      .lean(),
  ]);

  // Serialize payment accounts for client component
  const serializedPaymentAccounts = paymentAccounts.map((acc) => ({
    _id: acc._id.toString(),
    name: acc.accountName,
    code: acc.accountCode,
    subType: acc.subType,
  }));

  return (
    <InvoicesTable
      invoices={invoices}
      paymentAccounts={serializedPaymentAccounts}
    />
  );
}

// ============================================
// INVOICES TABLE SKELETON
// ============================================

export function InvoicesTableSkeleton() {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <div className="border-b bg-muted/50 p-4">
            <div className="flex gap-6">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
          </div>
          {[...Array(8)].map((_, index) => (
            <div key={index} className="border-b p-4">
              <div className="flex gap-6 items-center">
                <Skeleton className="h-4 w-20" />
                <div className="space-y-1 flex-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-6 w-16" />
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
// INVOICES PAGINATION SERVER (Async Server Component)
// ============================================

export async function InvoicesPaginationServer({ query, filters }) {
  const totalPages = await fetchInvoicePages(query, filters);

  if (totalPages <= 1) return null;

  return (
    <div className="flex justify-center">
      <Pagination totalPages={totalPages} />
    </div>
  );
}

// ============================================
// PAGINATION SKELETON
// ============================================

export function PaginationSkeleton() {
  return (
    <div className="flex justify-center">
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-9" />
        <Skeleton className="h-9 w-9" />
        <Skeleton className="h-9 w-9" />
        <Skeleton className="h-9 w-9" />
        <Skeleton className="h-9 w-9" />
      </div>
    </div>
  );
}
