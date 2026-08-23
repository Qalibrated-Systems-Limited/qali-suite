import { Suspense } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import ExpenseList from "../components/ExpenseList";
import {
  listExpensesPg,
  getExpenseSummaryPg,
  getExpenseCategoriesPg,
} from "@/app/db/actions/expense-actions";
import { FormBanner } from "@/components/ui/form-banner";

export const metadata = {
  title: "Expenses | ERP",
  description: "Manage business expenses",
};

export default async function ExpensesPage({ searchParams }) {
  const params = await searchParams;
  const page = parseInt(params?.page) || 1;

  // `undefined`, not `null`: the repository builds its WHERE from whichever
  // options are present, and `null` is present.
  const filters = {
    status: params?.status || undefined,
    category: params?.category || undefined,
    search: params?.search || undefined,
    startDate: params?.startDate || undefined,
    endDate: params?.endDate || undefined,
  };

  /**
   * Postgres, and tenant-scoped by RLS rather than by remembering to filter.
   *
   * `getExpenses` and `getExpenseSummary` both opened with
   * `isSuperAdmin ? {} : { companyId }` — so signed in as platform staff, the
   * expense list and every summary card aggregated EVERY tenant's spending
   * into one figure.
   */
  const [expenseData, summary, categories] = await Promise.all([
    listExpensesPg({ page, ...filters }),
    getExpenseSummaryPg(),
    getExpenseCategoriesPg(),
  ]);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <FormBanner searchParams={params} />
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Expenses</h1>
        <Button asChild size="sm">
          <Link href="/dashboard/expenses/create">
            <Plus className="h-3.5 w-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">New Expense</span>
          </Link>
        </Button>
      </div>

      {/* Content */}
      <Suspense fallback={<ExpenseListSkeleton />}>
        <ExpenseList
          expenses={expenseData.expenses}
          pagination={expenseData.pagination}
          summary={summary}
          categories={categories}
          filters={filters}
        />
      </Suspense>
    </div>
  );
}

function ExpenseListSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 bg-muted rounded-lg" />
        ))}
      </div>
      <div className="h-12 bg-muted rounded" />
      <div className="h-96 bg-muted rounded-lg" />
    </div>
  );
}
