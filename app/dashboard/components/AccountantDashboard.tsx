import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

// Components
import {
  MetricCard,
  MetricCardsGrid,
  MetricCardsGridSkeleton,
} from "./MetricsCard";
import {
  ChartCard,
  ChartCardSkeleton,
  ChartContainer,
  EmptyChartState,
} from "./ChartCard";
import {
  ActivityCard,
  ActivityItem,
  EmptyState,
  ActivityCardSkeleton,
} from "./ActivityCard";

import { AlertsStrip, AlertsStripSkeleton } from "./AlertsStrip";

// Queries
import {
  getAccountantWorkload,
  getARAgingSummary,
  getAPAgingSummary,
} from "@/app/mongodb/queries/erp-dashboard-queries";
import { getUnallocatedCount, getBankStatements } from "@/app/mongodb/queries/bank-feed-queries";
import { fetchFiscalPeriodStats } from "@/app/mongodb/actions/fiscal-period-actions";
import Invoice from "../../models/invoice";
import Bill from "../../models/bill";
import EmployeeClaim from "../../models/employeesClaims";
import Expense from "../../models/expenses";

// Utils
import { formatCurrency } from "@/lib/utils";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import mongoose from "mongoose";

const ObjectId = mongoose.Types.ObjectId;

// ============================================
// ACCOUNTANT DASHBOARD PAGE
// ============================================
export default async function AccountantDashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;
  const userRole = (user as { role?: string }).role || "Employee";

  // Only accountants and admins
  if (!["SuperAdmin", "Admin", "Accountant"].includes(userRole)) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
          Finance Dashboard
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage receivables, payables, and payments
        </p>
      </div>

      {/* Alerts strip — what needs attention right now */}
      <Suspense fallback={<AlertsStripSkeleton />}>
        <AlertsStrip
          show={[
            "overdueInvoices",
            "pendingClaims",
            "lowStockCount",
            "pendingRequests",
          ]}
        />
      </Suspense>

      {/* Financial Summary */}
      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">
          Today's Focus
        </h2>
        <Suspense fallback={<MetricCardsGridSkeleton count={4} />}>
          <FinancialSummaryCards />
        </Suspense>
      </section>

      {/* Aging Analysis */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <Suspense fallback={<ChartCardSkeleton />}>
          <ARAgingCard />
        </Suspense>
        <Suspense fallback={<ChartCardSkeleton />}>
          <APAgingCard />
        </Suspense>
      </section>

      {/* Payment Queues */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <Suspense fallback={<ActivityCardSkeleton />}>
          <OverdueInvoicesCard />
        </Suspense>
        <Suspense fallback={<ActivityCardSkeleton />}>
          <ClaimsToPayCard />
        </Suspense>
      </section>

      {/* Bank Reconciliation & Period-End */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <Suspense fallback={<ChartCardSkeleton />}>
          <BankReconciliationCard />
        </Suspense>
        <Suspense fallback={<ChartCardSkeleton />}>
          <PeriodEndChecklistCard />
        </Suspense>
      </section>
    </div>
  );
}

// ============================================
// FINANCIAL SUMMARY CARDS
// ============================================
async function FinancialSummaryCards() {
  const data = await getAccountantWorkload();

  return (
    <MetricCardsGrid cols={4}>
      <MetricCard
        title="Overdue Invoices"
        value={data.overdueInvoices.count}
        subtitle={formatCurrency(data.overdueInvoices.total)}
        icon="AlertTriangle"
        iconColor="text-red-500"
        alert={data.overdueInvoices.count > 0}
        href="/dashboard/invoices?status=overdue"
      />
      <MetricCard
        title="Due This Week"
        value={data.dueThisWeek.count}
        subtitle={formatCurrency(data.dueThisWeek.total)}
        icon="Clock"
        iconColor="text-orange-500"
        alert={data.dueThisWeek.count > 5}
        href="/dashboard/invoices?status=due"
      />
      <MetricCard
        title="Claims to Pay"
        value={data.claimsToPay.count}
        subtitle={formatCurrency(data.claimsToPay.total)}
        icon="Users"
        iconColor="text-blue-500"
        alert={data.claimsToPay.count > 0}
        href="/dashboard/claims/payments"
      />
      <MetricCard
        title="Paid Today"
        value={data.paidToday}
        subtitle="Completed"
        icon="CheckCircle"
        iconColor="text-green-500"
      />
    </MetricCardsGrid>
  );
}

// ============================================
// AR AGING CARD
// ============================================
async function ARAgingCard() {
  const rawData = await getARAgingSummary();

  // Convert array to object for easier access
  const data = rawData.reduce(
    (acc, item) => {
      acc[item.bucket] = item.amount;
      return acc;
    },
    {} as Record<string, number>
  );

  const agingBuckets = [
    { label: "Current", value: data["current"] || 0, color: "bg-green-500" },
    { label: "1-30 days", value: data["1-30"] || 0, color: "bg-blue-500" },
    { label: "31-60 days", value: data["31-60"] || 0, color: "bg-yellow-500" },
    { label: "61-90 days", value: data["61-90"] || 0, color: "bg-orange-500" },
    { label: "90+ days", value: data["90+"] || 0, color: "bg-red-500" },
  ];

  const maxValue = Math.max(...agingBuckets.map((b) => b.value), 1);
  const total = agingBuckets.reduce((sum, b) => sum + b.value, 0);

  return (
    <ChartCard
      title="Accounts Receivable Aging"
      subtitle={`${formatCurrency(total)} total outstanding`}
    >
      <div className="space-y-3 pt-2">
        {agingBuckets.map((bucket, index) => (
          <div key={index} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{bucket.label}</span>
              <span className="font-medium text-foreground tabular-nums">
                {formatCurrency(bucket.value)}
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full ${bucket.color} rounded-full transition-all`}
                style={{ width: `${(bucket.value / maxValue) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

// ============================================
// AP AGING CARD
// ============================================
async function APAgingCard() {
  const rawData = await getAPAgingSummary();

  // Convert array to object for easier access
  const data = rawData.reduce(
    (acc, item) => {
      acc[item.bucket] = item.amount;
      return acc;
    },
    {} as Record<string, number>
  );

  const agingBuckets = [
    { label: "Current", value: data["current"] || 0, color: "bg-green-500" },
    { label: "1-30 days", value: data["1-30"] || 0, color: "bg-blue-500" },
    { label: "31-60 days", value: data["31-60"] || 0, color: "bg-yellow-500" },
    { label: "61-90 days", value: data["61-90"] || 0, color: "bg-orange-500" },
    { label: "90+ days", value: data["90+"] || 0, color: "bg-red-500" },
  ];

  const maxValue = Math.max(...agingBuckets.map((b) => b.value), 1);
  const total = agingBuckets.reduce((sum, b) => sum + b.value, 0);

  return (
    <ChartCard
      title="Accounts Payable Aging"
      subtitle={`${formatCurrency(total)} total outstanding`}
    >
      <div className="space-y-3 pt-2">
        {agingBuckets.map((bucket, index) => (
          <div key={index} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{bucket.label}</span>
              <span className="font-medium text-foreground tabular-nums">
                {formatCurrency(bucket.value)}
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full ${bucket.color} rounded-full transition-all`}
                style={{ width: `${(bucket.value / maxValue) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

// ============================================
// OVERDUE INVOICES CARD
// ============================================
async function OverdueInvoicesCard() {
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const now = new Date();
  const invoices = await Invoice.find({
    ...tenantMatch,
    paymentStatus: { $in: ["unpaid", "partial"] },
    dueDate: { $lt: now },
  })
    .sort({ dueDate: 1 })
    .limit(5)
    .select("_id invoiceNumber dueDate amountDue customer.name paymentStatus")
    .lean();

  const getDaysOverdue = (dueDate: Date) => {
    const diff = now.getTime() - new Date(dueDate).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  return (
    <ActivityCard
      title="Overdue Invoices"
      subtitle="Requires collection"
      viewAllHref="/dashboard/invoices?status=overdue"
      isEmpty={invoices.length === 0}
      emptyState={
        <EmptyState title="All caught up!" description="No overdue invoices" />
      }
    >
      <div className="space-y-1">
        {invoices.map((invoice: any) => {
          const daysOverdue = getDaysOverdue(invoice.dueDate);
          return (
            <ActivityItem
              key={invoice._id.toString()}
              title={invoice.invoiceNumber}
              subtitle={`${
                invoice.customer?.name || "Unknown"
              } • ${daysOverdue} days overdue`}
              value={formatCurrency(invoice.amountDue)}
              badge={{
                label: "Overdue",
                className: "text-red-500 bg-red-500/10",
              }}
              href={`/dashboard/invoices/${invoice._id}`}
            />
          );
        })}
      </div>
    </ActivityCard>
  );
}

// ============================================
// CLAIMS TO PAY CARD
// ============================================
async function ClaimsToPayCard() {
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const claims = await EmployeeClaim.find({
    ...tenantMatch,
    status: "approved",
    paidAt: null,
  })
    .sort({ approvedAt: -1 })
    .limit(5)
    .select("_id claimNumber claimType approvedAt totalAmount status employee.name")
    .lean();

  const formatDate = (date: Date) => {
    const now = new Date();
    const diffDays = Math.floor(
      (now.getTime() - new Date(date).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      advance_request: "Advance",
      advance_return: "Settlement",
      reimbursement: "Reimburse",
    };
    return labels[type] || type;
  };

  return (
    <ActivityCard
      title="Claims Awaiting Payment"
      subtitle="Approved, pending disbursement"
      viewAllHref="/dashboard/claims/payments"
      isEmpty={claims.length === 0}
      emptyState={
        <EmptyState title="All paid!" description="No pending claim payments" />
      }
    >
      <div className="space-y-1">
        {claims.map((claim: any) => (
          <ActivityItem
            key={claim._id.toString()}
            title={claim.claimNumber}
            subtitle={`${
              claim.employee?.name || "Unknown"
            } • Approved ${formatDate(claim.approvedAt)}`}
            value={formatCurrency(claim.totalAmount)}
            badge={{
              label: getTypeLabel(claim.claimType),
              className: "text-blue-500 bg-blue-500/10",
            }}
            href={`/dashboard/claims/${claim._id}`}
          />
        ))}
      </div>
    </ActivityCard>
  );
}

// ============================================
// BANK RECONCILIATION STATUS CARD
// ============================================
async function BankReconciliationCard() {
  const [unallocatedCount, statementsResult] = await Promise.all([
    getUnallocatedCount(),
    getBankStatements(1, 5),
  ]);

  const recentStatements = statementsResult.statements;
  const hasStatements = recentStatements.length > 0;

  // Calculate overall progress
  let totalLines = 0;
  let allocatedLines = 0;
  recentStatements.forEach((s: any) => {
    totalLines += s.stats?.totalLines || 0;
    allocatedLines += (s.stats?.allocatedLines || 0) + (s.stats?.excludedLines || 0);
  });

  const progressPercent = totalLines > 0 ? Math.round((allocatedLines / totalLines) * 100) : 0;

  return (
    <ChartCard
      title="Bank Reconciliation"
      subtitle={
        unallocatedCount > 0
          ? `${unallocatedCount} transactions to allocate`
          : "All transactions allocated"
      }
      href="/dashboard/banking"
    >
      {!hasStatements ? (
        <div className="py-8 text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
            <svg
              className="h-6 w-6 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
              />
            </svg>
          </div>
          <p className="text-sm text-muted-foreground">No bank statements imported</p>
          <span className="text-sm text-primary mt-1 inline-block">
            Import your first statement
          </span>
        </div>
      ) : (
        <div className="space-y-4 pt-2">
          {/* Overall Progress */}
          <div>
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-muted-foreground">Overall Progress</span>
              <span className="font-medium">{progressPercent}%</span>
            </div>
            <div className="h-3 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  progressPercent === 100
                    ? "bg-green-500"
                    : progressPercent > 50
                    ? "bg-blue-500"
                    : "bg-orange-500"
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Recent Statements */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Recent Statements
            </p>
            {recentStatements.slice(0, 3).map((statement: any) => {
              const progress = statement.stats?.totalLines
                ? Math.round(
                    ((statement.stats.allocatedLines + statement.stats.excludedLines) /
                      statement.stats.totalLines) *
                      100
                  )
                : 0;
              return (
                <a
                  key={statement._id}
                  href={`/dashboard/banking/${statement._id}`}
                  className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {statement.bankAccountName || "Bank Account"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {statement.stats?.unallocatedLines || 0} unallocated
                    </p>
                  </div>
                  <div className="ml-4 flex items-center gap-2">
                    <span
                      className={`text-xs font-medium ${
                        progress === 100 ? "text-green-600" : "text-orange-600"
                      }`}
                    >
                      {progress}%
                    </span>
                    {progress === 100 && (
                      <span className="flex h-2 w-2 rounded-full bg-green-500" />
                    )}
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      )}
    </ChartCard>
  );
}

// ============================================
// PERIOD-END CHECKLIST CARD
// ============================================
async function PeriodEndChecklistCard() {
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  // Get fiscal period stats
  const periodResult = await fetchFiscalPeriodStats();
  const currentPeriod = periodResult.success ? periodResult.stats?.currentPeriod : null;

  // Get pending items counts in parallel
  const [
    pendingExpenses,
    pendingBills,
    unreconciledCount,
  ] = await Promise.all([
    Expense.countDocuments({ ...tenantMatch, status: "pending" }),
    Bill.countDocuments({ ...tenantMatch, status: "pending" }),
    getUnallocatedCount(),
  ]);

  const checklistItems = [
    {
      label: "Approve pending expenses",
      count: pendingExpenses,
      completed: pendingExpenses === 0,
      href: "/dashboard/expenses?status=pending",
    },
    {
      label: "Approve pending bills",
      count: pendingBills,
      completed: pendingBills === 0,
      href: "/dashboard/bills?status=pending",
    },
    {
      label: "Reconcile bank transactions",
      count: unreconciledCount,
      completed: unreconciledCount === 0,
      href: "/dashboard/banking/unallocated",
    },
    {
      label: "Review trial balance",
      count: null,
      completed: false,
      href: "/dashboard/reports/trial-balance",
    },
    {
      label: "Generate P&L report",
      count: null,
      completed: false,
      href: "/dashboard/reports/profit-loss",
    },
  ];

  const completedCount = checklistItems.filter((item) => item.completed).length;
  const totalCount = checklistItems.length;

  return (
    <ChartCard
      title="Period-End Checklist"
      subtitle={
        currentPeriod
          ? `Current: ${currentPeriod.name}`
          : "No active period"
      }
      href="/dashboard/settings/fiscal-periods"
    >
      <div className="space-y-4 pt-2">
        {/* Progress Summary */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
          <div className="relative h-12 w-12">
            <svg className="h-12 w-12 -rotate-90" viewBox="0 0 36 36">
              <circle
                cx="18"
                cy="18"
                r="16"
                fill="none"
                className="stroke-muted"
                strokeWidth="3"
              />
              <circle
                cx="18"
                cy="18"
                r="16"
                fill="none"
                className="stroke-primary"
                strokeWidth="3"
                strokeDasharray={`${(completedCount / totalCount) * 100} 100`}
                strokeLinecap="round"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold">
              {completedCount}/{totalCount}
            </span>
          </div>
          <div>
            <p className="font-medium text-sm">
              {completedCount === totalCount
                ? "Ready to close!"
                : `${totalCount - completedCount} items remaining`}
            </p>
            <p className="text-xs text-muted-foreground">
              Complete all tasks before period close
            </p>
          </div>
        </div>

        {/* Checklist Items */}
        <div className="space-y-1">
          {checklistItems.map((item, index) => (
            <div
              key={index}
              className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-muted/50 transition-colors"
            >
              <div
                className={`shrink-0 h-5 w-5 rounded-full border-2 flex items-center justify-center ${
                  item.completed
                    ? "bg-green-500 border-green-500"
                    : "border-muted-foreground/30"
                }`}
              >
                {item.completed && (
                  <svg
                    className="h-3 w-3 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </div>
              <span
                className={`flex-1 text-sm ${
                  item.completed ? "text-muted-foreground line-through" : "text-foreground"
                }`}
              >
                {item.label}
              </span>
              {item.count !== null && item.count > 0 && (
                <span className="text-xs font-medium text-orange-600 bg-orange-500/10 px-2 py-0.5 rounded-full">
                  {item.count}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}

