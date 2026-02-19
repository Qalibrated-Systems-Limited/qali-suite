import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Edit,
  Activity,
  PauseCircle,
  CheckCircle2,
  Clock,
  TrendingUp,
  Wallet,
  AlertTriangle,
  BarChart3,
} from "lucide-react";
import {
  getProjectById,
  getProjectFinancialSummary,
  getProjectBudgetVsActual,
  getProjectTransactions,
  getSubprojects,
} from "@/app/mongodb/queries/projectQueries";
import ProjectStatusActions from "../components/ProjectStatusActions";
import { FormBanner } from "@/components/ui/form-banner";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const project = await getProjectById(id);
  return {
    title: project
      ? `${project.name} | Projects`
      : "Project Not Found",
  };
}

const STATUS_CONFIG = {
  planning: { label: "Planning", color: "bg-slate-100 text-slate-700", icon: Clock },
  active: { label: "Active", color: "bg-emerald-100 text-emerald-700", icon: Activity },
  on_hold: { label: "On Hold", color: "bg-amber-100 text-amber-700", icon: PauseCircle },
  completed: { label: "Completed", color: "bg-blue-100 text-blue-700", icon: CheckCircle2 },
  closed: { label: "Closed", color: "bg-gray-100 text-gray-500", icon: CheckCircle2 },
};

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-KE", {
    style: "decimal",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

