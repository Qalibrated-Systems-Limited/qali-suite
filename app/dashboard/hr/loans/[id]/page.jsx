import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Banknote, User, Clock, FileText, CheckCircle2, XCircle, DollarSign, Calendar } from "lucide-react";
import { getLoanById } from "@/app/mongodb/actions/loan-actions";
import { LoanDetailActions } from "@/app/dashboard/hr/loans/components/LoanDetailActions";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const result = await getLoanById(id);
  return { title: `${result.loan?.loanNumber || "Loan"} | HR` };
}

/** Serialize Mongoose lean doc to plain JSON safe for React */
function serializeLoan(raw) {
  if (!raw) return null;
  return {
    _id: raw._id?.toString?.() ?? raw._id,
    loanNumber: raw.loanNumber,
    loanType: raw.loanType,
    partyId: raw.partyId?.toString?.() ?? raw.partyId,
    profileId: raw.profileId?.toString?.() ?? raw.profileId,
    employeeName: raw.employeeName,
    employeeNumber: raw.employeeNumber,
    department: raw.department,
    principalAmount: raw.principalAmount,
    interestRate: raw.interestRate,
    interestType: raw.interestType,
    tenure: raw.tenure,
    monthlyInstallment: raw.monthlyInstallment,
    startMonth: raw.startMonth,
    startYear: raw.startYear,
    totalRepaid: raw.totalRepaid || 0,
    totalInterestPaid: raw.totalInterestPaid || 0,
    outstandingBalance: raw.outstandingBalance || 0,
    status: raw.status,
    purpose: raw.purpose,
    notes: raw.notes,
    currency: raw.currency || "KES",
    rejectionReason: raw.rejectionReason,
    disbursementMethod: raw.disbursementMethod,
    disbursementRef: raw.disbursementRef,
    requestedAt: raw.requestedAt?.toISOString?.() ?? raw.requestedAt ?? null,
    requestedBy: raw.requestedBy || null,
    approvedAt: raw.approvedAt?.toISOString?.() ?? raw.approvedAt ?? null,
    approvedBy: raw.approvedBy || null,
    rejectedAt: raw.rejectedAt?.toISOString?.() ?? raw.rejectedAt ?? null,
    disbursedAt: raw.disbursedAt?.toISOString?.() ?? raw.disbursedAt ?? null,
    disbursedBy: raw.disbursedBy || null,
    disbursementJournalId: raw.disbursementJournalId?.toString?.() ?? raw.disbursementJournalId ?? null,
    journalEntryIds: (raw.journalEntryIds || []).map((id) => id?.toString?.() ?? id),
    installments: (raw.installments || []).map((inst) => ({
      month: inst.month,
      year: inst.year,
      principal: inst.principal,
      interest: inst.interest,
      total: inst.total,
      status: inst.status,
      payrollRunId: inst.payrollRunId?.toString?.() ?? inst.payrollRunId ?? null,
      paidAt: inst.paidAt?.toISOString?.() ?? inst.paidAt ?? null,
    })),
    createdAt: raw.createdAt?.toISOString?.() ?? raw.createdAt ?? null,
    updatedAt: raw.updatedAt?.toISOString?.() ?? raw.updatedAt ?? null,
  };
}

const HR_ROLES = ["SuperAdmin", "Admin", "Manager", "HR", "Accountant", "Employee"];

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

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
    <span className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${map[status] || "bg-muted text-muted-foreground"}`}>
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
    sacco_deduction: "SACCO Deduction",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${map[type] || "bg-muted text-muted-foreground"}`}>
      {labels[type] || type}
    </span>
  );
}

