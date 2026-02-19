import { Card } from "@/components/ui/card";
import {
  FolderKanban,
  Activity,
  PauseCircle,
  CheckCircle2,
  TrendingUp,
} from "lucide-react";
import { getProjectStats } from "@/app/mongodb/queries/projectQueries";

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-KE", {
    style: "decimal",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export default async function ProjectStats() {
  const stats = await getProjectStats();

  const cards = [
    {
      label: "Total Projects",
      value: stats.total,
      icon: FolderKanban,
      iconColor: "text-blue-500",
      iconBg: "bg-blue-500/10",
    },
    {
      label: "Active",
      value: stats.active,
      icon: Activity,
      iconColor: "text-emerald-500",
      iconBg: "bg-emerald-500/10",
    },
    {
      label: "On Hold",
      value: stats.onHold,
      icon: PauseCircle,
      iconColor: "text-amber-500",
      iconBg: "bg-amber-500/10",
    },
    {
      label: "Completed",
      value: stats.completed + stats.closed,
      icon: CheckCircle2,
      iconColor: "text-purple-500",
      iconBg: "bg-purple-500/10",
    },
  ];

  return (
    <div className="space-y-4">
      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {cards.map((card) => (
          <Card key={card.label} className="p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <div className={`rounded-lg p-2.5 ${card.iconBg}`}>
                <card.icon className={`h-5 w-5 ${card.iconColor}`} />
              </div>
              <div>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  {card.label}
                </p>
                <p className="text-xl sm:text-2xl font-bold">{card.value}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Budget Summary */}
      {stats.totalBudget > 0 && (
        <Card className="p-4 sm:p-5 bg-gradient-to-r from-blue-500/5 to-purple-500/5">
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-lg p-2.5 bg-blue-500/10">
              <TrendingUp className="h-5 w-5 text-blue-500" />
            </div>
            <h3 className="font-semibold">Active Projects Summary</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Total Budget</p>
              <p className="text-lg font-bold">
                KES {formatCurrency(stats.totalBudget)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Revenue</p>
              <p className="text-lg font-bold text-emerald-600">
                KES {formatCurrency(stats.totalRevenue)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Costs</p>
              <p className="text-lg font-bold text-red-600">
                KES {formatCurrency(stats.totalCosts)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Committed</p>
              <p className="text-lg font-bold text-amber-600">
                KES {formatCurrency(stats.totalCommitted)}
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

export function ProjectStatsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="p-4 sm:p-5 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted" />
              <div className="space-y-2">
                <div className="h-3 w-16 bg-muted rounded" />
                <div className="h-6 w-10 bg-muted rounded" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
