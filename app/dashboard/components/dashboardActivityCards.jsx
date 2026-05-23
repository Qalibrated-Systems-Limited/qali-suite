import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  FileText,
  Package,
  Clock,
  ExternalLink,
  ChevronRight,
} from "lucide-react";
import {
  getLowStockAlerts,
  getOverdueCheckouts,
  getRecentMovements,
  getRecentRequests,
} from "@/app/mongodb/queries/dashboard-queries";

// ============================================
// RECENT REQUESTS
// ============================================
export async function RecentRequestsCard({}) {
  const requests = await getRecentRequests(5);
  const statusColors = {
    pending:
      "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
    approved:
      "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
    rejected: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
    fulfilled:
      "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  };

  const priorityColors = {
    low: "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20",
    normal:
      "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    high: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
    urgent: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <CardTitle className="text-foreground">Recent Requests</CardTitle>
          <CardDescription className="text-muted-foreground">
            Latest stock requests
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link
            href="/dashboard/requests"
            className="text-muted-foreground hover:text-foreground"
          >
            View all
            <ChevronRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {requests.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No recent requests</p>
            </div>
          ) : (
            requests.map((request) => (
              <div
                key={request._id}
                className="flex items-start justify-between p-3 rounded-lg hover:bg-accent transition-colors border border-border"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-medium text-foreground truncate">
                      {request.requestNumber}
                    </p>
                    <Badge
                      variant="outline"
                      className={statusColors[request.status]}
                    >
                      {request.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {request.requester.name} • {request.itemCount} items
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDate(request.createdAt)}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={priorityColors[request.priority]}
                >
                  {request.priority}
                </Badge>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// RECENT MOVEMENTS
// ============================================
export async function RecentMovementsCard({}) {
  const movements = await getRecentMovements(10);
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const typeColors = {
    issue: "text-blue-500",
    return: "text-green-500",
    sale: "text-purple-500",
    purchase: "text-cyan-500",
    adjustment: "text-orange-500",
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <CardTitle className="text-foreground">Recent Activity</CardTitle>
          <CardDescription className="text-muted-foreground">
            Latest stock movements
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link
            href="/dashboard/movements"
            className="text-muted-foreground hover:text-foreground"
          >
            View all
            <ChevronRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {movements.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No recent movements</p>
            </div>
          ) : (
            movements.map((movement) => (
              <div
                key={movement._id}
                className="flex items-start gap-3 p-3 rounded-lg hover:bg-accent transition-colors border border-border"
              >
                <div
                  className={`mt-1 p-1.5 rounded ${
                    movement.direction === "in"
                      ? "bg-green-500/10"
                      : "bg-red-500/10"
                  }`}
                >
                  {movement.direction === "in" ? (
                    <ArrowDownCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <ArrowUpCircle className="h-4 w-4 text-red-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {movement.productSnapshot.name}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className={`text-xs font-medium ${
                        typeColors[movement.movementType]
                      }`}
                    >
                      {movement.movementType}
                    </span>
                    <span className="text-xs text-muted-foreground">•</span>
                    <span className="text-xs text-muted-foreground">
                      Qty: {movement.quantity}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {movement.performedBy.name} •{" "}
                    {formatDate(movement.createdAt)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// LOW STOCK ALERTS
// ============================================
export async function LowStockAlertsCard({}) {
  const alerts = await getLowStockAlerts(10);
  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <CardTitle className="text-foreground flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            Low Stock Alerts
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Items needing reorder
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link
            href="/dashboard/stocks?quantity=low-stock"
            className="text-muted-foreground hover:text-foreground"
          >
            View all
            <ChevronRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {alerts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">All stock levels are healthy</p>
            </div>
          ) : (
            alerts.map((item) => (
              <div
                key={item._id}
                className="flex items-center justify-between p-3 rounded-lg bg-orange-500/5 border border-orange-500/20"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {item.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    SKU: {item.SKU} • {item.category}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-lg font-bold text-orange-600 dark:text-orange-400">
                      {item.stock}
                    </p>
                    <p className="text-xs text-muted-foreground">in stock</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// OVERDUE CHECKOUTS
// ============================================
export async function OverdueCheckoutsCard({}) {
  const checkouts = await getOverdueCheckouts();
  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <CardTitle className="text-foreground flex items-center gap-2">
            <Clock className="h-5 w-5 text-red-500" />
            Overdue Checkouts
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Items past return date
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link
            href="/dashboard/checkout?status=overdue"
            className="text-muted-foreground hover:text-foreground"
          >
            View all
            <ChevronRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {checkouts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No overdue checkouts</p>
            </div>
          ) : (
            checkouts.map((checkout) => (
              <div
                key={checkout._id}
                className="flex items-start justify-between p-3 rounded-lg bg-red-500/5 border border-red-500/20"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {checkout.productSnapshot.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {checkout.checkedOutTo.name} •{" "}
                    {checkout.checkedOutTo.department}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Checkout: {checkout.checkoutNumber}
                  </p>
                </div>
                <div className="text-right">
                  <Badge
                    variant="outline"
                    className="bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
                  >
                    {checkout.daysOverdue}d overdue
                  </Badge>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
