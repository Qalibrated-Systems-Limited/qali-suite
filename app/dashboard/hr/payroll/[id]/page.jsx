import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Users, TrendingUp, BookOpen } from "lucide-react";
import { getPayrollRunForPage } from "@/app/db/actions/hr-payroll-actions";
import { PayrollActions, EntryEditButton, PayrollExportButtons, PayslipButton } from "@/app/dashboard/hr/components/PayrollActions";
import { can } from "@/lib/capabilities";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const data = await getPayrollRunForPage(id);
  return { title: `${data?.run?.payrollNumber || "Payroll"} | HR` };
}

// HR prepares, finance approves — both must be able to open the run.

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
    <span className={`inline-flex rounded-full px-3 py-1 text-sm font-medium capitalize ${map[status] || "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

function fmt(n) {
  if (!n && n !== 0) return "—";
  return new Intl.NumberFormat("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function TotalsCard({ label, value, sub, highlight }) {
  return (
    <div className={`rounded-lg border p-4 shadow-sm ${highlight ? "border-primary/20 bg-primary/5" : "border-border bg-card"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-bold ${highlight ? "text-primary" : "text-foreground"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default async function PayrollRunDetailPage({ params }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "payroll.prepare")) redirect("/dashboard/hr");

  const data = await getPayrollRunForPage(id);
  if (!data) notFound();

  /*
   * `permissions`, NOT `can`.
   *
   * This was `const { run, entries, can } = data`, which shadows the IMPORTED
   * `can` across the whole function — including the gate five lines above it,
   * which runs before the declaration and so hit the temporal dead zone:
   *
   *     ReferenceError: Cannot access 'u' before initialization
   *
   * Every payroll run's page threw it, for every role, every time. The import
   * and the payload had simply been given the same name.
   */
  const { run, entries, can: permissions } = data;
  const canEditEntries =
    permissions.prepare && !["approved", "paid", "voided"].includes(run.status);

  const currency = run.currency || "KES";
  const totals = run.totals || {};

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-6xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/payroll" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Payroll
        </Link>
        <span>/</span>
        <span className="text-foreground font-mono">{run.payrollNumber}</span>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-foreground sm:text-2xl">{run.label}</h1>
            <StatusBadge status={run.status} />
          </div>
          <p className="mt-1 font-mono text-sm text-muted-foreground">{run.payrollNumber}</p>
          {run.notes && <p className="mt-0.5 truncate text-sm text-muted-foreground">{run.notes}</p>}
        </div>
        <PayrollActions payrollRun={run} can={permissions} />
      </div>

      {/* Export buttons */}
      {["approved", "paid"].includes(run.status) && entries.length > 0 && (
        <PayrollExportButtons payrollRunId={run.id} canExport={permissions.prepare} />
      )}

      {/* Totals grid */}
      {totals.employeeCount > 0 && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <TotalsCard label="Employees" value={totals.employeeCount} sub="in this run" />
          <TotalsCard label="Gross Pay" value={`${currency} ${fmt(totals.gross)}`} sub="before deductions" />
          <TotalsCard
            label="Deductions"
            value={`${currency} ${fmt(totals.deductions)}`}
            sub={<span className="hidden sm:inline">PAYE {fmt(totals.paye)} · NSSF {fmt(totals.nssf)} · SHIF {fmt(totals.shif)}</span>}
          />
          <TotalsCard label="Net Pay" value={`${currency} ${fmt(totals.net)}`} highlight />
        </div>
      )}

      {/* Draft notice */}
      {run.status === "draft" && entries.length === 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-500/5 p-5 text-sm text-blue-700 dark:border-blue-900 dark:text-blue-400">
          <p className="font-semibold">No entries yet</p>
          <p className="mt-1">
            Click <strong>Generate Entries</strong> to auto-calculate salaries and deductions for all active employees.
          </p>
        </div>
      )}

      {/* Approval info */}
      {run.approvedByName && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900 dark:text-emerald-400">
          <Users className="h-4 w-4 shrink-0" />
          Approved by <strong>{run.approvedByName}</strong>
          {run.approvedAt && <> on {new Date(run.approvedAt).toLocaleDateString("en-KE")}</>}
        </div>
      )}

      {/* What this run put in the books. Each entry says WHICH it is, rather
          than the reader inferring it from position in an array. */}
      {run.journals.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm shadow-sm">
          <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">In the ledger:</span>
          {run.journals.map((j) => (
            <Link
              key={j.id}
              href={`/dashboard/journal/${j.id}`}
              className="font-mono text-xs text-primary hover:underline"
              title={`${j.kind} · ${j.status}`}
            >
              {j.entryNumber} ({j.kind})
            </Link>
          ))}
        </div>
      )}

      {/* Entries */}
      {entries.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold text-foreground">Employee Entries</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{entries.length}</span>
          </div>

          <div className="rounded-lg border border-border bg-card shadow-sm">
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-4 py-3 text-right">Basic</th>
                    <th className="px-4 py-3 text-right">Allowances</th>
                    <th className="px-4 py-3 text-right">Gross</th>
                    <th className="px-4 py-3 text-right">PAYE</th>
                    <th className="px-4 py-3 text-right">NSSF</th>
                    <th className="px-4 py-3 text-right">SHIF</th>
                    <th className="px-4 py-3 text-right">AHL</th>
                    <th className="px-4 py-3 text-right font-semibold text-foreground">Net Pay</th>
                    <th className="px-4 py-3 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entries.map((entry) => {
                    const allowances =
                      entry.housingAllowance +
                      entry.transportAllowance +
                      entry.medicalAllowance +
                      entry.otherAllowance;
                    return (
                      <tr key={entry.id} className="hover:bg-muted/50 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground">{entry.employeeName}</p>
                          <p className="text-xs text-muted-foreground">
                            {entry.employeeNumber}{entry.department ? ` · ${entry.department}` : ""}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-foreground">{fmt(entry.basicSalary)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-foreground">{fmt(allowances)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs font-medium text-foreground">{fmt(entry.grossPay)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-red-600 dark:text-red-400">{fmt(entry.paye)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-red-600 dark:text-red-400">{fmt(entry.nssf)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-red-600 dark:text-red-400">{fmt(entry.shif)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-red-600 dark:text-red-400">{fmt(entry.housingLevy)}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-bold text-primary">{fmt(entry.netPay)}</td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <PayslipButton payrollRunId={run.id} entryId={entry.id} />
                            <EntryEditButton entry={entry} payrollRunId={run.id} canEdit={canEditEntries} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {totals.net > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/50 font-semibold">
                      <td className="px-4 py-3 text-xs uppercase text-muted-foreground">Total ({entries.length})</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-foreground">{fmt(totals.basic)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-foreground">{fmt(totals.allowances)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-foreground">{fmt(totals.gross)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-red-600 dark:text-red-400">{fmt(totals.paye)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-red-600 dark:text-red-400">{fmt(totals.nssf)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-red-600 dark:text-red-400">{fmt(totals.shif)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-red-600 dark:text-red-400">{fmt(totals.housingLevy)}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-bold text-primary">{fmt(totals.net)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* Mobile cards */}
            <div className="divide-y divide-border md:hidden">
              {entries.map((entry) => (
                <div key={entry.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{entry.employeeName}</p>
                      <p className="text-xs text-muted-foreground">{entry.department || entry.employeeNumber}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <PayslipButton payrollRunId={run.id} entryId={entry.id} />
                      <p className="font-bold text-primary tabular-nums">{fmt(entry.netPay)}</p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div className="rounded bg-muted/50 p-2 text-center">
                      <p className="text-[10px] text-muted-foreground">Gross</p>
                      <p className="text-xs font-semibold text-foreground tabular-nums">{fmt(entry.grossPay)}</p>
                    </div>
                    <div className="rounded bg-red-500/5 p-2 text-center">
                      <p className="text-[10px] text-muted-foreground">PAYE</p>
                      <p className="text-xs font-semibold text-red-600 dark:text-red-400 tabular-nums">{fmt(entry.paye)}</p>
                    </div>
                    <div className="rounded bg-red-500/5 p-2 text-center">
                      <p className="text-[10px] text-muted-foreground">NSSF+SHIF</p>
                      <p className="text-xs font-semibold text-red-600 dark:text-red-400 tabular-nums">
                        {fmt(entry.nssf + entry.shif)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
