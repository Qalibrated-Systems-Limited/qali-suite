import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import {
  getProjectById,
  getProjectBudgets,
} from "@/app/db/actions/project-actions";
import { getCostCodes, getBudgetableBoqItems } from "@/app/db/actions/project-actions";
import {
  PROJECT_MANAGE_ROLES,
  FINANCE_WRITE_ROLES,
} from "@/lib/utils/role-gates";
import BudgetForm, { BudgetCard } from "../../components/BudgetForm";
import ImportBudget from "../../components/ImportBudget";
import { getExpenseAccountsForCategories } from "@/app/db/actions/claim-actions";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const project = await getProjectById(id);
  return {
    title: project ? `Budget — ${project.name}` : "Budget",
  };
}


export default async function BudgetPage({ params }) {
  const { id } = await params;
  const session = await auth();

  if (!session?.user) redirect("/login");

  // Cost codes, not the chart of accounts — 0073. Company-wide codes plus any
  // scoped to this project.
  const [project, budgets, costCodes, expenseAccounts, boqItems] = await Promise.all([
    getProjectById(id),
    getProjectBudgets(id),
    getCostCodes(id),
    // Only ever used by the finance-gated "New cost code" dialog. Loaded here
    // rather than fetched on open so the dialog has no loading state.
    getExpenseAccountsForCategories(),
    // The priced BOQ items the budget is built against — cost codes come from these.
    getBudgetableBoqItems(id),
  ]);

  if (!project) notFound();

  const canCreate = PROJECT_MANAGE_ROLES.includes(session.user.role);
  const canApprove = FINANCE_WRITE_ROLES.includes(session.user.role);
  /**
   * Who may DEFINE a cost code, which is not who may spend one (0073 decision
   * 4). A Manager builds the budget and picks from the codes finance has
   * defined; the same list, one narrower gate.
   */
  const canManageCostCodes = FINANCE_WRITE_ROLES.includes(session.user.role);

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 sm:gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/dashboard/projects/${id}`}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">
            Project Budget
          </h1>
          <p className="text-sm text-muted-foreground">
            {project.projectNumber} — {project.name}
          </p>
        </div>
        {/* Upload a whole budget rather than typing it line by line. Same gate
            as the create form below. */}
        {canCreate && project.status !== "closed" && (
          <div className="ml-auto">
            <ImportBudget projectId={id} />
          </div>
        )}
      </div>

      {/* Create New Budget */}
      {canCreate && project.status !== "closed" && (
        <BudgetForm
          projectId={id}
          costCodes={costCodes}
          boqItems={boqItems}
          canManageCostCodes={canManageCostCodes}
          expenseAccounts={expenseAccounts}
          defaultAccountId={project.defaultCostAccountId || ""}
          contractValue={project.contractValue || 0}
          vatRate={project.vatRate || 16}
        />
      )}

      {/* Budget History */}
      {budgets.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Budget Versions</h2>
          {budgets.map((budget) => (
            <BudgetCard
              key={budget._id}
              budget={budget}
              projectId={id}
              costCodes={costCodes}
              boqItems={boqItems}
              canManageCostCodes={canManageCostCodes}
              expenseAccounts={expenseAccounts}
              canCreate={canCreate}
              canApprove={canApprove}
            />
          ))}
        </div>
      )}

      {budgets.length === 0 && (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">
            No budgets created yet. Use the form above to create one.
          </p>
        </Card>
      )}
    </div>
  );
}
