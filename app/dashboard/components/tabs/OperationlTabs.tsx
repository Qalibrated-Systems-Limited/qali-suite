import { Suspense } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Users,
  Clock,
  CheckCircle,
  XCircle,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Queries
import { StockRequest } from "../../../models/requests";
import EmployeeClaim from "../../../models/employeesClaims";

// Tenant Scoping
import { getTenantContext } from "@/lib/utils/tenant-utils";
import mongoose from "mongoose";

const ObjectId = mongoose.Types.ObjectId;

// Utils
import { formatCurrency } from "@/lib/utils";
import { ActivityCardSkeleton } from "../ActivityCard";

// ============================================
// OPERATIONS TAB
// ============================================
export async function OperationsTab() {
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Quick Stats */}
      <Suspense fallback={<StatsSkeleton />}>
        <OperationsStats />
      </Suspense>

      {/* Quick Actions */}
      <QuickActionsBar />

      {/* Pending Items */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <Suspense fallback={<ListSkeleton />}>
          <PendingRequestsCard />
        </Suspense>
        <Suspense fallback={<ListSkeleton />}>
          <PendingClaimsCard />
        </Suspense>
      </div>

      {/* Recent Activity */}
      <Suspense fallback={<ListSkeleton />}>
        <RecentActivityCard />
      </Suspense>
    </div>
  );
}

