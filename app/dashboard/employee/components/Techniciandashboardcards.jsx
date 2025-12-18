import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Link from "next/link";
import {
  FileText,
  AlertTriangle,
  ChevronRight,
  Package,
  Clock,
} from "lucide-react";
import {
  getMyOverdueItems,
  getMyRequests,
} from "@/app/mongodb/queries/tech-dashboard-queries";
import { auth } from "@/auth";

// ============================================
// MY REQUESTS CARD
// ============================================
export async function MyRequestsCard({}) {
  const { user } = await auth();
  const requests = await getMyRequests(user.id, 10);
  const statusColors = {
    pending:
      "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
    approved:
      "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
    rejected: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
    fulfilled:
      "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    partially_fulfilled:
      "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  };

  const priorityColors = {
    low: "text-gray-600 dark:text-gray-400",
    normal: "text-blue-600 dark:text-blue-400",
    high: "text-orange-600 dark:text-orange-400",
    urgent: "text-red-600 dark:text-red-400",
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
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <CardTitle className="text-foreground">My Requests</CardTitle>
          <CardDescription className="text-muted-foreground">
            Your recent stock requests
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link
            href="/dashboard/my-requests"
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
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No requests yet</p>
              <p className="text-xs mt-1">Create your first stock request</p>
              <Button
                className="mt-4 bg-yellow-500 hover:bg-yellow-600 text-black font-medium"
                asChild
              >
                <Link href="/dashboard/requests/create">Request Stock</Link>
              </Button>
            </div>
          ) : (
            requests.slice(0, 5).map((request) => (
              <div
                key={request._id}
                className="flex items-start justify-between p-3 rounded-lg hover:bg-accent transition-colors border border-border cursor-pointer"
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
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Package className="h-3 w-3" />
                    <span>{request.itemCount} items</span>
                    <span>•</span>
                    <span className={priorityColors[request.priority]}>
                      {request.priority}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDate(request.createdAt)}
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
// OVERDUE ALERT
// ============================================
export async function OverdueAlert({}) {
  const { user } = await auth();

  const overdueItems = await getMyOverdueItems(user.id);
  if (overdueItems.length === 0) return null;

  return (
    <Alert className="bg-red-500/10 border-red-500/20">
      <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
      <AlertTitle className="text-red-600 dark:text-red-400 font-semibold">
        {overdueItems.length} Overdue{" "}
        {overdueItems.length === 1 ? "Item" : "Items"}
      </AlertTitle>
      <AlertDescription className="text-red-600 dark:text-red-400 mt-2">
        <div className="space-y-2">
          {overdueItems.map((item) => (
            <div
              key={item._id}
              className="flex items-start justify-between gap-3"
            >
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {item.productSnapshot.name}
                  {item.serialNo && (
                    <span className="text-xs font-normal ml-2">
                      (S/N: {item.serialNo})
                    </span>
                  )}
                </p>
                <p className="text-xs mt-1">
                  <Clock className="inline h-3 w-3 mr-1" />
                  {item.daysOverdue} {item.daysOverdue === 1 ? "day" : "days"}{" "}
                  overdue
                </p>
              </div>
              <Button
                size="sm"
                className="bg-red-600 hover:bg-red-700 text-white"
                asChild
              >
                <Link href={`/dashboard/checkout/${item._id}/return`}>
                  Return Now
                </Link>
              </Button>
            </div>
          ))}
        </div>
      </AlertDescription>
    </Alert>
  );
}

// ============================================
// QUICK ACTIONS CARD
// ============================================
export function QuickActionsCard() {
  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-foreground">Quick Actions</CardTitle>
        <CardDescription className="text-muted-foreground">
          Common tasks and shortcuts
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          <Button
            className="h-auto flex-col items-start p-4 bg-yellow-500 hover:bg-yellow-600 text-black font-medium"
            asChild
          >
            <Link href="/dashboard/requests/create">
              <FileText className="h-5 w-5 mb-2" />
              <span className="text-sm">Request Stock</span>
              <span className="text-xs font-normal opacity-80">
                Create new request
              </span>
            </Link>
          </Button>

          <Button
            variant="outline"
            className="h-auto flex-col items-start p-4 border-border hover:bg-accent"
            asChild
          >
            <Link href="/dashboard/stocks">
              <Package className="h-5 w-5 mb-2" />
              <span className="text-sm">Browse Stock</span>
              <span className="text-xs font-normal text-muted-foreground">
                View available items
              </span>
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
