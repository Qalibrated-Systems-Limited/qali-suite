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
  Package,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Clock,
  ChevronRight,
} from "lucide-react";
import { getMyBorrowedItems } from "@/app/mongodb/queries/tech-dashboard-queries";
import { auth } from "@/auth";

export async function MyBorrowedItemsCard({}) {
  const { user } = await auth();
  const items = await getMyBorrowedItems(user.id);
  const getUrgencyConfig = (urgency) => {
    switch (urgency) {
      case "overdue":
        return {
          color:
            "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
          icon: AlertTriangle,
          iconColor: "text-red-500",
        };
      case "soon":
        return {
          color:
            "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
          icon: Clock,
          iconColor: "text-orange-500",
        };
      default:
        return {
          color:
            "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
          icon: CheckCircle,
          iconColor: "text-green-500",
        };
    }
  };

  const formatDueDate = (daysUntilDue) => {
    if (daysUntilDue < 0) {
      return `${Math.abs(daysUntilDue)} days overdue`;
    } else if (daysUntilDue === 0) {
      return "Due today";
    } else if (daysUntilDue === 1) {
      return "Due tomorrow";
    } else {
      return `Due in ${daysUntilDue} days`;
    }
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <CardTitle className="text-foreground">My Borrowed Items</CardTitle>
          <CardDescription className="text-muted-foreground">
            Items currently checked out to you
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link
            href="/dashboard/my-items"
            className="text-muted-foreground hover:text-foreground"
          >
            View all
            <ChevronRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No items borrowed</p>
              <p className="text-xs mt-1">
                You currently have no items checked out
              </p>
            </div>
          ) : (
            items.map((item) => {
              const config = getUrgencyConfig(item.urgency);
              const Icon = config.icon;

              return (
                <div
                  key={item._id}
                  className={`p-4 rounded-lg border ${
                    item.urgency === "overdue"
                      ? "bg-red-500/5 border-red-500/20"
                      : item.urgency === "soon"
                      ? "bg-orange-500/5 border-orange-500/20"
                      : "border-border"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <Icon className={`h-4 w-4 ${config.iconColor} `} />
                        <p className="text-sm font-semibold text-foreground truncate">
                          {item.productSnapshot.name}
                        </p>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">
                            {item.checkoutNumber}
                          </span>
                          {item.serialNo && (
                            <>
                              <span>•</span>
                              <span>S/N: {item.serialNo}</span>
                            </>
                          )}
                        </div>

                        {item.purpose && (
                          <p className="text-xs text-muted-foreground">
                            Purpose: {item.purpose}
                          </p>
                        )}

                        <div className="flex items-center gap-2 text-xs">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          <span
                            className={`font-medium ${
                              item.urgency === "overdue"
                                ? "text-red-600 dark:text-red-400"
                                : item.urgency === "soon"
                                ? "text-orange-600 dark:text-orange-400"
                                : "text-muted-foreground"
                            }`}
                          >
                            {formatDueDate(item.daysUntilDue)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      className="border-border text-foreground hover:bg-accent "
                      asChild
                    >
                      <Link href={`/dashboard/checkout/${item._id}/return`}>
                        Return
                      </Link>
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
