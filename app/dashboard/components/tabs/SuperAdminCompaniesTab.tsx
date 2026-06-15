import { Suspense } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2,
  Plus,
  ChevronRight,
  CheckCircle2,
  Clock,
  XCircle,
  Mail,
  FileBarChart,
  UserPlus,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

// Queries
import { getCompanyHealthWithRevenue } from "@/app/mongodb/queries/company-queries";

// ============================================
// COMPANIES TAB - Company Health Overview
// ============================================
export async function SuperAdminCompaniesTab() {
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Quick Actions */}
      <QuickActionsBar />

      {/* Company Health Table */}
      <Suspense fallback={<TableSkeleton />}>
        <CompanyHealthTable />
      </Suspense>
    </div>
  );
}

// ============================================
// QUICK ACTIONS BAR
// ============================================
function QuickActionsBar() {
  return (
    <Card className="border-border/40 p-3 sm:p-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-muted-foreground">Quick actions</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/admin/companies/create">
            <Button
              size="sm"
              className="bg-linear-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-black font-medium shadow-md shadow-yellow-500/20"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              New Company
            </Button>
          </Link>
          <Link href="/dashboard/users/create">
            <Button size="sm" variant="outline" className="gap-1.5">
              <UserPlus className="w-4 h-4" />
              <span className="hidden sm:inline">Add User</span>
            </Button>
          </Link>
          <Button size="sm" variant="outline" className="gap-1.5" disabled>
            <Mail className="w-4 h-4" />
            <span className="hidden sm:inline">Bulk Email</span>
          </Button>
          <Link href="/dashboard/reports">
            <Button size="sm" variant="outline" className="gap-1.5">
              <FileBarChart className="w-4 h-4" />
              <span className="hidden sm:inline">Generate Report</span>
            </Button>
          </Link>
        </div>
      </div>
    </Card>
  );
}

// ============================================
// COMPANY HEALTH TABLE
// ============================================
async function CompanyHealthTable() {
  const companies = await getCompanyHealthWithRevenue(10);

  const statusConfig: Record<
    string,
    { label: string; color: string; bgColor: string; icon: typeof CheckCircle2 }
  > = {
    active: {
      label: "Active",
      color: "text-emerald-600",
      bgColor: "bg-emerald-500",
      icon: CheckCircle2,
    },
    inactive: {
      label: "Inactive",
      color: "text-gray-600",
      bgColor: "bg-gray-400",
      icon: Clock,
    },
    suspended: {
      label: "Suspended",
      color: "text-red-600",
      bgColor: "bg-red-500",
      icon: XCircle,
    },
  };

  if (companies.length === 0) {
    return (
      <Card className="border-border/40">
        <CardContent className="py-12">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
              <Building2 className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">
              No companies yet
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Companies will appear here once created
            </p>
            <Link href="/dashboard/admin/companies/create" className="mt-4">
              <Button size="sm" variant="outline">
                <Plus className="w-4 h-4 mr-1.5" />
                Create Company
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/40">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left text-xs font-semibold text-muted-foreground py-3 px-4">
                  Company
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground py-3 px-4">
                  Status
                </th>
                <th className="text-center text-xs font-semibold text-muted-foreground py-3 px-4">
                  Users
                </th>
                <th className="text-right text-xs font-semibold text-muted-foreground py-3 px-4 hidden sm:table-cell">
                  Revenue
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground py-3 px-4">
                  Health
                </th>
                <th className="text-right text-xs font-semibold text-muted-foreground py-3 px-4">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company, index) => {
                const config =
                  statusConfig[company.status] || statusConfig.inactive;
                const StatusIcon = config.icon;
                return (
                  <tr
                    key={company._id}
                    className={cn(
                      "border-b border-border/50 hover:bg-muted/30 transition-colors",
                      index === companies.length - 1 ? "border-b-0" : "",
                    )}
                  >
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-violet-500/20 flex items-center justify-center">
                          <Building2 className="w-4 h-4 text-blue-600" />
                        </div>
                        <span className="text-sm font-medium">
                          {company.name}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5">
                        <StatusIcon
                          className={cn("w-3.5 h-3.5", config.color)}
                        />
                        <span className={cn("text-sm", config.color)}>
                          {config.label}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className="text-sm font-medium tabular-nums">
                        {company.userCount}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right hidden sm:table-cell">
                      <span className="text-sm font-medium tabular-nums">
                        {formatCurrency(company.revenue || 0)}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2.5">
                        <Progress
                          value={(company.health / 5) * 100}
                          className="h-2 w-16"
                        />
                        <span className="text-xs text-muted-foreground tabular-nums w-6">
                          {company.health}/5
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <Link href={`/dashboard/admin/companies/${company._id}`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>

      {/* View All Link */}
      <div className="border-t border-border/50 p-3">
        <Link href="/dashboard/admin/companies">
          <Button variant="ghost" size="sm" className="w-full text-xs gap-1">
            View All Companies
            <ChevronRight className="w-3 h-3" />
          </Button>
        </Link>
      </div>
    </Card>
  );
}

// ============================================
// SKELETONS
// ============================================
function TableSkeleton() {
  return (
    <Card className="border-border/40">
      <CardContent className="p-0">
        <div className="overflow-hidden">
          {/* Header */}
          <div className="border-b border-border bg-muted/30 px-4 py-3 flex gap-4">
            {[120, 80, 50, 70, 100, 40].map((width, i) => (
              <Skeleton key={i} className="h-4" style={{ width }} />
            ))}
          </div>
          {/* Rows */}
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="border-b border-border/50 px-4 py-3.5 flex items-center gap-4"
            >
              <div className="flex items-center gap-2.5 flex-1">
                <Skeleton className="w-8 h-8 rounded-lg" />
                <Skeleton className="h-4 w-28" />
              </div>
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-8" />
              <Skeleton className="h-4 w-16 hidden sm:block" />
              <div className="flex items-center gap-2">
                <Skeleton className="h-2 w-16 rounded-full" />
                <Skeleton className="h-3 w-6" />
              </div>
              <Skeleton className="h-7 w-7 rounded" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function SuperAdminCompaniesTabSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <Card className="border-border/40 p-3 sm:p-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-24" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
      </Card>
      <TableSkeleton />
    </div>
  );
}
