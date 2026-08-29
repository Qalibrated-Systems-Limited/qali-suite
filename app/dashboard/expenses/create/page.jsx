import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import ExpenseForm from "../components/ExpenseForm";
import { getExpenseFormData } from "@/app/db/actions/expense-actions";
import { getActiveProjects } from "@/app/db/actions/project-actions";

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
   * Projects stay separate and stay Mongo: they are not ported, and hiding
   * that behind a helper that reads two stores would make the seam harder to
   * find, not smaller.
   */
  const [
    { accounts, paymentAccounts, vendors, employees, assets, categories },
    projects,
  ] = await Promise.all([getExpenseFormData(), getActiveProjects()]);

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
          assets={assets}
        />
      </div>
    </div>
  );
}
