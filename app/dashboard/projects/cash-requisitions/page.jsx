import {
  getProjectTransactions,
  getProjectFinancialSummary,
  getProjectSpendElsewhere,
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
import { Button } from "@/components/ui/button";
import { Info, Wallet, DollarSign, Receipt } from "lucide-react";

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
      <div className="flex flex-col gap-4 p-4 sm:p-5 lg:p-6">
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
      <div className="flex flex-col gap-4 p-4 sm:p-5 lg:p-6">
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

  const [transactions, financials, elsewhere] = await Promise.all([
    getProjectTransactions(project.id),
    getProjectFinancialSummary(project.id),
    getProjectSpendElsewhere(project.id),
  ]);

  const claims = transactions?.claims || [];
  const expenses = transactions?.expenses || [];

  /**
   * The two links out, built once.
   *
   * `returnTo` points back at THIS page WITH `?project=`, because the module
   * resolves the selected project from the URL and nothing else — a bare
   * `/dashboard/projects/cash-requisitions` would come back asking which job,
   * having just been told.
   */
  const back = `/dashboard/projects/cash-requisitions?project=${project.id}`;
  const claimParams = `projectId=${encodeURIComponent(project.id)}&returnTo=${encodeURIComponent(back)}`;
  const advanceHref = `/dashboard/claims/create/advance?${claimParams}`;
  const reimbursementHref = `/dashboard/claims/create/reimbursement?${claimParams}`;

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
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:p-6">
      <WorkspaceHeader
        title="Cash Requisitions"
        description="Cash claimed and spent against a project so far."
        project={project}
        projects={projects}
      />

      {/*
        RAISE IT FROM HERE.

        This page told you what had been claimed against the job and gave you
        no way to claim anything — so the act it is about happened in another
        module, three navigations away, with the project chosen again from a
        combobox or, more often, not chosen at all. An untagged claim is money
        the job never sees.

        Both links carry the project AND the way back, so the request lands on
        this job and returns to this page. See lib/utils/return-to.js.

        Full-width stacked buttons on a phone: this is the page's primary
        action, and a site agent is raising it one-handed in a yard.
      */}
      <div className="flex flex-col sm:flex-row gap-2">
        <Button asChild className="h-11 flex-1 sm:flex-none bg-yellow-500 hover:bg-yellow-600 text-black font-semibold">
          <Link href={advanceHref}>
            <DollarSign className="h-4 w-4 mr-2" />
            Request Advance
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-11 flex-1 sm:flex-none">
          <Link href={reimbursementHref}>
            <Receipt className="h-4 w-4 mr-2" />
            Claim Expense
          </Link>
        </Button>
      </div>

      <Alert className="border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
        <Info className="h-4 w-4" />
        <AlertDescription className="text-sm">
          A dedicated site cash requisition workflow (raise, approve,
          disburse) isn&apos;t built yet — this shows employee expense claims
          and operating expenses already tagged to this project from the
          Expenses module.
        </AlertDescription>
      </Alert>

      <Card className="p-4 sm:p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="rounded-lg p-2.5 bg-primary/10">
            <Wallet className="h-5 w-5 text-primary" />
          </div>
          <h2 className="font-semibold text-lg">Cash &amp; expense summary</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Claims + expenses logged</p>
            <p className="text-lg font-bold text-red-600">KES {formatCurrency(total)}</p>
          </div>
          <div>
            {/*
              NOT "(paid)". Since 0088 project cost is recognised where the
              ledger recognises it — a bill at approved, a claim from approved
              onward, an expense at posted — because counting cost at payment
              while counting revenue at invoice put the two halves of the
              margin on different bases.
            */}
            <p className="text-xs text-muted-foreground">Total project costs (incurred)</p>
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

      <Card className="p-4 sm:p-5">
        <h2 className="font-semibold text-lg mb-4">Linked claims &amp; expenses</h2>
        {claims.length === 0 && expenses.length === 0 ? (
          <div className="text-center py-8 space-y-2">
            <p className="text-sm text-muted-foreground">
              No expense claims or operating expenses linked to this project yet.
            </p>
            {/*
              A claim tagged to a job and then looked for from the global
              sidebar arrives here with no `?project=`, so the module asks
              which project rather than guessing — and the honest empty state
              above was indistinguishable from "the tag did not save".
            */}
            {elsewhere?.claims + elsewhere?.expenses > 0 && (
              <p className="text-sm text-muted-foreground">
                {elsewhere.claims > 0 && (
                  <>
                    {elsewhere.claims} claim{elsewhere.claims === 1 ? " is" : "s are"}
                  </>
                )}
                {elsewhere.claims > 0 && elsewhere.expenses > 0 && " and "}
                {elsewhere.expenses > 0 && (
                  <>
                    {elsewhere.expenses} expense{elsewhere.expenses === 1 ? " is" : "s are"}
                  </>
                )}{" "}
                tagged to {elsewhere.projects.length === 1 ? "" : "other projects, including "}
                <span className="font-medium text-foreground">
                  {elsewhere.projects.slice(0, 2).join(", ")}
                </span>
                . Switch project in the header above to see them.
              </p>
            )}
          </div>
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
