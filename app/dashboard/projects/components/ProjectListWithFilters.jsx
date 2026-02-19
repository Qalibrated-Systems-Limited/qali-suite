"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FolderKanban,
  Activity,
  PauseCircle,
  CheckCircle2,
  Clock,
  ArrowRight,
} from "lucide-react";

const STATUS_CONFIG = {
  planning: { label: "Planning", color: "bg-slate-100 text-slate-700", icon: Clock },
  active: { label: "Active", color: "bg-emerald-100 text-emerald-700", icon: Activity },
  on_hold: { label: "On Hold", color: "bg-amber-100 text-amber-700", icon: PauseCircle },
  completed: { label: "Completed", color: "bg-blue-100 text-blue-700", icon: CheckCircle2 },
  closed: { label: "Closed", color: "bg-gray-100 text-gray-500", icon: CheckCircle2 },
};

const PRIORITY_CONFIG = {
  low: { label: "Low", color: "bg-slate-100 text-slate-600" },
  normal: { label: "Normal", color: "bg-blue-100 text-blue-600" },
  high: { label: "High", color: "bg-orange-100 text-orange-600" },
  critical: { label: "Critical", color: "bg-red-100 text-red-600" },
};

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-KE", {
    style: "decimal",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

function ProjectCard({ project }) {
  const statusCfg = STATUS_CONFIG[project.status] || STATUS_CONFIG.planning;
  const priorityCfg = PRIORITY_CONFIG[project.priority] || PRIORITY_CONFIG.normal;
  const StatusIcon = statusCfg.icon;

  const budgetAmount = project.budget?.amount || 0;
  const totalCosts = project.financials?.totalCosts || 0;
  const totalCommitted = project.financials?.totalCommitted || 0;
  const used = totalCosts + totalCommitted;
  const utilPct = budgetAmount > 0 ? Math.round((used / budgetAmount) * 100) : 0;

  return (
    <Link href={`/dashboard/projects/${project._id}`}>
      <Card className="p-4 sm:p-5 hover:bg-muted/50 transition-colors cursor-pointer group">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="font-mono text-xs text-muted-foreground">
              {project.projectNumber}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {project.priority !== "normal" && (
              <Badge variant="secondary" className={`text-xs ${priorityCfg.color}`}>
                {priorityCfg.label}
              </Badge>
            )}
            <Badge variant="secondary" className={`text-xs ${statusCfg.color}`}>
              <StatusIcon className="h-3 w-3 mr-1" />
              {statusCfg.label}
            </Badge>
          </div>
        </div>

        <h3 className="font-semibold text-sm sm:text-base mb-1 truncate">
          {project.name}
        </h3>

        {project.client?.name && (
          <p className="text-xs text-muted-foreground mb-2">
            Client: {project.client.name}
          </p>
        )}

        {budgetAmount > 0 && (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                Budget: KES {formatCurrency(budgetAmount)}
              </span>
              <span
                className={
                  utilPct >= 90
                    ? "text-red-600 font-medium"
                    : utilPct >= 70
                      ? "text-amber-600 font-medium"
                      : "text-muted-foreground"
                }
              >
                {utilPct}% used
              </span>
            </div>
            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  utilPct >= 90
                    ? "bg-red-500"
                    : utilPct >= 70
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                }`}
                style={{ width: `${Math.min(utilPct, 100)}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mt-3 pt-3 border-t">
          {project.projectManager?.name && (
            <span className="text-xs text-muted-foreground">
              PM: {project.projectManager.name}
            </span>
          )}
          <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
        </div>
      </Card>
    </Link>
  );
}

const statusFilters = [
  { value: "all", label: "All" },
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
];

export default function ProjectListWithFilters({
  projects,
  currentStatus = "all",
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleFilterChange = (value) => {
    const params = new URLSearchParams(searchParams);
    if (value === "all") {
      params.delete("status");
    } else {
      params.set("status", value);
    }
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      {/* Status Filter */}
      <div className="space-y-3">
        <p className="text-sm font-semibold text-foreground">Filter by Status</p>
        <Tabs value={currentStatus} onValueChange={handleFilterChange}>
          <TabsList className="grid w-full grid-cols-3 lg:grid-cols-5 h-auto gap-2 p-1 bg-muted">
            {statusFilters.map((filter) => (
              <TabsTrigger
                key={filter.value}
                value={filter.value}
                className="text-sm font-medium py-2.5 px-3 data-[state=active]:bg-yellow-500 data-[state=active]:text-black data-[state=active]:shadow-sm"
              >
                {filter.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Results Count */}
      <div className="flex items-center justify-between pt-2">
        <p className="text-sm sm:text-base text-muted-foreground">
          {projects.length > 0 ? (
            <>
              Showing{" "}
              <span className="font-semibold text-foreground">
                {projects.length}
              </span>{" "}
              project{projects.length !== 1 ? "s" : ""}
            </>
          ) : (
            "No projects found"
          )}
        </p>
      </div>

      {/* Projects Grid */}
      {projects.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
          {projects.map((project) => (
            <ProjectCard key={project._id} project={project} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 sm:py-20 text-center px-4">
          <div className="w-20 h-20 sm:w-24 sm:h-24 mb-6 rounded-full bg-muted flex items-center justify-center">
            <FolderKanban className="h-10 w-10 text-muted-foreground" />
          </div>
          <h3 className="text-lg sm:text-xl font-semibold text-foreground mb-2">
            No projects found
          </h3>
          <p className="text-sm sm:text-base text-muted-foreground max-w-md">
            {currentStatus !== "all"
              ? "Try adjusting your filters to see more projects"
              : "Get started by creating your first project"}
          </p>
        </div>
      )}
    </div>
  );
}

export function ProjectListSkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="h-4 w-20 bg-muted rounded animate-pulse" />
        <div className="h-10 w-full bg-muted rounded animate-pulse" />
      </div>
      <div className="h-4 w-32 bg-muted rounded animate-pulse" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="p-5 animate-pulse">
            <div className="flex items-center justify-between mb-3">
              <div className="h-4 w-28 bg-muted rounded" />
              <div className="h-5 w-16 bg-muted rounded" />
            </div>
            <div className="h-5 w-48 bg-muted rounded mb-2" />
            <div className="h-3 w-32 bg-muted rounded mb-3" />
            <div className="h-1.5 w-full bg-muted rounded mt-3" />
          </Card>
        ))}
      </div>
    </div>
  );
}
