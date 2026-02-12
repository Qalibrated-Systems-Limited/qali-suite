import { Suspense } from "react";
import Link from "next/link";
import {
  Calendar,
  CalendarCheck,
  CalendarX,
  Lock,
  ChevronLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import {
  fetchFiscalPeriods,
  fetchFiscalPeriodStats,
} from "@/app/mongodb/actions/fiscal-period-actions";
import CreateYearPeriodsButton from "./components/CreateYearPeriodsButton";
import PeriodActionsMenu from "./components/PeriodActionsMenu";

// ============================================
// METADATA
// ============================================
export const metadata = {
  title: "Fiscal Periods | Settings",
  description: "Manage accounting fiscal periods",
};

// ============================================
// STATUS BADGE
// ============================================
function StatusBadge({ status }) {
  const config = {
    open: {
      label: "Open",
      className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
      icon: CalendarCheck,
    },
    closed: {
      label: "Closed",
      className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
      icon: CalendarX,
    },
    locked: {
      label: "Locked",
      className: "bg-red-500/15 text-red-700 dark:text-red-400",
      icon: Lock,
    },
  };

  const { label, className, icon: Icon } = config[status] || config.open;

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
// STATS CARDS
// ============================================
async function StatsCards() {
  const result = await fetchFiscalPeriodStats();

  if (!result.success) {
    return (
      <div className="rounded-lg border bg-card p-4 text-center">
        <AlertCircle className="h-6 w-6 text-red-500 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">{result.error}</p>
      </div>
    );
  }

  const { stats } = result;

  const cards = [
    {
      label: "Total Periods",
      value: stats.total,
      icon: Calendar,
      iconColor: "text-blue-500",
      iconBg: "bg-blue-500/10",
    },
    {
      label: "Open Periods",
      value: stats.open,
      icon: CalendarCheck,
      iconColor: "text-emerald-500",
      iconBg: "bg-emerald-500/10",
    },
    {
      label: "Closed Periods",
      value: stats.closed,
      icon: CalendarX,
      iconColor: "text-amber-500",
      iconBg: "bg-amber-500/10",
    },
    {
      label: "Locked Periods",
      value: stats.locked,
      icon: Lock,
      iconColor: "text-red-500",
      iconBg: "bg-red-500/10",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <div className={`rounded-md p-2 ${card.iconBg}`}>
              <card.icon className={`h-4 w-4 ${card.iconColor}`} />
            </div>
            <span className="text-2xl font-bold">{card.value}</span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{card.label}</p>
        </div>
      ))}
    </div>
  );
}

// ============================================
// CURRENT PERIOD CARD
// ============================================
async function CurrentPeriodCard() {
  const result = await fetchFiscalPeriodStats();

  if (!result.success || !result.stats.currentPeriod) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-amber-500/10 p-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
          </div>
          <div>
            <h3 className="font-medium">No Active Period</h3>
            <p className="text-sm text-muted-foreground">
              Create fiscal periods to start tracking.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { currentPeriod } = result.stats;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="rounded-full bg-emerald-500/10 p-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
        </div>
        <div className="flex-1">
          <h3 className="font-medium">Current Period: {currentPeriod.name}</h3>
          <p className="text-sm text-muted-foreground">
            {format(new Date(currentPeriod.startDate), "MMM d")} -{" "}
            {format(new Date(currentPeriod.endDate), "MMM d, yyyy")}
          </p>
        </div>
        <StatusBadge status="open" />
      </div>
    </div>
  );
}

