import { Suspense } from "react";
import Link from "next/link";
import {
  Package,
  AlertTriangle,
  ClipboardList,
  Activity,
  Plus,
  Boxes,
  PackagePlus,
  ArrowRight,
} from "lucide-react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import {
  getStockStats,
  getLowStockProducts,
  getRecentRequests,
} from "@/app/mongodb/queries/stock-dashboard-queries";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { StockMovement } from "@/app/models/stockmovement";
import dbConnect from "@/app/config/dbConnect";

export const metadata = {
  title: "Store Manager Dashboard | ERP System",
};

// Today's movement count for the Store Manager's company
async function getTodayMovementCount(companyId: string | null) {
  await dbConnect();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const filter: Record<string, unknown> = { createdAt: { $gte: start } };
  if (companyId) filter.companyId = companyId;
  return StockMovement.countDocuments(filter);
}

function StatCard({
  label,
  value,
  href,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number | string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "red" | "orange" | "blue" | "green";
}) {
  const tones = {
    red: "text-red-500 bg-red-500/10",
    orange: "text-orange-500 bg-orange-500/10",
    blue: "text-blue-500 bg-blue-500/10",
    green: "text-green-500 bg-green-500/10",
  };
  return (
    <Link href={href}>
      <Card className="bg-card border-border hover:border-yellow-500/40 transition-colors">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-2xl font-bold text-foreground mt-1">
                {value}
              </p>
            </div>
            <div className={`p-2 rounded-lg ${tones[tone]}`}>
              <Icon className="w-5 h-5" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

async function DashboardBody({ user }: { user: { name: string; companyId: string | null } }) {
  // Parallel fetch
  const [stats, lowStock, recentRequests, todayMovements] = await Promise.all([
    getStockStats(),
    getLowStockProducts(8),
    getRecentRequests(5),
    getTodayMovementCount(user.companyId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
          Hi {user.name.split(" ")[0]}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Here&apos;s what&apos;s happening in your store today
        </p>
      </div>

      {/* Quick action buttons — big tap targets, mobile first */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Button
          asChild
          className="h-16 bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
        >
          <Link href="/dashboard/adjustments/create">
            <PackagePlus className="w-5 h-5 mr-2" />
            New Adjustment
          </Link>
        </Button>
        <Button
          asChild
          variant="outline"
          className="h-16 border-border"
        >
          <Link href="/dashboard/purchase-orders/create">
            <Plus className="w-5 h-5 mr-2" />
            Receive Stock
          </Link>
        </Button>
        <Button
          asChild
          variant="outline"
          className="h-16 border-border"
        >
          <Link href="/dashboard/stocks">
            <Boxes className="w-5 h-5 mr-2" />
            Find Product
          </Link>
        </Button>
        <Button
          asChild
          variant="outline"
          className="h-16 border-border"
        >
          <Link href="/dashboard/requests">
            <ClipboardList className="w-5 h-5 mr-2" />
            Requests
          </Link>
        </Button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Low Stock Items"
          value={stats.lowStockCount}
          href="/dashboard/stocks?filter=low"
          icon={AlertTriangle}
          tone="orange"
        />
        <StatCard
          label="Pending Requests"
          value={stats.pendingRequests}
          href="/dashboard/requests?status=pending"
          icon={ClipboardList}
          tone="blue"
        />
        <StatCard
          label="Today's Movements"
          value={todayMovements}
          href="/dashboard/movements"
          icon={Activity}
          tone="green"
        />
        <StatCard
          label="Total Products"
          value={stats.totalProducts}
          href="/dashboard/stocks"
          icon={Package}
          tone="blue"
        />
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Low stock list */}
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Reorder Soon</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard/stocks">
                View all
                <ArrowRight className="w-4 h-4 ml-1" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {lowStock.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Nothing to reorder. 🎉
              </p>
            ) : (
              lowStock.map((p: any) => {
                const onHand = p.inventory?.quantityOnHand ?? 0;
                const reorder = p.inventory?.reorderLevel ?? 0;
                return (
                  <Link
                    key={String(p._id)}
                    href={`/dashboard/stocks/${p._id}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground truncate">
                        {p.name}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {p.SKU}
                      </p>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="font-semibold text-orange-500">{onHand}</p>
                      <p className="text-xs text-muted-foreground">
                        of {reorder}
                      </p>
                    </div>
                  </Link>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Recent requests */}
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent Stock Requests</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard/requests">
                View all
                <ArrowRight className="w-4 h-4 ml-1" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No recent requests
              </p>
            ) : (
              recentRequests.map((r: any) => {
                const statusColor =
                  r.status === "pending"
                    ? "bg-blue-500/10 text-blue-500 border-blue-500/20"
                    : r.status === "approved"
                    ? "bg-green-500/10 text-green-500 border-green-500/20"
                    : r.status === "fulfilled"
                    ? "bg-green-500/10 text-green-600 border-green-500/20"
                    : "bg-muted text-muted-foreground";
                return (
                  <Link
                    key={String(r._id)}
                    href={`/dashboard/requests/${r._id}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground truncate">
                        {r.requestNumber || "Request"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {r.requester?.name || r.customer || ""}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-xs shrink-0 ml-3 ${statusColor}`}
                    >
                      {r.status?.replace("_", " ")}
                    </Badge>
                  </Link>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-10 w-64 bg-muted animate-pulse rounded" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export default async function StoreManagerDashboard() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { companyId } = await getTenantContext();
  const sessionUser = session.user as { name?: string };
  const user = {
    name: sessionUser.name || "Manager",
    companyId: companyId || null,
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardBody user={user} />
      </Suspense>
    </div>
  );
}
