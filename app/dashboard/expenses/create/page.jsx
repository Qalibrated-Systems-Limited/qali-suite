import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import ExpenseForm from "../components/ExpenseForm";
import { getExpenseFormData } from "@/app/db/actions/expense-actions";
import { getActiveProjects } from "@/app/db/actions/project-actions";
import { getAllCostCodes } from "@/app/db/actions/project-actions";

export const metadata = {
  title: "Create Expense | ERP",
  description: "Record a new business expense",
};

export default async function CreateExpensePage() {
  /**
   * The pickers come from Postgres now, through one scoped call.
   *
   * What was here before built its own Account and Party queries through
   * `tenantFilter(companyId, isSuperAdmin)` — and that helper returns `{}` for
   * a SuperAdmin, so platform staff were shown every tenant's expense
   * accounts, payment accounts and payees. getExpenseFormData runs inside
   * withAuthorizedTenant, so it returns the ACTING company's and nothing else.
   *
   * Projects stay a separate call, but no longer for the reason written here
   * before: they were Mongo and are Postgres since 0070. Kept separate because
   * getExpenseFormData is the EXPENSE form's data and projects are not.
   */
  const [
    { accounts, paymentAccounts, vendors, employees, assets, categories },
    projects,
    costCodes,
  ] = await Promise.all([
    getExpenseFormData(),
    getActiveProjects(),
    // The vocabulary a project's spend is recorded in. Loaded whole and
    // filtered against the chosen project in the form, because the project is
    // picked client-side.
    getAllCostCodes(),
  ]);

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="border-b bg-card/50">
        <div className="container max-w-3xl py-4 sm:py-6">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              asChild
              className="h-8 w-8 shrink-0"
            >
              <Link href="/dashboard/expenses">
                <ChevronLeft className="h-4 w-4" />
                <span className="sr-only">Back to expenses</span>
              </Link>
            </Button>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                Create Expense
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Record a new business expense
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 container max-w-3xl py-6 sm:py-8">
        <ExpenseForm
          accounts={accounts}
          paymentAccounts={paymentAccounts}
          vendors={vendors}
          employees={employees}
          categories={categories}
          projects={projects}
          costCodes={costCodes}
          assets={assets}
        />
      </div>
    </div>
  );
}