// ============================================
// PERIODS TABLE (Desktop)
// ============================================
function PeriodsTable({ periods, canManage }) {
  if (periods.length === 0) {
    return (
      <div className="hidden md:block rounded-lg border bg-card p-8 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <Calendar className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mt-4 font-semibold">No fiscal periods yet</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Create fiscal periods to start managing your accounting.
        </p>
      </div>
    );
  }

  return (
    <div className="hidden md:block rounded-lg border bg-card overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
              Period
            </th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
              Code
            </th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
              Date Range
            </th>
            <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">
              Status
            </th>
            {canManage && (
              <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
                Actions
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y">
          {periods.map((period) => (
            <tr
              key={period._id}
              className="hover:bg-muted/50 transition-colors"
            >
              <td className="px-4 py-3">
                <span className="font-medium">{period.periodName}</span>
                {period.periodType && (
                  <span className="text-xs text-muted-foreground ml-2">
                    ({period.periodType})
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                <span className="font-mono text-sm">{period.periodCode}</span>
              </td>
              <td className="px-4 py-3 text-sm text-muted-foreground">
                {format(new Date(period.startDate), "MMM d, yyyy")} -{" "}
                {format(new Date(period.endDate), "MMM d, yyyy")}
              </td>
              <td className="px-4 py-3 text-center">
                <StatusBadge status={period.status} />
              </td>
              {canManage && (
                <td className="px-4 py-3 text-right">
                  <PeriodActionsMenu period={period} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================
// PERIODS CARDS (Mobile)
// ============================================
function PeriodsCards({ periods, canManage }) {
  if (periods.length === 0) {
    return (
      <div className="md:hidden rounded-lg border bg-card p-8 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <Calendar className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mt-4 font-semibold">No fiscal periods yet</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Create fiscal periods to start managing your accounting.
        </p>
      </div>
    );
  }

  return (
    <div className="md:hidden space-y-3">
      {periods.map((period) => (
        <div
          key={period._id}
          className="rounded-lg border bg-card p-4 hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{period.periodName}</span>
                <StatusBadge status={period.status} />
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                <span className="font-mono">{period.periodCode}</span>
              </p>
            </div>
            {canManage && <PeriodActionsMenu period={period} />}
          </div>

          <div className="flex items-center justify-between mt-3 pt-3 border-t">
            <div className="text-xs text-muted-foreground">
              {format(new Date(period.startDate), "MMM d")} -{" "}
              {format(new Date(period.endDate), "MMM d, yyyy")}
            </div>
            {period.periodType && (
              <span className="text-xs text-muted-foreground capitalize">
                {period.periodType}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================
// PERIODS LIST
// ============================================
async function PeriodsList({ canManage }) {
  const result = await fetchFiscalPeriods();

  if (!result.success) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center">
        <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">{result.error}</p>
      </div>
    );
  }

  // Serialize periods to plain objects for client components
  const periods = JSON.parse(JSON.stringify(result.periods));

  return (
    <>
      <PeriodsTable periods={periods} canManage={canManage} />
      <PeriodsCards periods={periods} canManage={canManage} />
    </>
  );
}

// ============================================
// PAGE COMPONENT
// ============================================
export default async function FiscalPeriodsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const isAdmin = session.user.role === "Admin";
  const isAccountant = session.user.role === "Accountant";
  const canManage = isAdmin || isAccountant;

  if (!canManage) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Access Denied
          </h2>
          <p className="text-muted-foreground">
            You don&apos;t have permission to manage fiscal periods.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/settings">
              <ChevronLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Fiscal Periods</h1>
            <p className="text-muted-foreground">
              Manage accounting periods for your organization
            </p>
          </div>
        </div>
        <CreateYearPeriodsButton />
      </div>

      {/* Current Period */}
      <Suspense
        fallback={
          <div className="h-20 rounded-lg border bg-muted animate-pulse" />
        }
      >
        <CurrentPeriodCard />
      </Suspense>

      {/* Stats */}
      <Suspense
        fallback={
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 rounded-lg border bg-muted animate-pulse" />
            ))}
          </div>
        }
      >
        <StatsCards />
      </Suspense>

      {/* Periods List */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">All Periods</h2>
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <PeriodsList canManage={canManage} />
        </Suspense>
      </div>
    </div>
  );
}
