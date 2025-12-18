import { getTechnicianStats } from "@/app/mongodb/queries/tech-dashboard-queries";
import { auth } from "@/auth";
import { Card, CardContent } from "@/components/ui/card";
import {
  FileText,
  Package,
  Clock,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";

export async function TechnicianStatsCards({}) {
  const { user } = await auth();
  const stats = await getTechnicianStats(user.id);
  const statsConfig = [
    {
      title: "My Requests",
      value: stats.totalRequests,
      subtitle: `${stats.pendingRequests} pending`,
      icon: FileText,
      iconColor: "text-blue-500",
      bgColor: "bg-blue-500/10",
      alert: stats.pendingRequests > 0,
    },
    {
      title: "Borrowed Items",
      value: stats.borrowedItems,
      subtitle:
        stats.borrowedItems > 0 ? "Currently in use" : "No items borrowed",
      icon: Package,
      iconColor: "text-purple-500",
      bgColor: "bg-purple-500/10",
    },
    {
      title: "Due Soon",
      value: stats.dueSoonItems,
      subtitle: "Next 3 days",
      icon: Clock,
      iconColor: "text-orange-500",
      bgColor: "bg-orange-500/10",
      alert: stats.dueSoonItems > 0,
    },
    {
      title: "Overdue",
      value: stats.overdueItems,
      subtitle: stats.overdueItems > 0 ? "Return immediately" : "All good!",
      icon: AlertTriangle,
      iconColor: stats.overdueItems > 0 ? "text-red-500" : "text-green-500",
      bgColor: stats.overdueItems > 0 ? "bg-red-500/10" : "bg-green-500/10",
      alert: stats.overdueItems > 0,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {statsConfig.map((stat, index) => (
        <Card
          key={index}
          className="bg-card border-border hover:shadow-lg transition-shadow"
        >
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  {stat.title}
                </p>
                <div className="flex items-baseline gap-2">
                  <p className="text-3xl font-bold text-foreground">
                    {stat.value}
                  </p>
                  {stat.alert && (
                    <span className="flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-orange-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {stat.subtitle}
                </p>
              </div>
              <div className={`${stat.bgColor} p-3 rounded-lg`}>
                <stat.icon className={`w-5 h-5 ${stat.iconColor}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