function InfoRow({ label, children }) {
  return (
    <div className="flex items-start justify-between py-3 border-b border-border last:border-0">
      <dt className="text-sm text-muted-foreground w-40 shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-foreground text-right flex-1">{children}</dd>
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
}

function formatCurrency(amount) {
  return (amount || 0).toLocaleString("en-KE", { minimumFractionDigits: 0 });
}

function TimelineEvent({ icon: Icon, iconClass, title, date, note }) {
  return (
    <div className="flex gap-3">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconClass}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 pt-0.5">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {date && <p className="text-xs text-muted-foreground">{formatDate(date)}</p>}
        {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      </div>
    </div>
  );
}

export default async function LoanDetailPage({ params }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!HR_ROLES.includes(session.user.role)) redirect("/dashboard");

  const result = await getLoanById(id);
  if (!result.loan || result.error) notFound();
  const loan = serializeLoan(result.loan);

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const repaidAmount = loan.totalRepaid + loan.totalInterestPaid;
  const progressPercent = loan.principalAmount > 0
    ? Math.min(100, Math.round((loan.totalRepaid / loan.principalAmount) * 100))
    : 0;

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/loans" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Loans
        </Link>
        <span>/</span>
        <span className="text-foreground font-mono">{loan.loanNumber}</span>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-foreground sm:text-2xl">{loan.loanNumber}</h1>
            <StatusBadge status={loan.status} />
            <LoanTypeBadge type={loan.loanType} />
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {loan.employeeName}
            {loan.department ? <span className="hidden sm:inline"> - {loan.department}</span> : null}
          </p>
        </div>
        <LoanDetailActions loan={loan} userRole={session.user.role} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Details + Schedule */}
        <div className="lg:col-span-2 space-y-6">
          {/* Loan Summary */}
          <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Banknote className="h-4 w-4 text-muted-foreground" /> Loan Summary
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-lg bg-muted/50 p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Principal</p>
                <p className="mt-1 text-base font-bold text-foreground">
                  KES {formatCurrency(loan.principalAmount)}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Monthly</p>
                <p className="mt-1 text-base font-bold text-foreground">
                  KES {formatCurrency(loan.monthlyInstallment)}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Repaid</p>
                <p className="mt-1 text-base font-bold text-emerald-700 dark:text-emerald-400">
                  KES {formatCurrency(repaidAmount)}
                </p>
              </div>
              <div className="rounded-lg bg-primary/5 p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Outstanding</p>
                <p className="mt-1 text-base font-bold text-primary">
                  KES {formatCurrency(loan.outstandingBalance)}
                </p>
              </div>
            </div>

            {/* Progress bar */}
            {["active", "fully_repaid"].includes(loan.status) && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>Repayment Progress</span>
                  <span>{progressPercent}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Loan Details */}
          <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
              <FileText className="h-4 w-4 text-muted-foreground" /> Details
            </h2>
            <dl>
              <InfoRow label="Tenure">{loan.tenure} months</InfoRow>
              {loan.interestRate > 0 && (
                <InfoRow label="Interest Rate">{(loan.interestRate * 100).toFixed(1)}% p.a.</InfoRow>
              )}
              {loan.interestType !== "none" && (
                <InfoRow label="Interest Type">
                  {loan.interestType === "flat" ? "Flat Rate" : "Reducing Balance (EMI)"}
                </InfoRow>
              )}
              <InfoRow label="Start Period">
                {MONTH_NAMES[loan.startMonth]} {loan.startYear}
              </InfoRow>
              {loan.disbursementMethod && (
                <InfoRow label="Disbursement">
                  {loan.disbursementMethod.toUpperCase()}
                  {loan.disbursementRef && ` - ${loan.disbursementRef}`}
                </InfoRow>
              )}
            </dl>
          </div>

          {/* Purpose */}
          {loan.purpose && (
            <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <FileText className="h-4 w-4 text-muted-foreground" /> Purpose
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{loan.purpose}</p>
            </div>
          )}

          {/* Rejection reason */}
          {loan.status === "rejected" && loan.rejectionReason && (
            <div className="rounded-lg border border-red-200 bg-red-500/5 p-5 dark:border-red-900">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-400">
                <XCircle className="h-4 w-4" /> Rejection Reason
              </h2>
              <p className="text-sm text-red-700 dark:text-red-400 leading-relaxed">{loan.rejectionReason}</p>
            </div>
          )}

          {/* Installment Schedule */}
          {loan.installments && loan.installments.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Calendar className="h-4 w-4 text-muted-foreground" /> Installment Schedule
              </h2>

              {/* Desktop table */}
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Month/Year</th>
                      <th className="px-3 py-2 text-right">Principal</th>
                      <th className="px-3 py-2 text-right">Interest</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {loan.installments.map((inst, i) => {
                      const isCurrent = inst.month === currentMonth && inst.year === currentYear;
                      const isDeducted = inst.status === "deducted";
                      return (
                        <tr
                          key={i}
                          className={`${isCurrent ? "bg-primary/5" : ""} ${isDeducted ? "text-emerald-700 dark:text-emerald-400" : ""}`}
                        >
                          <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                          <td className="px-3 py-2">
                            {MONTH_NAMES[inst.month]} {inst.year}
                            {isCurrent && (
                              <span className="ml-2 inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                Current
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">{formatCurrency(inst.principal)}</td>
                          <td className="px-3 py-2 text-right">{formatCurrency(inst.interest)}</td>
                          <td className="px-3 py-2 text-right font-medium">{formatCurrency(inst.total)}</td>
                          <td className="px-3 py-2">
                            {isDeducted ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                                <CheckCircle2 className="h-3 w-3" />
                                Deducted
                              </span>
                            ) : inst.status === "skipped" ? (
                              <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                Skipped
                              </span>
                            ) : (
                              <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                Pending
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile list */}
              <div className="divide-y divide-border sm:hidden">
                {loan.installments.map((inst, i) => {
                  const isCurrent = inst.month === currentMonth && inst.year === currentYear;
                  const isDeducted = inst.status === "deducted";
                  return (
                    <div
                      key={i}
                      className={`flex items-center justify-between gap-3 py-3 ${isCurrent ? "bg-primary/5 -mx-5 px-5" : ""}`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-5 shrink-0">{i + 1}</span>
                          <p className={`text-sm font-medium ${isDeducted ? "text-emerald-700 dark:text-emerald-400" : "text-foreground"}`}>
                            {MONTH_NAMES[inst.month]} {inst.year}
                          </p>
                          {isCurrent && (
                            <span className="inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                              Now
                            </span>
                          )}
                        </div>
                        <p className="ml-7 text-xs text-muted-foreground">
                          Total: KES {formatCurrency(inst.total)}
                        </p>
                      </div>
                      <div className="shrink-0">
                        {isDeducted ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" />
                            Paid
                          </span>
                        ) : inst.status === "skipped" ? (
                          <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            Skipped
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            Pending
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Journal Entry Links */}
          {loan.journalEntryIds && loan.journalEntryIds.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <DollarSign className="h-4 w-4 text-muted-foreground" /> Journal Entries
              </h2>
              <div className="space-y-2">
                {loan.journalEntryIds.map((jeId) => (
                  <Link
                    key={jeId}
                    href={`/dashboard/journal/${jeId}`}
                    className="block text-sm text-primary hover:underline"
                  >
                    View Journal Entry {jeId === loan.disbursementJournalId ? "(Disbursement)" : ""}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Employee + Timeline */}
        <div className="space-y-6">
          {/* Employee card */}
          <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
              <User className="h-4 w-4 text-muted-foreground" /> Employee
            </h2>
            <dl>
              <InfoRow label="Name">{loan.employeeName || "\u2014"}</InfoRow>
              <InfoRow label="Employee No.">
                <span className="font-mono text-xs">{loan.employeeNumber || "\u2014"}</span>
              </InfoRow>
              <InfoRow label="Department">{loan.department || "\u2014"}</InfoRow>
            </dl>
            {loan.profileId && (
              <Link
                href={`/dashboard/hr/employees/${loan.profileId}`}
                className="mt-3 block text-center text-xs text-primary hover:underline"
              >
                View employee profile
              </Link>
            )}
          </div>

          {/* Timeline */}
          <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Clock className="h-4 w-4 text-muted-foreground" /> Timeline
            </h2>
            <div className="space-y-4">
              <TimelineEvent
                icon={FileText}
                iconClass="bg-muted text-muted-foreground"
                title={`Requested${loan.requestedBy?.name ? ` by ${loan.requestedBy.name}` : ""}`}
                date={loan.requestedAt}
              />
              {loan.approvedAt && (
                <TimelineEvent
                  icon={CheckCircle2}
                  iconClass="bg-blue-500/15 text-blue-600 dark:text-blue-400"
                  title={`Approved${loan.approvedBy?.name ? ` by ${loan.approvedBy.name}` : ""}`}
                  date={loan.approvedAt}
                />
              )}
              {loan.status === "rejected" && loan.rejectedAt && (
                <TimelineEvent
                  icon={XCircle}
                  iconClass="bg-red-500/15 text-red-600 dark:text-red-400"
                  title="Rejected"
                  date={loan.rejectedAt}
                  note={loan.rejectionReason}
                />
              )}
              {loan.disbursedAt && (
                <TimelineEvent
                  icon={DollarSign}
                  iconClass="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  title={`Disbursed${loan.disbursedBy?.name ? ` by ${loan.disbursedBy.name}` : ""}`}
                  date={loan.disbursedAt}
                  note={loan.disbursementMethod ? `via ${loan.disbursementMethod.toUpperCase()}${loan.disbursementRef ? ` (${loan.disbursementRef})` : ""}` : null}
                />
              )}
              {loan.status === "fully_repaid" && (
                <TimelineEvent
                  icon={CheckCircle2}
                  iconClass="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  title="Fully Repaid"
                  date={loan.updatedAt}
                />
              )}
              {loan.status === "cancelled" && (
                <TimelineEvent
                  icon={XCircle}
                  iconClass="bg-muted text-muted-foreground"
                  title="Cancelled"
                  date={loan.updatedAt}
                />
              )}
            </div>
          </div>

          {/* Notes */}
          {loan.notes && (
            <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-foreground">Notes</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{loan.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
