import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
  FolderKanban,
  AlertTriangle,
  TrendingUp,
  ExternalLink,
} from "lucide-react";
import {
  getProjectById,
  getProjectFinancialSummary,
  getProjectBudgetVsActual,
} from "@/app/mongodb/queries/projectQueries";

function fmt(amount) {
  return new Intl.NumberFormat("en-KE", {
    style: "decimal",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export default async function ProjectContextCard({
  projectId,
  claimAmount = 0,
  claimStatus = null,
  expenseAccountId = null,
}) {
  if (!projectId) return null;

  const [project, liveFinancials, budgetVsActual] = await Promise.all([
    getProjectById(projectId),
    getProjectFinancialSummary(projectId),
    getProjectBudgetVsActual(projectId),
  ]);

  if (!project) return null;

  const budget = project.budget?.amount || 0;
  const spent = liveFinancials?.costs || 0;
  const committed = liveFinancials?.committed || 0;

  // paid/settled → claim already in costs, show actual state (no projection)
  // submitted/approved → claim already in committed, subtract to show pre-claim state
  // draft/rejected → not counted yet, show projection as-is
  const alreadyFinalized = ["paid", "settled"].includes(claimStatus);
  const alreadyInCommitted = ["submitted", "approved"].includes(claimStatus);
  const adjustedCommitted = alreadyInCommitted ? committed - claimAmount : committed;
  const used = spent + adjustedCommitted;
  const remaining = budget > 0 ? budget - used : 0;

  // Only show projection for claims not yet finalized
  const showProjection = !alreadyFinalized && claimAmount > 0;
  const remainingAfter = showProjection ? remaining - claimAmount : remaining;

  const pctUsed = budget > 0 ? Math.round((used / budget) * 100) : 0;
  const pctAfter = showProjection
    ? budget > 0 ? Math.round(((used + claimAmount) / budget) * 100) : 0
    : pctUsed;

  const barColor = (pct) => {
    if (pct > 100) return "bg-red-500";
    if (pct >= 90) return "bg-red-500";
    if (pct >= 70) return "bg-amber-500";
    return "bg-emerald-500";
  };

  const textColor = (pct) => {
    if (pct > 100) return "text-red-600";
    if (pct >= 90) return "text-red-500";
    if (pct >= 70) return "text-amber-600";
    return "text-emerald-600";
  };

  // Per-line budget detail for this claim's expense account
  let lineDetail = null;
  if (expenseAccountId && budgetVsActual?.lines) {
    lineDetail = budgetVsActual.lines.find(
      (l) => l.accountId === expenseAccountId,
    );
  }

  return (
    <Card className="p-4 sm:p-5 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <FolderKanban className="h-4 w-4 text-blue-500 shrink-0" />
          <Link
            href={`/dashboard/projects/${project._id}`}
            className="font-medium text-sm hover:underline flex items-center gap-1 truncate"
          >
            {project.name}
            <ExternalLink className="h-3 w-3 shrink-0" />
          </Link>
          <Badge variant="secondary" className="text-xs font-mono shrink-0">
            {project.projectNumber}
          </Badge>
        </div>
        <Badge
          variant="secondary"
          className="text-xs capitalize bg-blue-100 text-blue-700 shrink-0"
        >
          {project.status?.replace("_", " ")}
        </Badge>
      </div>

      {budget > 0 ? (
        <div className="space-y-3">
          {/* Stacked progress bar: spent | this claim | remaining */}
          <div className="space-y-1.5">
            <div className="w-full h-3 bg-white dark:bg-gray-800 rounded-full overflow-hidden flex">
              {/* Already used portion */}
              {pctUsed > 0 && (
                <div
                  className={`h-full ${barColor(pctUsed)} transition-all`}
                  style={{ width: `${Math.min(pctUsed, 100)}%` }}
                />
              )}
              {/* This claim's portion (striped/lighter to distinguish) */}
              {claimAmount > 0 && pctAfter > pctUsed && (
                <div
                  className={`h-full ${barColor(pctAfter)} opacity-50 transition-all`}
                  style={{ width: `${Math.min(pctAfter - pctUsed, 100 - Math.min(pctUsed, 100))}%` }}
                />
              )}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>KES {fmt(used)} used of KES {fmt(budget)}</span>
              <span className={textColor(pctUsed)}>
                {pctUsed}%
              </span>
            </div>
          </div>

          {/* Claim impact — only for pending/uncommitted claims */}
          {showProjection && (
            <div className="flex items-center justify-between text-sm pt-1 border-t border-blue-200 dark:border-blue-800">
              <span className="text-muted-foreground">
                After this <span className="font-medium text-foreground">KES {fmt(claimAmount)}</span> claim
              </span>
              <span className={`font-semibold ${remainingAfter < 0 ? "text-red-600" : textColor(pctAfter)}`}>
                KES {fmt(remainingAfter)} left ({pctAfter}%)
              </span>
            </div>
          )}

          {/* Warning / over budget */}
          {pctAfter >= 90 && pctAfter <= 100 && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Nearing budget limit ({pctAfter}%)</span>
            </div>
          )}
          {pctAfter > 100 && (
            <div className="flex items-center gap-1.5 text-xs text-red-600 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>This claim exceeds the project budget by KES {fmt(Math.abs(remainingAfter))}</span>
            </div>
          )}

          {/* Line-item detail (if claim maps to a budget line) */}
          {lineDetail && claimAmount > 0 && (() => {
            const lineUsed = lineDetail.actual + lineDetail.committed;
            const lineRemaining = lineDetail.budgeted - lineUsed - claimAmount;
            const linePct = lineDetail.budgeted > 0
              ? Math.round(((lineUsed + claimAmount) / lineDetail.budgeted) * 100)
              : 0;
            return (
              <div className="text-xs text-muted-foreground pt-1 border-t border-blue-200 dark:border-blue-800">
                <span className="font-mono">{lineDetail.accountCode}</span>{" "}
                {lineDetail.accountName}:{" "}
                <span className={`font-medium ${lineRemaining < 0 ? "text-red-600" : linePct >= 90 ? "text-amber-600" : "text-foreground"}`}>
                  KES {fmt(lineRemaining)} left
                </span>
                {" "}of KES {fmt(lineDetail.budgeted)} budgeted
                {linePct >= 90 && linePct <= 100 && " — nearing limit"}
                {linePct > 100 && " — over budget"}
              </div>
            );
          })()}
        </div>
      ) : (
        /* No budget set */
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <TrendingUp className="h-4 w-4" />
          <span>
            {project.projectManager?.name
              ? `PM: ${project.projectManager.name}`
              : "No budget set for this project"}
          </span>
        </div>
      )}
    </Card>
  );
}
