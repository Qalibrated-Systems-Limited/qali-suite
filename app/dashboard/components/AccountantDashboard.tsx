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

// Queries
import {
  getAccountantWorkload,
  getARAgingSummary,
  getAPAgingSummary,
} from "@/app/mongodb/queries/erp-dashboard-queries";
import Invoice from "../../models/invoice";
import EmployeeClaim from "../../models/employeesClaims";

// Utils
import { formatCurrency } from "@/lib/utils";

// ============================================
// ACCOUNTANT DASHBOARD PAGE
// ============================================
export default async function AccountantDashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;
  const userRole = user.role || "Employee";

  // Only accountants and admins
  if (!["Admin", "Accountant"].includes(userRole)) {
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
  const data = await getARAgingSummary();

  const agingBuckets = [
    { label: "Current", value: data.current, color: "bg-green-500" },
    { label: "1-30 days", value: data.days0_30, color: "bg-blue-500" },
    { label: "31-60 days", value: data.days31_60, color: "bg-yellow-500" },
    { label: "61-90 days", value: data.days61_90, color: "bg-orange-500" },
    { label: "90+ days", value: data.days90plus, color: "bg-red-500" },
  ];

  const maxValue = Math.max(...agingBuckets.map((b) => b.value), 1);

  return (
    <ChartCard
      title="Accounts Receivable Aging"
      subtitle={`${data.customerCount} customers • ${formatCurrency(
        data.total
      )} total`}
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
  const data = await getAPAgingSummary();

  const agingBuckets = [
    { label: "Current", value: data.current, color: "bg-green-500" },
    { label: "1-30 days", value: data.days0_30, color: "bg-blue-500" },
    { label: "31-60 days", value: data.days31_60, color: "bg-yellow-500" },
    { label: "61-90 days", value: data.days61_90, color: "bg-orange-500" },
    { label: "90+ days", value: data.days90plus, color: "bg-red-500" },
  ];

  const maxValue = Math.max(...agingBuckets.map((b) => b.value), 1);

  return (
    <ChartCard
      title="Accounts Payable Aging"
      subtitle={`${data.supplierCount} suppliers • ${formatCurrency(
        data.total
      )} total`}
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
  const now = new Date();
  const invoices = await Invoice.find({
    paymentStatus: { $in: ["unpaid", "partial"] },
    dueDate: { $lt: now },
  })
    .sort({ dueDate: 1 })
    .limit(5)
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
  const claims = await EmployeeClaim.find({
    status: "approved",
    paidAt: null,
  })
    .sort({ approvedAt: -1 })
    .limit(5)
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
