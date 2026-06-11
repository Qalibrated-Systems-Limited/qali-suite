// app/(dashboard)/dashboard/bills/page.jsx

import { Suspense } from "react";
import Link from "next/link";
import {
  Plus,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";

import Search from "@/components/search";
import Pagination from "@/components/pagination";
import { formatCurrency } from "@/lib/utils";
import { getBills, getBillsStats } from "@/app/mongodb/queries/bill-queries";
import { auth } from "@/auth";
import { BillActions } from "../components/BillActions";

// ============================================
// METADATA
// ============================================
export const metadata = {
  title: "Bills | ERP",
  description: "Manage supplier bills and accounts payable",
};

// ============================================
// STATUS BADGE COMPONENT
// ============================================
function StatusBadge({ status }) {
  const config = {
    draft: {
      label: "Draft",
      className: "bg-secondary text-secondary-foreground",
      icon: FileText,
    },
    submitted: {
      label: "Pending",
      className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
      icon: Clock,
    },
    approved: {
      label: "Approved",
      className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
      icon: CheckCircle2,
    },
    rejected: {
      label: "Rejected",
      className: "bg-red-500/15 text-red-700 dark:text-red-400",
      icon: XCircle,
    },
    cancelled: {
      label: "Cancelled",
      className: "bg-muted text-muted-foreground",
      icon: XCircle,
    },
  };

  const { label, className, icon: Icon } = config[status] || config.draft;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${className}`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

// ============================================
// PAYMENT STATUS BADGE
// ============================================
function PaymentBadge({ status, isOverdue }) {
  if (status === "paid") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" />
        Paid
      </span>
    );
  }

  if (isOverdue) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-500/15 text-red-700 dark:text-red-400">
        <AlertCircle className="h-3 w-3" />
        Overdue
      </span>
    );
  }

  if (status === "partial") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400">
        <Clock className="h-3 w-3" />
        Partial
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
      <Clock className="h-3 w-3" />
      Unpaid
    </span>
  );
}

// ============================================
// STATS CARDS
// ============================================
async function StatsCards() {
  const stats = await getBillsStats();

  const cards = [
    {
      label: "Pending Approval",
      value: stats.pendingApproval?.count || 0,
      amount: stats.pendingApproval?.total || 0,
      icon: Clock,
      iconColor: "text-amber-500",
      iconBg: "bg-amber-500/10",
    },
    {
      label: "Unpaid Bills",
      value:
        (stats.byPaymentStatus?.unpaid?.count || 0) +
        (stats.byPaymentStatus?.partial?.count || 0),
      amount:
        (stats.byPaymentStatus?.unpaid?.balance || 0) +
        (stats.byPaymentStatus?.partial?.balance || 0),
      icon: Receipt,
      iconColor: "text-blue-500",
      iconBg: "bg-blue-500/10",
    },
    {
      label: "Overdue",
      value: stats.overdue?.count || 0,
      amount: stats.overdue?.total || 0,
      icon: AlertCircle,
      iconColor: "text-red-500",
      iconBg: "bg-red-500/10",
    },
    {
      label: "This Month",
      value: stats.thisMonth?.count || 0,
      amount: stats.thisMonth?.total || 0,
      icon: FileText,
      iconColor: "text-emerald-500",
      iconBg: "bg-emerald-500/10",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-lg border bg-card p-3 sm:p-4">
          <div className="flex items-start justify-between gap-2 mb-2">
            <p className="text-xs font-medium text-muted-foreground leading-none">{card.label}</p>
            <card.icon className={`h-3.5 w-3.5 shrink-0 ${card.iconColor}`} />
          </div>
          <p className="text-xl font-bold tabular-nums tracking-tight leading-none">{card.value}</p>
          <p className="text-xs text-muted-foreground mt-1.5 font-mono">
            {formatCurrency(card.amount, true)}
          </p>
        </div>
      ))}
    </div>
  );
}

// ============================================
// BILLS TABLE (Desktop)
// ============================================
function BillsTable({ bills, userRole }) {
  if (bills.length === 0) {
    return (
      <div className="hidden md:block rounded-lg border bg-card p-8 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <FileText className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mt-4 font-semibold">No bills found</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Create your first bill to get started.
        </p>
        <Button asChild className="mt-4">
          <Link href="/dashboard/bills/create">
            <Plus className="h-4 w-4 mr-2" />
            Create Bill
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="hidden md:block rounded-lg border bg-card overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Bill #</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Supplier</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Date</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Due</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Amount</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground">Status</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground">Payment</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {bills.map((bill) => {
            const isOverdue =
              bill.status === "approved" &&
              bill.paymentStatus !== "paid" &&
              bill.dueDate &&
              new Date(bill.dueDate) < new Date();

            return (
              <tr
                key={bill._id}
                className="hover:bg-muted/50 transition-colors"
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/dashboard/bills/${bill._id}`}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    {bill.billNumber}
                  </Link>
                  {bill.supplierInvoiceNumber && (
                    <p className="text-xs text-muted-foreground">
                      {bill.supplierInvoiceNumber}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2 text-sm font-medium">{bill.supplier?.name}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {bill.billDate
                    ? new Date(bill.billDate).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "2-digit" })
                    : "-"}
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className={isOverdue ? "text-destructive font-medium" : "text-muted-foreground"}>
                    {bill.dueDate
                      ? new Date(bill.dueDate).toLocaleDateString("en-KE", { day: "numeric", month: "short" })
                      : "-"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="text-sm font-medium font-mono">
                    {formatCurrency(bill.amounts?.total || 0)}
                  </span>
                  {bill.amounts?.balance > 0 &&
                    bill.amounts?.balance < bill.amounts?.total && (
                      <p className="text-xs text-muted-foreground font-mono">
                        {formatCurrency(bill.amounts.balance)}
                      </p>
                    )}
                </td>
                <td className="px-3 py-2 text-center">
                  <StatusBadge status={bill.status} />
                </td>
                <td className="px-3 py-2 text-center">
                  {bill.status === "approved" && (
                    <PaymentBadge status={bill.paymentStatus} isOverdue={isOverdue} />
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <BillActions bill={bill} userRole={userRole} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================
// BILLS CARDS (Mobile)
// ============================================
function BillsCards({ bills, userRole }) {
  if (bills.length === 0) {
    return (
      <div className="md:hidden rounded-lg border bg-card p-8 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <FileText className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mt-4 font-semibold">No bills found</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Create your first bill to get started.
        </p>
        <Button asChild className="mt-4">
          <Link href="/dashboard/bills/create">
            <Plus className="h-4 w-4 mr-2" />
            Create Bill
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="md:hidden space-y-3">
      {bills.map((bill) => {
        const isOverdue =
          bill.status === "approved" &&
          bill.paymentStatus !== "paid" &&
          bill.dueDate &&
          new Date(bill.dueDate) < new Date();

        return (
          <div
            key={bill._id}
            className="rounded-lg border bg-card p-3 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <Link href={`/dashboard/bills/${bill._id}`} className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-medium text-primary hover:underline">
                    {bill.billNumber}
                  </span>
                  <StatusBadge status={bill.status} />
                </div>
                <p className="text-sm font-medium mt-0.5 truncate">{bill.supplier?.name}</p>
                {bill.supplierInvoiceNumber && (
                  <p className="text-xs text-muted-foreground">{bill.supplierInvoiceNumber}</p>
                )}
              </Link>
              <div className="flex items-start gap-1.5 shrink-0">
                <div className="text-right">
                  <p className="text-sm font-semibold font-mono">
                    {formatCurrency(bill.amounts?.total || 0)}
                  </p>
                  {bill.amounts?.balance > 0 &&
                    bill.amounts?.balance < bill.amounts?.total && (
                      <p className="text-xs text-muted-foreground font-mono">
                        {formatCurrency(bill.amounts.balance)}
                      </p>
                    )}
                </div>
                <BillActions bill={bill} userRole={userRole} />
              </div>
            </div>

            <div className="flex items-center justify-between mt-2 pt-2 border-t">
              <div className="text-xs text-muted-foreground">
                <span>
                  {bill.billDate
                    ? new Date(bill.billDate).toLocaleDateString("en-KE", { day: "numeric", month: "short" })
                    : "-"}
                </span>
                <span className="mx-1.5">·</span>
                <span className={isOverdue ? "text-destructive font-medium" : ""}>
                  Due {bill.dueDate
                    ? new Date(bill.dueDate).toLocaleDateString("en-KE", { day: "numeric", month: "short" })
                    : "-"}
                </span>
              </div>
              {bill.status === "approved" && (
                <PaymentBadge status={bill.paymentStatus} isOverdue={isOverdue} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================
// BILLS LIST WRAPPER
// ============================================
async function BillsList({ searchParams, userRole }) {
  const params = await searchParams;
  const page = Number(params?.page) || 1;
  const search = params?.search || "";
  const status = params?.status || "";
  const paymentStatus = params?.paymentStatus || "";

  const { bills, pagination } = await getBills({
    page,
    limit: 10,
    search,
    status,
    paymentStatus,
  });

  return (
    <>
      <BillsTable bills={bills} userRole={userRole} />
      <BillsCards bills={bills} userRole={userRole} />

      {pagination.totalPages > 1 && (
        <div className="mt-6">
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.total}
          />
        </div>
      )}
    </>
  );
}

// ============================================
// PAGE COMPONENT
// ============================================
export default async function BillsPage({ searchParams }) {
  const session = await auth();
  const canCreate = ["SuperAdmin", "Admin", "Manager", "Accountant"].includes(
    session?.user?.role,
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Bills</h1>
        {canCreate && (
          <Button asChild size="sm">
            <Link href="/dashboard/bills/create">
              <Plus className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">New Bill</span>
            </Link>
          </Button>
        )}
      </div>

      {/* Stats */}
      <Suspense
        fallback={
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 rounded-lg border bg-muted animate-pulse" />
            ))}
          </div>
        }
      >
        <StatsCards />
      </Suspense>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <Search placeholder="Search bills by number, supplier, or reference..." />
        </div>
      </div>

      {/* Bills List */}
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <BillsList searchParams={searchParams} userRole={session?.user?.role} />
      </Suspense>
    </div>
  );
}
