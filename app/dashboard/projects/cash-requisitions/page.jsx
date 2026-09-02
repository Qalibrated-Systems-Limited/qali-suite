import {
  getProjectTransactions,
  getProjectFinancialSummary,
} from "@/app/db/actions/project-actions";
import { getWorkspaceContext } from "../lib/workspace";
import WorkspaceHeader from "../components/WorkspaceHeader";
import NoProjectsCard from "../components/NoProjectsCard";
import AccessDenied from "../components/AccessDenied";
import SectionNotForType from "../components/SectionNotForType";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Link from "next/link";
import { Info, Wallet } from "lucide-react";

export const metadata = {
  title: "Cash Requisitions | Projects",
  description: "Cash claimed and spent against a project so far",
};

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-KE", {
    style: "decimal",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

export default async function CashRequisitionsPage({ searchParams }) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(sp, { section: "cashRequisitions" });
  if (ctx.denied) return <AccessDenied />;
  if (ctx.hidden) {
    return (
      <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <SectionNotForType
          section="Cash Requisitions"
          project={ctx.project}
          typeName={ctx.typeName}
        />
      </div>
    );
  }

  const { projects, project } = ctx;

  if (!project) {
    return (
      <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <WorkspaceHeader
          title="Cash Requisitions"
          description="Cash claimed and spent against a project so far."
          project={null}
          projects={projects}
        />
        <NoProjectsCard
          notFound={ctx.notFound}
          unselected={ctx.unselected}
          requestedId={sp?.project}
        />
      </div>
    );
  }

  const [transactions, financials] = await Promise.all([
    getProjectTransactions(project.id),
    getProjectFinancialSummary(project.id),
  ]);

  const claims = transactions?.claims || [];
  const expenses = transactions?.expenses || [];
  /**
   * MONEY IS A STRING on both of these. `employee_claims.total_amount` and
   * `expenses.total` are numeric(19,4) read in string mode, so `s + c.totalAmount`
   * CONCATENATES rather than adds: one claim and one expense came out as
   * "01500.00002000.0000", which Intl.NumberFormat renders as NaN.
   *
   * Every other figure on this page comes from `getProjectFinancialSummary`,
   * which returns numbers because the screens do arithmetic on them. These two
   * are the only ones the page sums for itself.
   */
  const num = (v) => Number(v) || 0;
  const total =
    claims.reduce((s, c) => s + num(c.totalAmount), 0) +
    expenses.reduce((s, e) => s + num(e.total), 0);

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <WorkspaceHeader
        title="Cash Requisitions"
        description="Cash claimed and spent against a project so far."
        project={project}
        projects={projects}
      />

      <Alert className="border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
        <Info className="h-4 w-4" />
        <AlertDescription className="text-sm">
          A dedicated site cash requisition workflow (raise, approve,
          disburse) isn&apos;t built yet — this shows employee expense claims
          and operating expenses already tagged to this project from the
          Expenses module.
        </AlertDescription>
      </Alert>

      <Card className="p-5 sm:p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="rounded-lg p-2.5 bg-primary/10">
            <Wallet className="h-5 w-5 text-primary" />
          </div>
          <h2 className="font-semibold text-lg">Cash &amp; expense summary</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-6">
          <div>
            <p className="text-xs text-muted-foreground">Claims + expenses logged</p>
            <p className="text-lg font-bold text-red-600">KES {formatCurrency(total)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total project costs (paid)</p>
            <p className="text-lg font-bold">KES {formatCurrency(financials?.costs || 0)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Committed</p>
            <p className="text-lg font-bold text-amber-600">
              KES {formatCurrency(financials?.committed || 0)}
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="font-semibold text-lg mb-4">Linked claims &amp; expenses</h2>
        {claims.length === 0 && expenses.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No expense claims or operating expenses linked to this project yet.
          </p>
        ) : (
          <>
            {claims.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  Employee Claims ({claims.length})
                </h3>
                <div className="space-y-2">
                  {claims.map((claim) => (
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
                          <Badge variant="secondary" className="text-xs">{claim.status}</Badge>
                        </div>
                        <p className="text-sm font-medium mt-0.5 truncate">{claim.employeeName}</p>
                      </div>
                      <p className="text-sm font-semibold shrink-0">
                        KES {formatCurrency(claim.totalAmount)}
                      </p>
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {expenses.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  Operating Expenses ({expenses.length})
                </h3>
                <div className="space-y-2">
                  {expenses.map((exp) => (
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
                          <Badge variant="secondary" className="text-xs">{exp.status}</Badge>
                        </div>
                        <p className="text-sm font-medium mt-0.5 truncate">
                          {exp.accountName || exp.category}
                        </p>
                      </div>
                      <p className="text-sm font-semibold shrink-0">KES {formatCurrency(exp.total)}</p>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