function formatDate(date) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-KE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ============================================
// FINANCIAL SUMMARY CARD
// ============================================
async function FinancialSummaryCard({ projectId, budget }) {
  const liveFinancials = await getProjectFinancialSummary(projectId);
  if (!liveFinancials) return null;

  const { revenue, costs, committed } = liveFinancials;
  const budgetAmount = budget?.amount || 0;
  const available = budgetAmount > 0 ? budgetAmount - costs - committed : 0;
  const margin = revenue - costs;
  const marginPct = revenue > 0 ? Math.round((margin / revenue) * 100) : 0;
  const utilPct = budgetAmount > 0 ? Math.round(((costs + committed) / budgetAmount) * 100) : 0;

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="rounded-lg p-2.5 bg-blue-500/10">
          <TrendingUp className="h-5 w-5 text-blue-500" />
        </div>
        <h2 className="font-semibold text-lg">Financial Summary</h2>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-6">
        {budgetAmount > 0 && (
          <div>
            <p className="text-xs text-muted-foreground">Budget</p>
            <p className="text-sm sm:text-lg font-bold">KES {formatCurrency(budgetAmount)}</p>
          </div>
        )}
        <div>
          <p className="text-xs text-muted-foreground">Revenue</p>
          <p className="text-sm sm:text-lg font-bold text-emerald-600">
            KES {formatCurrency(revenue)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Costs (Paid)</p>
          <p className="text-sm sm:text-lg font-bold text-red-600">
            KES {formatCurrency(costs)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Committed</p>
          <p className="text-sm sm:text-lg font-bold text-amber-600">
            KES {formatCurrency(committed)}
          </p>
        </div>
        {budgetAmount > 0 && (
          <div>
            <p className="text-xs text-muted-foreground">Available</p>
            <p
              className={`text-sm sm:text-lg font-bold ${available < 0 ? "text-red-600" : "text-foreground"}`}
            >
              KES {formatCurrency(available)}
            </p>
          </div>
        )}
        <div>
          <p className="text-xs text-muted-foreground">Margin</p>
          <p
            className={`text-sm sm:text-lg font-bold ${margin >= 0 ? "text-emerald-600" : "text-red-600"}`}
          >
            KES {formatCurrency(margin)}{" "}
            {revenue > 0 && (
              <span className="text-xs sm:text-sm font-normal">({marginPct}%)</span>
            )}
          </p>
        </div>
      </div>

      {/* Budget Progress Bar */}
      {budgetAmount > 0 && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Budget Utilization</span>
            <span
              className={`font-medium ${
                utilPct >= 90
                  ? "text-red-600"
                  : utilPct >= 70
                    ? "text-amber-600"
                    : "text-emerald-600"
              }`}
            >
              {utilPct}%
            </span>
          </div>
          <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
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
          {utilPct >= 90 && (
            <div className="flex items-center gap-2 text-sm text-red-600 mt-1">
              <AlertTriangle className="h-4 w-4" />
              <span>
                {utilPct > 100 ? "Over budget!" : "Budget nearly exhausted"}
              </span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ============================================
// BUDGET VS ACTUAL CARD
// ============================================
async function BudgetVsActualCard({ projectId }) {
  const data = await getProjectBudgetVsActual(projectId);
  if (!data) return null;

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="rounded-lg p-2.5 bg-purple-500/10">
          <BarChart3 className="h-5 w-5 text-purple-500" />
        </div>
        <div>
          <h2 className="font-semibold text-lg">Budget vs Actual</h2>
          <p className="text-xs text-muted-foreground">
            Budget v{data.version} — per expense account
          </p>
        </div>
      </div>

      {/* Mobile: Card layout */}
      <div className="sm:hidden space-y-3">
        {data.lines.map((line) => (
          <div key={line.accountId} className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {line.accountName}
                </p>
                <p className="text-xs text-muted-foreground font-mono">
                  {line.accountCode}
                </p>
              </div>
              <span
                className={`text-sm font-semibold shrink-0 ${
                  line.percentUsed >= 90
                    ? "text-red-600"
                    : line.percentUsed >= 70
                      ? "text-amber-600"
                      : "text-emerald-600"
                }`}
              >
                {line.percentUsed}%
              </span>
            </div>
            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  line.percentUsed >= 90
                    ? "bg-red-500"
                    : line.percentUsed >= 70
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                }`}
                style={{ width: `${Math.min(line.percentUsed, 100)}%` }}
              />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Budget</span>
                <span>{formatCurrency(line.budgeted)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Actual</span>
                <span>{formatCurrency(line.actual)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Committed</span>
                <span>{formatCurrency(line.committed)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Available</span>
                <span className={line.available < 0 ? "text-red-600 font-medium" : ""}>
                  {formatCurrency(line.available)}
                </span>
              </div>
            </div>
          </div>
        ))}
        {/* Mobile totals */}
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-sm font-semibold mb-1">Totals</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Budget</span>
              <span className="font-medium">{formatCurrency(data.totalBudgeted)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Actual</span>
              <span className="font-medium">{formatCurrency(data.lines.reduce((s, l) => s + l.actual, 0))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Committed</span>
              <span className="font-medium">{formatCurrency(data.lines.reduce((s, l) => s + l.committed, 0))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Available</span>
              <span className="font-medium">{formatCurrency(data.lines.reduce((s, l) => s + l.available, 0))}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Desktop: Table layout */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="pb-2 font-medium text-muted-foreground">Account</th>
              <th className="pb-2 font-medium text-muted-foreground text-right">Budget</th>
              <th className="pb-2 font-medium text-muted-foreground text-right">Actual</th>
              <th className="pb-2 font-medium text-muted-foreground text-right">Committed</th>
              <th className="pb-2 font-medium text-muted-foreground text-right">Available</th>
              <th className="pb-2 font-medium text-muted-foreground text-right">Used</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line) => (
              <tr key={line.accountId} className="border-b last:border-0">
                <td className="py-2">
                  <span className="font-mono text-xs text-muted-foreground mr-2">
                    {line.accountCode}
                  </span>
                  {line.accountName}
                  {line.description && (
                    <p className="text-xs text-muted-foreground">
                      {line.description}
                    </p>
                  )}
                </td>
                <td className="py-2 text-right">
                  {formatCurrency(line.budgeted)}
                </td>
                <td className="py-2 text-right">{formatCurrency(line.actual)}</td>
                <td className="py-2 text-right">
                  {formatCurrency(line.committed)}
                </td>
                <td
                  className={`py-2 text-right ${line.available < 0 ? "text-red-600 font-medium" : ""}`}
                >
                  {formatCurrency(line.available)}
                </td>
                <td className="py-2 text-right">
                  <span
                    className={`${
                      line.percentUsed >= 90
                        ? "text-red-600 font-medium"
                        : line.percentUsed >= 70
                          ? "text-amber-600"
                          : ""
                    }`}
                  >
                    {line.percentUsed}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t font-medium">
              <td className="pt-2">Total</td>
              <td className="pt-2 text-right">
                {formatCurrency(data.totalBudgeted)}
              </td>
              <td className="pt-2 text-right">
                {formatCurrency(
                  data.lines.reduce((s, l) => s + l.actual, 0),
                )}
              </td>
              <td className="pt-2 text-right">
                {formatCurrency(
                  data.lines.reduce((s, l) => s + l.committed, 0),
                )}
              </td>
              <td className="pt-2 text-right">
                {formatCurrency(
                  data.lines.reduce((s, l) => s + l.available, 0),
                )}
              </td>
              <td className="pt-2 text-right">
                {data.totalBudgeted > 0
                  ? Math.round(
                      ((data.lines.reduce((s, l) => s + l.actual + l.committed, 0) /
                        data.totalBudgeted) *
                        100),
                    )
                  : 0}
                %
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

// ============================================
// TRANSACTIONS CARD
// ============================================
async function TransactionsCard({ projectId }) {
  const transactions = await getProjectTransactions(projectId);

  const hasClaims = transactions?.claims?.length > 0;
  const hasInvoices = transactions?.invoices?.length > 0;
  const hasBills = transactions?.bills?.length > 0;
  const hasExpenses = transactions?.expenses?.length > 0;
  const hasRequests = transactions?.requests?.length > 0;

  if (!hasClaims && !hasInvoices && !hasBills && !hasExpenses && !hasRequests) {
    return (
      <Card className="p-5 sm:p-6">
        <h2 className="font-semibold text-lg mb-3">Linked Transactions</h2>
        <p className="text-sm text-muted-foreground text-center py-8">
          No transactions linked to this project yet
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="font-semibold text-lg mb-4">Linked Transactions</h2>

      {hasClaims && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">
            Claims ({transactions.claims.length})
          </h3>
          <div className="space-y-2">
            {transactions.claims.map((claim) => (
              <Link
                key={claim._id}
                href={`/dashboard/claims/${claim._id}`}
                className="flex items-start justify-between gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-muted-foreground">
                      {claim.claimNumber}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {claim.status}
                    </Badge>
                  </div>
                  <p className="text-sm font-medium mt-0.5 truncate">{claim.employee?.name}</p>
                  {claim.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {claim.description}
                    </p>
                  )}
                </div>
                <p className="text-sm font-semibold shrink-0">
                  KES {formatCurrency(claim.totalAmount)}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {hasInvoices && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">
            Invoices ({transactions.invoices.length})
          </h3>
          <div className="space-y-2">
            {transactions.invoices.map((inv) => (
              <Link
                key={inv._id}
                href={`/dashboard/invoices/${inv._id}`}
                className="flex items-start justify-between gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-muted-foreground">
                      {inv.invoiceNumber}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {inv.status}
                    </Badge>
                  </div>
                  <p className="text-sm font-medium mt-0.5 truncate">{inv.customer?.name}</p>
                </div>
                <p className="text-sm font-semibold shrink-0">
                  KES {formatCurrency(inv.total)}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {hasBills && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">
            Bills ({transactions.bills.length})
          </h3>
          <div className="space-y-2">
            {transactions.bills.map((bill) => (
              <Link
                key={bill._id}
                href={`/dashboard/bills/${bill._id}`}
                className="flex items-start justify-between gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-muted-foreground">
                      {bill.billNumber}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {bill.status}
                    </Badge>
                  </div>
                  <p className="text-sm font-medium mt-0.5 truncate">{bill.vendor?.name}</p>
                </div>
                <p className="text-sm font-semibold shrink-0">
                  KES {formatCurrency(bill.amounts?.netPayable || bill.amounts?.total)}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {hasExpenses && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">
            Expenses ({transactions.expenses.length})
          </h3>
          <div className="space-y-2">
            {transactions.expenses.map((exp) => (
              <Link
                key={exp._id}
                href={`/dashboard/expenses/${exp._id}`}
                className="flex items-start justify-between gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-muted-foreground">
                      {exp.expenseNumber}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {exp.status}
                    </Badge>
                  </div>
                  <p className="text-sm font-medium mt-0.5 truncate">
                    {exp.accountName || exp.category}
                  </p>
                </div>
                <p className="text-sm font-semibold shrink-0">
                  KES {formatCurrency(exp.total)}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {hasRequests && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">
            Stock Requests ({transactions.requests.length})
          </h3>
          <div className="space-y-2">
            {transactions.requests.map((req) => (
              <Link
                key={req._id}
                href={`/dashboard/requests/${req._id}`}
                className="flex items-start justify-between gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-muted-foreground">
                      {req.requestNumber}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {req.status}
                    </Badge>
                  </div>
                  <p className="text-sm font-medium mt-0.5 truncate">{req.requester?.name}</p>
                </div>
                <p className="text-sm font-semibold shrink-0">
                  KES {formatCurrency(req.totalValue)}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ============================================
// MAIN PAGE COMPONENT
// ============================================
export default async function ProjectDetailPage({ params, searchParams }) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const session = await auth();

  if (!session?.user) redirect("/login");

  const project = await getProjectById(id);
  if (!project) notFound();

  // Fetch parent project info + subprojects in parallel
  const [parentProject, subprojects] = await Promise.all([
    project.parentProjectId ? getProjectById(project.parentProjectId) : null,
    getSubprojects(id),
  ]);

  const statusCfg = STATUS_CONFIG[project.status] || STATUS_CONFIG.planning;
  const StatusIcon = statusCfg.icon;

  return (
    <div className="flex flex-col gap-4 sm:gap-6 p-4 sm:p-6 lg:p-8">
      <FormBanner searchParams={resolvedSearchParams} />
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-start gap-3 sm:gap-4">
          <Button variant="ghost" size="icon" asChild className="mt-1 shrink-0">
            <Link href="/dashboard/projects">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-mono text-xs sm:text-sm text-muted-foreground">
                {project.projectNumber}
              </span>
              <Badge className={statusCfg.color}>
                <StatusIcon className="h-3 w-3 mr-1" />
                {statusCfg.label}
              </Badge>
              {project.priority !== "normal" && (
                <Badge variant="outline" className="text-xs">
                  {project.priority}
                </Badge>
              )}
            </div>
            <h1 className="text-xl sm:text-3xl font-bold text-foreground truncate">
              {project.name}
            </h1>
            {project.description && (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2 sm:line-clamp-none max-w-2xl">
                {project.description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 pl-11 sm:pl-14">
          {project.status !== "closed" && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/dashboard/projects/${id}/edit`}>
                <Edit className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Edit</span>
              </Link>
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <Link href={`/dashboard/projects/${id}/budget`}>
              <Wallet className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Budget</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* Project Info Card */}
      <Card className="p-5 sm:p-6 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Client</p>
            <p className="text-sm font-medium">
              {project.client?.name || "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Project Manager</p>
            <p className="text-sm font-medium">
              {project.projectManager?.name || "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Start Date</p>
            <p className="text-sm font-medium">{formatDate(project.startDate)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">End Date</p>
            <p className="text-sm font-medium">{formatDate(project.endDate)}</p>
          </div>
        </div>

        {/* Contract & Billing Info */}
        {(project.contractValue || project.billingModel || project.parentProjectId) && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3 border-t">
            {project.contractValue != null && (
              <div>
                <p className="text-xs text-muted-foreground">Contract Value</p>
                <p className="text-sm font-medium">
                  KES {formatCurrency(project.contractValue)}
                </p>
              </div>
            )}
            {project.billingModel && (
              <div>
                <p className="text-xs text-muted-foreground">Billing Model</p>
                <p className="text-sm font-medium capitalize">
                  {project.billingModel === "time_material"
                    ? "Time & Material"
                    : project.billingModel}
                </p>
              </div>
            )}
            {project.parentProjectId && parentProject && (
              <div className="col-span-2 sm:col-span-2">
                <p className="text-xs text-muted-foreground">Parent Project</p>
                <Link
                  href={`/dashboard/projects/${project.parentProjectId}`}
                  className="text-sm font-medium text-blue-600 hover:underline"
                >
                  {parentProject.projectNumber} — {parentProject.name}
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Progress */}
        {project.progressPercent > 0 && (
          <div className="pt-3 border-t space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium">{project.progressPercent}%</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500 transition-all"
                style={{ width: `${project.progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {project.tags?.length > 0 && (
          <div className="pt-3 border-t flex flex-wrap gap-2">
            {project.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </Card>

      {/* Status Actions */}
      <ProjectStatusActions
        projectId={id}
        currentStatus={project.status}
        userRole={session.user.role}
      />

      {/* Subprojects */}
      {subprojects.length > 0 && (
        <Card className="p-5 sm:p-6">
          <h2 className="font-semibold text-lg mb-3">
            Subprojects ({subprojects.length})
          </h2>
          <div className="space-y-2">
            {subprojects.map((sub) => {
              const subStatus = STATUS_CONFIG[sub.status] || STATUS_CONFIG.planning;
              return (
                <Link
                  key={sub._id}
                  href={`/dashboard/projects/${sub._id}`}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">
                        {sub.projectNumber}
                      </span>
                      <Badge className={`${subStatus.color} text-xs`}>
                        {subStatus.label}
                      </Badge>
                    </div>
                    <p className="text-sm font-medium mt-0.5 truncate">{sub.name}</p>
                  </div>
                  <div className="text-right shrink-0">
                    {sub.budget?.amount > 0 && (
                      <p className="text-sm font-semibold">
                        KES {formatCurrency(sub.budget.amount)}
                      </p>
                    )}
                    {sub.progressPercent > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {sub.progressPercent}% complete
                      </p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>
      )}

      {/* Financial Summary */}
      <Suspense
        fallback={
          <Card className="p-6 animate-pulse">
            <div className="h-6 w-40 bg-muted rounded mb-4" />
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <div className="h-3 w-16 bg-muted rounded" />
                  <div className="h-6 w-24 bg-muted rounded" />
                </div>
              ))}
            </div>
          </Card>
        }
      >
        <FinancialSummaryCard
          projectId={id}
          budget={project.budget}
        />
      </Suspense>

      {/* Budget vs Actual */}
      <Suspense
        fallback={
          <Card className="p-6 animate-pulse">
            <div className="h-6 w-40 bg-muted rounded mb-4" />
            <div className="h-32 w-full bg-muted rounded" />
          </Card>
        }
      >
        <BudgetVsActualCard projectId={id} />
      </Suspense>

      {/* Transactions */}
      <Suspense
        fallback={
          <Card className="p-6 animate-pulse">
            <div className="h-6 w-40 bg-muted rounded mb-4" />
            <div className="h-20 w-full bg-muted rounded" />
          </Card>
        }
      >
        <TransactionsCard projectId={id} />
      </Suspense>
    </div>
  );
}
