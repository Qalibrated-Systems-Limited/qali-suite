import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Banknote, Plus, DollarSign, TrendingUp, Clock } from "lucide-react";
import { getLoans } from "@/app/mongodb/actions/loan-actions";

export const metadata = { title: "Loans & Advances | HR" };

const HR_ROLES = ["SuperAdmin", "Admin", "Manager", "HR", "Accountant", "Employee"];

function StatusBadge({ status }) {
  const map = {
    pending_approval: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    approved: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    disbursed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    fully_repaid: "bg-muted text-muted-foreground",
    rejected: "bg-red-500/15 text-red-700 dark:text-red-400",
    cancelled: "bg-muted text-muted-foreground",
  };
  const labels = {
    pending_approval: "Pending Approval",
    approved: "Approved",
    active: "Active",
    disbursed: "Disbursed",
    fully_repaid: "Fully Repaid",
    rejected: "Rejected",
    cancelled: "Cancelled",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${map[status] || "bg-muted text-muted-foreground"}`}>
      {labels[status] || status}
    </span>
  );
}

function LoanTypeBadge({ type }) {
  const map = {
    salary_advance: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    staff_loan: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    sacco_deduction: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  };
  const labels = {
    salary_advance: "Salary Advance",
    staff_loan: "Staff Loan",
    sacco_deduction: "SACCO",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${map[type] || "bg-muted text-muted-foreground"}`}>
      {labels[type] || type}
    </span>
  );
}

function formatCurrency(amount) {
  return (amount || 0).toLocaleString("en-KE", { minimumFractionDigits: 0 });
}

function StatsCards({ stats, canAdmin }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <TrendingUp className="h-4 w-4" />
          <p className="text-xs font-medium uppercase tracking-wide">{canAdmin ? "Active Loans" : "Active"}</p>
        </div>
        <p className="mt-2 text-2xl font-bold text-foreground">{stats.totalActive}</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <DollarSign className="h-4 w-4" />
          <p className="text-xs font-medium uppercase tracking-wide">{canAdmin ? "Total Disbursed" : "Borrowed"}</p>
        </div>
        <p className="mt-2 text-2xl font-bold text-foreground">KES {formatCurrency(stats.totalDisbursed)}</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Banknote className="h-4 w-4" />
          <p className="text-xs font-medium uppercase tracking-wide">Outstanding</p>
        </div>
        <p className="mt-2 text-2xl font-bold text-foreground">KES {formatCurrency(stats.totalOutstanding)}</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Clock className="h-4 w-4" />
          <p className="text-xs font-medium uppercase tracking-wide">{canAdmin ? "Pending Approval" : "Pending"}</p>
        </div>
        <p className="mt-2 text-2xl font-bold text-foreground">{stats.pendingCount}</p>
      </div>
    </div>
  );
}

