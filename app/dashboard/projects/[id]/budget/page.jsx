import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import {
  getProjectById,
  getProjectBudgets,
} from "@/app/mongodb/queries/projectQueries";
import { getExpenseAccountsForCategories } from "@/app/mongodb/queries/claimQueries";
import BudgetForm, { BudgetCard } from "../../components/BudgetForm";

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

  const [project, budgets, expenseAccounts] = await Promise.all([
    getProjectById(id),
    getProjectBudgets(id),
    getExpenseAccountsForCategories(),
  ]);

  if (!project) notFound();

  const canCreate = ["SuperAdmin", "Admin", "Accountant", "Manager"].includes(
    session.user.role,
  );
  const canApprove = ["SuperAdmin", "Admin", "Accountant"].includes(session.user.role);

  return (
    <div className="flex flex-col gap-4 sm:gap-6 p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 sm:gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/dashboard/projects/${id}`}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            Project Budget
          </h1>
          <p className="text-sm text-muted-foreground">
            {project.projectNumber} — {project.name}
          </p>
        </div>
      </div>

      {/* Create New Budget */}
      {canCreate && project.status !== "closed" && (
        <BudgetForm projectId={id} expenseAccounts={expenseAccounts} />
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
