import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2,
  Timer,
  TrendingUp,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Queries
import {
  getPlatformMetrics,
  getSubscriptionDistribution,
  getExpiringCompanies,
  getMRRMetrics,
} from "@/app/mongodb/queries/company-queries";

// Utils
import { formatCurrency } from "@/lib/utils";

// Components
import {
  MetricCard,
  MetricCardsGrid,
  MetricCardsGridSkeleton,
} from "../MetricsCard";

// ============================================
// OVERVIEW TAB - Platform Metrics & Subscriptions
// ============================================
export async function SuperAdminOverviewTab() {
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Platform Metrics - 4 Cards */}
      <Suspense fallback={<MetricCardsGridSkeleton count={4} />}>
        <PlatformMetricsCards />
      </Suspense>

      {/* Subscription Overview - 3 Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <Suspense fallback={<SubscriptionCardSkeleton />}>
          <SubscriptionDistributionCard />
        </Suspense>
        <Suspense fallback={<ExpiryCardSkeleton />}>
          <ExpiringTrialsCard />
        </Suspense>
        <Suspense fallback={<ExpiryCardSkeleton />}>
          <ExpiringSubscriptionsCard />
        </Suspense>
      </div>
    </div>
  );
}

// ============================================
// PLATFORM METRICS CARDS
// ============================================
async function PlatformMetricsCards() {
  const [metrics, mrrMetrics] = await Promise.all([
    getPlatformMetrics(),
    getMRRMetrics(),
  ]);

  // Format MRR for display
  const formattedMRR = formatCurrency(mrrMetrics.current);
  const mrrTrendText = mrrMetrics.trend > 0
    ? `+${mrrMetrics.trend}% MoM`
    : mrrMetrics.trend < 0
      ? `${mrrMetrics.trend}% MoM`
      : "No change";

  return (
    <MetricCardsGrid cols={4}>
      <MetricCard
        title="Active Companies"
        value={metrics.companies.active}
        subtitle={`${metrics.companies.total} total registered`}
        icon="Building2"
        iconColor="text-blue-500"
        href="/dashboard/admin/companies"
      />
      <MetricCard
        title="Total Users"
        value={metrics.users.total}
        subtitle={`${metrics.users.activeToday} active today`}
        icon="Users"
        iconColor="text-emerald-500"
        href="/dashboard/users"
      />
      <MetricCard
        title="MRR"
        value={formattedMRR}
        subtitle={mrrTrendText}
        icon="TrendingUp"
        iconColor="text-violet-500"
        trend={mrrMetrics.trend}
      />
      <MetricCard
        title="Alerts"
        value={metrics.alerts.trialsExpiring + metrics.alerts.critical}
        subtitle={`${metrics.alerts.critical} critical issue${metrics.alerts.critical !== 1 ? "s" : ""}`}
        icon="Bell"
        iconColor="text-red-500"
        alert={metrics.alerts.critical > 0}
      />
    </MetricCardsGrid>
  );
}

// ============================================
// SUBSCRIPTION DISTRIBUTION CARD
// ============================================
async function SubscriptionDistributionCard() {
  const distribution = await getSubscriptionDistribution();

  const planConfig: Record<
    string,
    { label: string; color: string; bgColor: string }
  > = {
    enterprise: {
      label: "Enterprise",
      color: "text-violet-600",
      bgColor: "bg-violet-500",
    },
    professional: {
      label: "Professional",
      color: "text-blue-600",
      bgColor: "bg-blue-500",
    },
    starter: {
      label: "Starter",
      color: "text-amber-600",
      bgColor: "bg-amber-500",
    },
    free: {
      label: "Free/Trial",
      color: "text-gray-600",
      bgColor: "bg-gray-400",
    },
  };

  const total = distribution.reduce((sum, d) => sum + d.value, 0);

  return (
    <Card className="overflow-hidden border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">
            Subscription Distribution
          </CardTitle>
          <Badge variant="secondary" className="text-xs font-normal">
            {total} total
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Visual Bar */}
        <div className="h-3 rounded-full bg-muted overflow-hidden flex">
          {distribution.map((plan) => {
            const config = planConfig[plan.name] || planConfig.free;
            const width = total > 0 ? (plan.value / total) * 100 : 0;
            return (
              <div
                key={plan.name}
                className={cn(config.bgColor, "transition-all")}
                style={{ width: `${width}%` }}
              />
            );
          })}
        </div>

        {/* Legend */}
        <div className="space-y-2.5">
          {distribution.map((plan) => {
            const config = planConfig[plan.name] || planConfig.free;
            return (
              <div
                key={plan.name}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <div className={cn("w-2.5 h-2.5 rounded-full", config.bgColor)} />
                  <span className={cn("text-sm font-medium", config.color)}>
                    {config.label}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {plan.value}
                  </span>
                  <span className="text-xs text-muted-foreground w-10 text-right tabular-nums">
                    {plan.percentage}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// EXPIRING TRIALS CARD
// ============================================
async function ExpiringTrialsCard() {
  const { trials } = await getExpiringCompanies();

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-orange-500/10">
            <Timer className="w-4 h-4 text-orange-500" />
          </div>
          <CardTitle className="text-sm font-semibold">
            Trials Expiring
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {trials.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center mb-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            </div>
            <p className="text-sm font-medium text-foreground">All clear</p>
            <p className="text-xs text-muted-foreground">
              No trials expiring soon
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {trials.map((company) => (
              <div
                key={company._id}
                className="flex items-center justify-between p-2.5 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium truncate">
                    {company.name}
                  </span>
                </div>
                <Badge
                  variant={company.daysRemaining <= 2 ? "destructive" : "secondary"}
                  className="text-xs shrink-0 ml-2"
                >
                  {company.daysRemaining}d
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================
// EXPIRING SUBSCRIPTIONS CARD
// ============================================
async function ExpiringSubscriptionsCard() {
  const { subscriptions } = await getExpiringCompanies();

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-blue-500/10">
            <TrendingUp className="w-4 h-4 text-blue-500" />
          </div>
          <CardTitle className="text-sm font-semibold">Renewals Due</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {subscriptions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center mb-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            </div>
            <p className="text-sm font-medium text-foreground">All clear</p>
            <p className="text-xs text-muted-foreground">
              No renewals due soon
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {subscriptions.map((company) => (
              <div
                key={company._id}
                className="flex items-center justify-between p-2.5 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{company.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {company.plan} plan
                  </p>
                </div>
                <Badge variant="secondary" className="text-xs shrink-0 ml-2">
                  {company.daysRemaining}d
                </Badge>
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
function SubscriptionCardSkeleton() {
  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-16" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-3 w-full rounded-full" />
        <div className="space-y-2.5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Skeleton className="w-2.5 h-2.5 rounded-full" />
                <Skeleton className="h-4 w-20" />
              </div>
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ExpiryCardSkeleton() {
  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Skeleton className="w-7 h-7 rounded-lg" />
          <Skeleton className="h-5 w-28" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2.5">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between p-2.5 rounded-lg bg-muted/50"
            >
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-10" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function SuperAdminOverviewTabSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <MetricCardsGridSkeleton count={4} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <SubscriptionCardSkeleton />
        <ExpiryCardSkeleton />
        <ExpiryCardSkeleton />
      </div>
    </div>
  );
}