async function LoanList({ searchParams, canAdmin }) {
  const params = await searchParams;

  const currentPage = parseInt(params.page || "1");
  const status = params.status || "";
  const loanType = params.loanType || "";
  const search = params.search || "";
  const limit = 20;

  // Fetch filtered list
  const result = await getLoans({
    page: currentPage,
    limit,
    status,
    loanType,
    search,
  });

  const loans = result.loans || [];
  const total = result.total || 0;
  const totalPages = Math.ceil(total / limit);

  // Fetch unfiltered stats (active loans + pending count)
  const [allResult, pendingResult] = await Promise.all([
    getLoans({ page: 1, limit: 1000, status: "" }),
    getLoans({ page: 1, limit: 1, status: "pending_approval" }),
  ]);

  const allLoans = allResult.loans || [];
  const activeLoans = allLoans.filter((l) =>
    ["active", "disbursed"].includes(l.status)
  );
  const stats = {
    totalActive: activeLoans.length,
    totalDisbursed: activeLoans.reduce((s, l) => s + (l.principalAmount || 0), 0),
    totalOutstanding: activeLoans.reduce((s, l) => s + (l.outstandingBalance || 0), 0),
    pendingCount: pendingResult.total || 0,
  };

  // Serialize ObjectIds to strings for rendering
  const serialized = loans.map((l) => ({
    _id: l._id?.toString?.() ?? l._id,
    loanNumber: l.loanNumber,
    loanType: l.loanType,
    employeeName: l.employeeName,
    employeeNumber: l.employeeNumber,
    department: l.department,
    principalAmount: l.principalAmount,
    outstandingBalance: l.outstandingBalance,
    monthlyInstallment: l.monthlyInstallment,
    status: l.status,
  }));

  return (
    <>
      <StatsCards stats={stats} canAdmin={canAdmin} />

      {serialized.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center shadow-sm">
          <Banknote className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-muted-foreground">
            {status ? `No ${status.replace("_", " ")} loans` : canAdmin ? "No loans yet." : "You have no loan requests yet."}
          </p>
          {!canAdmin && !status && (
            <a href="/dashboard/hr/loans/create" className="mt-3 inline-block text-sm text-primary hover:underline">
              Request a salary advance or loan →
            </a>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card shadow-sm">
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">Loan #</th>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Outstanding</th>
                  <th className="px-4 py-3 text-right">Installment</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {serialized.map((loan) => (
                  <tr key={loan._id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{loan.loanNumber}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{loan.employeeName}</p>
                      <p className="text-xs text-muted-foreground">{loan.department}</p>
                    </td>
                    <td className="px-4 py-3"><LoanTypeBadge type={loan.loanType} /></td>
                    <td className="px-4 py-3 text-right font-medium text-foreground">
                      KES {formatCurrency(loan.principalAmount)}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      KES {formatCurrency(loan.outstandingBalance)}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      KES {formatCurrency(loan.monthlyInstallment)}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={loan.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/dashboard/hr/loans/${loan._id}`} className="text-xs text-primary hover:underline">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="divide-y divide-border md:hidden">
            {serialized.map((loan) => (
              <Link
                key={loan._id}
                href={`/dashboard/hr/loans/${loan._id}`}
                className="block p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-foreground">{loan.employeeName}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">{loan.loanNumber}</p>
                  </div>
                  <StatusBadge status={loan.status} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <LoanTypeBadge type={loan.loanType} />
                  <span className="text-xs text-muted-foreground">
                    KES {formatCurrency(loan.principalAmount)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Outstanding: KES {formatCurrency(loan.outstandingBalance)}
                  </span>
                </div>
              </Link>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
              <p className="text-muted-foreground">{total} loans</p>
              <div className="flex gap-2">
                {currentPage > 1 && (
                  <Link
                    href={`?page=${currentPage - 1}&status=${status}&loanType=${loanType}&search=${search}`}
                    className="rounded border border-border px-3 py-1 hover:bg-accent hover:text-accent-foreground"
                  >
                    Previous
                  </Link>
                )}
                {currentPage < totalPages && (
                  <Link
                    href={`?page=${currentPage + 1}&status=${status}&loanType=${loanType}&search=${search}`}
                    className="rounded border border-border px-3 py-1 hover:bg-accent hover:text-accent-foreground"
                  >
                    Next
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default async function LoansPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!HR_ROLES.includes(session.user.role)) redirect("/dashboard");

  const params = await searchParams;
  const canAdmin = ["SuperAdmin", "Admin", "Manager", "HR"].includes(session.user.role);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">
            {canAdmin ? "Loans & Advances" : "My Loans"}
          </h1>
          <p className="hidden sm:block text-sm text-muted-foreground">
            {canAdmin ? "Manage employee loans, salary advances, and SACCO deductions" : "Your loan requests and repayment schedules"}
          </p>
        </div>
        <Link
          href="/dashboard/hr/loans/create"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Request Loan</span>
          <span className="sm:hidden">New</span>
        </Link>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1 shadow-sm">
        {[
          { value: "", label: "All" },
          { value: "pending_approval", label: "Pending" },
          { value: "approved", label: "Approved" },
          { value: "active", label: "Active" },
          { value: "fully_repaid", label: "Repaid" },
          { value: "rejected", label: "Rejected" },
        ].map((s) => (
          <Link
            key={s.value}
            href={`?status=${s.value}&loanType=${params.loanType || ""}&search=${params.search || ""}`}
            className={`shrink-0 rounded-md px-4 py-1.5 text-sm transition-colors ${
              params.status === s.value || (!params.status && s.value === "")
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      <Suspense
        fallback={
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        }
      >
        <LoanList searchParams={searchParams} canAdmin={canAdmin} />
      </Suspense>
    </div>
  );
}