// ============================================
// OPERATIONS STATS
// ============================================
async function OperationsStats() {
  // Tenant scoping - only show company's data
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [pendingRequests, pendingClaims, todayApproved, todayRejected] =
    await Promise.all([
      StockRequest.countDocuments({ ...tenantMatch, status: "pending" }),
      EmployeeClaim.countDocuments({ ...tenantMatch, status: "submitted" }),
      StockRequest.countDocuments({
        ...tenantMatch,
        status: "approved",
        updatedAt: { $gte: todayStart },
      }),
      StockRequest.countDocuments({
        ...tenantMatch,
        status: "rejected",
        updatedAt: { $gte: todayStart },
      }),
    ]);

  const stats = [
    {
      label: "Pending",
      value: pendingRequests + pendingClaims,
      subtext: "awaiting review",
      icon: Clock,
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
      alert: pendingRequests + pendingClaims > 0,
    },
    {
      label: "Approved Today",
      value: todayApproved,
      subtext: "items",
      icon: CheckCircle,
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
    },
    {
      label: "Rejected Today",
      value: todayRejected,
      subtext: "items",
      icon: XCircle,
      color: "text-rose-500",
      bgColor: "bg-rose-500/10",
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-4">
      {stats.map((stat, index) => (
        <Card
          key={index}
          className={cn(
            "p-3 sm:p-4 border-border/40",
            stat.alert && "border-amber-500/30"
          )}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className={cn("p-1.5 sm:p-2 rounded-lg", stat.bgColor)}>
              <stat.icon
                className={cn("w-3.5 h-3.5 sm:w-4 sm:h-4", stat.color)}
              />
            </div>
            <span className="text-xs sm:text-sm text-muted-foreground truncate">
              {stat.label}
            </span>
            {stat.alert && (
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            )}
          </div>

          <p className="text-lg sm:text-xl lg:text-2xl font-bold text-foreground tabular-nums">
            {stat.value}
          </p>

          <p className="text-xs text-muted-foreground mt-0.5">{stat.subtext}</p>
        </Card>
      ))}
    </div>
  );
}

// ============================================
// QUICK ACTIONS BAR
// ============================================
function QuickActionsBar() {
  const actions = [
    {
      label: "New Request",
      href: "/dashboard/requests/create",
      icon: FileText,
      color: "bg-blue-500 hover:bg-blue-600 text-white",
    },
    {
      label: "New Claim",
      href: "/dashboard/claims/create",
      icon: Users,
      color: "bg-violet-500 hover:bg-violet-600 text-white",
    },
    {
      label: "Approve All",
      href: "/dashboard/approvals",
      icon: CheckCircle,
      color: "bg-yellow-500 hover:bg-yellow-600 text-black",
    },
  ];

  return (
    <Card className="p-2 sm:p-3 border-border/40">
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
        <span className="text-xs sm:text-sm text-muted-foreground shrink-0 pl-1">
          Quick:
        </span>
        {actions.map((action, index) => (
          <Button
            key={index}
            size="sm"
            asChild
            className={cn("h-7 sm:h-8 text-xs shrink-0", action.color)}
          >
            <Link href={action.href}>
              <action.icon className="w-3 h-3 mr-1" />
              {action.label}
            </Link>
          </Button>
        ))}
      </div>
    </Card>
  );
}

// ============================================
// PENDING REQUESTS CARD
// ============================================
async function PendingRequestsCard() {
  // Tenant scoping - only show company's requests
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const requests = await StockRequest.find({ ...tenantMatch, status: "pending" })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  const getPriorityColor = (priority: string) => {
    const colors: Record<string, string> = {
      urgent: "bg-rose-500/10 text-rose-500",
      high: "bg-amber-500/10 text-amber-500",
      normal: "bg-blue-500/10 text-blue-500",
      low: "bg-muted text-muted-foreground",
    };
    return colors[priority] || colors.normal;
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - new Date(date).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <Card className="border-border/40">
      <div className="p-3 sm:p-4 border-b border-border/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-500" />
            <h3 className="font-semibold text-sm sm:text-base">
              Stock Requests
            </h3>
            {requests.length > 0 && (
              <Badge
                variant="secondary"
                className="bg-blue-500/10 text-blue-500 text-xs"
              >
                {requests.length}
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
            <Link href="/dashboard/requests?status=pending">
              View all <ChevronRight className="w-3 h-3 ml-1" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="divide-y divide-border/40">
        {requests.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No pending requests
            </p>
          </div>
        ) : (
          requests.map((request: any) => (
            <div
              key={request._id.toString()}
              className="flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground truncate">
                    {request.requestNumber}
                  </p>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "text-xs",
                      getPriorityColor(request.priority)
                    )}
                  >
                    {request.priority}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {request.requester?.name || "Unknown"} •{" "}
                  {request.items?.length || 0} items •{" "}
                  {formatDate(request.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs text-rose-500 border-rose-500/30 hover:bg-rose-500/10"
                >
                  <XCircle className="w-3 h-3" />
                  <span className="hidden sm:inline ml-1">Reject</span>
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs bg-emerald-500 hover:bg-emerald-600"
                >
                  <CheckCircle className="w-3 h-3" />
                  <span className="hidden sm:inline ml-1">Approve</span>
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// ============================================
// PENDING CLAIMS CARD
// ============================================
async function PendingClaimsCard() {
  // Tenant scoping - only show company's claims
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const claims = await EmployeeClaim.find({ ...tenantMatch, status: "submitted" })
    .sort({ submittedAt: -1 })
    .limit(5)
    .lean();

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      advance_request: "Advance",
      advance_return: "Settlement",
      reimbursement: "Reimburse",
    };
    return labels[type] || type;
  };

  const getTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      advance_request: "bg-blue-500/10 text-blue-500",
      advance_return: "bg-violet-500/10 text-violet-500",
      reimbursement: "bg-emerald-500/10 text-emerald-500",
    };
    return colors[type] || "bg-muted text-muted-foreground";
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - new Date(date).getTime();
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
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
            {claims.length > 0 && (
              <Badge
                variant="secondary"
                className="bg-violet-500/10 text-violet-500 text-xs"
              >
                {claims.length}
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
            <Link href="/dashboard/claims?status=submitted">
              View all <ChevronRight className="w-3 h-3 ml-1" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="divide-y divide-border/40">
        {claims.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No pending claims
            </p>
          </div>
        ) : (
          claims.map((claim: any) => (
            <div
              key={claim._id.toString()}
              className="flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground truncate">
                    {claim.employee?.name || "Unknown"}
                  </p>
                  <Badge
                    variant="secondary"
                    className={cn("text-xs", getTypeColor(claim.claimType))}
                  >
                    {getTypeLabel(claim.claimType)}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {claim.claimNumber} • {formatCurrency(claim.totalAmount)} •{" "}
                  {formatDate(claim.submittedAt)}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs text-rose-500 border-rose-500/30 hover:bg-rose-500/10"
                >
                  <XCircle className="w-3 h-3" />
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs bg-yellow-500 hover:bg-yellow-600 text-black"
                >
                  <CheckCircle className="w-3 h-3" />
                  <span className="hidden sm:inline ml-1">Approve</span>
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// ============================================
// RECENT ACTIVITY CARD
// ============================================
async function RecentActivityCard() {
  // Tenant scoping - only show company's activity
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const [recentRequests, recentClaims] = await Promise.all([
    StockRequest.find({ ...tenantMatch, status: { $in: ["approved", "rejected"] } })
      .sort({ updatedAt: -1 })
      .limit(3)
      .lean(),
    EmployeeClaim.find({ ...tenantMatch, status: { $in: ["approved", "rejected", "paid"] } })
      .sort({ updatedAt: -1 })
      .limit(3)
      .lean(),
  ]);

  // Combine and sort
  const activities = [
    ...recentRequests.map((r: any) => ({
      type: "request",
      id: r._id.toString(),
      title: r.requestNumber,
      subtitle: r.requester?.name || "Unknown",
      status: r.status,
      date: r.updatedAt,
    })),
    ...recentClaims.map((c: any) => ({
      type: "claim",
      id: c._id.toString(),
      title: c.claimNumber,
      subtitle: c.employee?.name || "Unknown",
      status: c.status,
      date: c.updatedAt,
    })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "approved":
      case "paid":
        return <CheckCircle className="w-3 h-3 text-emerald-500" />;
      case "rejected":
        return <XCircle className="w-3 h-3 text-rose-500" />;
      default:
        return <Clock className="w-3 h-3 text-muted-foreground" />;
    }
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - new Date(date).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  return (
    <Card className="border-border/40">
      <div className="p-3 sm:p-4 border-b border-border/40">
        <h3 className="font-semibold text-sm sm:text-base">Recent Activity</h3>
      </div>

      <div className="divide-y divide-border/40">
        {activities.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-sm text-muted-foreground">No recent activity</p>
          </div>
        ) : (
          activities.map((activity) => (
            <Link
              key={`${activity.type}-${activity.id}`}
              href={`/dashboard/${
                activity.type === "request" ? "requests" : "claims"
              }/${activity.id}`}
              className="flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors"
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center",
                  activity.type === "request"
                    ? "bg-blue-500/10"
                    : "bg-violet-500/10"
                )}
              >
                {activity.type === "request" ? (
                  <FileText className="w-4 h-4 text-blue-500" />
                ) : (
                  <Users className="w-4 h-4 text-violet-500" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">
                  {activity.title}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {activity.subtitle}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {getStatusIcon(activity.status)}
                <span className="text-xs text-muted-foreground">
                  {formatDate(activity.date)}
                </span>
              </div>
            </Link>
          ))
        )}
      </div>
    </Card>
  );
}

// ============================================
// SKELETONS
// ============================================
function StatsSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-4">
      {[1, 2, 3].map((i) => (
        <Card key={i} className="p-3 sm:p-4 border-border/40">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-muted animate-pulse" />
            <div className="h-3 w-14 bg-muted animate-pulse rounded" />
          </div>
          <div className="h-6 sm:h-7 w-12 bg-muted animate-pulse rounded" />
        </Card>
      ))}
    </div>
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
            <div className="flex gap-1">
              <div className="h-7 w-16 bg-muted animate-pulse rounded" />
              <div className="h-7 w-16 bg-muted animate-pulse rounded" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ============================================
// EXPORTED SKELETON
// ============================================
export function OperationsTabSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <StatsSkeleton />
      <Card className="p-3 border-border/40">
        <div className="flex gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 w-24 bg-muted animate-pulse rounded" />
          ))}
        </div>
      </Card>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <ListSkeleton />
        <ListSkeleton />
      </div>
      <ActivityCardSkeleton />
    </div>
  );
}
