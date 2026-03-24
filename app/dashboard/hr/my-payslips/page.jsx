import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, FileText, Download } from "lucide-react";
import {
  getMyPayslips,
  getMyEmployeeProfile,
} from "@/app/mongodb/queries/hr-queries";

export const metadata = { title: "My Payslips | HR" };

function fmt(n) {
  if (!n && n !== 0) return "—";
  return new Intl.NumberFormat("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function StatusBadge({ status }) {
  const map = {
    paid: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${map[status] || "bg-muted text-muted-foreground"}`}
    >
      {status}
    </span>
  );
}

async function PayslipList({ searchParams }) {
  const params = await searchParams;
  const page = parseInt(params.page || "1");
  const [profile, { payslips, pagination }] = await Promise.all([
    getMyEmployeeProfile(),
    getMyPayslips({ page, limit: 12 }),
  ]);

  if (!profile) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-500/5 p-6 text-sm text-amber-700 dark:border-amber-900 dark:text-amber-400">
        <p className="font-semibold">No employee profile found</p>
        <p className="mt-1">
          Your account hasn&apos;t been linked to an employee profile yet.
          Contact HR to set this up.
        </p>
      </div>
    );
  }

  if (payslips.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-12 text-center shadow-sm">
        <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <p className="font-medium text-foreground">No payslips yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your payslips will appear here once payroll has been processed.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Desktop table */}
      <div className="hidden rounded-lg border border-border bg-card shadow-sm md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3 text-right">Gross Pay</th>
                <th className="px-4 py-3 text-right">PAYE</th>
                <th className="px-4 py-3 text-right">NSSF</th>
                <th className="px-4 py-3 text-right">SHIF</th>
                <th className="px-4 py-3 text-right">AHL</th>
                <th className="px-4 py-3 text-right font-semibold text-foreground">
                  Net Pay
                </th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {payslips.map((p) => (
                <tr key={p._id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">
                      {p.period.label}
                    </p>
                    {p.paidAt && (
                      <p className="text-xs text-muted-foreground">
                        Paid{" "}
                        {new Date(p.paidAt).toLocaleDateString("en-KE", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-foreground">
                    {fmt(p.earnings.grossPay)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                    {fmt(p.deductions.paye)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                    {fmt(p.deductions.nssf)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                    {fmt(p.deductions.shif)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                    {fmt(p.deductions.housingLevy)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-foreground">
                    {fmt(p.netPay)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={p.paymentStatus} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/dashboard/hr/my-payslips/${p._id}`}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <FileText className="h-3 w-3" /> View
                      </Link>
                      <a
                        href={`/api/hr/my-payslip/${p._id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Download className="h-3 w-3" /> PDF
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {payslips.map((p) => (
          <div
            key={p._id}
            className="rounded-lg border border-border bg-card p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-foreground">
                  {p.period.label}
                </p>
                {p.paidAt && (
                  <p className="text-xs text-muted-foreground">
                    Paid{" "}
                    {new Date(p.paidAt).toLocaleDateString("en-KE", {
                      day: "numeric",
                      month: "short",
                    })}
                  </p>
                )}
              </div>
              <StatusBadge status={p.paymentStatus} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-muted-foreground">Gross</p>
                <p className="font-mono font-medium text-foreground">
                  {p.currency} {fmt(p.earnings.grossPay)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Net Pay</p>
                <p className="font-mono font-semibold text-foreground">
                  {p.currency} {fmt(p.netPay)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Deductions</p>
                <p className="font-mono text-foreground">
                  {fmt(p.deductions.totalDeductions)}
                </p>
              </div>
            </div>
            <div className="mt-3 border-t border-border pt-3">
              <div className="flex items-center gap-3">
                <Link
                  href={`/dashboard/hr/my-payslips/${p._id}`}
                  className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <FileText className="h-3 w-3" /> View
                </Link>
                <a
                  href={`/api/hr/my-payslip/${p._id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <Download className="h-3 w-3" /> Download PDF
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            Showing {(page - 1) * pagination.limit + 1}–
            {Math.min(page * pagination.limit, pagination.total)} of{" "}
            {pagination.total}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`?page=${page - 1}`}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-accent"
              >
                Previous
              </Link>
            )}
            {page < pagination.totalPages && (
              <Link
                href={`?page=${page + 1}`}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-accent"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

async function P9Link() {
  const profile = await getMyEmployeeProfile();
  if (!profile) return null;
  const year = new Date().getFullYear();
  return (
    <Link
      href={`/dashboard/hr/p9/${profile._id}?year=${year}`}
      className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent shrink-0"
    >
      <Download className="h-4 w-4 text-muted-foreground" />
      P9 ({year})
    </Link>
  );
}

export default async function MyPayslipsPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href="/dashboard/hr"
          className="flex items-center gap-1 hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> HR
        </Link>
        <span>/</span>
        <span className="text-foreground">My Payslips</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            My Payslips
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your salary statements and deductions history
          </p>
        </div>
        <Suspense fallback={null}>
          <P9Link />
        </Suspense>
      </div>

      <Suspense
        fallback={
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        }
      >
        <PayslipList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
