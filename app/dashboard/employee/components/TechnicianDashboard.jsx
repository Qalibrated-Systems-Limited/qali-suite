import { Suspense } from "react";
import { getMyRecentActivity } from "@/app/mongodb/queries/tech-dashboard-queries";
import { auth } from "@/auth";
import { TechnicianStatsCards } from "./TechCardStats";
import { MyBorrowedItemsCard } from "./MyBorrowedItemscard";
import {
  MyRequestsCard,
  OverdueAlert,
  QuickActionsCard,
} from "./Techniciandashboardcards";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  MyBorrowedItemsSkeleton,
  MyRequestsSkeleton,
  OverdueAlertSkeleton,
  RecentActivitySkeleton,
  TechnicianStatsCardsSkeleton,
} from "./TechnicianDashboardSkeleton";

export async function TechnicianDashboard() {
  const session = await auth();
  const { user } = session;

  // Fetch all data in parallel
  //   const dashboardData = await getTechnicianDashboardData(user.id);
  //   const { recentActivity } = dashboardData;

  return (
    <div className="flex flex-col gap-6">
      {/* Welcome Header */}
      <div className="space-y-1">
        <h1 className="text-3xl font-bold text-foreground">
          Welcome back, {user?.name?.split(" ")[0] || "there"}
        </h1>
        <p className="text-muted-foreground">
          {user?.role} • {user?.department || "QaliSuite"}
        </p>
      </div>

      {/* Stats Cards */}
      <Suspense fallback={<TechnicianStatsCardsSkeleton />}>
        <TechnicianStatsCards />
      </Suspense>

      {/* Quick Actions */}
      <QuickActionsCard />

      {/* Overdue Alert - Only shows if items are overdue */}

      <Suspense fallback={<OverdueAlertSkeleton />}>
        <OverdueAlert />
      </Suspense>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* My Borrowed Items */}
        <Suspense fallback={<MyBorrowedItemsSkeleton />}>
          <MyBorrowedItemsCard />
        </Suspense>

        {/* My Requests */}
        <Suspense fallback={<MyRequestsSkeleton />}>
          <MyRequestsCard />
        </Suspense>
      </div>

      {/* Recent Activity Timeline */}
      <Suspense fallback={<RecentActivitySkeleton />}>
        <RecentActivityCard />
      </Suspense>
    </div>
  );
}

// ============================================
// RECENT ACTIVITY TIMELINE
// ============================================
async function RecentActivityCard({}) {
  const { user } = await auth();

  const activities = await getMyRecentActivity(user.id);
  if (activities.length === 0) return null;

  const getActivityIcon = (type) => {
    switch (type) {
      case "borrowed":
        return "📦";
      case "returned":
        return "✅";
      case "request_created":
        return "📋";
      case "request_approved":
        return "✓";
      default:
        return "•";
    }
  };

  const getActivityText = (activity) => {
    switch (activity.type) {
      case "borrowed":
        return `Borrowed ${activity.item}`;
      case "returned":
        return `Returned ${activity.item}`;
      case "request_created":
        return `Created request ${activity.requestNumber} (${activity.itemCount} items)`;
      case "request_approved":
        return `Request ${activity.requestNumber} approved by ${activity.approvedBy}`;
      default:
        return "Activity";
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-foreground">Recent Activity</CardTitle>
        <CardDescription className="text-muted-foreground">
          Your latest transactions and updates
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {activities.map((activity, index) => (
            <div key={index} className="flex items-start gap-3 group">
              {/* Timeline dot */}
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-yellow-500/10 border-2 border-yellow-500 flex items-center justify-center flex-shrink-0 group-hover:bg-yellow-500/20 transition-colors">
                  <span className="text-sm">
                    {getActivityIcon(activity.type)}
                  </span>
                </div>
                {index < activities.length - 1 && (
                  <div className="w-0.5 h-full bg-border mt-2" />
                )}
              </div>

              {/* Activity content */}
              <div className="flex-1 pb-4">
                <p className="text-sm text-foreground font-medium">
                  {getActivityText(activity)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatDate(activity.date)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
