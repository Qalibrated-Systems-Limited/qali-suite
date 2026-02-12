import Link from "next/link";
import { ChevronLeft, Clock, CheckCircle2, XCircle, Receipt, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getPendingExpenses } from "@/app/mongodb/queries/expense-queries";
import PendingExpenseActions from "../components/PendingExpenseActions";

export const metadata = {
  title: "Pending Approvals | Expenses",
  description: "Review and approve pending expenses",
};

const formatCurrency = (amount) => {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
  }).format(amount || 0);
};

const formatDate = (date) => {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const categoryLabels = {
  utilities: "Utilities",
  rent: "Rent",
  salaries: "Salaries",
  transport: "Transport",
  office_supplies: "Office Supplies",
  insurance: "Insurance",
  maintenance: "Maintenance",
  marketing: "Marketing",
  legal_professional: "Legal/Professional",
  bank_charges: "Bank Charges",
  depreciation: "Depreciation",
  meals_entertainment: "Meals",
  telecommunications: "Telecom",
  training: "Training",
  other: "Other",
};

export default async function PendingExpensesPage() {
  const expenses = await getPendingExpenses();

  const totalPending = expenses.reduce((sum, exp) => sum + (exp.total || 0), 0);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
          <Link href="/dashboard/expenses">
            <ChevronLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Pending Approvals</h1>
          <p className="text-sm text-muted-foreground">
            Review and approve submitted expenses
          </p>
        </div>
        {expenses.length > 0 && (
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Total Pending</p>
            <p className="text-xl font-bold tabular-nums">
              {formatCurrency(totalPending)}
            </p>
          </div>
        )}
      </div>

      {/* Alert */}
      {expenses.length > 0 && (
        <div className="flex items-center gap-3 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0" />
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            You have <strong>{expenses.length}</strong> expense
            {expenses.length > 1 ? "s" : ""} waiting for your approval.
          </p>
        </div>
      )}

      {/* Pending Expenses */}
      {expenses.length > 0 ? (
        <div className="space-y-4">
          {expenses.map((expense) => (
            <Card key={expense._id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Link
                        href={`/dashboard/expenses/${expense._id}`}
                        className="font-mono text-sm font-medium hover:underline text-primary"
                      >
                        {expense.expenseNumber}
                      </Link>
                      <Badge variant="outline" className="text-xs">
                        {categoryLabels[expense.category] || expense.category}
                      </Badge>
                      {expense.isReimbursable && (
                        <Badge variant="secondary" className="text-xs">
                          Reimbursable
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm truncate">{expense.description}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span>{expense.vendor}</span>
                      <span>{formatDate(expense.expenseDate)}</span>
                      {expense.submittedBy && (
                        <span>Submitted by {expense.submittedBy.name}</span>
                      )}
                    </div>
                  </div>

                  {/* Amount & Actions */}
                  <div className="flex items-center gap-4 sm:flex-col sm:items-end">
                    <p className="text-lg font-bold tabular-nums">
                      {formatCurrency(expense.total)}
                    </p>
                    <PendingExpenseActions expenseId={expense._id} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-12 text-center">
            <CheckCircle2 className="w-12 h-12 mx-auto text-green-500 mb-4" />
            <h3 className="font-medium text-lg mb-1">All caught up!</h3>
            <p className="text-sm text-muted-foreground">
              No expenses pending approval
            </p>
            <Button asChild className="mt-4" variant="outline">
              <Link href="/dashboard/expenses">View All Expenses</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
