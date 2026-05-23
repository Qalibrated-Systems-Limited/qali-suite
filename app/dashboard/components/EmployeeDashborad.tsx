import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

// Components
import {
  MetricCard,
  MetricCardsGrid,
  MetricCardsGridSkeleton,
} from "./MetricsCard";
import {
  ActivityCard,
  ActivityItem,
  EmptyState,
  ActivityCardSkeleton,
} from "./ActivityCard";
// Icons
import { Wallet, FileText, CheckCircle, Plus, Calendar, Receipt } from "lucide-react";

// Queries
import {
  getEmployeeSummary,
  getEmployeeFinancialSummary,
} from "@/app/mongodb/queries/erp-dashboard-queries";
import MyHRStrip from "./MyHRStrip";
import { MyAlertsStrip, MyAlertsStripSkeleton } from "./MyAlertsStrip";
import EmployeeClaim from "../../models/employeesClaims";
import { StockRequest } from "../../models/requests";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";

// Utils
import { formatCurrency } from "@/lib/utils";

// ============================================
// EMPLOYEE DASHBOARD PAGE
// ============================================
export default async function EmployeeDashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;
  const userName = user.name?.split(" ")[0] || "there";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-foreground tracking-tight">
          Welcome back, {userName}
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Your personal dashboard
        </p>
      </div>

      {/* Personal alerts strip — claims, items I have, leave */}
      <Suspense fallback={<MyAlertsStripSkeleton />}>
        <MyAlertsStrip userId={user.id} />
      </Suspense>

      {/* Quick Actions */}
      <section>
        <h2 className="text-xs font-medium text-muted-foreground mb-2">
          Quick Actions
        </h2>
        <QuickActionsGrid />
      </section>

      {/* My Stats */}
      <section>
        <h2 className="text-xs font-medium text-muted-foreground mb-2">
          My Overview
        </h2>
        <Suspense fallback={<MetricCardsGridSkeleton count={4} />}>
          <EmployeeStatsCards userId={user.id} />
        </Suspense>
      </section>

      {/* HR Section */}
      <section>
        <h2 className="text-xs font-medium text-muted-foreground mb-2">
          My HR
        </h2>
        <MyHRStrip />
      </section>

      {/* Recent Activity */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
        <Suspense fallback={<ActivityCardSkeleton />}>
          <MyRecentClaimsCard userId={user.id} />
        </Suspense>
        <Suspense fallback={<ActivityCardSkeleton />}>
          <MyRecentRequestsCard userId={user.id} />
        </Suspense>
      </section>
    </div>
  );
}

