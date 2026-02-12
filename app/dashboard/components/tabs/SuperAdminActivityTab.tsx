import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

// Queries
import {
  getRecentPlatformActivity,
  getSystemAlerts,
  getPlatformActivityChart,
} from "@/app/mongodb/queries/company-queries";

// Components
import { PlatformActivityChart } from "../PlatformActivityChart";

// ============================================
// ACTIVITY TAB - Platform Activity Chart, Recent Activity & System Alerts
// ============================================
export async function SuperAdminActivityTab() {
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Platform Activity Chart - Full Width */}
      <Suspense fallback={<ChartSkeleton />}>
        <PlatformActivityChartWrapper />
      </Suspense>

      {/* Two Column Layout - Activity & Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <Suspense fallback={<ActivitySkeleton />}>
          <RecentActivityCard />
        </Suspense>
        <Suspense fallback={<AlertsSkeleton />}>
          <SystemAlertsCard />
        </Suspense>
      </div>
    </div>
  );
}

// ============================================
// PLATFORM ACTIVITY CHART WRAPPER
// ============================================
async function PlatformActivityChartWrapper() {
  const data = await getPlatformActivityChart();
  return <PlatformActivityChart data={data} />;
}

// ============================================
// RECENT ACTIVITY CARD
// ============================================
async function RecentActivityCard() {
  const activities = await getRecentPlatformActivity(8);

  const typeConfig: Record<
    string,
    { icon: string; color: string; bgColor: string }
  > = {
    company_created: {
      icon: "🏢",
      color: "text-blue-600",
      bgColor: "bg-blue-500/10",
    },
    user_created: {
      icon: "👤",
      color: "text-emerald-600",
      bgColor: "bg-emerald-500/10",
    },
    subscription_changed: {
      icon: "💳",
      color: "text-violet-600",
      bgColor: "bg-violet-500/10",
    },
    payment_received: {
      icon: "💰",
      color: "text-amber-600",
      bgColor: "bg-amber-500/10",
    },
  };

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">
            Recent Activity
          </CardTitle>
          <Badge variant="secondary" className="text-xs font-normal">
            Last 7 days
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mb-2">
              <Clock className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">
              No activity yet
            </p>
            <p className="text-xs text-muted-foreground">
              Recent platform activity will appear here
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {activities.map((activity, index) => {
              const config =
                typeConfig[activity.type] || typeConfig.user_created;
              return (
                <div
                  key={index}
                  className="flex items-start gap-3 py-2.5 px-2 rounded-lg hover:bg-muted/50 transition-colors -mx-2"
                >
                  <div
                    className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                      config.bgColor
                    )}
                  >
                    <span className="text-sm">{config.icon}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground leading-tight">
                      {activity.message}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {activity.relativeTime}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================
// SYSTEM ALERTS CARD
// ============================================
async function SystemAlertsCard() {
  const alerts = await getSystemAlerts();

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-500/10">
            <AlertCircle className="w-4 h-4 text-amber-500" />
          </div>
          <CardTitle className="text-sm font-semibold">System Alerts</CardTitle>
          {alerts.length > 0 && (
            <Badge variant="destructive" className="text-xs ml-auto">
              {alerts.length}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
            </div>
            <p className="text-sm font-medium text-foreground">
              All systems healthy
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              No issues require attention
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {alerts.map((alert, index) => (
              <div
                key={index}
                className={cn(
                  "flex items-start gap-3 p-3 rounded-lg border",
                  alert.type === "critical"
                    ? "bg-red-500/5 border-red-500/20"
                    : "bg-amber-500/5 border-amber-500/20"
                )}
              >
                <span className="text-lg shrink-0">{alert.icon}</span>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm font-medium",
                      alert.type === "critical"
                        ? "text-red-700 dark:text-red-400"
                        : "text-amber-700 dark:text-amber-400"
                    )}
                  >
                    {alert.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================
// SKELETONS
// ============================================
function ChartSkeleton() {
  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-20" />
        </div>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[300px] w-full rounded-lg" />
      </CardContent>
    </Card>
  );
}

function ActivitySkeleton() {
  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-5 w-20" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex items-start gap-3 py-2.5">
              <Skeleton className="w-8 h-8 rounded-lg shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-full max-w-[240px]" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AlertsSkeleton() {
  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Skeleton className="w-7 h-7 rounded-lg" />
          <Skeleton className="h-5 w-24" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2.5">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-3 rounded-lg bg-muted/50"
            >
              <Skeleton className="w-5 h-5 rounded shrink-0" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function SuperAdminActivityTabSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <ChartSkeleton />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <ActivitySkeleton />
        <AlertsSkeleton />
      </div>
    </div>
  );
}
