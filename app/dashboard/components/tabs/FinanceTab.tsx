import { Suspense } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  AlertCircle,
  FileText,
  Users,
  DollarSign,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Queries
import {
  getFinancialOverview,
  getExpenseBreakdown,
  getRevenueTrend,
  getDashboardAlerts,
} from "@/app/mongodb/queries/erp-dashboard-queries";
import Invoice from "../../../models/invoice";
import EmployeeClaim from "../../../models/employeesClaims";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import mongoose from "mongoose";

const ObjectId = mongoose.Types.ObjectId;

// Charts
import { RevenueTrendChart } from "../RevenueTrendChart";
import { ExpenseBreakdownChart } from "../ExpenseBreakdown";

// Utils
import { formatCurrency } from "@/lib/utils";

// ============================================
// FINANCE TAB
// ============================================
export async function FinanceTab() {
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* KPI Cards - 3 on mobile (scrollable), 3 on desktop */}
      <Suspense fallback={<KPIsSkeleton />}>
        <FinanceKPIs />
      </Suspense>

      {/* Alerts Bar */}
      <Suspense fallback={<AlertsBarSkeleton />}>
        <FinanceAlertsBar />
      </Suspense>

      {/* Charts - Stack on mobile, side by side on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <Suspense fallback={<ChartSkeleton />}>
          <RevenueTrendChartWrapper />
        </Suspense>
        <Suspense fallback={<ChartSkeleton />}>
          <ExpenseBreakdownChartWrapper />
        </Suspense>
      </div>

      {/* Quick Actions + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <Suspense fallback={<ListSkeleton />}>
          <PendingPaymentsCard />
        </Suspense>
        <Suspense fallback={<ListSkeleton />}>
          <PendingClaimsCard />
        </Suspense>
      </div>
    </div>
  );
}

// ============================================
// FINANCE KPIs - Clean, Compact, 3 Cards
// ============================================
async function FinanceKPIs() {
  const data = await getFinancialOverview();

  const kpis = [
    {
      label: "Revenue",
      value: data.revenue.current,
      trend: data.revenue.trend,
      icon: TrendingUp,
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
    },
    {
      label: "Expenses",
      value: data.expenses.current,
      trend: data.expenses.trend,
      icon: TrendingDown,
      color: "text-rose-500",
      bgColor: "bg-rose-500/10",
      invertTrend: true, // Lower is better
    },
    {
      label: "Net Profit",
      value: data.profit.current,
      trend: data.profit.trend,
      icon: DollarSign,
      color: "text-violet-500",
      bgColor: "bg-violet-500/10",
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-4">
      {kpis.map((kpi, index) => (
        <KPICard key={index} {...kpi} />
      ))}
    </div>
  );
}

interface KPICardProps {
  label: string;
  value: number;
  trend?: number;
  icon: any;
  color: string;
  bgColor: string;
  invertTrend?: boolean;
}

function KPICard({
  label,
  value,
  trend,
  icon: Icon,
  color,
  bgColor,
  invertTrend,
}: KPICardProps) {
  const isPositive = invertTrend ? (trend || 0) < 0 : (trend || 0) > 0;
  const TrendIcon = isPositive ? ArrowUpRight : ArrowDownRight;

  return (
    <Card className="p-3 sm:p-4 border-border/40 hover:border-border transition-colors">
      <div className="flex items-center gap-2 mb-2">
        <div className={cn("p-1.5 sm:p-2 rounded-lg", bgColor)}>
          <Icon className={cn("w-3.5 h-3.5 sm:w-4 sm:h-4", color)} />
        </div>
        <span className="text-xs sm:text-sm text-muted-foreground truncate">
          {label}
        </span>
      </div>

      <p className="text-lg sm:text-xl lg:text-2xl font-bold text-foreground tabular-nums">
        {formatCurrency(value)}
      </p>

      {trend !== undefined && (
        <div
          className={cn(
            "flex items-center gap-0.5 mt-1 text-xs",
            isPositive ? "text-emerald-500" : "text-rose-500"
          )}
        >
          <TrendIcon className="w-3 h-3" />
          <span>{Math.abs(trend).toFixed(1)}%</span>
          <span className="text-muted-foreground ml-1 hidden sm:inline">
            vs last month
          </span>
        </div>
      )}
    </Card>
  );
}

// ============================================
// FINANCE ALERTS BAR - Compact, Actionable
// ============================================
async function FinanceAlertsBar() {
  const alerts = await getDashboardAlerts();

  const alertItems = [
    {
      label: "Overdue Invoices",
      count: alerts.overdueInvoices,
      href: "/dashboard/invoices?status=overdue",
      color: "text-rose-500",
      bgColor: "bg-rose-500/10",
    },
    {
      label: "Claims to Pay",
      count: alerts.overdueClaims,
      href: "/dashboard/claims/payments",
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
    },
    {
      label: "Pending Approvals",
      count: (alerts.pendingClaims || 0) + (alerts.pendingRequests || 0),
      href: "/dashboard/approvals",
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    },
  ].filter((item) => item.count > 0);

  if (alertItems.length === 0) {
    return (
      <Card className="p-3 sm:p-4  bg-emerald-500/5 border-emerald-500/20">
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-sm font-medium">All caught up!</span>
          <span className="text-xs text-muted-foreground">
            No pending items
          </span>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-2 sm:p-3 border-border/40">
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
        <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
        <span className="text-xs sm:text-sm text-muted-foreground shrink-0">
          Needs attention:
        </span>

        <div className="flex items-center gap-2">
          {alertItems.map((alert, index) => (
            <Link
              key={index}
              href={alert.href}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap",
                "transition-colors hover:opacity-80",
                alert.bgColor,
                alert.color
              )}
            >
              <span>{alert.count}</span>
              <span className="hidden sm:inline">{alert.label}</span>
              <span className="sm:hidden">{alert.label.split(" ")[0]}</span>
            </Link>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ============================================
// PENDING PAYMENTS CARD - Actionable List
// ============================================
async function PendingPaymentsCard() {
  // Ensure DB connection (critical for serverless cold starts)
  const dbConnect = (await import("@/app/config/dbConnect")).default;
  await dbConnect();

  // Tenant scoping - only show company's invoices
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const invoices = await Invoice.find({
    ...tenantMatch,
    paymentStatus: { $in: ["unpaid", "partial"] },
    dueDate: { $lte: new Date() },
  })
    .sort({ dueDate: 1 })
    .limit(4)
    .lean();

  const getDaysOverdue = (dueDate: Date) => {
    const diff = Date.now() - new Date(dueDate).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  return (
    <Card className="border-border/40">
      <div className="p-3 sm:p-4 border-b border-border/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-rose-500" />
            <h3 className="font-semibold text-sm sm:text-base">
              Overdue Invoices
            </h3>
          </div>
          <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
            <Link href="/dashboard/invoices?status=overdue">
              View all <ChevronRight className="w-3 h-3 ml-1" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="divide-y divide-border/40">
        {invoices.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No overdue invoices
            </p>
          </div>
        ) : (
          invoices.map((invoice: any) => (
            <Link
              key={invoice._id.toString()}
              href={`/dashboard/invoices/${invoice._id}`}
              className="flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">
                  {invoice.invoiceNumber}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {invoice.customer?.name || "Unknown"} •{" "}
                  {getDaysOverdue(invoice.dueDate)}d overdue
                </p>
              </div>
              <div className="text-right shrink-0 ml-3">
                <p className="text-sm font-semibold text-foreground tabular-nums">
                  {formatCurrency(invoice.amountDue)}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs mt-1 hidden sm:inline-flex"
                >
                  Record Payment
                </Button>
              </div>
            </Link>
          ))
        )}
      </div>
    </Card>
  );
}

// ============================================
// PENDING CLAIMS CARD - Actionable List
// ============================================
async function PendingClaimsCard() {
  // Ensure DB connection (critical for serverless cold starts)
  const dbConnect = (await import("@/app/config/dbConnect")).default;
  await dbConnect();

  // Tenant scoping - only show company's claims
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const claims = await EmployeeClaim.find({
    ...tenantMatch,
    status: { $in: ["submitted", "approved"] },
  })
    .sort({ submittedAt: -1 })
    .limit(4)
    .lean();

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      advance_request: "Advance",
      advance_return: "Settlement",
      reimbursement: "Reimburse",
    };
    return labels[type] || type;
  };

  const getStatusColor = (status: string) => {
    return status === "submitted"
      ? "bg-amber-500/10 text-amber-500"
      : "bg-blue-500/10 text-blue-500";
  };

  return (
    <Card className="border-border/40">
      <div className="p-3 sm:p-4 border-b border-border/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-violet-500" />
            <h3 className="font-semibold text-sm sm:text-base">
              Employee Claims
            </h3>
          </div>
          <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
            <Link href="/dashboard/claims">
              View all <ChevronRight className="w-3 h-3 ml-1" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="divide-y divide-border/40">
        {claims.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-sm text-muted-foreground">No pending claims</p>
          </div>
        ) : (
          claims.map((claim: any) => (
            <Link
              key={claim._id.toString()}
              href={`/dashboard/claims/${claim._id}`}
              className="flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground truncate">
                    {claim.employee?.name || "Unknown"}
                  </p>
                  <Badge
                    variant="secondary"
                    className={cn("text-xs", getStatusColor(claim.status))}
                  >
                    {claim.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {getTypeLabel(claim.claimType)} • {claim.claimNumber}
                </p>
              </div>
              <div className="text-right shrink-0 ml-3">
                <p className="text-sm font-semibold text-foreground tabular-nums">
                  {formatCurrency(claim.totalAmount)}
                </p>
                <Button
                  size="sm"
                  className="h-6 text-xs mt-1 hidden sm:inline-flex bg-yellow-500 hover:bg-yellow-600 text-black"
                >
                  {claim.status === "submitted" ? "Approve" : "Pay"}
                </Button>
              </div>
            </Link>
          ))
        )}
      </div>
    </Card>
  );
}

// ============================================
// CHART WRAPPERS
// ============================================
async function RevenueTrendChartWrapper() {
  const data = await getRevenueTrend(6);
  return <RevenueTrendChart data={data} />;
}

async function ExpenseBreakdownChartWrapper() {
  const data = await getExpenseBreakdown();
  console.log("Expense Breakdown Data:", data);
  return <ExpenseBreakdownChart data={data} />;
}

// ============================================
// SKELETONS
// ============================================
function KPIsSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-4">
      {[1, 2, 3].map((i) => (
        <Card key={i} className="p-3 sm:p-4 border-border/40">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-muted animate-pulse" />
            <div className="h-3 w-14 bg-muted animate-pulse rounded" />
          </div>
          <div className="h-6 sm:h-7 w-20 bg-muted animate-pulse rounded" />
          <div className="h-3 w-16 bg-muted animate-pulse rounded mt-1" />
        </Card>
      ))}
    </div>
  );
}

function AlertsBarSkeleton() {
  return (
    <Card className="p-3 border-border/40">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 bg-muted animate-pulse rounded" />
        <div className="h-4 w-24 bg-muted animate-pulse rounded" />
        <div className="h-6 w-20 bg-muted animate-pulse rounded-full" />
      </div>
    </Card>
  );
}

function ChartSkeleton() {
  return (
    <Card className="border-border/40">
      <div className="p-4 border-b border-border/40">
        <div className="h-5 w-32 bg-muted animate-pulse rounded" />
      </div>
      <div className="p-4">
        <div className="h-70 bg-muted/50 animate-pulse rounded-lg" />
      </div>
    </Card>
  );
}

function ListSkeleton() {
  return (
    <Card className="border-border/40">
      <div className="p-4 border-b border-border/40">
        <div className="h-5 w-32 bg-muted animate-pulse rounded" />
      </div>
      <div className="divide-y divide-border/40">
        {[1, 2, 3].map((i) => (
          <div key={i} className="p-3 flex items-center justify-between">
            <div className="space-y-1">
              <div className="h-4 w-24 bg-muted animate-pulse rounded" />
              <div className="h-3 w-32 bg-muted animate-pulse rounded" />
            </div>
            <div className="h-5 w-16 bg-muted animate-pulse rounded" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function FinanceTabSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <KPIsSkeleton />
      <AlertsBarSkeleton />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <ListSkeleton />
        <ListSkeleton />
      </div>
    </div>
  );
}
