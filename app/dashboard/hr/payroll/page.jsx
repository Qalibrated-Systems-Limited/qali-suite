import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getPayrollRuns } from "@/app/mongodb/queries/hr-queries";
import { Plus, Banknote, FileText } from "lucide-react";

export const metadata = { title: "Payroll | HR" };

const PAYROLL_ROLES = ["SuperAdmin", "Admin", "HR"];

function StatusBadge({ status }) {
  const map = {
    draft: "bg-muted text-muted-foreground",
    processing: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    review: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    posted: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
    paid: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    voided: "bg-red-500/15 text-red-700 dark:text-red-400",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${map[status] || "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

async function PayrollRunList({ searchParams }) {
  const params = await searchParams;
  const { payrollRuns } = await getPayrollRuns({
    page: parseInt(params.page || "1"),
    status: params.status || "",
    year: params.year || String(new Date().getFullYear()),
  });

  const fmt = (n) => (n || 0).toLocaleString("en-KE", { minimumFractionDigits: 0 });

  if (!payrollRuns.length) {
    return (
      <div className="rounded-lg border border-border bg-card p-12 text-center shadow-sm">
        <Banknote className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">No payroll runs yet.</p>
        <Link
          href="/dashboard/hr/payroll/create"
          className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          Create First Payroll Run
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      {/* ── Desktop table ── */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3">Payroll #</th>
              <th className="px-4 py-3">Period</th>
              <th className="px-4 py-3 text-right">Employees</th>
              <th className="px-4 py-3 text-right">Gross Pay</th>
              <th className="px-4 py-3 text-right">Deductions</th>
              <th className="px-4 py-3 text-right">Net Pay</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {payrollRuns.map((run) => (
              <tr key={run._id} className="hover:bg-muted/50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{run.payrollNumber}</td>
                <td className="px-4 py-3 font-medium text-foreground">{run.period?.label}</td>
                <td className="px-4 py-3 text-right text-foreground">{run.totals?.employeeCount || 0}</td>
                <td className="px-4 py-3 text-right text-foreground">{fmt(run.totals?.totalGrossPay)}</td>
                <td className="px-4 py-3 text-right text-red-600 dark:text-red-400">
                  ({fmt(run.totals?.totalDeductions)})
                </td>
                <td className="px-4 py-3 text-right font-semibold text-emerald-700 dark:text-emerald-400">
                  {fmt(run.totals?.totalNetPay)}
                </td>
                <td className="px-4 py-3"><StatusBadge status={run.status} /></td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/dashboard/hr/payroll/${run._id}`} className="text-xs text-primary hover:underline">
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Mobile cards ── */}
      <div className="divide-y divide-border md:hidden">
        {payrollRuns.map((run) => (
          <Link
            key={run._id}
            href={`/dashboard/hr/payroll/${run._id}`}
            className="block p-4 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium text-foreground">{run.period?.label}</p>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">{run.payrollNumber}</p>
              </div>
              <StatusBadge status={run.status} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-xs">
              <div>
                <p className="text-muted-foreground">Employees</p>
                <p className="font-medium text-foreground">{run.totals?.employeeCount || 0}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Gross</p>
                <p className="font-medium text-foreground">{fmt(run.totals?.totalGrossPay)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Net Pay</p>
                <p className="font-semibold text-emerald-700 dark:text-emerald-400">{fmt(run.totals?.totalNetPay)}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default async function PayrollPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!PAYROLL_ROLES.includes(session.user.role)) redirect("/dashboard/hr");

  const currentYear = new Date().getFullYear();

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Payroll</h1>
          <p className="hidden sm:block text-sm text-muted-foreground">Monthly payroll runs</p>
        </div>
        <div className="flex items-center gap-2">
          {["SuperAdmin", "Admin", "HR", "Accountant"].includes(session.user.role) && (
            <a
              href={`/api/hr/p9a?year=${currentYear}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
              title={`Download P9A Annual PAYE Certificate for ${currentYear}`}
            >
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">P9A ({currentYear})</span>
            </a>
          )}
          <Link
            href="/dashboard/hr/payroll/create"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New Payroll Run</span>
            <span className="sm:hidden">New</span>
          </Link>
        </div>
      </div>

      <Suspense
        fallback={
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        }
      >
        <PayrollRunList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
