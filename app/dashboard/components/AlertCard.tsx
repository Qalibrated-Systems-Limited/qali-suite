import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Package,
  Users,
  Clock,
  FileText,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { getDashboardAlerts } from "@/app/mongodb/queries/erp-dashboard-queries";

// ============================================
// ALERTS CARD - Server Component
// ============================================
export async function AlertsCard() {
  const alerts = await getDashboardAlerts();

  // Build alert items from data
  const alertItems = [
    {
      id: "overdue-invoices",
      label: "Overdue Invoices",
      count: alerts.overdueInvoices,
      href: "/dashboard/invoices?status=overdue",
      icon: FileText,
      color: "text-red-500",
      bgColor: "bg-red-500/10",
    },
    {
      id: "low-stock",
      label: "Low Stock Items",
      count: alerts.lowStockCount,
      href: "/dashboard/stocks?quantity=low-stock",
      icon: Package,
      color: "text-orange-500",
      bgColor: "bg-orange-500/10",
    },
    {
      id: "claims-pending",
      label: "Claims to Pay",
      count: alerts.overdueClaims,
      href: "/dashboard/claims/payments",
      icon: Users,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    },
    {
      id: "overdue-checkouts",
      label: "Overdue Checkouts",
      count: alerts.overdueCheckouts,
      href: "/dashboard/checkouts?status=overdue",
      icon: Clock,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
    },
  ].filter((item) => item.count > 0);

  // No alerts - show success state
  if (alertItems.length === 0) {
    return (
      <Card className="bg-card border border-border/40">
        <CardContent className="py-6">
          <div className="flex items-center justify-center gap-3 text-center">
            <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
              <svg
                className="w-5 h-5 text-green-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <div className="text-left">
              <p className="text-sm font-medium text-foreground">All Clear</p>
              <p className="text-xs text-muted-foreground">
                No alerts at the moment
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border border-border/40">
      {/* Header */}
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-yellow-500/10 flex items-center justify-center">
            <AlertTriangle className="w-4 h-4 text-yellow-500" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Alerts</h3>
            <p className="text-xs text-muted-foreground">
              {alerts.total} items need attention
            </p>
          </div>
        </div>
      </CardHeader>

      {/* Alert Items */}
      <CardContent className="pt-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {alertItems.map((alert) => (
            <Link
              key={alert.id}
              href={alert.href}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg",
                "border border-border/40",
                "hover:border-border hover:bg-muted/30",
                "transition-all duration-150"
              )}
            >
              <div
                className={cn(
                  "shrink-0 w-9 h-9 rounded-lg flex items-center justify-center",
                  alert.bgColor
                )}
              >
                <alert.icon className={cn("w-4 h-4", alert.color)} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground truncate">
                  {alert.label}
                </p>
                <p className="text-lg font-bold text-foreground tabular-nums">
                  {alert.count}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// ALERTS SKELETON
// ============================================
export function AlertsSkeleton() {
  return (
    <Card className="bg-card border border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-muted animate-pulse" />
          <div className="space-y-1">
            <div className="h-4 w-16 bg-muted animate-pulse rounded" />
            <div className="h-3 w-32 bg-muted animate-pulse rounded" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-3 rounded-lg border border-border/40"
            >
              <div className="w-9 h-9 rounded-lg bg-muted animate-pulse" />
              <div className="flex-1 space-y-1">
                <div className="h-3 w-16 bg-muted animate-pulse rounded" />
                <div className="h-5 w-8 bg-muted animate-pulse rounded" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