// ============================================
// QUICK ACTIONS GRID
// ============================================
function QuickActionsGrid() {
  const actions = [
    {
      title: "Request Leave",
      description: "Annual, sick, or other leave",
      href: "/dashboard/hr/leave/create",
      icon: Calendar,
      color: "bg-teal-600 hover:bg-teal-700 text-white dark:bg-teal-500 dark:hover:bg-teal-600",
    },
    {
      title: "Request Advance",
      description: "For travel or expenses",
      href: "/dashboard/claims/create?type=advance",
      icon: Wallet,
      color: "bg-card hover:bg-accent border border-border",
    },
    {
      title: "Submit Reimbursement",
      description: "Get expenses back",
      href: "/dashboard/claims/create?type=reimbursement",
      icon: FileText,
      color: "bg-card hover:bg-accent border border-border",
    },
    {
      title: "My Payslips",
      description: "View salary statements",
      href: "/dashboard/hr/my-payslips",
      icon: Receipt,
      color: "bg-card hover:bg-accent border border-border",
    },
    {
      title: "Request Stock",
      description: "Request items from store",
      href: "/dashboard/requests/create",
      icon: Plus,
      color: "bg-card hover:bg-accent border border-border",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
      {actions.map((action, index) => (
        <Link
          key={index}
          href={action.href}
          className={`flex items-center gap-2.5 p-3 rounded-lg transition-all ${action.color}`}
        >
          <div className="shrink-0">
            <action.icon className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-xs leading-tight">{action.title}</p>
            <p className="text-xs opacity-60 truncate">{action.description}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}

// ============================================
// EMPLOYEE STATS CARDS
// ============================================
async function EmployeeStatsCards({ userId }: { userId: string }) {
  const [summary, financial] = await Promise.all([
    getEmployeeSummary(userId),
    getEmployeeFinancialSummary(userId),
  ]);

  const totalClaims = summary.pendingClaims + summary.approvedClaims + summary.paidClaims;

  return (
    <MetricCardsGrid cols={4}>
      <MetricCard
        title="My Claims"
        value={totalClaims}
        subtitle="Total submitted"
        icon="FileText"
        iconColor="text-primary"
        href="/dashboard/my-claims"
      />
      <MetricCard
        title="Pending"
        value={summary.pendingClaims}
        subtitle="Awaiting review"
        icon="Clock"
        iconColor="text-orange-500"
        alert={summary.pendingClaims > 0}
        href="/dashboard/my-claims?status=submitted"
      />
      <MetricCard
        title="Advances"
        value={formatCurrency(financial.advancesGiven)}
        subtitle="To settle"
        icon="Wallet"
        iconColor="text-purple-500"
        alert={financial.advancesGiven > 0}
      />
      <MetricCard
        title="Reimbursed"
        value={formatCurrency(financial.reimbursedMTD)}
        subtitle="This month"
        icon="CheckCircle"
        iconColor="text-green-500"
      />
    </MetricCardsGrid>
  );
}

// ============================================
// MY RECENT CLAIMS
// ============================================
async function MyRecentClaimsCard({ userId }: { userId: string }) {
  const { companyId, isSuperAdmin } = await getTenantContext();
  const claims = await EmployeeClaim.find(
    withTenantScope({ "employee.userId": userId }, companyId, isSuperAdmin),
  )
    .sort({ createdAt: -1 })
    .limit(5)
    .select(
      "claimNumber claimType status totalAmount createdAt employee.name advanceDetails.destination",
    )
    .lean();

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      draft: "text-gray-500 bg-gray-500/10",
      submitted: "text-orange-500 bg-orange-500/10",
      approved: "text-blue-500 bg-blue-500/10",
      rejected: "text-red-500 bg-red-500/10",
      paid: "text-green-500 bg-green-500/10",
    };
    return colors[status] || "text-muted-foreground";
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      advance_request: "Advance",
      advance_return: "Settlement",
      reimbursement: "Reimburse",
    };
    return labels[type] || type;
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - new Date(date).getTime();
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  return (
    <ActivityCard
      title="My Claims"
      subtitle="Recent submissions"
      viewAllHref="/dashboard/my-claims"
      isEmpty={claims.length === 0}
      emptyState={
        <EmptyState
          title="No claims yet"
          description="Submit your first claim to get started"
          action={{
            label: "Create Claim",
            href: "/dashboard/claims/create",
          }}
        />
      }
    >
      <div className="space-y-1">
        {claims.map((claim: any) => (
          <ActivityItem
            key={claim._id.toString()}
            title={claim.claimNumber}
            subtitle={`${getTypeLabel(claim.claimType)} • ${formatDate(
              claim.createdAt
            )}`}
            value={formatCurrency(claim.totalAmount)}
            badge={{
              label: claim.status,
              className: getStatusColor(claim.status),
            }}
            href={`/dashboard/claims/${claim._id}`}
          />
        ))}
      </div>
    </ActivityCard>
  );
}

// ============================================
// MY RECENT REQUESTS
// ============================================
async function MyRecentRequestsCard({ userId }: { userId: string }) {
  const { companyId, isSuperAdmin } = await getTenantContext();
  const requests = await StockRequest.find(
    withTenantScope({ "requester.userId": userId }, companyId, isSuperAdmin),
  )
    .sort({ createdAt: -1 })
    .limit(5)
    .select("requestNumber status priority requestType items totalValue createdAt customer.name")
    .lean();

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: "text-orange-500 bg-orange-500/10",
      approved: "text-green-500 bg-green-500/10",
      rejected: "text-red-500 bg-red-500/10",
      completed: "text-blue-500 bg-blue-500/10",
    };
    return colors[status] || "text-muted-foreground";
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - new Date(date).getTime();
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  return (
    <ActivityCard
      title="My Requests"
      subtitle="Stock requests"
      viewAllHref="/dashboard/my-requests"
      isEmpty={requests.length === 0}
      emptyState={
        <EmptyState
          title="No requests yet"
          description="Request stock items when needed"
          action={{
            label: "Create Request",
            href: "/dashboard/requests/create",
          }}
        />
      }
    >
      <div className="space-y-1">
        {requests.map((request: any) => (
          <ActivityItem
            key={request._id.toString()}
            title={request.requestNumber}
            subtitle={`${request.items?.length || 0} items • ${formatDate(
              request.createdAt
            )}`}
            badge={{
              label: request.status,
              className: getStatusColor(request.status),
            }}
            href={`/dashboard/requests/${request._id}`}
          />
        ))}
      </div>
    </ActivityCard>
  );
}
